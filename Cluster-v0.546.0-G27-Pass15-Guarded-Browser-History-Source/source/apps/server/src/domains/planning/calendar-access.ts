import type { AuthorizationService } from "../access/authorization.js";

function parseCalendarStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export type CalendarAccessMinimum = "view" | "edit" | "manage";

/** Canonical Calendar visibility authority for every server-side projection. */
export async function canAccessCalendarEvent(
  authorization: AuthorizationService,
  request: any,
  event: any,
  minimum: CalendarAccessMinimum = "view",
) {
  const identity = await authorization.identityForRequest(request);
  const actor = identity.user;
  if (!actor) return false;

  const privileged = Boolean(identity.decorated?.isAdmin || ["owner", "admin"].includes(String(identity.role || "")));
  const toolMinimum = minimum === "edit" ? "edit" : minimum;
  if (!privileged && !authorization.hasToolPermission(actor, identity.role, "calendar", toolMinimum)) return false;

  const actorId = String(actor.id || "");
  const ownerId = String(event?.ownerId || "");
  const attendeeIds = parseCalendarStringList(event?.attendeeIds);
  const isOwner = Boolean(actorId && ownerId === actorId);
  const isParticipant = isOwner || attendeeIds.includes(actorId);
  const isDelegate = parseCalendarStringList(event?.delegateIds).includes(actorId);
  const visibility = String(event?.visibility || (event?.projectId ? "project" : "studio"));

  if (minimum === "edit" && isDelegate) {
    if (event?.project) return authorization.requestCanTarget(request, "calendar", String(event.id), event.project, "contribute");
    return true;
  }
  if (visibility === "studio") return true;
  if (visibility === "project") {
    if (!event?.project) return false;
    return authorization.requestCanTarget(request, "calendar", String(event.id), event.project, minimum === "edit" ? "contribute" : minimum);
  }
  if (visibility === "participants") return isParticipant || privileged || (isDelegate && (!event?.project || await authorization.requestCanTarget(request, "calendar", String(event.id), event.project, "view")));
  if (visibility === "private") {
    if (isOwner || privileged) return true;
    if (isDelegate) return !event?.project || authorization.requestCanTarget(request, "calendar", String(event.id), event.project, "view");
    if (minimum === "view") return false;
    return event?.project
      ? authorization.requestCanTarget(request, "calendar", String(event.id), event.project, "manage")
      : authorization.requestCanUserScope(request, { ownerUserId: event?.ownerId, tool: "calendar", minimum: "manage", allowUnowned: true });
  }
  return false;
}

/** Evaluate an offline/background recipient using the SAME visibility authority as
 * HTTP Calendar. Never manufacture a request/session for a background task.
 * Target decisions query authoritative Access Rules and Project policy afresh.
 */
export async function canAccessCalendarEventAsActor(
  authorization: AuthorizationService,
  actor: { user: any; decorated?: any | null; role?: string | null },
  event: any,
  minimum: CalendarAccessMinimum = "view",
): Promise<boolean> {
  if (!actor?.user) return false;
  const role = actor.role ?? actor.decorated?.workspaceRole ?? null;
  const privileged = Boolean(actor.decorated?.isAdmin || ["owner", "admin"].includes(String(role || "")));
  if (!privileged && !authorization.hasToolPermission(actor.user, role, "calendar", minimum === "edit" ? "edit" : minimum)) return false;
  const userId = String(actor.user.id || "");
  const isOwner = Boolean(userId && event?.ownerId === userId);
  const isParticipant = isOwner || parseCalendarStringList(event?.attendeeIds).includes(userId);
  const isDelegate = parseCalendarStringList(event?.delegateIds).includes(userId);
  const visibility = String(event?.visibility || (event?.projectId ? "project" : "studio"));
  if (minimum === "edit" && isDelegate) {
    if (event?.project) return (await authorization.authorize(actor, "contribute", { kind: "target", targetKind: "calendar", targetId: String(event.id), project: event.project }, { minimum: "contribute" })).allowed;
    return true;
  }
  if (visibility === "studio") return true;
  if (visibility === "participants") {
    if (isParticipant || privileged) return true;
    return isDelegate && (!event?.project || (await authorization.authorize(actor, "view", { kind: "target", targetKind: "calendar", targetId: String(event.id), project: event.project }, { minimum: "view" })).allowed);
  }
  if (visibility === "private") {
    if (isOwner || privileged) return true;
    if (isDelegate) return !event?.project || (await authorization.authorize(actor, "view", { kind: "target", targetKind: "calendar", targetId: String(event.id), project: event.project }, { minimum: "view" })).allowed;
    if (minimum === "view") return false;
    const resource = event?.project
      ? { kind: "target" as const, targetKind: "calendar", targetId: String(event.id), project: event.project }
      : { kind: "user" as const, ownerUserId: event?.ownerId, tool: "calendar" as const, allowUnowned: true };
    return (await authorization.authorize(actor, "manage", resource, { minimum: "manage" })).allowed;
  }
  if (visibility === "project") {
    if (!event?.project || event.project.archived) return false;
    const action = minimum === "edit" ? "contribute" : minimum;
    return (await authorization.authorize(actor, action, {
      kind: "target", targetKind: "calendar", targetId: String(event.id), project: event.project,
    }, { minimum: action })).allowed;
  }
  return false;
}
