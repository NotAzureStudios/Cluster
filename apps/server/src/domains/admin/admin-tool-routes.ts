import fs from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ClusterDataLayout } from "../../core/data-layout.js";
import { z } from "zod";
import { CLUSTER_PROJECT_CALENDAR_VIEW_VALUES } from "@cluster/shared";
import { projectCalendarViewSnapshot, updateProjectCalendarView } from "./project-tool-settings.js";
import { CLUSTER_ADMIN_CONFIGURABLE_TOOL_IDS, CLUSTER_TOOL_SETTING_KEYS, CLUSTER_TOOL_CONFIG_FIELDS, clusterResolveToolConfig, clusterToolSettingProvenance, clusterToolStudioChangeImpact, clusterToolSettingKeys, type ClusterSettingPrecondition, type ClusterToolFieldSpec, type ClusterAdminConfigurableToolId } from "@cluster/shared";

type AdminToolRouteDeps = {
  prisma: any;
  getCurrentUser: (request: FastifyRequest) => Promise<any>;
  decorateUserForClient: (user: any) => Promise<any>;
  readSettings: () => Promise<Record<string, any>>;
  saveSettings: (settings: Record<string, any>) => Promise<void>;
  patchSettings: (patch: Record<string, any>, expected?: Record<string, ClusterSettingPrecondition>) => Promise<unknown>;
  readSettingPreconditions: (keys: string[]) => Promise<Record<string, ClusterSettingPrecondition>>;
  resetSettingOverrides: (keys: string[], expected: Record<string, ClusterSettingPrecondition>) => Promise<{ changedKeys: string[] }>;
  verifyStorageSchema: () => Promise<void>;
  logSecurityEvent: (input: any) => Promise<unknown>;
  dataLayout: ClusterDataLayout;
};

export function registerAdminToolRoutes(app: FastifyInstance, deps: AdminToolRouteDeps) {
  const { prisma, getCurrentUser, decorateUserForClient, readSettings, patchSettings, readSettingPreconditions, resetSettingOverrides, verifyStorageSchema, logSecurityEvent, dataLayout } = deps;
  const ADMIN_TOOL_KEYS = [...CLUSTER_ADMIN_CONFIGURABLE_TOOL_IDS];
  type AdminToolKey = ClusterAdminConfigurableToolId;
  type AdminToolOperation = {
    id: string;
    label: string;
    danger?: boolean;
    requiresDays?: boolean;
    defaultDays?: number;
  };

  const ADMIN_TOOL_OPERATIONS: Record<AdminToolKey, AdminToolOperation[]> = {
    timeline: [
      { id: "resolve-discussions", label: "Resolve open discussions" },
      { id: "remove-past-manual", label: "Delete old manual items", danger: true, requiresDays: true, defaultDays: 180 }
    ],
    tickets: [
      { id: "archive-resolved", label: "Archive resolved tickets" },
      { id: "purge-archived", label: "Delete archived tickets", danger: true, requiresDays: true, defaultDays: 90 }
    ],
    calendar: [
      { id: "remove-cancelled", label: "Delete past cancelled events", danger: true },
      { id: "remove-past", label: "Delete old events", danger: true, requiresDays: true, defaultDays: 365 }
    ],
    scheduler: [
      { id: "stop-stale-timers", label: "Stop stale timers" },
      { id: "lock-closed", label: "Lock old entries", requiresDays: true, defaultDays: 14 },
      { id: "clear-old-schedule", label: "Delete old schedule blocks", danger: true, requiresDays: true, defaultDays: 90 }
    ],
    library: [
      { id: "verify-storage", label: "Verify storage" },
      { id: "archive-deprecated", label: "Archive deprecated items" },
      { id: "archive-stale-drafts", label: "Archive stale drafts", requiresDays: true, defaultDays: 90 },
      { id: "clear-model-thumbnails", label: "Rebuild model thumbnails" },
      { id: "clear-model-cache", label: "Clear converted model cache" }
    ],
    packets: [
      { id: "ensure-root", label: "Create or repair Packets root" },
      { id: "archive-empty", label: "Archive empty packets", danger: true },
      { id: "normalize-folders", label: "Normalize packet folder metadata" }
    ]
  };

  // Defined once, not reconstructed for each API write. Constraint definitions
  // are shared with the renderer without importing Zod into its startup graph.
  const TOOL_CONFIG_SCHEMAS = Object.fromEntries(CLUSTER_ADMIN_CONFIGURABLE_TOOL_IDS.map((tool: AdminToolKey) => {
    const shape: Record<string, z.ZodTypeAny> = {};
    for (const [field, spec] of Object.entries(CLUSTER_TOOL_CONFIG_FIELDS[tool] as Readonly<Record<string, ClusterToolFieldSpec>>)) {
      let validator: z.ZodTypeAny;
      if (spec.kind === "boolean") validator = z.boolean();
      else if (spec.kind === "enum") validator = z.enum([...spec.values] as [string, ...string[]]);
      else if (spec.kind === "number") {
        let number = z.number();
        if (spec.integer) number = number.int();
        if (spec.min !== undefined) number = number.min(spec.min);
        if (spec.max !== undefined) number = number.max(spec.max);
        validator = number;
      } else if (spec.kind === "string-array") {
        let array = z.array(z.string());
        if (spec.max !== undefined) array = array.max(spec.max);
        validator = array;
      } else {
        let string = z.string();
        if (spec.min !== undefined) string = string.min(spec.min);
        if (spec.max !== undefined) string = string.max(spec.max);
        if (spec.format === "HH:mm") string = string.regex(/^\d{2}:\d{2}$/);
        validator = string;
      }
      shape[field] = validator;
    }
    return [tool, z.object(shape)];
  })) as Record<AdminToolKey, z.ZodTypeAny>;

  function adminToolSettings(tool: AdminToolKey, settings: Record<string, any>) {
    return clusterResolveToolConfig(tool, settings);
  }

  async function requireToolAdmin(request: FastifyRequest, reply: FastifyReply) {
    const user = await getCurrentUser(request);
    const decorated = user ? await decorateUserForClient(user) : null;
    if (!decorated?.isAdmin) {
      reply.code(403).send({ ok: false, error: "Administrator access required." });
      return null;
    }
    return decorated;
  }

  async function toolRuntimeSnapshot(tool: AdminToolKey) {
    if (tool === "timeline") {
      const [records, upcoming, openDiscussions, pastManual] = await Promise.all([
        prisma.timelineItem.count(),
        prisma.timelineItem.count({ where: { startsAt: { gte: new Date() } } }),
        prisma.entityComment.count({ where: { entityType: "timeline", resolved: false } }),
        prisma.timelineItem.count({ where: { source: "manual", startsAt: { lt: new Date() } } })
      ]);
      return { records, active: upcoming, openDiscussions, pastManual, detail: `${upcoming} upcoming · ${openDiscussions} open discussions` };
    }
    if (tool === "tickets") {
      const ticketWhere = { workItemKind: "ticket" };
      const [records, urgent, resolved, archived] = await Promise.all([
        prisma.card.count({ where: { ...ticketWhere, archived: false } }),
        prisma.card.count({ where: { ...ticketWhere, archived: false, priority: "urgent" } }),
        prisma.card.count({ where: { ...ticketWhere, archived: false, ticketStage: "resolved" } }),
        prisma.card.count({ where: { ...ticketWhere, archived: true } })
      ]);
      return { records, active: urgent, resolved, archived, detail: `${urgent} urgent · ${resolved} resolved · ${archived} archived` };
    }
    if (tool === "calendar") {
      const now = new Date();
      const [records, upcoming, cancelled, past] = await Promise.all([
        prisma.calendarEvent.count(),
        prisma.calendarEvent.count({ where: { startsAt: { gte: now } } }),
        prisma.calendarEvent.count({ where: { status: "cancelled", startsAt: { lt: now } } }),
        prisma.calendarEvent.count({ where: { startsAt: { lt: now } } })
      ]);
      return { records, active: upcoming, cancelled, past, detail: `${upcoming} upcoming · ${cancelled} cancelled` };
    }
    if (tool === "scheduler") {
      const settings = await readSettings();
      const staleCutoff = new Date(Date.now() - Number(settings.schedulerAutoCloseHours || 16) * 60 * 60 * 1000);
      const [records, running, stale, scheduled, locked, resources, maintenanceResources, mirroredWindows] = await Promise.all([
        prisma.timeEntry.count(),
        prisma.timeEntry.count({ where: { endedAt: null } }),
        prisma.timeEntry.count({ where: { endedAt: null, startedAt: { lt: staleCutoff } } }),
        prisma.scheduleBlock.count({ where: { endsAt: { gte: new Date() }, status: { not: "cancelled" } } }),
        prisma.timeEntry.count({ where: { lockedAt: { not: null } } }),
        prisma.scheduleResource.count({ where: { status: { not: "retired" } } }),
        prisma.scheduleResource.count({ where: { status: "maintenance" } }),
        prisma.scheduleBlock.count({ where: { calendarSync: true, endsAt: { gte: new Date() } } }),
      ]);
      return { records, active: running, stale, scheduled, locked, resources, maintenanceResources, mirroredWindows, detail: `${running} running · ${scheduled} scheduled · ${resources} resources` };
    }
    if (tool === "packets") {
      const root = await prisma.libraryItem.findFirst({ where: { type: "folder", source: "packets-root", status: { not: "archived" } }, select: { id: true } });
      if (!root) return { records: 0, active: 0, items: 0, detail: "Packets root is not initialized" };
      const packets = await prisma.libraryItem.findMany({ where: { parentId: root.id, type: "folder", status: { not: "archived" } }, select: { id: true } });
      const packetIds = packets.map((packet: { id: string }) => packet.id);
      const items = packetIds.length ? await prisma.libraryItem.count({ where: { parentId: { in: packetIds }, status: { not: "archived" } } }) : 0;
      return { records: packets.length, active: packets.length, items, rootId: root.id, detail: `${packets.length} packets · ${items} resources` };
    }
    const [records, files, folders, links, archived, staleDrafts] = await Promise.all([
      prisma.libraryItem.count({ where: { status: { not: "archived" } } }),
      prisma.libraryItem.count({ where: { fileName: { not: null }, status: { not: "archived" } } }),
      prisma.libraryItem.count({ where: { type: "folder", status: { not: "archived" } } }),
      prisma.libraryItem.count({ where: { type: { in: ["link", "youtube-video", "youtube-playlist"] }, status: { not: "archived" } } }),
      prisma.libraryItem.count({ where: { status: "archived" } }),
      prisma.libraryItem.count({ where: { status: "draft", updatedAt: { lt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) } } })
    ]);
    let storageOk = true;
    try { await verifyStorageSchema(); } catch { storageOk = false; }
    let modelThumbnails = 0;
    try { modelThumbnails = (await fs.readdir(path.join(dataLayout.runtimeRoot, "library-model-thumbnails"))).filter((name) => /\.(?:webp|png|jpg)$/i.test(name)).length; } catch {}
    return { records, active: files, folders, links, archived, staleDrafts, modelThumbnails, storageOk, detail: `${files} files · ${modelThumbnails} model thumbnails · ${archived} archived` };
  }

  async function runToolOperation(tool: AdminToolKey, action: string, days: number | undefined) {
    const now = new Date();
    const cutoff = new Date(now.getTime() - Number(days || 0) * 24 * 60 * 60 * 1000);

    if (tool === "timeline" && action === "resolve-discussions") {
      const result = await prisma.entityComment.updateMany({ where: { entityType: "timeline", resolved: false }, data: { resolved: true } });
      return { affected: result.count, message: `${result.count} discussion${result.count === 1 ? "" : "s"} resolved.` };
    }
    if (tool === "timeline" && action === "remove-past-manual") {
      const result = await prisma.timelineItem.deleteMany({ where: { source: "manual", startsAt: { lt: cutoff } } });
      return { affected: result.count, message: `${result.count} manual item${result.count === 1 ? "" : "s"} deleted.` };
    }

    if (tool === "tickets" && action === "archive-resolved") {
      const result = await prisma.card.updateMany({ where: { archived: false, workItemKind: "ticket", ticketStage: "resolved" }, data: { archived: true } });
      return { affected: result.count, message: `${result.count} resolved ticket${result.count === 1 ? "" : "s"} archived.` };
    }
    if (tool === "tickets" && action === "purge-archived") {
      const result = await prisma.card.deleteMany({ where: { archived: true, workItemKind: "ticket", updatedAt: { lt: cutoff } } });
      return { affected: result.count, message: `${result.count} archived ticket${result.count === 1 ? "" : "s"} deleted.` };
    }

    if (tool === "calendar" && action === "remove-cancelled") {
      const result = await prisma.calendarEvent.deleteMany({ where: { status: "cancelled", startsAt: { lt: now } } });
      return { affected: result.count, message: `${result.count} cancelled event${result.count === 1 ? "" : "s"} deleted.` };
    }
    if (tool === "calendar" && action === "remove-past") {
      const result = await prisma.calendarEvent.deleteMany({ where: { OR: [{ endsAt: { lt: cutoff } }, { endsAt: null, startsAt: { lt: cutoff } }] } });
      return { affected: result.count, message: `${result.count} old event${result.count === 1 ? "" : "s"} deleted.` };
    }

    if (tool === "scheduler" && action === "stop-stale-timers") {
      const settings = await readSettings();
      const autoCloseHours = Math.max(1, Math.min(72, Number(settings.schedulerAutoCloseHours || 16)));
      const staleCutoff = new Date(now.getTime() - autoCloseHours * 60 * 60 * 1000);
      const entries = await prisma.timeEntry.findMany({ where: { endedAt: null, startedAt: { lt: staleCutoff } }, select: { id: true, startedAt: true } });
      if (entries.length) {
        await prisma.$transaction(entries.map((entry: { id: string; startedAt: Date }) => {
          const endedAt = new Date(entry.startedAt.getTime() + autoCloseHours * 60 * 60 * 1000);
          return prisma.timeEntry.update({ where: { id: entry.id }, data: { endedAt, durationMinutes: autoCloseHours * 60 } });
        }));
      }
      return { affected: entries.length, message: `${entries.length} stale timer${entries.length === 1 ? "" : "s"} stopped.` };
    }
    if (tool === "scheduler" && action === "lock-closed") {
      const result = await prisma.timeEntry.updateMany({ where: { endedAt: { not: null }, startedAt: { lt: cutoff }, lockedAt: null }, data: { lockedAt: now } });
      return { affected: result.count, message: `${result.count} time entr${result.count === 1 ? "y" : "ies"} locked.` };
    }
    if (tool === "scheduler" && action === "clear-old-schedule") {
      const result = await prisma.scheduleBlock.deleteMany({ where: { endsAt: { lt: cutoff } } });
      return { affected: result.count, message: `${result.count} schedule block${result.count === 1 ? "" : "s"} deleted.` };
    }

    if (tool === "packets" && action === "ensure-root") {
      const settings = await readSettings();
      const rootName = String(settings.packetsRootName || "Packets").trim().slice(0, 100) || "Packets";
      const existing = await prisma.libraryItem.findFirst({ where: { type: "folder", source: "packets-root", status: { not: "archived" } } });
      if (existing) {
        await prisma.libraryItem.update({ where: { id: existing.id }, data: { title: rootName, metadata: JSON.stringify({ packetRoot: true, folderColor: "#7aa8ff", folderIcon: "note" }) } });
        return { affected: 1, message: "Packets root repaired." };
      }
      await prisma.libraryItem.create({ data: { title: rootName, type: "folder", status: "active", priority: "medium", tags: JSON.stringify(["packets"]), visibility: "internal", metadata: JSON.stringify({ packetRoot: true, folderColor: "#7aa8ff", folderIcon: "note" }), source: "packets-root" } });
      return { affected: 1, message: "Packets root created." };
    }
    if (tool === "packets" && action === "archive-empty") {
      const root = await prisma.libraryItem.findFirst({ where: { type: "folder", source: "packets-root", status: { not: "archived" } }, select: { id: true } });
      if (!root) return { affected: 0, message: "Packets root is not initialized." };
      const packets = await prisma.libraryItem.findMany({ where: { parentId: root.id, type: "folder", status: { not: "archived" } }, include: { _count: { select: { children: true } } } });
      const emptyIds = packets.filter((packet: any) => Number(packet._count?.children || 0) === 0).map((packet: any) => packet.id);
      if (emptyIds.length) await prisma.libraryItem.updateMany({ where: { id: { in: emptyIds } }, data: { status: "archived" } });
      return { affected: emptyIds.length, message: `${emptyIds.length} empty packet${emptyIds.length === 1 ? "" : "s"} archived.` };
    }
    if (tool === "packets" && action === "normalize-folders") {
      const root = await prisma.libraryItem.findFirst({ where: { type: "folder", source: "packets-root", status: { not: "archived" } }, select: { id: true } });
      if (!root) return { affected: 0, message: "Packets root is not initialized." };
      const packets = await prisma.libraryItem.findMany({ where: { parentId: root.id, type: "folder", status: { not: "archived" } }, select: { id: true } });
      if (packets.length) await prisma.$transaction(packets.map((packet: { id: string }) => prisma.libraryItem.update({ where: { id: packet.id }, data: { source: "packet", metadata: JSON.stringify({ packet: true, folderColor: "#7aa8ff", folderIcon: "note" }) } })));
      return { affected: packets.length, message: `${packets.length} packet folder${packets.length === 1 ? "" : "s"} normalized.` };
    }

    if (tool === "library" && action === "verify-storage") {
      await verifyStorageSchema();
      return { affected: 0, message: "Library storage verified." };
    }
    if (tool === "library" && action === "archive-deprecated") {
      const result = await prisma.libraryItem.updateMany({ where: { status: "deprecated" }, data: { status: "archived" } });
      return { affected: result.count, message: `${result.count} deprecated item${result.count === 1 ? "" : "s"} archived.` };
    }
    if (tool === "library" && action === "archive-stale-drafts") {
      const result = await prisma.libraryItem.updateMany({ where: { status: "draft", updatedAt: { lt: cutoff } }, data: { status: "archived" } });
      return { affected: result.count, message: `${result.count} stale draft${result.count === 1 ? "" : "s"} archived.` };
    }
    if (tool === "library" && action === "clear-model-thumbnails") {
      const root = path.join(dataLayout.runtimeRoot, "library-model-thumbnails");
      let affected = 0;
      try { affected = (await fs.readdir(root)).filter((name) => /\.(?:webp|png|jpg)$/i.test(name)).length; } catch {}
      await fs.rm(root, { recursive: true, force: true });
      await fs.mkdir(root, { recursive: true });
      return { affected, message: `${affected} cached model thumbnail${affected === 1 ? "" : "s"} cleared. Visible cards will rebuild them one at a time.` };
    }
    if (tool === "library" && action === "clear-model-cache") {
      const root = path.join(dataLayout.runtimeRoot, "model-previews");
      let affected = 0;
      try { affected = (await fs.readdir(root)).filter((name) => name.toLowerCase().endsWith(".glb")).length; } catch {}
      await fs.rm(root, { recursive: true, force: true });
      await fs.mkdir(root, { recursive: true });
      return { affected, message: `${affected} converted model preview${affected === 1 ? "" : "s"} cleared.` };
    }

    throw new Error("Unknown tool operation.");
  }

  // The displayed configuration and its write preconditions must represent
  // the same database snapshot. The resolved Settings cache can be older than
  // the raw rows if another admin saved between two reads.
  async function readToolConfigSnapshot(tool: AdminToolKey, resolvedSettings: Record<string, any>) {
    const expectedSettings = await readSettingPreconditions(clusterToolSettingKeys(tool));
    const authoritative = { ...resolvedSettings };
    for (const [key, entry] of Object.entries(expectedSettings)) {
      if (entry.exists) authoritative[key] = entry.value;
      else delete authoritative[key]; // A deleted row must not resurrect from a stale 5-second Settings cache.
    }
    return { config: adminToolSettings(tool, authoritative) as Record<string, unknown>, expectedSettings, settingProvenance: clusterToolSettingProvenance(tool, expectedSettings) };
  }

  app.get("/api/admin/tools", async (request, reply) => {
    if (!await requireToolAdmin(request, reply)) return;
    const settings = await readSettings();
    const tools = await Promise.all(ADMIN_TOOL_KEYS.map(async (key) => {
      try {
        const runtime = await toolRuntimeSnapshot(key);
        const { config, expectedSettings, settingProvenance } = await readToolConfigSnapshot(key, settings);
        const enabled = config.enabled !== false;
        const degraded = key === "library" && runtime.storageOk === false;
        return { key, enabled, status: !enabled ? "disabled" : degraded ? "degraded" : "operational", config, expectedSettings, settingProvenance, runtime, operations: ADMIN_TOOL_OPERATIONS[key] };
      } catch (error) {
        return { key, enabled: true, status: "degraded", config: adminToolSettings(key, settings), expectedSettings: null, settingProvenance: null, runtime: { records: 0, active: 0, detail: error instanceof Error ? error.message : "Diagnostics failed." }, operations: ADMIN_TOOL_OPERATIONS[key] };
      }
    }));
    return { ok: true, updatedAt: new Date().toISOString(), tools };
  });

  app.put("/api/admin/tools/:tool", async (request, reply) => {
    if (!await requireToolAdmin(request, reply)) return;
    const { tool: parsedTool } = z.object({ tool: z.enum(ADMIN_TOOL_KEYS as unknown as [AdminToolKey, ...AdminToolKey[]]) }).parse(request.params);
    const tool = parsedTool as AdminToolKey;
    // Full configs are validated; only fields with explicit DB-truth preconditions
    // may be published. The UI sends only edited keys, so unrelated admin edits
    // survive even when an older tool configuration screen remains open.
    const requestBody = z.object({
      config: z.record(z.unknown()),
      expectedSettings: z.record(z.object({ exists: z.boolean(), value: z.unknown().optional() }).strict()),
      acknowledgeStudioChanges: z.boolean().optional(),
    }).strict().parse(request.body);
    const config = TOOL_CONFIG_SCHEMAS[tool].parse(requestBody.config) as Record<string, any>;

    const map = CLUSTER_TOOL_SETTING_KEYS[tool];
    const expected = requestBody.expectedSettings;
    const allowed = new Set(Object.values(map));
    const patch: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(config)) {
      const settingKey = map[field];
      if (settingKey && Object.prototype.hasOwnProperty.call(expected, settingKey)) patch[settingKey] = value;
    }
    if (Object.keys(expected).some((key) => !allowed.has(key) || !Object.prototype.hasOwnProperty.call(patch, key))) {
      return reply.code(400).send({ ok: false, code: "TOOL_CONFIG_PRECONDITION_INVALID", error: "Expected values must match the edited tool settings." });
    }
    if (!Object.keys(expected).length) {
      return reply.code(400).send({ ok: false, code: "TOOL_CONFIG_NO_CHANGES", error: "No edited settings were provided." });
    }
    // Studio-owned fields are editable here for convenience, not private Tool settings.
    // Do not let API consumers bypass the cross-workspace impact confirmation.
    const affectedStudioFields = clusterToolStudioChangeImpact(tool, Object.keys(expected));
    if (affectedStudioFields.length && requestBody.acknowledgeStudioChanges !== true) {
      return reply.code(409).send({
        ok: false, code: "TOOL_CONFIG_STUDIO_CONFIRMATION_REQUIRED",
        error: "Confirm Studio-wide changes before saving.",
        affectedSettings: affectedStudioFields,
      });
    }
    try {
      await patchSettings(patch, expected);
    } catch (error) {
      if ((error as any)?.code === "STUDIO_SETTINGS_CONFLICT") {
        return reply.code(409).send({ ok: false, code: "TOOL_CONFIG_CONFLICT", error: "Tool settings changed since they were loaded. Your draft was retained; reload and review before saving.", conflictingKeys: (error as any).conflictingKeys || [] });
      }
      throw error;
    }
    const updated = await readSettings();
    const latest = await readToolConfigSnapshot(tool, updated);
    return { ok: true, tool, ...latest, runtime: await toolRuntimeSnapshot(tool), operations: ADMIN_TOOL_OPERATIONS[tool] };
  });

  // Reset one explicit Studio-scope AppSetting row. The stored value is
  // compared transactionally before deletion; no client-supplied "default" is
  // written to the DB. Inherited Project/User scopes are deliberately excluded.
  app.post("/api/admin/tools/:tool/settings/:field/reset", async (request, reply) => {
    if (!await requireToolAdmin(request, reply)) return;
    const params = z.object({
      tool: z.enum(ADMIN_TOOL_KEYS as unknown as [AdminToolKey, ...AdminToolKey[]]),
      field: z.string().min(1).max(100),
    }).parse(request.params);
    const tool = params.tool as AdminToolKey;
    if (!Object.prototype.hasOwnProperty.call(CLUSTER_TOOL_SETTING_KEYS[tool], params.field)) {
      return reply.code(404).send({ ok: false, code: "TOOL_CONFIG_FIELD_UNKNOWN", error: "Unknown Tool Configuration field." });
    }
    const key = CLUSTER_TOOL_SETTING_KEYS[tool][params.field];
    const body = z.object({
      expectedSetting: z.object({ exists: z.literal(true), value: z.unknown() }).strict(),
      acknowledgeStudioChanges: z.boolean().optional(),
    }).strict().parse(request.body);
    if (!Object.prototype.hasOwnProperty.call(body.expectedSetting, "value")) {
      return reply.code(400).send({ ok: false, code: "TOOL_CONFIG_PRECONDITION_INVALID", error: "The saved value must be supplied to reset it safely." });
    }
    const affectedStudioFields = clusterToolStudioChangeImpact(tool, [key]);
    if (affectedStudioFields.length && body.acknowledgeStudioChanges !== true) {
      return reply.code(409).send({ ok: false, code: "TOOL_CONFIG_STUDIO_CONFIRMATION_REQUIRED", error: "Confirm this Studio-wide reset before applying it.", affectedSettings: affectedStudioFields });
    }
    try {
      await resetSettingOverrides([key], { [key]: body.expectedSetting });
    } catch (error) {
      if ((error as any)?.code === "STUDIO_SETTINGS_CONFLICT") {
        return reply.code(409).send({ ok: false, code: "TOOL_CONFIG_CONFLICT", error: "The saved setting changed since you opened Tool Configuration. Refresh before resetting it.", conflictingKeys: (error as any).conflictingKeys || [] });
      }
      throw error;
    }
    const updated = await readSettings();
    const latest = await readToolConfigSnapshot(tool, updated);
    return { ok: true, tool, field: params.field, ...latest, runtime: await toolRuntimeSnapshot(tool), operations: ADMIN_TOOL_OPERATIONS[tool] };
  });

  // TD1: Project-scoped visual default. No tool enablement, security setting,
  // or Studio policy may be overridden at Project level.
  app.get("/api/admin/tools/calendar/projects/:projectId/default-view", async (request, reply) => {
    if (!await requireToolAdmin(request, reply)) return;
    const { projectId } = z.object({ projectId: z.string().min(1) }).parse(request.params);
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, archived: true } });
    if (!project || project.archived) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Project not found." });
    return { ok: true, projectId, ...(await projectCalendarViewSnapshot(prisma, projectId, await readSettings())) };
  });

  app.put("/api/admin/tools/calendar/projects/:projectId/default-view", async (request, reply) => {
    const actor = await requireToolAdmin(request, reply);
    if (!actor) return;
    const { projectId } = z.object({ projectId: z.string().min(1) }).parse(request.params);
    const body = z.object({
      value: z.enum(CLUSTER_PROJECT_CALENDAR_VIEW_VALUES).nullable(),
      expectedRevision: z.number().int().positive().nullable(),
      lockUserOverride: z.boolean(),
    }).strict().parse(request.body);
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, archived: true } });
    if (!project || project.archived) return reply.code(404).send({ ok: false, code: "RESOURCE_NOT_FOUND", error: "Project not found." });
    try {
      await updateProjectCalendarView(prisma, projectId, body.value, body.expectedRevision, actor.id, body.value !== null && body.lockUserOverride === true);
    } catch (error) {
      if ((error as any)?.code === "PROJECT_TOOL_SETTING_CONFLICT") return reply.code(409).send({ ok: false, code: "PROJECT_TOOL_SETTING_CONFLICT", error: (error as Error).message });
      throw error;
    }
    // A successful DB write is authoritative even if optional telemetry fails.
    try {
      await logSecurityEvent({ event: "admin.tool.calendar.project-default-view", actorUserId: actor.id, result: "SUCCESS", reasonCode: "PROJECT_TOOL_SETTING", request, metadata: { projectId, action: body.value === null ? "reset" : "set", lockUserOverride: body.value === null ? false : body.lockUserOverride === true } });
    } catch (error) { app.log.warn({ err: error }, "Project Tool Config audit emission failed after commit"); }
    return { ok: true, projectId, ...(await projectCalendarViewSnapshot(prisma, projectId, await readSettings())) };
  });

  app.post("/api/admin/tools/:tool/actions/:action", async (request, reply) => {
    const actor = await requireToolAdmin(request, reply);
    if (!actor) return;
    const { tool: parsedTool, action } = z.object({ tool: z.enum(ADMIN_TOOL_KEYS as unknown as [AdminToolKey, ...AdminToolKey[]]), action: z.string().min(1).max(80) }).parse(request.params);
    const tool = parsedTool as AdminToolKey;
    const operation = ADMIN_TOOL_OPERATIONS[tool].find((item) => item.id === action);
    if (!operation) return reply.code(404).send({ ok: false, error: "Unknown tool operation." });
    const body = z.object({ confirm: z.literal(true), days: z.coerce.number().int().min(1).max(3650).optional() }).parse(request.body || {});
    const days = operation.requiresDays ? body.days || operation.defaultDays : undefined;
    if (operation.requiresDays && !days) return reply.code(400).send({ ok: false, error: "A retention window is required." });

    try {
      const result = await runToolOperation(tool, action, days);
      await logSecurityEvent({
        event: `admin.tool.${tool}.${action}`,
        actorUserId: actor.id || null,
        result: "SUCCESS",
        reasonCode: "ADMIN_TOOL_OPERATION",
        request,
        metadata: { tool, action, days: days || null, affected: result.affected },
      });
      return { ok: true, tool, action, ...result, runtime: await toolRuntimeSnapshot(tool), updatedAt: new Date().toISOString() };
    } catch (error) {
      await logSecurityEvent({
        event: `admin.tool.${tool}.${action}`,
        actorUserId: actor.id || null,
        result: "FAILURE",
        reasonCode: "ADMIN_TOOL_OPERATION_FAILED",
        request,
        metadata: { tool, action, days: days || null, error: error instanceof Error ? error.message : "Operation failed" },
      });
      throw error;
    }
  });
}
