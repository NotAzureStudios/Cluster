import { projectCapsuleLayout } from "../../core/data-layout.js";
import { clusterProjectCapabilitiesForDefinition, clusterProjectSourceControlDefaultsForDefinition, type ClusterProjectCapabilities, type ClusterProjectSourceControlDefaults, type ClusterProjectTypeDefinition } from "@cluster/shared";
export type ProjectSourceControlCreateMode = "auto" | "enabled" | "disabled";
export type ClusterManagedGitRuntime = { initializeManagedRepository: (input: { repositoryId: string; repositoryPath?: string | null; defaultBranch?: string; projectName?: string; lfs?: boolean; ignoreTemplate?: "generic" | "unreal" | "software" }) => Promise<{ defaultBranch: string; headRevision: string; lfs: boolean }>; deleteManagedRepository: (repositoryId: string, repositoryPath?: string | null) => Promise<void>; inspect?: (force?: boolean) => Promise<{ available: boolean; lfsAvailable: boolean; message: string }>; };
export function projectSourceControlPlan(definition: ClusterProjectTypeDefinition, productionProfile: unknown, mode: ProjectSourceControlCreateMode = "auto") {
  const capabilities = clusterProjectCapabilitiesForDefinition(definition, productionProfile); const defaults = clusterProjectSourceControlDefaultsForDefinition(definition, productionProfile); const required = capabilities.sourceControl === "required"; const shouldProvision = mode === "enabled" || (mode === "auto" && ["default", "required"].includes(capabilities.sourceControl)); return { capabilities, defaults, required, shouldProvision };
}
export async function provisionClusterManagedProjectRepository(input: {
  prisma: any;
  gitRuntime: ClusterManagedGitRuntime;
  workspaceId: string;
  project: { id: string; name: string };
  projectDirectory: string;
  definition: ClusterProjectTypeDefinition;
  productionProfile: string;
  defaults: ClusterProjectSourceControlDefaults;
}) {
  const existing = await input.prisma.projectSourceBinding.findFirst({
    where: { projectId: input.project.id, archived: false },
    include: { repository: { include: { connection: true } }, branchPolicy: true },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
  });

  // An interrupted provision may have written the binding and repository
  // authority before Git finished. Reuse the same IDs, never allocate a new
  // repository or falsely report an unfinished one as healthy.
  if (existing?.repository?.healthState === "healthy" && existing.repository.headRevision) {
    return {
      repository: existing.repository,
      binding: existing,
      initialized: {
        defaultBranch: existing.defaultBranch || existing.repository.defaultBranch || input.defaults.defaultBranch,
        headRevision: existing.repository.headRevision,
        lfs: Boolean(input.defaults.lfs),
      },
      reused: true,
    };
  }

  let repository: any = existing?.repository || null;
  let binding: any = existing || null;
  const capsule = projectCapsuleLayout(input.projectDirectory);

  if (!repository) {
    const duplicate = await input.prisma.sourceRepository.findFirst({
      where: { workspaceId: input.workspaceId, name: input.project.name },
      select: { id: true },
    });
    const created = await input.prisma.$transaction(async (tx: any) => {
      const repo = await tx.sourceRepository.create({
        data: {
          workspaceId: input.workspaceId,
          name: duplicate ? `${input.project.name} · ${String(input.project.id).slice(-6)}` : input.project.name,
          hostingMode: "cluster",
          defaultBranch: input.defaults.defaultBranch,
          syncState: "syncing",
          healthState: "unknown",
          metadata: JSON.stringify({
            managedBy: "cluster",
            projectId: input.project.id,
            projectType: input.definition.id,
            productionProfile: input.productionProfile,
            lfs: input.defaults.lfs,
            ignoreTemplate: input.defaults.ignoreTemplate,
            storageKind: "project-capsule",
            repositoryRelativePath: ".cluster/source/repository.git",
            lfsStorageRelativePath: ".cluster/source/repository.git/lfs",
          }),
        },
      });
      const newBinding = await tx.projectSourceBinding.create({
        data: {
          projectId: input.project.id,
          repositoryId: repo.id,
          role: "primary",
          branchRole: "development",
          defaultBranch: input.defaults.defaultBranch,
          isPrimary: true,
        },
      });
      return { repo, binding: newBinding };
    });
    repository = created.repo;
    binding = created.binding;
  }

  try {
    const initialized = await input.gitRuntime.initializeManagedRepository({
      repositoryId: repository.id,
      repositoryPath: capsule.repositoryRoot,
      defaultBranch: input.defaults.defaultBranch,
      projectName: input.project.name,
      lfs: input.defaults.lfs,
      ignoreTemplate: input.defaults.ignoreTemplate,
    });
    const now = new Date();
    const updated = await input.prisma.$transaction(async (tx: any) => {
      const repo = await tx.sourceRepository.update({
        where: { id: repository.id },
        data: {
          defaultBranch: initialized.defaultBranch,
          headRevision: initialized.headRevision,
          syncState: "idle",
          lastSyncedAt: now,
          lastFetchAt: now,
          healthState: "healthy",
          healthMessage: "Cluster-managed repository is ready.",
        },
      });
      await tx.sourceBranch.upsert({
        where: { repositoryId_name: { repositoryId: repository.id, name: initialized.defaultBranch } },
        create: {
          repositoryId: repository.id,
          name: initialized.defaultBranch,
          headRevision: initialized.headRevision,
          isDefault: true,
          protected: false,
          lastCommitAt: now,
          lastSyncedAt: now,
        },
        update: {
          headRevision: initialized.headRevision,
          isDefault: true,
          archived: false,
          lastCommitAt: now,
          lastSyncedAt: now,
        },
      });
      return repo;
    });
    return {
      repository: { ...updated, connection: null },
      binding: { ...binding, branchPolicy: null },
      initialized,
      reused: Boolean(existing),
    };
  } catch (error) {
    // Do not destroy project Git history or its database link when a filesystem,
    // Git LFS or later Prisma step fails. A retry retains the repository ID.
    // If the on-disk repository survived a failed DB commit, the Git runtime
    // refuses to overwrite it and surfaces a recovery-required error instead.
    const detail = error instanceof Error ? error.message : String(error);
    await input.prisma.sourceRepository.update({
      where: { id: repository.id },
      data: {
        syncState: "error",
        healthState: "degraded",
        healthMessage: `Project Git setup incomplete: ${detail}`.slice(0, 500),
      },
    }).catch(() => undefined);
    throw error;
  }
}
