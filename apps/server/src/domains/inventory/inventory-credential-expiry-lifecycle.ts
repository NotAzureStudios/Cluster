// G26 Batch G: durable, administrator-directed Inventory/Vault expiry notices.
// No credential values, fingerprints, Vault IDs or recipient names are copied
// into the inbox. This is an advisory worker, never credential authorization.
const DAY_MS = 86_400_000;
export type InventoryExpiryKind = "digital_seat" | "assigned_key" | "vault_credential";
export type InventoryExpiryStage = "seven_days" | "one_day" | "expired";

export function inventoryExpiryStage(expiresAt: Date | string | null, now = new Date()): InventoryExpiryStage | null {
  if (!expiresAt) return null;
  const time = new Date(expiresAt).getTime();
  const left = time - now.getTime();
  if (!Number.isFinite(left)) return null;
  if (left <= 0) return "expired";
  if (left <= DAY_MS) return "one_day";
  if (left <= 7 * DAY_MS) return "seven_days";
  return null;
}

type CredentialDeadline = { id: string; expiresAt: Date };
const descriptors = {
  digital_seat: { label: "Digital seat allocation", area: "Inventory → Assets" },
  assigned_key: { label: "Assigned license/game key", area: "Inventory → Key Pools" },
  vault_credential: { label: "Vault credential", area: "Inventory → Vault" },
} as const;
const inactiveStates = ["DISABLED", "SUSPENDED", "LOCKED", "PRIVACY_ERASED"];

export async function runInventoryCredentialExpiryTick(input: {
  prisma: any; now?: Date; limitPerKind?: number;
  onCommitted?: (adminIds: string[]) => void;
}) {
  const { prisma } = input;
  const now = input.now || new Date();
  const soon = new Date(now.getTime() + 7 * DAY_MS);
  const limit = Math.min(1000, Math.max(1, input.limitPerKind ?? 250));
  // Selecting one more than our bound ensures overflow is never reported as
  // a complete scan. This job makes no updates if any scope is incomplete.
  const [seats, keys, vault, admins] = await Promise.all([
    prisma.studioInventoryAllocation.findMany({
      where: { status: "active", expiresAt: { lte: soon },
        asset: { status: "active", kind: { in: ["digital", "license"] } } },
      select: { id: true, expiresAt: true }, orderBy: [{ expiresAt: "asc" }, { id: "asc" }], take: limit + 1,
    }),
    prisma.studioInventoryKey.findMany({
      where: { status: "assigned", expiresAt: { lte: soon }, pool: { status: "active" },
        secret: { revokedAt: null }, userId: { not: null } },
      select: { id: true, expiresAt: true }, orderBy: [{ expiresAt: "asc" }, { id: "asc" }], take: limit + 1,
    }),
    prisma.studioVaultSecret.findMany({
      where: { revokedAt: null, expiresAt: { lte: soon } },
      select: { id: true, expiresAt: true }, orderBy: [{ expiresAt: "asc" }, { id: "asc" }], take: limit + 1,
    }),
    prisma.workspaceMember.findMany({
      where: { role: { in: ["owner", "admin"] }, user: { archived: false,
        accountState: { notIn: inactiveStates },
        OR: [{ accessExpiresAt: null }, { accessExpiresAt: { gt: now } }] } },
      select: { userId: true }, take: 501,
    }),
  ]);
  if ([seats, keys, vault].some(rows => rows.length > limit)) throw new Error("INVENTORY_CREDENTIAL_EXPIRY_SCAN_INCOMPLETE");
  if (admins.length > 500) throw new Error("INVENTORY_CREDENTIAL_EXPIRY_ADMIN_SCOPE_INCOMPLETE");
  const adminIds = [...new Set<string>(admins.map((item: { userId: string }) => item.userId))];
  if (!adminIds.length && (seats.length || keys.length || vault.length)) throw new Error("INVENTORY_CREDENTIAL_EXPIRY_NO_ADMIN");
  let committed = 0;
  const cases: Array<{ kind: InventoryExpiryKind; record: CredentialDeadline }> = [
    ...seats.map((record: CredentialDeadline) => ({ kind: "digital_seat" as const, record })),
    ...keys.map((record: CredentialDeadline) => ({ kind: "assigned_key" as const, record })),
    ...vault.map((record: CredentialDeadline) => ({ kind: "vault_credential" as const, record })),
  ];
  for (const { kind, record } of cases) {
    const success = await prisma.$transaction(async (tx: any) => {
      // Lock canonical credential authority, not the reminder. A concurrent
      // extension/revocation cannot produce a stale post-change notice.
      let fresh: any;
      if (kind === "digital_seat") {
        const locked = await tx.$queryRaw`SELECT "id" FROM "StudioInventoryAllocation" WHERE "id" = ${record.id} FOR UPDATE`;
        if (!locked.length) return false;
        fresh = await tx.studioInventoryAllocation.findUnique({ where: { id: record.id },
          select: { status: true, expiresAt: true, asset: { select: { kind: true, status: true } },
            userId: true } });
        if (!fresh || fresh.status !== "active" || fresh.asset?.status !== "active"
          || !["digital", "license"].includes(fresh.asset?.kind)) return false;
      } else if (kind === "assigned_key") {
        const locked = await tx.$queryRaw`SELECT "id" FROM "StudioInventoryKey" WHERE "id" = ${record.id} FOR UPDATE`;
        if (!locked.length) return false;
        fresh = await tx.studioInventoryKey.findUnique({ where: { id: record.id },
          select: { status: true, expiresAt: true, userId: true,
            pool: { select: { status: true } }, secret: { select: { revokedAt: true } } } });
        if (!fresh || fresh.status !== "assigned" || !fresh.userId || fresh.pool?.status !== "active"
          || fresh.secret?.revokedAt) return false;
      } else {
        const locked = await tx.$queryRaw`SELECT "id" FROM "StudioVaultSecret" WHERE "id" = ${record.id} FOR UPDATE`;
        if (!locked.length) return false;
        fresh = await tx.studioVaultSecret.findUnique({ where: { id: record.id },
          select: { expiresAt: true, revokedAt: true } });
        if (!fresh || fresh.revokedAt) return false;
      }
      if (!fresh.expiresAt || new Date(fresh.expiresAt).getTime() !== new Date(record.expiresAt).getTime()) return false;
      if (kind !== "vault_credential") {
        const person = await tx.user.findUnique({ where: { id: fresh.userId },
          select: { archived: true, accountState: true, accessExpiresAt: true } });
        if (!person || person.archived || inactiveStates.includes(person.accountState)
          || (person.accessExpiresAt && new Date(person.accessExpiresAt) <= now)) return false;
      }
      const stage = inventoryExpiryStage(fresh.expiresAt, now);
      if (!stage) return false;
      const expires = new Date(fresh.expiresAt);
      const inserted = await tx.studioInventoryExpiryNotice.createMany({ data: [{
        subjectKind: kind, subjectId: record.id, expiresAt: expires, stage, notifiedAt: now,
      }], skipDuplicates: true });
      if (inserted.count !== 1) return false;
      const scope = descriptors[kind];
      const when = stage === "expired" ? "expired" : stage === "one_day" ? "expires within 24 hours" : "expires within 7 days";
      await tx.notificationInboxItem.createMany({ data: adminIds.map(userId => ({
        userId, category: "system", priority: stage === "expired" ? "high" : "normal",
        title: `${scope.label} ${when}`,
        message: `Credential deadline: ${expires.toISOString()}. Review ${scope.area}.`,
        // Intentionally no entityId, key/secret ID, value or navigable sensitive reference.
        entityType: "security", tool: "system", signal: "inventory_credential_expiration",
        requiresAction: true, groupKey: `credential-deadline:${kind}:${stage}:${expires.toISOString()}`,
      })) });
      return true;
    });
    if (success) {
      committed++;
      // Live invalidation happens after the transaction, never before commit.
      input.onCommitted?.(adminIds);
    }
  }
  return { inspected: { digitalSeats: seats.length, assignedKeys: keys.length, vaultCredentials: vault.length }, committed,
    recipientCount: adminIds.length, containsSecrets: false };
}
