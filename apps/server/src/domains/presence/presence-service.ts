import { loadPresenceProfile } from "./presence-policy-service.js";

const MAX_CONTEXT_LIFETIME_MS = 12 * 60 * 60 * 1000;

function contextExpiry(value: string | null | undefined) {
  if (!value) return new Date(Date.now() + 2 * 60 * 60 * 1000);
  const date = new Date(value);
  const maximum = Date.now() + MAX_CONTEXT_LIFETIME_MS;
  if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) throw new Error("Presence context expiry must be in the future.");
  if (date.getTime() > maximum) return new Date(maximum);
  return date;
}

async function workspaceIdForUser(prisma: any, userId: string) {
  const membership = await prisma.workspaceMember.findFirst({ where: { userId }, orderBy: { workspaceId: "asc" }, select: { workspaceId: true } });
  return membership?.workspaceId || null;
}

export function createPresenceService(deps: any) {
  async function contextAccess(user: any, input: { projectId?: string | null; repositoryId?: string | null }) {
    let project: any | null = null;
    let repository: any | null = null;
    if (input.projectId) {
      project = await deps.prisma.project.findFirst({ where: { id: input.projectId, archived: false } });
      if (!project) throw new Error("Project context was not found.");
      const membership = await deps.prisma.projectMembership.findFirst({ where: { projectId: project.id, userId: user.id, status: "active" } });
      if (!membership && !(await deps.decorateUserForClient(user))?.isAdmin) throw new Error("Project context is not available to this account.");
    }
    if (input.repositoryId) {
      repository = await deps.prisma.sourceRepository.findFirst({ where: { id: input.repositoryId, archived: false } });
      if (!repository) throw new Error("Repository context was not found.");
      const workspaceId = await workspaceIdForUser(deps.prisma, user.id);
      if (!workspaceId || repository.workspaceId !== workspaceId) throw new Error("Repository context is not available to this account.");
      const bindings = await deps.prisma.projectSourceBinding.findMany({ where: { repositoryId: repository.id, archived: false }, include: { project: { include: { memberships: { where: { status: "active" } } } } }, take: 25 });
      const compatible = input.projectId ? bindings.some((binding: any) => binding.projectId === input.projectId) : bindings.some((binding: any) => !binding.project?.archived);
      if (bindings.length && !compatible) throw new Error("Repository context does not belong to the selected project.");
    }
    return { project, repository };
  }

  return {
    async read(user: any) {
      return loadPresenceProfile(deps.prisma, user.id);
    },
    async heartbeat(user: any) {
      await deps.prisma.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } });
      return { ok: true };
    },
    async update(user: any, input: { availability?: string; message?: string | null; declaredStatus?: string | null; presenceDisclosure?: string; connectionVisibility?: "visible" | "invisible" }) {
      const status = await deps.prisma.workforceStatus.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          availability: input.availability || "available",
          availabilityMessage: input.message || null,
          connectionVisibility: input.connectionVisibility || "visible",
          declaredStatus: input.declaredStatus || null,
          presenceDisclosure: input.presenceDisclosure || "work_state",
          updatedByUserId: user.id,
        },
        update: {
          availability: input.availability,
          availabilityMessage: input.message === undefined ? undefined : input.message || null,
          connectionVisibility: input.connectionVisibility,
          declaredStatus: input.declaredStatus === undefined ? undefined : input.declaredStatus || null,
          presenceDisclosure: input.presenceDisclosure,
          updatedByUserId: user.id,
        },
      });
      const updated = await deps.prisma.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } });
      await deps.logActivity({
        userId: user.id,
        type: "availability",
        entityType: "user",
        entityId: user.id,
        title: "Availability updated",
        message: status.declaredStatus || status.availabilityMessage || status.availability,
        metadata: { connectionVisibility: status.connectionVisibility, presenceDisclosure: status.presenceDisclosure },
      });
      return updated;
    },
    async updateContext(user: any, input: any) {
      const { project, repository: sourceRepository } = await contextAccess(user, input);
      if (input.resourceKind && !input.resourceId) throw new Error("Resource context requires a resource id.");
      if (input.resourceId && !input.resourceKind) throw new Error("Resource context requires a resource kind.");
      if (input.branch && !input.repositoryId) throw new Error("Branch context requires a repository.");
      const expiresAt = contextExpiry(input.expiresAt);
      const context = await deps.prisma.presenceContext.upsert({
        where: { userId: user.id },
        create: {
          userId: user.id,
          applicationKey: input.applicationKey || null,
          projectId: project?.id || input.projectId || null,
          repositoryId: sourceRepository?.id || input.repositoryId || null,
          branch: input.branch || null,
          resourceKind: input.resourceKind || null,
          resourceId: input.resourceId || null,
          sensitivity: input.sensitivity || "normal",
          source: "declared",
          expiresAt,
        },
        update: {
          applicationKey: input.applicationKey === undefined ? undefined : input.applicationKey || null,
          projectId: input.projectId === undefined ? undefined : project?.id || input.projectId || null,
          repositoryId: input.repositoryId === undefined ? undefined : sourceRepository?.id || input.repositoryId || null,
          branch: input.branch === undefined ? undefined : input.branch || null,
          resourceKind: input.resourceKind === undefined ? undefined : input.resourceKind || null,
          resourceId: input.resourceId === undefined ? undefined : input.resourceId || null,
          sensitivity: input.sensitivity || undefined,
          source: "declared",
          expiresAt,
        },
      });
      await deps.logActivity?.({
        userId: user.id,
        projectId: context.projectId || null,
        type: "presence_context",
        entityType: "user",
        entityId: user.id,
        title: "Work context updated",
        message: context.projectId ? "Project work context updated" : context.applicationKey ? "Application work context updated" : "Work context updated",
        metadata: { applicationKey: context.applicationKey, projectId: context.projectId, repositoryId: context.repositoryId, resourceKind: context.resourceKind },
      });
      return loadPresenceProfile(deps.prisma, user.id);
    },
    async clearContext(user: any) {
      await deps.prisma.presenceContext.deleteMany({ where: { userId: user.id } });
      return loadPresenceProfile(deps.prisma, user.id);
    },
  };
}
