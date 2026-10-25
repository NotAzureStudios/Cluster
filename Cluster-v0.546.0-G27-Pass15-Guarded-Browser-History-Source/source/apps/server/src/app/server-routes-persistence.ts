import { type FastifyInstance } from "fastify";

import { z } from "zod";
import type { PersistenceValidationIssue, ServerRouteRegistrationDeps } from "./server-composition-types.js";


export function registerPersistenceRoutes(deps: ServerRouteRegistrationDeps) {
  const app: FastifyInstance = deps.app;
  const {
    CLUSTER_VERSION,
    checksumMatchesRecord,
    logPersistenceAudit,
    parseJsonObject,
    persistenceKindSchema,
    prisma,
    requireAdminUserForRequest,
    serializePersistenceRecord,
    validatePersistencePayload
  } = deps;
  
  
  app.get("/api/persistence/summary", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return { ok: false, error: "Admin required." };
    const [totalRecords, archivedRecords, grouped] = await Promise.all([
      prisma.clusterPersistenceRecord.count(),
      prisma.clusterPersistenceRecord.count({ where: { archived: true } }),
      prisma.clusterPersistenceRecord.groupBy({
        by: ["kind"],
        where: { archived: false },
        _count: { kind: true },
      }),
    ]);
    const countsByKind = Object.fromEntries(grouped.map((item: any) => [item.kind, item._count.kind]));
    return {
      version: CLUSTER_VERSION,
      generatedAt: new Date().toISOString(),
      totalRecords,
      archivedRecords,
      countsByKind,
    };
  });
  
  
  app.get("/api/persistence/records", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return { ok: false, error: "Admin required." };
    const querySchema = z.object({
      kind: persistenceKindSchema.optional(),
      projectId: z.string().optional(),
      status: z.string().optional(),
      archived: z.enum(["true", "false", "all"]).optional(),
      limit: z.coerce.number().int().min(1).max(500).optional(),
    });
    const query = querySchema.parse(request.query);
    const where: any = {};
    if (query.kind) where.kind = query.kind;
    if (query.projectId) where.projectId = query.projectId;
    if (query.status) where.status = query.status;
    if (query.archived !== "all") where.archived = query.archived === "true";
    const records = await prisma.clusterPersistenceRecord.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: query.limit || 200,
    });
    return records.map(serializePersistenceRecord);
  });
  
  
  app.delete("/api/persistence/records/:recordId", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return { ok: false, error: "Admin required." };
    const params = z.object({ recordId: z.string() }).parse(request.params);
    const query = z.object({ force: z.enum(["true", "false"]).optional() }).parse(request.query);
    const existing = await prisma.clusterPersistenceRecord.findUnique({
      where: { id: params.recordId },
    });
    if (!existing) {
      reply.code(404);
      return { ok: false, error: "Persistence record not found." };
    }
    if (existing.locked && query.force !== "true") {
      reply.code(423);
      return {
        ok: false,
        error: "Persistence record is locked. Pass force=true before archiving it.",
      };
    }
    const record = await prisma.clusterPersistenceRecord.update({
      where: { id: params.recordId },
      data: { archived: true, deletedAt: new Date(), syncedAt: new Date(), revision: { increment: 1 } },
    });
    await logPersistenceAudit({
      recordId: record.id,
      kind: record.kind,
      action: "archived",
      actorId: admin.id,
      summary: `Archived ${record.kind}: ${record.title}`,
    });
    return serializePersistenceRecord(record);
  });

  app.get("/api/persistence/records/:recordId", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return { ok: false, error: "Admin required." };
    const params = z.object({ recordId: z.string() }).parse(request.params);
    const record = await prisma.clusterPersistenceRecord.findUnique({
      where: { id: params.recordId },
    });
    if (!record) {
      reply.code(404);
      return { ok: false, error: "Persistence record not found." };
    }
    return serializePersistenceRecord(record);
  });
  
  
  app.get("/api/persistence/audit", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return { ok: false, error: "Admin required." };
    const query = z
      .object({
        recordId: z.string().optional(),
        kind: persistenceKindSchema.optional(),
        action: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(500).optional(),
      })
      .parse(request.query);
    const where: any = {};
    if (query.recordId) where.recordId = query.recordId;
    if (query.kind) where.kind = query.kind;
    if (query.action) where.action = query.action;
    const logs = await prisma.persistenceAuditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: query.limit || 200,
    });
    return logs.map((log: any) => ({
      ...log,
      metadata: parseJsonObject(log.metadata),
    }));
  });
  
  
  app.post("/api/persistence/records/:recordId/validate", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return { ok: false, error: "Admin required." };
    const params = z.object({ recordId: z.string() }).parse(request.params);
    const record = await prisma.clusterPersistenceRecord.findUnique({
      where: { id: params.recordId },
    });
    if (!record) {
      reply.code(404);
      return { ok: false, error: "Persistence record not found." };
    }
    const payload = parseJsonObject(record.payload);
    const validation = validatePersistencePayload(record.kind, payload as any, record.id);
    const updated = await prisma.clusterPersistenceRecord.update({
      where: { id: record.id },
      data: {
        schemaVersion: validation.schemaVersion,
        checksum: validation.checksum,
        validationState: validation.state,
        validationSummary: validation.summary,
        lastValidatedAt: new Date(),
      },
    });
    await logPersistenceAudit({
      recordId: record.id,
      kind: record.kind,
      action: "validated",
      actorId: admin.id,
      summary: `Validated ${record.kind}: ${record.title}`,
      metadata: {
        state: validation.state,
        issues: validation.issues.length,
        warnings: validation.warnings.length,
      },
    });
    return { record: serializePersistenceRecord(updated), validation };
  });
  
  
  app.post("/api/persistence/records/:recordId/lock", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return { ok: false, error: "Admin required." };
    const params = z.object({ recordId: z.string() }).parse(request.params);
    const body = z
      .object({
        locked: z.boolean().default(true),
        reason: z.string().trim().max(240).optional(),
      })
      .parse(request.body || {});
    const record = await prisma.clusterPersistenceRecord.update({
      where: { id: params.recordId },
      data: { locked: body.locked, syncedAt: new Date() },
    });
    await logPersistenceAudit({
      recordId: record.id,
      kind: record.kind,
      action: body.locked ? "locked" : "unlocked",
      actorId: admin.id,
      summary: `${body.locked ? "Locked" : "Unlocked"} ${record.kind}: ${record.title}`,
      metadata: { reason: body.reason || null },
    });
    return serializePersistenceRecord(record);
  });
  
  
  app.post("/api/persistence/bulk-status", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return { ok: false, error: "Admin required." };
    const body = z
      .object({
        recordIds: z.array(z.string()).min(1).max(250),
        status: z.string().trim().min(1).max(80).optional(),
        archived: z.boolean().optional(),
        locked: z.boolean().optional(),
        force: z.boolean().optional().default(false),
        note: z.string().trim().max(300).optional(),
      })
      .parse(request.body);
    const records = await prisma.clusterPersistenceRecord.findMany({
      where: { id: { in: body.recordIds } },
    });
    const lockedRecords = records.filter((record: any) => record.locked && !body.force && body.locked !== false);
    if (lockedRecords.length) {
      reply.code(423);
      return {
        ok: false,
        error: `${lockedRecords.length} selected record(s) are locked. Pass force=true to override.`,
        lockedRecordIds: lockedRecords.map((record: any) => record.id),
      };
    }
    const data: any = { syncedAt: new Date() };
    if (body.status !== undefined) data.status = body.status;
    if (body.archived !== undefined) {
      data.archived = body.archived;
      data.deletedAt = body.archived ? new Date() : null;
    }
    if (body.locked !== undefined) data.locked = body.locked;
    const result = await prisma.clusterPersistenceRecord.updateMany({
      where: { id: { in: body.recordIds } },
      data,
    });
    await logPersistenceAudit({
      kind: "controlSignal",
      action: "bulk_status",
      actorId: admin.id,
      summary: `Bulk updated ${result.count} persistence record(s).`,
      metadata: {
        ...data,
        note: body.note || null,
        recordIds: body.recordIds.slice(0, 50),
      },
    });
    return { ok: true, updated: result.count };
  });
  
  
  app.get("/api/persistence/integrity", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return { ok: false, error: "Admin required." };
    const query = z.object({ limit: z.coerce.number().int().min(1).max(1000).optional() }).parse(request.query);
    const records = await prisma.clusterPersistenceRecord.findMany({
      where: { archived: false },
      orderBy: { updatedAt: "desc" },
      take: query.limit || 1000,
    });
    const issues: PersistenceValidationIssue[] = [];
    const duplicateMap = new Map<string, any[]>();
    const countsByValidationState: Record<string, number> = {};
    const countsByKind: Record<string, number> = {};
    let checksumMismatches = 0;
    let lockedCount = 0;
    for (const record of records as any[]) {
      countsByValidationState[record.validationState || "unchecked"] = (countsByValidationState[record.validationState || "unchecked"] || 0) + 1;
      countsByKind[record.kind] = (countsByKind[record.kind] || 0) + 1;
      if (record.locked) lockedCount += 1;
      const payload = parseJsonObject(record.payload);
      const validation = validatePersistencePayload(record.kind, payload as any, record.id);
      issues.push(...validation.issues, ...validation.warnings);
      if (record.checksum && !checksumMatchesRecord(record)) {
        checksumMismatches += 1;
        issues.push({
          severity: "fail",
          code: "checksum_mismatch",
          message: "Stored checksum does not match payload.",
          kind: record.kind,
          recordId: record.id,
        });
      }
      const dedupeKey = `${record.kind}:${record.sourceKey || "none"}:${record.entityId || "none"}`;
      if (record.entityId) duplicateMap.set(dedupeKey, [...(duplicateMap.get(dedupeKey) || []), record]);
    }
    for (const [key, matches] of duplicateMap.entries()) {
      if (matches.length > 1) {
        issues.push({
          severity: "warn",
          code: "duplicate_entity",
          message: `${matches.length} records share ${key}.`,
          kind: matches[0].kind,
        });
      }
    }
    const failed = issues.filter((issue) => issue.severity === "fail").length;
    const warned = issues.filter((issue) => issue.severity === "warn").length;
    return {
      ok: failed === 0,
      version: CLUSTER_VERSION,
      generatedAt: new Date().toISOString(),
      scanned: records.length,
      lockedCount,
      checksumMismatches,
      countsByKind,
      countsByValidationState,
      issueCounts: {
        fail: failed,
        warn: warned,
        info: issues.filter((issue) => issue.severity === "info").length,
      },
      issues: issues.slice(0, 250),
    };
  });
  
  
  app.post("/api/persistence/repair", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return { ok: false, error: "Admin required." };
    const body = z
      .object({
        kind: persistenceKindSchema.optional(),
        dryRun: z.boolean().optional().default(true),
        includeArchived: z.boolean().optional().default(false),
        limit: z.coerce.number().int().min(1).max(2000).optional(),
      })
      .parse(request.body || {});
    const where: any = {};
    if (body.kind) where.kind = body.kind;
    if (!body.includeArchived) where.archived = false;
    const records = await prisma.clusterPersistenceRecord.findMany({
      where,
      orderBy: { updatedAt: "asc" },
      take: body.limit || 1000,
    });
    const repaired: any[] = [];
    const skippedLocked: string[] = [];
    for (const record of records as any[]) {
      if (record.locked) {
        skippedLocked.push(record.id);
        continue;
      }
      const payload = parseJsonObject(record.payload);
      const validation = validatePersistencePayload(record.kind, payload as any, record.id);
      const patch = {
        schemaVersion: validation.schemaVersion,
        checksum: validation.checksum,
        validationState: validation.state,
        validationSummary: validation.summary,
        lastValidatedAt: new Date(),
      };
      if (!body.dryRun)
        await prisma.clusterPersistenceRecord.update({
          where: { id: record.id },
          data: patch,
        });
      repaired.push({
        id: record.id,
        kind: record.kind,
        title: record.title,
        validationState: validation.state,
        summary: validation.summary,
        checksum: validation.checksum,
      });
    }
    await logPersistenceAudit({
      kind: body.kind || "controlSignal",
      action: body.dryRun ? "repair_dry_run" : "repair_applied",
      actorId: admin.id,
      summary: `${body.dryRun ? "Previewed" : "Applied"} backend repair for ${repaired.length} persistence record(s).`,
      metadata: {
        skippedLocked: skippedLocked.length,
        includeArchived: body.includeArchived,
      },
    });
    return {
      ok: true,
      dryRun: body.dryRun,
      scanned: records.length,
      repaired: repaired.length,
      skippedLocked,
      records: repaired.slice(0, 100),
    };
  });
  
  
  app.get("/api/persistence/export", async (request, reply) => {
    const admin = await requireAdminUserForRequest(request, reply);
    if (!admin) return { ok: false, error: "Admin required." };
    const query = z
      .object({
        kind: persistenceKindSchema.optional(),
        archived: z.enum(["true", "false", "all"]).optional(),
      })
      .parse(request.query);
    const where: any = {};
    if (query.kind) where.kind = query.kind;
    if (query.archived !== "all") where.archived = query.archived === "true";
    const records = await prisma.clusterPersistenceRecord.findMany({
      where,
      orderBy: [{ kind: "asc" }, { updatedAt: "desc" }],
    });
    return {
      version: CLUSTER_VERSION,
      generatedAt: new Date().toISOString(),
      records: records.map(serializePersistenceRecord),
    };
  });
}
