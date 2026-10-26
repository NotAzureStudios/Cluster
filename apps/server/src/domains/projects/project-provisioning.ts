import { z } from "zod";
import {
  CLUSTER_PROJECT_STATUSES,
  normalizeClusterProjectTypeId,
  resolveClusterProductionProfile,
  type ClusterProjectTypeDefinition,
} from "@cluster/shared";
import { projectSourceControlPlan, provisionClusterManagedProjectRepository, type ClusterManagedGitRuntime } from "./project-source-provisioning.js";
import { projectStorageDirectory, type ClusterDataLayout } from "../../core/data-layout.js";
import type { DurableJobWorker } from "../jobs/job-worker.js";
import { projectTypeTemplateSeeds } from "./project-type-workspace-routes.js";

export const projectProvisioningRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  externalName: z.string().trim().max(200).optional().nullable(),
  codename: z.string().trim().max(120).optional().nullable(),
  aliases: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  description: z.string().max(10_000).optional().nullable(),
  objective: z.string().max(4_000).optional().nullable(),
  clientName: z.string().max(160).optional().nullable(),
  startDate: z.coerce.date().optional().nullable(),
  targetDate: z.coerce.date().optional().nullable(),
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  tags: z.array(z.string().trim().min(1).max(48)).max(24).default([]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().nullable(),
  healthNote: z.string().max(1000).optional().nullable(),
  projectType: z.string().trim().min(1).max(64).default("general"),
  productionProfile: z.string().trim().min(1).max(64).optional(),
  blueprintKey: z.string().trim().max(120).optional().nullable(),
  workspacePresetKey: z.string().trim().max(120).default("standard"),
  status: z.enum(CLUSTER_PROJECT_STATUSES).default("active"),
  external: z.boolean().default(false),
  memberIds: z.array(z.string().trim().min(1)).min(1),
  leadId: z.string().trim().min(1),
  roleLabels: z.record(z.string().trim().max(80)).default({}),
  createDefaultBoard: z.boolean().default(true),
  boardName: z.string().trim().max(120).default("Main Board"),
  createWhiteboard: z.boolean().default(false),
  whiteboardName: z.string().trim().max(120).optional().nullable(),
  whiteboardDescription: z.string().max(4000).optional().nullable(),
  whiteboardCanvasWidth: z.number().int().min(600).max(4000).default(1800),
  whiteboardCanvasHeight: z.number().int().min(400).max(2400).default(950),
  createLibraryFolder: z.boolean().default(true),
  libraryFolderName: z.string().trim().max(200).optional().nullable(),
  libraryFolderDescription: z.string().max(4000).optional().nullable(),
  projectTypeTemplate: z.string().trim().max(120).optional().nullable(),
  sourceControl: z.enum(["auto", "enabled", "disabled"]).default("auto"),
  sourceRepositoryId: z.string().trim().min(1).max(200).optional().nullable(),
  sourceDefaultBranch: z.string().trim().min(1).max(200).optional().nullable(),
  sourceRequireQa: z.boolean().default(false),
  sourceRequireBuild: z.boolean().default(false),
  provisioningKey: z.string().trim().min(8).max(160),
});

export type ProjectProvisioningRequest = z.infer<typeof projectProvisioningRequestSchema>;

type ProvisioningPayload = {
  actorId: string;
  workspaceId: string;
  request: ProjectProvisioningRequest;
  typeDefinition: ClusterProjectTypeDefinition;
};

function unique(values: string[]) { return Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean))); }
function completeStatus(status: string) { return ["done", "complete", "completed", "resolved", "approved", "released", "delivered", "retired", "rejected"].includes(status.toLowerCase()); }

export function buildProjectProvisioningPreview(input: ProjectProvisioningRequest, definition: ClusterProjectTypeDefinition) {
  const projectType = normalizeClusterProjectTypeId(input.projectType);
  const profile = resolveClusterProductionProfile(input.productionProfile || "generic", definition);
  const sourcePlan = projectSourceControlPlan(definition, profile.id, input.sourceControl);
  return {
    project: { name: input.name, externalName: input.externalName || null, codename: input.codename || null, aliases: unique(input.aliases), projectType, productionProfile: profile.id, blueprintKey: input.blueprintKey || input.projectTypeTemplate || null, workspacePresetKey: input.workspacePresetKey },
    membership: { leadId: input.leadId, members: unique([input.leadId, ...input.memberIds]).length },
    sourceControl: { requested: input.sourceControl, capability: sourcePlan.capabilities.sourceControl, required: sourcePlan.required, shouldProvision: sourcePlan.shouldProvision, defaults: sourcePlan.defaults, selectedRepositoryId: input.sourceRepositoryId || null },
    steps: [
      { id: "project", label: "Project record", action: "create-or-resume", required: true },
      { id: "membership", label: "People & access", action: "normalize-memberships", required: true },
      { id: "board", label: "Plan & Control board", action: input.createDefaultBoard ? "provision" : "skip", required: false },
      { id: "whiteboard", label: "Working space", action: input.createWhiteboard ? "provision" : "skip", required: false },
      { id: "library", label: "Project Library", action: input.createLibraryFolder ? "provision" : "skip", required: false },
      { id: "source", label: "Source Control", action: input.sourceRepositoryId ? "bind-repository" : sourcePlan.shouldProvision ? "provision-cluster-repository" : "skip", required: sourcePlan.required },
      { id: "blueprint", label: "Blueprint content", action: input.projectTypeTemplate || input.blueprintKey ? "apply-idempotently" : "skip", required: false },
      { id: "production", label: "Builds / QA production context", action: profile.id === "generic" ? "generic-ready" : `profile:${profile.id}`, required: false },
      { id: "dashboard", label: "Dashboard preset", action: `workspace:${input.workspacePresetKey}`, required: false },
      { id: "automation", label: "Automation hooks", action: input.projectTypeTemplate || input.blueprintKey ? "blueprint-defined" : "not-configured", required: false },
    ],
    boardColumns: definition.boardColumns,
    productionTracks: unique([...(definition.tracks || []), ...(profile.tracks || [])]),
  };
}

export function registerProjectProvisioningJobHandlers(input: { worker: DurableJobWorker; prisma: any; dataLayout: ClusterDataLayout; gitRuntime?: ClusterManagedGitRuntime | null; logActivity?: (input: any) => Promise<unknown> }) {
  input.worker.register<ProvisioningPayload>("project.provision", async ({ payload, updateProgress, throwIfCancelled }) => {
    const parsed = z.object({ actorId: z.string().min(1), workspaceId: z.string().min(1), request: projectProvisioningRequestSchema, typeDefinition: z.any() }).parse(payload || {}) as ProvisioningPayload;
    const request = parsed.request;
    const projectType = normalizeClusterProjectTypeId(request.projectType);
    const profile = resolveClusterProductionProfile(request.productionProfile || "generic", parsed.typeDefinition);
    const memberIds = unique([request.leadId, ...request.memberIds]);
    const roleLabels = { ...request.roleLabels, [request.leadId]: request.roleLabels[request.leadId] || "Project Lead" };
    const sourcePlan = projectSourceControlPlan(parsed.typeDefinition, profile.id, request.sourceControl);
    if (sourcePlan.required && request.sourceControl === "disabled" && !request.sourceRepositoryId) throw Object.assign(new Error(`${parsed.typeDefinition.label} projects require Cluster Source Control.`), { code: "PROJECT_SOURCE_REQUIRED" });
    const stepReceipts: Array<{ id: string; state: "created" | "reused" | "skipped" | "ready"; resourceId?: string | null }> = [];

    await throwIfCancelled();
    await updateProgress(5, "Creating or resuming project authority");
    let project = await input.prisma.project.findUnique({ where: { provisioningKey: request.provisioningKey }, include: { memberships: true } });
    let projectCreatedByOperation = false;
    if (!project) {
      project = await input.prisma.project.create({
        data: {
          workspaceId: parsed.workspaceId,
          name: request.name,
          externalName: request.externalName || null,
          codename: request.codename || null,
          aliases: JSON.stringify(unique(request.aliases)),
          description: request.description || null,
          objective: request.objective || null,
          clientName: request.clientName || null,
          startDate: request.startDate || null,
          targetDate: request.targetDate || null,
          priority: request.priority,
          tags: JSON.stringify(unique(request.tags)),
          color: request.color || null,
          healthNote: request.healthNote || null,
          projectType,
          productionProfile: profile.id,
          blueprintKey: request.blueprintKey || request.projectTypeTemplate || null,
          workspacePresetKey: request.workspacePresetKey,
          provisioningKey: request.provisioningKey,
          status: request.status,
          source: request.external ? "external" : "manual",
          productionTracks: JSON.stringify(unique([...(parsed.typeDefinition.tracks || []), ...(profile.tracks || [])])),
          memberships: {
            create: memberIds.map((userId) => {
              const isLead = userId === request.leadId;
              return { userId, roleKey: isLead ? "lead" : "member", roleLabel: roleLabels[userId] || (isLead ? "Project Lead" : "Member"), allocationPercent: 100, accessLevel: isLead ? "manage" : "contribute", isLead, status: "active" };
            }),
          },
        },
        include: { memberships: true },
      });
      projectCreatedByOperation = true;
      stepReceipts.push({ id: "project", state: "created", resourceId: project.id });
    } else {
      stepReceipts.push({ id: "project", state: "reused", resourceId: project.id });
    }

    await throwIfCancelled();
    await updateProgress(20, "Reconciling project membership and access");
    for (const userId of memberIds) {
      const isLead = userId === request.leadId;
      await input.prisma.projectMembership.upsert({
        where: { projectId_userId: { projectId: project.id, userId } },
        update: { roleKey: isLead ? "lead" : "member", roleLabel: roleLabels[userId] || (isLead ? "Project Lead" : "Member"), isLead, accessLevel: isLead ? "manage" : "contribute", status: "active", endsAt: null },
        create: { projectId: project.id, userId, roleKey: isLead ? "lead" : "member", roleLabel: roleLabels[userId] || (isLead ? "Project Lead" : "Member"), isLead, accessLevel: isLead ? "manage" : "contribute", allocationPercent: 100, status: "active" },
      });
    }
    await input.prisma.projectMembership.updateMany({ where: { projectId: project.id, userId: { notIn: memberIds }, status: "active" }, data: { status: "inactive", endsAt: new Date() } });
    stepReceipts.push({ id: "membership", state: "ready", resourceId: project.id });

    await throwIfCancelled();
    await updateProgress(35, "Provisioning Plan & Control workspace");
    if (request.createDefaultBoard) {
      let board = await input.prisma.board.findFirst({ where: { projectId: project.id, name: request.boardName, archived: false }, include: { lists: true } });
      if (!board) {
        board = await input.prisma.board.create({ data: { projectId: project.id, name: request.boardName, lists: { create: (parsed.typeDefinition.boardColumns || ["Backlog", "To Do", "In Progress", "Review", "Done"]).map((title: string, position: number) => ({ title, position, isDone: ["Done", "Approved", "Release", "Publish", "Delivered"].includes(title) })) } }, include: { lists: true } });
        stepReceipts.push({ id: "board", state: "created", resourceId: board.id });
      } else stepReceipts.push({ id: "board", state: "reused", resourceId: board.id });
    } else stepReceipts.push({ id: "board", state: "skipped" });

    await throwIfCancelled();
    await updateProgress(48, "Provisioning collaborative spaces");
    if (request.createWhiteboard) {
      const name = request.whiteboardName || `${request.name} Whiteboard`;
      let whiteboard = await input.prisma.whiteboard.findFirst({ where: { projectId: project.id, name } });
      if (!whiteboard) whiteboard = await input.prisma.whiteboard.create({ data: { projectId: project.id, name, description: request.whiteboardDescription || request.description || null, elements: "[]", canvasWidth: request.whiteboardCanvasWidth, canvasHeight: request.whiteboardCanvasHeight } });
      stepReceipts.push({ id: "whiteboard", state: whiteboard.createdAt && whiteboard.updatedAt && new Date(whiteboard.createdAt).getTime() === new Date(whiteboard.updatedAt).getTime() ? "created" : "reused", resourceId: whiteboard.id });
    } else stepReceipts.push({ id: "whiteboard", state: "skipped" });

    await throwIfCancelled();
    await updateProgress(60, "Provisioning project Library and access");
    if (request.createLibraryFolder) {
      let folder = project.libraryFolderId ? await input.prisma.libraryItem.findUnique({ where: { id: project.libraryFolderId } }) : null;
      if (!folder) folder = await input.prisma.libraryItem.findFirst({ where: { projectId: project.id, type: "folder", source: "project-folder", status: { notIn: ["archived", "trashed"] }, lifecycleState: { not: "destroyed" }, deletedAt: null } });
      const existed = Boolean(folder);
      if (!folder) folder = await input.prisma.libraryItem.create({ data: { projectId: project.id, title: request.libraryFolderName || `${request.name} Library`, body: request.libraryFolderDescription || request.description || "Project-bound library folder.", type: "folder", status: "active", priority: "medium", tags: JSON.stringify(unique(["project-library", "folder", projectType, profile.id])), pinned: true, source: "project-folder" } });
      if (project.libraryFolderId !== folder.id) await input.prisma.project.update({ where: { id: project.id }, data: { libraryFolderId: folder.id } });
      for (const userId of memberIds) await input.prisma.folderPermission.upsert({ where: { folderId_userId: { folderId: folder.id, userId } }, update: { access: userId === request.leadId ? "manage" : "edit" }, create: { folderId: folder.id, userId, access: userId === request.leadId ? "manage" : "edit" } });
      stepReceipts.push({ id: "library", state: existed ? "reused" : "created", resourceId: folder.id });
    } else stepReceipts.push({ id: "library", state: "skipped" });

    await throwIfCancelled();
    await updateProgress(68, request.sourceRepositoryId ? "Binding selected Source repository" : sourcePlan.shouldProvision ? "Provisioning Cluster Source Control" : "Source Control not required");
    let sourceOutcome: Record<string, unknown> = { state: "skipped", bindingId: null, repositoryId: null, hostingMode: null, defaultBranch: sourcePlan.defaults.defaultBranch, lfs: sourcePlan.defaults.lfs, ignoreTemplate: sourcePlan.defaults.ignoreTemplate, requestedRepositoryId: request.sourceRepositoryId || null, mode: request.sourceControl, capability: sourcePlan.capabilities.sourceControl, required: sourcePlan.required, reason: "Project capabilities do not require Source Control by default." };
    if (request.sourceRepositoryId) {
      const repository = await input.prisma.sourceRepository.findFirst({ where: { id: request.sourceRepositoryId, workspaceId: parsed.workspaceId, archived: false } });
      if (!repository) throw Object.assign(new Error("The selected Source repository is unavailable in this workspace."), { code: "PROJECT_PROVISION_SOURCE_REPOSITORY_NOT_FOUND" });
      const existingBinding = await input.prisma.projectSourceBinding.findUnique({ where: { projectId_repositoryId: { projectId: project.id, repositoryId: repository.id } } });
      const binding = await input.prisma.projectSourceBinding.upsert({ where: { projectId_repositoryId: { projectId: project.id, repositoryId: repository.id } }, create: { projectId: project.id, repositoryId: repository.id, role: "primary", branchRole: "development", defaultBranch: request.sourceDefaultBranch || repository.defaultBranch || "main", isPrimary: true, archived: false }, update: { role: "primary", branchRole: "development", defaultBranch: request.sourceDefaultBranch || repository.defaultBranch || "main", isPrimary: true, archived: false } });
      await input.prisma.projectSourceBinding.updateMany({ where: { projectId: project.id, id: { not: binding.id }, isPrimary: true }, data: { isPrimary: false } });
      await input.prisma.sourceBranchPolicy.upsert({ where: { bindingId: binding.id }, create: { bindingId: binding.id, requireQa: request.sourceRequireQa, requireBuild: request.sourceRequireBuild }, update: { requireQa: request.sourceRequireQa, requireBuild: request.sourceRequireBuild } });
      const sourceState = existingBinding ? "reused" : "created";
      sourceOutcome = { state: sourceState, bindingId: binding.id, repositoryId: repository.id, hostingMode: repository.hostingMode || (repository.connectionId ? "provider" : "cluster"), defaultBranch: binding.defaultBranch || repository.defaultBranch || sourcePlan.defaults.defaultBranch, lfs: sourcePlan.defaults.lfs, ignoreTemplate: sourcePlan.defaults.ignoreTemplate, requestedRepositoryId: request.sourceRepositoryId, mode: request.sourceControl, capability: sourcePlan.capabilities.sourceControl, required: sourcePlan.required, reason: null };
      stepReceipts.push({ id: "source", state: sourceState, resourceId: binding.id });
    } else if (sourcePlan.shouldProvision) {
      try {
        if (!input.gitRuntime) throw new Error("Cluster Git runtime is unavailable.");
        const projectDirectory = await projectStorageDirectory(input.prisma, input.dataLayout, project.id);
        const source = await provisionClusterManagedProjectRepository({ prisma: input.prisma, gitRuntime: input.gitRuntime, workspaceId: parsed.workspaceId, project, projectDirectory, definition: parsed.typeDefinition, productionProfile: profile.id, defaults: sourcePlan.defaults });
        const sourceState = source.reused ? "reused" : "created";
        sourceOutcome = { state: sourceState, bindingId: source.binding.id, repositoryId: source.repository.id, hostingMode: "cluster", defaultBranch: source.initialized.defaultBranch, lfs: source.initialized.lfs, ignoreTemplate: sourcePlan.defaults.ignoreTemplate, requestedRepositoryId: null, mode: request.sourceControl, capability: sourcePlan.capabilities.sourceControl, required: sourcePlan.required, reason: null };
        stepReceipts.push({ id: "source", state: sourceState, resourceId: source.binding.id });
        if (!source.reused) await input.logActivity?.({ userId: parsed.actorId, projectId: project.id, type: "created", entityType: "source_repository", entityId: source.repository.id, title: "Project repository created", message: `${source.repository.name} · ${source.initialized.defaultBranch}`, metadata: { hostingMode: "cluster", lfs: source.initialized.lfs, ignoreTemplate: sourcePlan.defaults.ignoreTemplate, projectType: parsed.typeDefinition.id, productionProfile: profile.id } });
      } catch (error) {
        if (projectCreatedByOperation) await input.prisma.project.delete({ where: { id: project.id } }).catch(() => undefined);
        const rollbackMessage = projectCreatedByOperation ? "The partial project was rolled back." : "The existing project was preserved.";
        throw Object.assign(new Error(`Cluster could not provision the project repository. ${rollbackMessage}`), { code: "PROJECT_SOURCE_PROVISION_FAILED", cause: error });
      }
    } else stepReceipts.push({ id: "source", state: "skipped" });

    await throwIfCancelled();
    await updateProgress(74, "Applying Project Blueprint");
    const template = request.projectTypeTemplate || request.blueprintKey;
    if (template && (parsed.typeDefinition.workspaceEntities || []).length) {
      const available = (parsed.typeDefinition.productionTemplates || []).find((candidate: string) => candidate.toLowerCase() === template.toLowerCase());
      if (available) {
        for (const [index, seed] of projectTypeTemplateSeeds(parsed.typeDefinition, available).slice(0, 20).entries()) {
          const entity = (parsed.typeDefinition.workspaceEntities || []).find((item: any) => item.id === seed.entityKind);
          if (!entity) continue;
          const category = `type-workspace:${parsed.typeDefinition.id}:${entity.id}`;
          const exists = await input.prisma.projectControlRecord.findFirst({ where: { projectId: project.id, category, title: seed.title } });
          if (exists) continue;
          const status = seed.status && entity.statuses.includes(seed.status) ? seed.status : entity.defaultStatus;
          await input.prisma.projectControlRecord.create({ data: { projectId: project.id, kind: entity.baseKind, title: seed.title, description: seed.description || null, status, priority: seed.priority || "medium", category, completedAt: completeStatus(status) ? new Date() : null, progress: completeStatus(status) ? 100 : 0, sortOrder: index * 100, payload: JSON.stringify({ ...(seed.payload || {}), projectTypeId: parsed.typeDefinition.id, projectTypeEntityKind: entity.id, projectTypeTemplate: available, provisionedByOperation: true }) } });
        }
        stepReceipts.push({ id: "blueprint", state: "ready", resourceId: project.id });
      } else stepReceipts.push({ id: "blueprint", state: "skipped" });
    } else stepReceipts.push({ id: "blueprint", state: "skipped" });

    await throwIfCancelled();
    await updateProgress(86, "Finalizing Project workspace preset and production context");
    stepReceipts.push({ id: "production", state: "ready", resourceId: project.id });

    const dashboardSourceKey = `project-dashboard:${project.id}`;
    const dashboardPayload = { workspacePresetKey: request.workspacePresetKey, widgets: parsed.typeDefinition.dashboardWidgets || [], projectType, productionProfile: profile.id };
    const dashboardRecord = await input.prisma.clusterPersistenceRecord.findFirst({ where: { projectId: project.id, kind: "projectDashboardPreset", sourceKey: dashboardSourceKey, archived: false } });
    if (dashboardRecord) {
      await input.prisma.clusterPersistenceRecord.update({ where: { id: dashboardRecord.id }, data: { payload: JSON.stringify(dashboardPayload), status: "active", validationState: "valid", lastValidatedAt: new Date(), revision: { increment: 1 } } });
      stepReceipts.push({ id: "dashboard", state: "reused", resourceId: dashboardRecord.id });
    } else {
      const createdDashboard = await input.prisma.clusterPersistenceRecord.create({ data: { projectId: project.id, kind: "projectDashboardPreset", title: `${request.name} dashboard preset`, entityType: "project", entityId: project.id, userId: parsed.actorId, ownerId: parsed.actorId, status: "active", visibility: "internal", sourceKey: dashboardSourceKey, schemaVersion: 1, validationState: "valid", lastValidatedAt: new Date(), payload: JSON.stringify(dashboardPayload) } });
      stepReceipts.push({ id: "dashboard", state: "created", resourceId: createdDashboard.id });
    }

    const automationCount = await input.prisma.projectControlRecord.count({ where: { projectId: project.id, kind: "automation", archived: false } });
    stepReceipts.push({ id: "automation", state: automationCount > 0 ? "ready" : "skipped", resourceId: automationCount > 0 ? project.id : null });
    const sourceReceipt = stepReceipts.find((step) => step.id === "source");
    const automationReceipt = stepReceipts.find((step) => step.id === "automation");
    const receiptPayload = {
      provisioningKey: request.provisioningKey, workspacePresetKey: request.workspacePresetKey, projectType, productionProfile: profile.id,
      dashboardWidgets: parsed.typeDefinition.dashboardWidgets || [],
      source: { ...sourceOutcome, state: sourceReceipt?.state || String(sourceOutcome["state"] || "skipped"), bindingId: sourceReceipt?.resourceId || sourceOutcome["bindingId"] || null },
      productionContext: { state: "ready", buildProfileKey: parsed.typeDefinition.buildProfileKey, tracks: unique([...(parsed.typeDefinition.tracks || []), ...(profile.tracks || [])]), deliveryGatePolicy: parsed.typeDefinition.deliveryGatePolicy || null },
      automation: { state: automationReceipt?.state || "skipped", configuredRules: automationCount },
      accessPolicy: "project-membership", steps: stepReceipts,
    };
    const existingReceipt = await input.prisma.clusterPersistenceRecord.findFirst({ where: { projectId: project.id, kind: "projectWorkspaceProvisioning", sourceKey: `project-provision:${request.provisioningKey}`, archived: false } });
    if (existingReceipt) await input.prisma.clusterPersistenceRecord.update({ where: { id: existingReceipt.id }, data: { payload: JSON.stringify(receiptPayload), status: "complete", validationState: "valid", lastValidatedAt: new Date(), revision: { increment: 1 } } });
    else await input.prisma.clusterPersistenceRecord.create({ data: { projectId: project.id, kind: "projectWorkspaceProvisioning", title: `${request.name} workspace provisioning`, entityType: "project", entityId: project.id, userId: parsed.actorId, ownerId: parsed.actorId, status: "complete", visibility: "internal", sourceKey: `project-provision:${request.provisioningKey}`, schemaVersion: 1, validationState: "valid", lastValidatedAt: new Date(), payload: JSON.stringify(receiptPayload) } });

    await input.logActivity?.({ userId: parsed.actorId, projectId: project.id, type: "created", entityType: "project_provisioning", entityId: project.id, title: "Project workspace provisioned", message: request.name, metadata: { provisioningKey: request.provisioningKey, projectType, productionProfile: profile.id, workspacePresetKey: request.workspacePresetKey } });
    await updateProgress(100, "Project workspace ready");
    return { projectId: project.id, provisioningKey: request.provisioningKey, projectType, productionProfile: profile.id, source: receiptPayload.source, steps: stepReceipts };
  });
}
