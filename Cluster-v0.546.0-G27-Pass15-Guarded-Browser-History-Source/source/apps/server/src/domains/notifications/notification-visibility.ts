import type { AuthorizationService } from "../access/authorization.js";

export function configureNotificationVisibility(deps: {
  prisma: any;
  authorization: AuthorizationService;
  decorateUserForClient: (user: any) => Promise<any>;
  notificationService: {
    setVisibilityFilter(filter: (userId: string, items: any[]) => Promise<any[]>): void;
    setSubscriptionAuthorization(authorizer: ((input: { userId: string; resource: any; scope: any }) => Promise<boolean>) | null): void;
  };
}) {
  const { prisma, authorization, decorateUserForClient, notificationService } = deps;

  async function identityForUser(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } }).catch(() => null);
    if (!user || user.archived || String(user.accountState || "").toUpperCase() === "PRIVACY_ERASED") return null;
    const decorated = await decorateUserForClient(user);
    return { user, decorated };
  }

  async function canStream(userId: string) {
    const identity = await identityForUser(userId);
    if (!identity) return false;
    return (await authorization.authorize({ user: identity.user, decorated: identity.decorated }, "view", { kind: "tool", tool: "inbox" }, { minimum: "view", surface: "realtime" })).allowed;
  }

  notificationService.setSubscriptionAuthorization(async ({ userId, resource }) => {
    const identity = await identityForUser(userId);
    if (!identity) return false;
    const actor = { user: identity.user, decorated: identity.decorated, role: identity.decorated?.workspaceRole || null };
    const projectId = String(resource?.projectId || "").trim();
    const project = projectId ? await prisma.project.findUnique({ where: { id: projectId } }).catch(() => null) : null;
    if (resource?.kind === "project" && project) {
      return (await authorization.authorize(actor, "subscribe", { kind: "project", project }, { minimum: "view", surface: "realtime" })).allowed;
    }
    const targetKind = resource?.kind === "project_control" ? "control" : String(resource?.kind || "");
    if (!targetKind || !resource?.id) return false;
    return (await authorization.authorize(actor, "subscribe", { kind: "target", targetKind, targetId: String(resource.id), project }, { minimum: "view", surface: "realtime" })).allowed;
  });

  const projectAuthorizationSelect = {
    id: true,
    source: true,
    memberships: {
      where: { status: "active" },
      select: { userId: true, roleKey: true, roleLabel: true, accessLevel: true, isLead: true, status: true, startsAt: true, endsAt: true },
    },
  } as const;

  notificationService.setVisibilityFilter(async (userId: string, items: any[]) => {
    const identity = await identityForUser(userId);
    if (!identity) return [];
    const { user, decorated } = identity;
    const inboxDecision = await authorization.authorize({ user, decorated, role: decorated?.workspaceRole || null }, "view", { kind: "tool", tool: "inbox" }, { minimum: "view", surface: "realtime" });
    if (!inboxDecision.allowed) return [];
    if (decorated?.isAdmin || ["owner", "admin"].includes(String(decorated?.workspaceRole || ""))) return items;

    const eventIds = [...new Set((items || []).map((item: any) => String(item?.activityEventId || "").trim()).filter(Boolean))];
    let visibleEventIds = new Set<string>();
    if (eventIds.length) {
      const events = await prisma.activityEvent.findMany({
        where: { id: { in: eventIds } },
        select: {
          id: true,
          projectId: true,
          boardId: true,
          whiteboardId: true,
          cardId: true,
          entityType: true,
          entityId: true,
          project: { select: projectAuthorizationSelect },
          card: {
            select: {
              id: true,
              workItemKind: true,
              list: {
                select: {
                  board: { select: { id: true, project: { select: projectAuthorizationSelect } } },
                },
              },
            },
          },
        },
      });
      const visibleEvents = await authorization.filterActivityEventsForUser(user, events, "view", decorated);
      visibleEventIds = new Set(visibleEvents.map((event: any) => String(event.id)));
    }

    return (items || []).filter((item: any) => {
      const eventId = String(item?.activityEventId || "").trim();
      if (eventId) return visibleEventIds.has(eventId);
      // Administrative credential warnings remain administrative after a role
      // revocation. Previously delivered records cannot confer continuing access.
      if (item?.signal === "inventory_credential_expiration") return false;
      if (item?.signal === "offboarding_key_rotation_review") return false;
      if (item?.projectId || item?.boardId || item?.cardId) return false;
      const entityType = String(item?.entityType || "").trim().toLowerCase();
      // A committed Packet reminder contains only generic text and is sent
      // directly to the verified recipient. Do not authorize arbitrary Packet
      // entity notifications here: those require a separate visibility model.
      const scopedPacketReminder = entityType === "packet" && item?.signal === "packet_acknowledgment_due"
        && item?.resourceKind === "packet" && String(item?.userId || "") === String(userId)
        && Boolean(item?.entityId) && String(item?.entityId) === String(item?.resourceId || "");
      return scopedPacketReminder || ["notification_digest", "password_reset_request", "account", "session", "security", "announcement"].includes(entityType) || !item?.entityId;
    });
  });

  return { canStream };
}
