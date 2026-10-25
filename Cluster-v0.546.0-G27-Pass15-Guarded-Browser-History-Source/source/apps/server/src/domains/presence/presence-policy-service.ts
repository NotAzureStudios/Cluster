import type { CollaborationPresence } from "../../core/collaboration-runtime.js";

export const PRESENCE_DISCLOSURE_LEVELS = ["connection", "work_state", "application", "project", "detailed"] as const;
export type PresenceDisclosure = typeof PRESENCE_DISCLOSURE_LEVELS[number];

export type PresenceWorkContext = {
  applicationKey?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  repositoryId?: string | null;
  repositoryName?: string | null;
  branch?: string | null;
  resourceKind?: string | null;
  resourceId?: string | null;
  source?: string | null;
  sensitivity?: string | null;
  expiresAt?: Date | string | null;
};

function disclosureRank(value: unknown) {
  const index = PRESENCE_DISCLOSURE_LEVELS.indexOf(String(value || "work_state") as PresenceDisclosure);
  return index < 0 ? 1 : index;
}

function contextExpired(context: any, now = Date.now()) {
  return Boolean(context?.expiresAt && new Date(context.expiresAt).getTime() <= now);
}

export async function loadPresenceProfile(prisma: any, userId: string) {
  const [status, context, activeTime] = await Promise.all([
    prisma.workforceStatus.findUnique({ where: { userId } }).catch(() => null),
    prisma.presenceContext?.findUnique?.({ where: { userId } }).catch(() => null),
    prisma.timeEntry.findFirst({ where: { userId, endedAt: null }, orderBy: { startedAt: "desc" }, select: { id: true, projectId: true, title: true, startedAt: true, breaks: { where: { endedAt: null }, select: { id: true }, take: 1 } } }).catch(() => null),
  ]);
  const usableContext = context && !contextExpired(context) ? context : null;
  const [project, repository] = await Promise.all([
    usableContext?.projectId ? prisma.project.findFirst({ where: { id: usableContext.projectId, archived: false }, select: { id: true, name: true } }).catch(() => null) : null,
    usableContext?.repositoryId ? prisma.sourceRepository.findFirst({ where: { id: usableContext.repositoryId, archived: false }, select: { id: true, name: true } }).catch(() => null) : null,
  ]);
  return {
    status: status || null,
    activeTime: activeTime || null,
    context: usableContext ? {
      applicationKey: usableContext.applicationKey || null,
      projectId: project?.id || usableContext.projectId || null,
      projectName: project?.name || null,
      repositoryId: repository?.id || usableContext.repositoryId || null,
      repositoryName: repository?.name || null,
      branch: usableContext.branch || null,
      resourceKind: usableContext.resourceKind || null,
      resourceId: usableContext.resourceId || null,
      source: usableContext.source || null,
      sensitivity: usableContext.sensitivity || "normal",
      expiresAt: usableContext.expiresAt || null,
    } : null,
  };
}

export function composeCollaborationPresence(base: CollaborationPresence, profile: any): CollaborationPresence {
  const status = profile?.status || {};
  const context = profile?.context || null;
  return {
    ...base,
    activity: null,
    availability: status.availability || "available",
    availabilityMessage: status.availabilityMessage || null,
    declaredStatus: status.declaredStatus || null,
    connectionVisibility: status.connectionVisibility || "visible",
    presenceDisclosure: status.presenceDisclosure || "work_state",
    clockState: profile?.activeTime ? (profile.activeTime.breaks?.length ? "break" : "in") : "out",
    workContext: context,
  };
}

export function sanitizePresenceForRecipient(presence: CollaborationPresence, input: { self: boolean; canSeePrivateConnection: boolean }) {
  const privateConnection = input.self || input.canSeePrivateConnection;
  if (presence.connectionVisibility === "invisible" && !privateConnection) return null;

  const rank = disclosureRank(presence.presenceDisclosure);
  const result: CollaborationPresence = {
    ...presence,
    connectionVisibility: privateConnection ? presence.connectionVisibility : undefined,
    availability: rank >= 1 ? presence.availability : undefined,
    availabilityMessage: rank >= 1 ? presence.availabilityMessage : undefined,
    declaredStatus: rank >= 1 ? presence.declaredStatus : undefined,
    clockState: rank >= 1 ? presence.clockState : undefined,
    workContext: null,
    // The server never relays free-form heartbeat activity. Context is composed from approved fields.
    activity: rank >= 1 ? `working in ${presence.tool}` : null,
  };
  if (!presence.workContext || rank < 2) return result;

  const context = presence.workContext;
  const restricted = String(context.sensitivity || "normal") === "restricted";
  result.workContext = {
    applicationKey: rank >= 2 ? context.applicationKey || null : null,
    projectId: rank >= 3 ? context.projectId || null : null,
    projectName: rank >= 3 ? context.projectName || null : null,
    repositoryId: !restricted && rank >= 4 ? context.repositoryId || null : null,
    repositoryName: !restricted && rank >= 4 ? context.repositoryName || null : null,
    branch: !restricted && rank >= 4 ? context.branch || null : null,
    resourceKind: !restricted && rank >= 4 ? context.resourceKind || null : null,
    resourceId: !restricted && rank >= 4 ? context.resourceId || null : null,
    source: null,
    sensitivity: restricted ? "restricted" : "normal",
    expiresAt: null,
  };
  return result;
}
