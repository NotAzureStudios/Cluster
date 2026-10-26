// Administrative on-demand Inventory/Vault custody projection. Read-only,
// bounded and deliberately secret-free. A healthy result never substitutes
// for an authenticated reveal, security PIN or an independent access review.
import { z } from "zod";

export type InventoryKeyCustodyReason =
  | "no_known_custody_blocker" | "pool_closed" | "key_expired"
  | "vault_revoked" | "vault_expired" | "recipient_missing" | "recipient_inactive"
  | "key_expires_soon" | "vault_expires_soon" | "recipient_access_expires_soon";

export function keyCustodyReason(key: {
  expiresAt?: Date | string | null; secret: { revokedAt?: Date | string | null; expiresAt?: Date | string | null };
}, poolStatus: string, user: { archived?: boolean; accountState?: string; accessExpiresAt?: Date | string | null } | null,
now: Date): InventoryKeyCustodyReason {
  if (poolStatus !== "active") return "pool_closed";
  if (key.expiresAt && new Date(key.expiresAt) <= now) return "key_expired";
  if (key.secret.revokedAt) return "vault_revoked";
  if (key.secret.expiresAt && new Date(key.secret.expiresAt) <= now) return "vault_expired";
  if (!user) return "recipient_missing";
  if (user.archived || user.accountState !== "ACTIVE"
    || (user.accessExpiresAt && new Date(user.accessExpiresAt) <= now)) return "recipient_inactive";
  // Advisory status only. A future deadline is not a revocation and cannot
  // grant/revoke custody; every reveal still does its own authorization check.
  const soon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  if (key.expiresAt && new Date(key.expiresAt) <= soon) return "key_expires_soon";
  if (key.secret.expiresAt && new Date(key.secret.expiresAt) <= soon) return "vault_expires_soon";
  if (user.accessExpiresAt && new Date(user.accessExpiresAt) <= soon) return "recipient_access_expires_soon";
  return "no_known_custody_blocker";
}

export async function inspectPoolKeyCustody(db: any, poolId: string, cursor?: string, now = new Date()) {
  const pool = await db.studioInventoryKeyPool.findUnique({where: {id: poolId}, select: {id: true, status: true, title: true}});
  if (!pool) return null;
  // The (poolId,status,id) index supports stable bounded incremental reads.
  // This is intentionally page-scoped, not a fabricated global compliance total.
  const rows = await db.studioInventoryKey.findMany({
    where: {poolId, status: "assigned", ...(cursor ? {id: {gt: cursor}} : {})},
    select: {id: true, userId: true, expiresAt: true, revision: true, firstRevealedAt: true,
      secret: {select: {revokedAt: true, expiresAt: true}}},
    orderBy: {id: "asc"}, take: 51,
  });
  const page = rows.slice(0, 50);
  const userIds = [...new Set(page.map((key: any) => key.userId).filter(Boolean))];
  const users = userIds.length ? await db.user.findMany({
    where: {id: {in: userIds}}, select: {id: true, archived: true, accountState: true, accessExpiresAt: true},
    take: 50,
  }) : [];
  if (users.length > userIds.length) throw new Error("Inventory key recipient query returned an invalid scope");
  const people = new Map(users.map((user: any) => [user.id, user]));
  const cases = page.map((key: any) => {
    const reason = keyCustodyReason(key, pool.status, (people.get(key.userId) || null) as any, now);
    return {keyId: key.id, userId: key.userId, revision: key.revision,
      expiresAt: key.expiresAt, firstRevealedAt: key.firstRevealedAt,
      reason, requiresReview: reason !== "no_known_custody_blocker"};
  });
  return {poolId: pool.id, poolTitle: pool.title, asOf: now.toISOString(), cases,
    nextCursor: rows.length > 50 ? page[49]?.id : null,
    scope: "assigned_keys_in_this_page_only", hasGlobalCounts: false,
    containsVaultSecrets: false, revealsAuthorized: false};
}

export function registerInventoryKeyReadinessRoutes(deps: {
  app: any; prisma: any; admin: (req: any, reply: any) => Promise<any>;
}) {
  const {app, prisma, admin} = deps;
  app.get("/api/admin/inventory/key-pools/:id/custody-review", async (request: any, reply: any) => {
    if (!(await admin(request, reply))) return;
    const {id} = z.object({id: z.string().trim().min(1).max(160)}).strict().parse(request.params || {});
    const {cursor} = z.object({cursor: z.string().trim().min(1).max(160).optional()}).strict().parse(request.query || {});
    reply.header("Cache-Control", "private, no-store");
    const result = await inspectPoolKeyCustody(prisma, id, cursor);
    if (!result) return reply.code(404).send({ok: false, code: "KEY_POOL_NOT_FOUND"});
    return {ok: true, review: result};
  });
}
