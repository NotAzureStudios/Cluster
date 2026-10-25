import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { createHttpError } from "../../core/http-errors.js";
import { createProjectDeliveryLifecycleService, CORE_RELEASE_GATE_IDS } from "./project-delivery-lifecycle-service.js";
import type { ProjectReadModelRuntime } from "../../core/project-read-model-runtime.js";
import { sendPrivateRevalidated } from "../../core/http-cache.js";

const paramsSchema = z.object({ projectId: z.string().trim().min(1).max(200) });
const bulkLifecycleQuerySchema = z.object({ projectIds: z.string().trim().min(1).max(20_000) });
const decisionSchema = z.object({
  buildId: z.string().trim().min(1).max(200).optional().nullable(),
  gateId: z.enum(["qa_pass", "fixes_clear", "rebuild_clear", "build_approval", "reviewer_approval", "signed_artifact", "launch_window", "availability_clear", "no_active_hold", "release_notes", "delivery_schedule"]),
  decision: z.enum(["approved", "rejected", "hold", "cleared", "exception"]),
  reason: z.string().trim().max(4000).optional().default(""),
  expiresAt: z.string().datetime().optional().nullable(),
});
const GATE_IDS = ["qa_pass", "fixes_clear", "rebuild_clear", "build_approval", "reviewer_approval", "signed_artifact", "launch_window", "availability_clear", "no_active_hold", "release_notes", "delivery_schedule"] as const;
const policySchema = z.object({
  channel: z.string().trim().min(1).max(40),
  requiredGateIds: z.array(z.enum(GATE_IDS)).max(GATE_IDS.length),
  optionalGateIds: z.array(z.enum(GATE_IDS)).max(GATE_IDS.length).optional().default([]),
});

function safePayload(value: Record<string, unknown>) {
  const json = JSON.stringify(value || {});
  if (json.length > 128_000) throw createHttpError("VALIDATION_FAILED", "Delivery record is too large.", 400);
  return json;
}
function recordId(projectId: string, kind: string, entityId: string) {
  return `delivery_${createHash("sha256").update(`${projectId}:${kind}:${entityId}`).digest("hex").slice(0, 32)}`;
}
function atDayOffset(base: Date, days: number, hour: number, minute = 0) {
  const next = new Date(base);
  next.setDate(next.getDate() + days);
  next.setHours(hour, minute, 0, 0);
  return next;
}
function plusMinutes(date: Date, minutes: number) { return new Date(date.getTime() + minutes * 60_000); }
function marker(kind: string, buildId?: string | null) { return `[cluster-delivery:${kind}:${buildId || "project"}]`; }

export function registerProjectDeliveryLifecycleRoutes({ app, prisma, enforceTargetAccess, getCurrentUser, buildPersistenceStorageData, logActivity, projectReadModels }: { app: any; prisma: any; enforceTargetAccess: (...args: any[]) => Promise<any>; getCurrentUser: (request: any) => Promise<any>; buildPersistenceStorageData: (kind: string, payload: Record<string, any>, recordId?: string | null) => Record<string, unknown>; logActivity: (input: any) => Promise<unknown>; projectReadModels?: ProjectReadModelRuntime }) {
  const service = createProjectDeliveryLifecycleService(prisma);
  const snapshotFor = (projectId: string) => projectReadModels
    ? projectReadModels.getOrLoad(projectId, () => service.snapshot(projectId), 8_000, "delivery-lifecycle")
    : service.snapshot(projectId);
  const invalidateSnapshot = (projectId: string) => projectReadModels?.invalidate(projectId);
  async function projectFor(projectId: string) {
    const project = await prisma.project.findFirst({ where: { id: projectId, archived: false } });
    if (!project) throw createHttpError("PROJECT_NOT_FOUND", "Project not found.", 404);
    return project;
  }


  app.get("/api/project-delivery/lifecycle", async (request: any, reply: any) => {
    const { projectIds } = bulkLifecycleQuerySchema.parse(request.query || {});
    const ids: string[] = Array.from(new Set<string>(projectIds.split(",").map((value: string) => value.trim()).filter(Boolean))).slice(0, 50);
    const rows: any[] = [];
    const projects = await prisma.project.findMany({ where: { id: { in: ids }, archived: false } });
    const projectById = new Map(projects.map((project: any) => [String(project.id), project] as const));
    for (const projectId of ids) {
      const project = projectById.get(projectId);
      if (!project) throw createHttpError("PROJECT_NOT_FOUND", "Project not found.", 404);
      if (!(await enforceTargetAccess(request, reply, "project", projectId, project, "view"))) return;
      const snapshot = await snapshotFor(projectId);
      if (!snapshot) continue;
      rows.push({
        projectId,
        ready: Boolean(snapshot.releaseReady),
        recommendedAction: String(snapshot.recommendedAction || ""),
        blocked: Number(snapshot.readiness?.blocked || 0),
        activeHold: Boolean(snapshot.readiness?.activeHold),
        channel: String(snapshot.readiness?.channel || "internal"),
        published: String(snapshot.release?.status || "").toLowerCase() === "published",
        releaseId: snapshot.release?.id || null,
        latestBuildId: snapshot.latestBuild?.id || null,
        generatedAt: snapshot.generatedAt,
      });
    }
    return sendPrivateRevalidated(request, reply, { projectIds: ids, projects: rows });
  });

  app.get("/api/projects/:projectId/delivery-lifecycle", async (request: any, reply: any) => {
    const { projectId } = paramsSchema.parse(request.params || {});
    const project = await projectFor(projectId);
    if (!(await enforceTargetAccess(request, reply, "project", projectId, project, "view"))) return;
    const snapshot = await snapshotFor(projectId);
    if (!snapshot) throw createHttpError("PROJECT_NOT_FOUND", "Project not found.", 404);
    return sendPrivateRevalidated(request, reply, snapshot);
  });

  app.post("/api/projects/:projectId/delivery-lifecycle/decisions", async (request: any, reply: any) => {
    const user = await getCurrentUser(request);
    const { projectId } = paramsSchema.parse(request.params || {});
    const body = decisionSchema.parse(request.body || {});
    const project = await projectFor(projectId);
    if (!(await enforceTargetAccess(request, reply, "project", projectId, project, "manage"))) return;
    const current = await service.snapshot(projectId, body.buildId || null);
    const buildId = body.buildId || current?.latestBuild?.id || null;
    if (!buildId || current?.latestBuild?.id !== buildId) throw createHttpError("DELIVERY_BUILD_NOT_FOUND", "Choose an existing project build before recording a decision.", 409);
    if (([...CORE_RELEASE_GATE_IDS, "reviewer_approval", "signed_artifact"] as string[]).includes(body.gateId) && body.decision === "exception") throw createHttpError("DELIVERY_CORE_GATE", "Safety-critical QA, fix, rebuild, build, reviewer, signing, and hold gates cannot be waived.", 409);
    if (["hold", "cleared"].includes(body.decision) && body.gateId !== "no_active_hold") throw createHttpError("DELIVERY_DECISION_INVALID", "Only release holds can be placed or cleared this way.", 400);
    if (["approved", "rejected"].includes(body.decision) && body.gateId !== "reviewer_approval") throw createHttpError("DELIVERY_DECISION_INVALID", "Review decisions must target the reviewer approval gate.", 400);
    if (body.decision === "exception" && (!body.reason.trim() || body.gateId === "reviewer_approval")) throw createHttpError("DELIVERY_DECISION_INVALID", "Exceptions require a reason and cannot replace reviewer approval.", 400);
    if ((body.decision === "hold" || body.decision === "rejected") && !body.reason.trim()) throw createHttpError("DELIVERY_DECISION_REASON", "Hold and rejection decisions require a reason.", 400);
    const build = await prisma.deliveryBuild.findFirst({ where: { id: buildId, projectId, archived: false }, select: { revision: true, createdById: true, ownerId: true } });
    if (!build) throw createHttpError("DELIVERY_BUILD_NOT_FOUND", "The target build no longer exists.", 409);
    if (body.decision === "approved" && body.gateId === "reviewer_approval") {
      if (!user?.id) throw createHttpError("DELIVERY_REVIEWER_REQUIRED", "An authenticated reviewer is required.", 403);
      if ([build.createdById, build.ownerId].filter(Boolean).includes(user.id)) throw createHttpError("DELIVERY_INDEPENDENT_REVIEW", "The build creator or owner cannot independently approve their own release.", 403);
    }
    if (body.decision === "exception" && !body.reason) throw createHttpError("VALIDATION_FAILED", "Exceptions require a reason.", 400);
    if (body.decision === "hold" && body.gateId !== "no_active_hold") throw createHttpError("VALIDATION_FAILED", "Release holds must target the no_active_hold gate.", 400);
    const now = new Date().toISOString();
    const entityId = `decision-${randomUUID()}`;
    const payload = {
      id: entityId,
      projectId,
      buildId,
      reviewedBuildRevision: Number(build.revision),
      gateId: body.gateId,
      decision: body.decision,
      state: body.decision === "cleared" ? "cleared" : "active",
      reason: body.reason || "",
      reviewerId: user?.id || null,
      reviewerName: user?.displayName || user?.username || "Cluster reviewer",
      expiresAt: body.expiresAt || null,
      createdAt: now,
      updatedAt: now,
    };
    await prisma.clusterPersistenceRecord.create({ data: {
      id: recordId(projectId, "deliveryApproval", entityId), kind: "deliveryApproval", title: `${payload.gateId} · ${payload.decision}`,
      projectId, entityType: "deliveryApproval", entityId, ownerId: user?.id || null, userId: user?.id || null, status: payload.decision,
      visibility: "internal", sourceKey: "project-delivery-lifecycle", ...buildPersistenceStorageData("deliveryApproval", payload), payload: safePayload(payload), archived: false, syncedAt: new Date(), revision: 1,
    } });
    await logActivity({ userId: user?.id, projectId, type: "delivery_decision", entityType: "project_delivery_approval", entityId, title: "Delivery gate decision recorded", message: `${payload.gateId} · ${payload.decision}${payload.reason ? ` · ${payload.reason}` : ""}`, metadata: { buildId, gateId: payload.gateId, decision: payload.decision } });
    invalidateSnapshot(projectId);
    return { decision: payload, snapshot: await service.snapshot(projectId, buildId) };
  });

  app.put("/api/projects/:projectId/delivery-lifecycle/policy", async (request: any, reply: any) => {
    const user = await getCurrentUser(request);
    const { projectId } = paramsSchema.parse(request.params || {});
    const body = policySchema.parse(request.body || {});
    const project = await projectFor(projectId);
    if (!(await enforceTargetAccess(request, reply, "project", projectId, project, "manage"))) return;
    const requiredGateIds = [...new Set([...CORE_RELEASE_GATE_IDS, ...body.requiredGateIds])];
    const optionalGateIds = [...new Set(body.optionalGateIds.filter((id) => !requiredGateIds.includes(id)))];
    const entityId = `policy-${body.channel.toLowerCase()}`;
    const existing = await prisma.clusterPersistenceRecord.findFirst({ where: { projectId, kind: "deliveryPolicy", entityId } });
    const now = new Date().toISOString();
    const payload = { id: entityId, projectId, channel: body.channel.toLowerCase(), requiredGateIds, optionalGateIds, updatedById: user?.id || null, updatedAt: now, createdAt: existing ? undefined : now };
    const data = { title: `Delivery policy · ${payload.channel}`, projectId, entityType: "deliveryPolicy", entityId, ownerId: user?.id || null, userId: user?.id || null, status: "active", visibility: "internal", sourceKey: "project-delivery-lifecycle", ...buildPersistenceStorageData("deliveryPolicy", payload, existing?.id || null), payload: safePayload(payload), archived: false, deletedAt: null, syncedAt: new Date() };
    if (existing) await prisma.clusterPersistenceRecord.update({ where: { id: existing.id }, data: { ...data, revision: { increment: 1 } } });
    else await prisma.clusterPersistenceRecord.create({ data: { id: recordId(projectId, "deliveryPolicy", entityId), kind: "deliveryPolicy", ...data, revision: 1 } });
    await logActivity({ userId: user?.id, projectId, type: "delivery_policy_updated", entityType: "project_delivery_policy", entityId, title: "Delivery gate policy updated", message: `${payload.channel} · ${requiredGateIds.length} required gate(s)` });
    invalidateSnapshot(projectId);
    return await snapshotFor(projectId);
  });

  app.post("/api/projects/:projectId/delivery-lifecycle/orchestrate", async (request: any, reply: any) => {
    const user = await getCurrentUser(request);
    const { projectId } = paramsSchema.parse(request.params || {});
    const project = await projectFor(projectId);
    if (!(await enforceTargetAccess(request, reply, "project", projectId, project, "contribute"))) return;
    const snapshot = await service.snapshot(projectId);
    const build = snapshot?.latestBuild;
    if (!build) throw createHttpError("VALIDATION_FAILED", "Create a build before scheduling delivery work.", 409);
    const base = project.targetDate ? new Date(project.targetDate) : atDayOffset(new Date(), 7, 16);
    const qaSession = snapshot?.qa?.sessions?.[0] || null;
    const ownerId = build.ownerId || user?.id || null;
    const testerIds = Array.isArray(qaSession?.testerIds) ? qaSession.testerIds : [];
    const reviewerIds = Array.isArray(build.reviewerIds) ? build.reviewerIds : [];
    const milestones = [
      { kind: "qa", title: `QA window · ${build.version || build.title || "build"}`, start: atDayOffset(base, -3, 10), minutes: 120, ownerId: qaSession?.ownerId || testerIds[0] || ownerId, attendees: [...new Set([qaSession?.ownerId, ...testerIds].filter(Boolean))] },
      { kind: "review", title: `Release review · ${build.version || build.title || "build"}`, start: atDayOffset(base, -2, 14), minutes: 60, ownerId: reviewerIds[0] || ownerId, attendees: [...new Set([ownerId, ...reviewerIds].filter(Boolean))] },
      { kind: "release", title: `Launch window · ${build.version || build.title || "build"}`, start: atDayOffset(base, 0, 16), minutes: 90, ownerId, attendees: [...new Set([ownerId, ...reviewerIds, ...testerIds].filter(Boolean))] },
    ];
    if (snapshot?.failureLoop?.rebuildRequired) milestones.unshift({ kind: "rebuild", title: `Rebuild target · ${build.version || build.title || "build"}`, start: atDayOffset(new Date(), 1, 11), minutes: 90, ownerId, attendees: [ownerId].filter(Boolean) });
    const created: any[] = [];
    for (const item of milestones) {
      const description = `${marker(item.kind, build.id)} Project delivery milestone generated from the delivery lifecycle.`;
      let event = await prisma.calendarEvent.findFirst({ where: { projectId, description: { contains: marker(item.kind, build.id) } } });
      const eventData = { projectId, title: item.title, description, startsAt: item.start, endsAt: plusMinutes(item.start, item.minutes), allDay: false, source: "project-delivery", eventType: "delivery", status: "scheduled", ownerId: item.ownerId || null, attendeeIds: JSON.stringify(item.attendees || []), reminderMinutes: 30 };
      event = event ? await prisma.calendarEvent.update({ where: { id: event.id }, data: { ...eventData, revision: { increment: 1 } } }) : await prisma.calendarEvent.create({ data: eventData });
      created.push({ kind: "calendar", id: event.id, milestone: item.kind });
      if (item.ownerId) {
        let block = await prisma.scheduleBlock.findFirst({ where: { projectId, userId: item.ownerId, description: { contains: marker(item.kind, build.id) } } });
        const blockData = { userId: item.ownerId, projectId, title: item.title, description, startsAt: item.start, endsAt: plusMinutes(item.start, item.minutes), type: "delivery" };
        block = block ? await prisma.scheduleBlock.update({ where: { id: block.id }, data: blockData }) : await prisma.scheduleBlock.create({ data: blockData });
        created.push({ kind: "scheduler", id: block.id, milestone: item.kind });
      }
    }
    await logActivity({ userId: user?.id, projectId, type: "delivery_orchestrated", entityType: "project_delivery", entityId: build.id, title: "Delivery milestones scheduled", message: `${milestones.length} delivery milestone(s) synchronized to Calendar and Scheduler.`, metadata: { buildId: build.id, milestones: milestones.map((item) => item.kind) } });
    invalidateSnapshot(projectId);
    return { created, snapshot: await service.snapshot(projectId, build.id) };
  });
}
