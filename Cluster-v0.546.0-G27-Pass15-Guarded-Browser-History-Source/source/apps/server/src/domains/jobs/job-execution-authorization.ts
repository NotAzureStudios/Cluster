import type { AuthorizationService } from "../access/authorization.js";
import type { DurableJobWorker } from "./job-worker.js";
import type { BackgroundJobAuthorizationRequirement } from "./job-types.js";
import type { LibraryAccessService, LibraryAccessLevel } from "../library/library-access-service.js";

export function configureBackgroundJobExecutionAuthorization(input: {
  worker: DurableJobWorker;
  prisma: any;
  authorization: AuthorizationService;
  decorateUserForClient: (user: any) => Promise<any>;
  libraryAccess: LibraryAccessService;
}) {
  const { worker, prisma, authorization, decorateUserForClient, libraryAccess } = input;

  async function resolveResource(requirement: BackgroundJobAuthorizationRequirement) {
    const resource = requirement.resource;
    if (resource.kind === "workspace") return { kind: "workspace" } as const;
    if (resource.kind === "tool") return { kind: "tool", tool: resource.tool } as const;
    if (resource.kind === "user") return { kind: "user", ownerUserId: resource.ownerUserId || null, tool: resource.tool, allowUnowned: Boolean(resource.allowUnowned) } as const;
    if (resource.kind === "project") {
      const project = await prisma.project.findUnique({ where: { id: resource.projectId }, include: { memberships: { where: { status: "active" } } } }).catch(() => null);
      return project ? { kind: "project", project } as const : null;
    }
    if (resource.kind === "target") {
      const projectId = String(resource.projectId || "").trim();
      const project = projectId ? await prisma.project.findUnique({ where: { id: projectId }, include: { memberships: { where: { status: "active" } } } }).catch(() => null) : null;
      return { kind: "target", targetKind: resource.targetKind, targetId: resource.targetId, project } as const;
    }
    return null;
  }

  worker.setExecutionAuthorizer(async ({ job, requirement }) => {
    const requestedActorId = String(requirement.actorUserId || "").trim();
    const creatorId = String(job.createdById || "").trim();
    if (requestedActorId && creatorId && requestedActorId !== creatorId) {
      return { allowed: false, code: "BACKGROUND_JOB_ACTOR_MISMATCH", reason: "The queued authorization actor does not match the job creator." };
    }
    const actorId = requestedActorId || creatorId;
    if (!actorId) return { allowed: false, code: "BACKGROUND_JOB_ACTOR_REQUIRED", reason: "This background operation no longer has an accountable actor." };

    const user = await prisma.user.findUnique({ where: { id: actorId } }).catch(() => null);
    if (!user || user.archived || String(user.accountState || "").toUpperCase() === "PRIVACY_ERASED") {
      return { allowed: false, code: "BACKGROUND_JOB_ACTOR_UNAVAILABLE", reason: "The actor account is no longer available." };
    }
    const decorated = await decorateUserForClient(user);
    if (requirement.tool === "library" && requirement.resource.kind === "target" && requirement.resource.targetKind === "library") {
      const item = await prisma.libraryItem.findUnique({ where: { id: requirement.resource.targetId }, include: { project: { include: { memberships: { where: { status: "active" } } } } } }).catch(() => null);
      if (!item) return { allowed: false, code: "BACKGROUND_JOB_RESOURCE_UNAVAILABLE", reason: "The protected Library item no longer exists." };
      const context = await libraryAccess.contextForUser(user);
      const minimum = (String(requirement.minimum || "view") === "manage" ? "manage" : String(requirement.minimum || "view") === "edit" ? "edit" : String(requirement.minimum || "view") === "contribute" ? "contribute" : "view") as LibraryAccessLevel;
      const decision = libraryAccess.explainAccess(context, item, minimum);
      return { allowed: decision.allowed, code: decision.allowed ? decision.reasonCode : "BACKGROUND_JOB_AUTHORIZATION_REVOKED", reason: decision.contributors.map((entry) => entry.detail).join(" ") };
    }
    const resource = await resolveResource(requirement);
    if (!resource) return { allowed: false, code: "BACKGROUND_JOB_RESOURCE_UNAVAILABLE", reason: "The protected resource no longer exists." };
    const decision = await authorization.authorize(
      { user, decorated, role: decorated?.workspaceRole || null },
      requirement.action,
      resource as any,
      { minimum: requirement.minimum, tool: requirement.tool || undefined, surface: "api" },
    );
    return { allowed: decision.allowed, code: decision.allowed ? decision.code : "BACKGROUND_JOB_AUTHORIZATION_REVOKED", reason: decision.reason };
  });

  return worker;
}
