import { randomUUID } from "node:crypto";

export type SyncConflictAction = "keep_mine" | "keep_server" | "merge" | "restore" | "duplicate" | "discard";

export type SyncConflictRecord = {
  id: string; userId: string; deviceId: string; mutationId: string; idempotencyKey: string;
  entityType: string | null; entityId: string | null; classification: string; status: string;
  localPayload: unknown; serverPayload: unknown; allowedActions: SyncConflictAction[];
  resolution: SyncConflictAction | null; createdAt: string; resolvedAt: string | null;
};

function json(value: unknown) { try { return JSON.stringify(value ?? null); } catch { return "null"; } }
function parse(value: unknown) { if (typeof value !== "string") return value ?? null; try { return JSON.parse(value); } catch { return value; } }
function iso(value: unknown) { const date = new Date(String(value || "")); return Number.isFinite(date.getTime()) ? date.toISOString() : String(value || ""); }

function mapConflict(row: any): SyncConflictRecord {
  return {
    id: String(row.id), userId: String(row.userId), deviceId: String(row.deviceId), mutationId: String(row.mutationId), idempotencyKey: String(row.idempotencyKey),
    entityType: row.entityType == null ? null : String(row.entityType), entityId: row.entityId == null ? null : String(row.entityId),
    classification: String(row.classification), status: String(row.status), localPayload: parse(row.localPayload), serverPayload: parse(row.serverPayload),
    allowedActions: Array.isArray(parse(row.allowedActions)) ? parse(row.allowedActions) : [], resolution: row.resolution == null ? null : row.resolution,
    createdAt: iso(row.createdAt), resolvedAt: row.resolvedAt == null ? null : iso(row.resolvedAt),
  };
}

export function createSyncControlRepository(prisma: any) {
  return {
    async ensure() { return undefined; },
    async registerDevice(input: { id?: string; userId: string; name?: string | null; platform?: string | null; clientVersion?: string | null; mutationSchemaVersion?: number }) {
      const now = new Date();
      const id = input.id || randomUUID();
      const existing = await prisma.clusterSyncDevice.findUnique({ where: { id }, select: { userId: true } });
      if (existing && existing.userId !== input.userId) return { id, ownershipConflict: true, lastSeenAt: now.toISOString() };
      const update: Record<string, unknown> = { lastSeenAt: now, updatedAt: now };
      if (input.name !== undefined) update.name = input.name;
      if (input.platform !== undefined) update.platform = input.platform;
      if (input.clientVersion !== undefined) update.clientVersion = input.clientVersion;
      if (input.mutationSchemaVersion !== undefined) update.mutationSchemaVersion = input.mutationSchemaVersion;
      const device = await prisma.clusterSyncDevice.upsert({
        where: { id },
        create: { id, userId: input.userId, name: input.name ?? null, platform: input.platform ?? null, clientVersion: input.clientVersion ?? null, mutationSchemaVersion: input.mutationSchemaVersion ?? 1, lastSeenAt: now, createdAt: now, updatedAt: now },
        update,
      });
      if (device.userId !== input.userId) return { id, ownershipConflict: true, lastSeenAt: device.lastSeenAt.toISOString() };
      return { id: device.id, ownershipConflict: false, lastSeenAt: device.lastSeenAt.toISOString() };
    },
    async acknowledge(input: { deviceId: string; userId: string; cursor?: string | null }) {
      const now = new Date();
      const updated = await prisma.clusterSyncDevice.updateMany({ where: { id: input.deviceId, userId: input.userId }, data: { lastCursor: input.cursor ?? null, lastSeenAt: now, updatedAt: now } });
      return { deviceId: input.deviceId, cursor: input.cursor ?? null, acknowledgedAt: now.toISOString(), accepted: updated.count === 1 };
    },
    async receipt(userId: string, deviceId: string, idempotencyKey: string) {
      const row = await prisma.clusterSyncReceipt.findUnique({ where: { userId_deviceId_idempotencyKey: { userId, deviceId, idempotencyKey } } });
      return row ? { statusCode: Number(row.statusCode), requestId: row.requestId || null, payload: parse(row.responsePayload) } : null;
    },
    async recordReceipt(input: { userId: string; deviceId: string; mutationId: string; idempotencyKey: string; statusCode: number; payload: unknown; requestId?: string | null }) {
      const createdAt = new Date();
      await prisma.clusterSyncReceipt.upsert({
        where: { userId_deviceId_idempotencyKey: { userId: input.userId, deviceId: input.deviceId, idempotencyKey: input.idempotencyKey } },
        create: { id: randomUUID(), userId: input.userId, deviceId: input.deviceId, mutationId: input.mutationId, idempotencyKey: input.idempotencyKey, statusCode: input.statusCode, responsePayload: json(input.payload), requestId: input.requestId ?? null, createdAt },
        update: { mutationId: input.mutationId, statusCode: input.statusCode, responsePayload: json(input.payload), requestId: input.requestId ?? null, createdAt },
      });
    },
    async activeConflict(userId: string, deviceId: string, idempotencyKey: string) {
      const row = await prisma.clusterSyncConflict.findFirst({
        where: { userId, deviceId, idempotencyKey, status: { in: ["OPEN", "QUARANTINED"] } },
        orderBy: { createdAt: "desc" },
      });
      return row ? mapConflict(row) : null;
    },
    async createConflict(input: Omit<SyncConflictRecord, "id" | "createdAt" | "resolvedAt" | "resolution" | "status"> & { status?: string }) {
      const existing = await prisma.clusterSyncConflict.findFirst({
        where: { userId: input.userId, deviceId: input.deviceId, idempotencyKey: input.idempotencyKey, status: { in: ["OPEN", "QUARANTINED"] } },
        orderBy: { createdAt: "desc" },
        select: { id: true, createdAt: true },
      });
      if (existing) return { id: existing.id, createdAt: existing.createdAt.toISOString() };
      const created = await prisma.clusterSyncConflict.create({ data: { id: randomUUID(), userId: input.userId, deviceId: input.deviceId, mutationId: input.mutationId, idempotencyKey: input.idempotencyKey, entityType: input.entityType ?? null, entityId: input.entityId ?? null, classification: input.classification, status: input.status ?? "OPEN", localPayload: json(input.localPayload), serverPayload: json(input.serverPayload), allowedActions: json(input.allowedActions), createdAt: new Date() } });
      return { id: created.id, createdAt: created.createdAt.toISOString() };
    },
    async listConflicts(input: { userId: string; deviceId?: string | null; status?: string | null; limit: number; cursor?: { at: Date; id: string } | null }) {
      const where: any = { userId: input.userId };
      if (input.deviceId) where.deviceId = input.deviceId;
      if (input.status) where.status = input.status;
      if (input.cursor) where.OR = [{ createdAt: { lt: input.cursor.at } }, { createdAt: input.cursor.at, id: { lt: input.cursor.id } }];
      const rows = await prisma.clusterSyncConflict.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: input.limit + 1 });
      return rows.map(mapConflict);
    },
    async resolveConflict(input: { id: string; userId: string; action: SyncConflictAction }) {
      const row = await prisma.clusterSyncConflict.findFirst({ where: { id: input.id, userId: input.userId } });
      if (!row) return null;
      const allowed = Array.isArray(parse(row.allowedActions)) ? parse(row.allowedActions) : [];
      if (!["OPEN", "QUARANTINED"].includes(String(row.status)) || !allowed.includes(input.action)) return { conflict: mapConflict(row), allowed: false };
      // A second tab can resolve the same conflict between our read and write. Only
      // the first matching OPEN/QUARANTINED transition is authoritative.
      const updated = await prisma.clusterSyncConflict.updateMany({
        where: { id: row.id, userId: input.userId, status: { in: ["OPEN", "QUARANTINED"] } },
        data: { status: "RESOLVED", resolution: input.action, resolvedAt: new Date() },
      });
      const current = await prisma.clusterSyncConflict.findFirst({ where: { id: input.id, userId: input.userId } });
      if (!current) return null;
      return { conflict: mapConflict(current), allowed: updated.count === 1 };
    },
    async status(input: { userId: string; deviceId?: string | null }) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const deviceWhere = { userId: input.userId, ...(input.deviceId ? { id: input.deviceId } : {}) };
      const conflictWhere = { userId: input.userId, ...(input.deviceId ? { deviceId: input.deviceId } : {}) };
      const receiptWhere = { userId: input.userId, ...(input.deviceId ? { deviceId: input.deviceId } : {}), createdAt: { gte: since } };
      const [devices, grouped, replayed24h, failed24h, oldestOpenConflict] = await Promise.all([
        prisma.clusterSyncDevice.findMany({ where: deviceWhere, orderBy: { lastSeenAt: "desc" }, take: input.deviceId ? 1 : 20 }),
        prisma.clusterSyncConflict.groupBy({ by: ["status"], where: conflictWhere, _count: { _all: true } }),
        prisma.clusterSyncReceipt.count({ where: receiptWhere }),
        prisma.clusterSyncReceipt.count({ where: { ...receiptWhere, statusCode: { gte: 400 } } }),
        prisma.clusterSyncConflict.findFirst({ where: { ...conflictWhere, status: "OPEN" }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
      ]);
      return {
        devices,
        conflicts: Object.fromEntries(grouped.map((row: any) => [String(row.status).toLowerCase(), Number(row._count?._all || 0)])),
        replay: { windowHours: 24, completed: replayed24h, failed: failed24h, oldestOpenConflictAt: oldestOpenConflict?.createdAt?.toISOString?.() || null },
      };
    },
  };
}
