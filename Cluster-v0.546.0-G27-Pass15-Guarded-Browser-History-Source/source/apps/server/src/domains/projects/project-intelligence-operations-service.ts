import { scanById } from "../../core/batched-scan.js";
import { resolveClusterProjectType, type ClusterProjectTypeDefinition } from "@cluster/shared";
import { createProjectDeliveryLifecycleService } from "./project-delivery-lifecycle-service.js";
import type { ProjectReadModelRuntime } from "../../core/project-read-model-runtime.js";

const DAY = 86_400_000;
const CLOSED = new Set(["done", "completed", "resolved", "approved", "accepted", "closed", "published", "released", "passed", "go", "archived", "cancelled"]);

function parseJson(value: unknown): Record<string, any> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, any>;
  if (typeof value !== "string" || !value.trim()) return {};
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; }
}
function parseIds(value: unknown) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== "string") return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : []; } catch { return []; }
}
function closed(value: unknown) { return CLOSED.has(String(value || "").trim().toLowerCase()); }
function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }
function dayStart(value: Date) { const next = new Date(value); next.setHours(9, 0, 0, 0); return next; }
function stageCategory(stage: string) { return `delivery-pipeline:${stage}`; }
function humanize(value: string) { return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }

export function createProjectIntelligenceOperationsService(prisma: any, readSettings: (force?: boolean) => Promise<any>, readModels?: ProjectReadModelRuntime) {
  async function projectType(project: any): Promise<ClusterProjectTypeDefinition> {
    const settings = await readSettings();
    return resolveClusterProjectType(project.projectType || "general", settings.projectTypePresets);
  }

  async function loadPipelineSnapshot(project: any) {
    const definition = await projectType(project);
    const stages = (definition.deliveryStages || []).slice(0, 16);
    const [records, relationships, scheduleBlocks, deliveryLifecycle] = await Promise.all([
      prisma.projectControlRecord.findMany({ where: { projectId: project.id, archived: false, category: { startsWith: "delivery-pipeline:" } }, orderBy: [{ sortOrder: "asc" }, { updatedAt: "asc" }], take: 100 }),
      prisma.projectRelationship.findMany({ where: { AND: [{ relationship: { in: ["blocks", "depends_on", "blocked_by"] } }, { OR: [{ projectId: project.id }, { sourceType: "project", sourceId: project.id }, { targetType: "project", targetId: project.id }] }] }, take: 1000 }),
      prisma.scheduleBlock.findMany({ where: { projectId: project.id }, select: { id: true, title: true, startsAt: true, endsAt: true, userId: true }, orderBy: { startsAt: "asc" }, take: 500 }),
      createProjectDeliveryLifecycleService(prisma).snapshot(project.id),
    ]);
    const byStage = new Map(records.map((record: any) => [String(parseJson(record.payload).pipelineStage || String(record.category || "").slice("delivery-pipeline:".length)), record]));
    const now = Date.now();
    const rawBaseStart = project.startDate ? new Date(project.startDate) : new Date();
    const prerequisiteProjectIds = new Set<string>();
    for (const relationship of relationships) {
      const type = String(relationship.relationship || "");
      if (relationship.sourceType === "project" && relationship.sourceId === project.id && ["depends_on", "blocked_by"].includes(type) && relationship.targetType === "project") prerequisiteProjectIds.add(String(relationship.targetId));
      if (relationship.targetType === "project" && relationship.targetId === project.id && type === "blocks" && relationship.sourceType === "project") prerequisiteProjectIds.add(String(relationship.sourceId));
    }
    const prerequisiteProjects = prerequisiteProjectIds.size ? await prisma.project.findMany({ where: { id: { in: [...prerequisiteProjectIds] }, archived: false }, select: { id: true, name: true, status: true, targetDate: true } }) : [];
    const latestConstraint = prerequisiteProjects.filter((item: any) => !closed(item.status) && item.targetDate).sort((a: any, b: any) => new Date(b.targetDate).getTime() - new Date(a.targetDate).getTime())[0] || null;
    const constrainedStartMs = latestConstraint?.targetDate ? Math.max(rawBaseStart.getTime(), new Date(latestConstraint.targetDate).getTime()) : rawBaseStart.getTime();
    const baseStart = new Date(constrainedStartMs);
    const dependencyDelayDays = Math.max(0, Math.ceil((baseStart.getTime() - rawBaseStart.getTime()) / DAY));
    const target = project.targetDate ? new Date(project.targetDate) : new Date(baseStart.getTime() + Math.max(1, stages.length) * 14 * DAY);
    const span = Math.max(DAY * Math.max(1, stages.length), target.getTime() - baseStart.getTime());
    const stageSpan = span / Math.max(1, stages.length);
    const rows = stages.map((stage, index) => {
      const record: any = byStage.get(stage) || null;
      const expectedStart = new Date(baseStart.getTime() + stageSpan * index);
      const expectedFinish = new Date(baseStart.getTime() + stageSpan * (index + 1));
      const dueAt = record?.dueDate ? new Date(record.dueDate) : expectedFinish;
      const slipDays = record && !closed(record.status) && dueAt.getTime() < now ? Math.ceil((now - dueAt.getTime()) / DAY) : 0;
      const schedule = scheduleBlocks.filter((block: any) => String(block.title || "").toLowerCase().includes(stage.replaceAll("_", " ").toLowerCase()));
      const ownerDepartments = definition.stageOwnership?.[stage] || [];
      const normalizedStage = stage.replaceAll("_", "-").toLowerCase();
      const lifecycleStage = (deliveryLifecycle?.stages || []).find((item: any) => normalizedStage.includes(String(item.id || "").replaceAll("_", "-").toLowerCase()) || String(item.id || "").replaceAll("_", "-").toLowerCase().includes(normalizedStage));
      const schedulerSuggestion = !schedule.length && record?.ownerId ? { ownerId: record.ownerId, startsAt: (record.startDate || expectedStart).toISOString?.() || record.startDate || expectedStart.toISOString(), endsAt: (record.dueDate || expectedFinish).toISOString?.() || record.dueDate || expectedFinish.toISOString(), reason: `No Scheduler block is mapped for ${humanize(stage)}.` } : null;
      return {
        stage,
        label: humanize(stage),
        recordId: record?.id || null,
        status: record?.status || "not_configured",
        progress: record ? Number(record.progress || 0) : 0,
        ownerId: record?.ownerId || null,
        ownerDepartments,
        startDate: record?.startDate || expectedStart.toISOString(),
        dueDate: record?.dueDate || expectedFinish.toISOString(),
        forecastStart: expectedStart.toISOString(),
        forecastFinish: expectedFinish.toISOString(),
        slipDays,
        scheduleBlocks: schedule.length,
        schedulerSuggestion,
        deliveryGate: lifecycleStage ? { id: lifecycleStage.id, state: lifecycleStage.state, detail: lifecycleStage.detail, target: lifecycleStage.target || null } : null,
      };
    });
    const configured = rows.filter((row) => row.recordId).length;
    const overdue = rows.filter((row) => row.slipDays > 0);
    const blocked = rows.filter((row) => row.status === "blocked");
    const linkIds = new Set(records.map((record: any) => record.id));
    const linked = relationships.filter((relationship: any) => linkIds.has(relationship.sourceId) || linkIds.has(relationship.targetId)).length;
    const dateEvidence = rows.filter((row) => row.recordId && row.dueDate).length;
    const confidence = configured === stages.length && dateEvidence === stages.length ? "high" : configured ? "medium" : "low";
    const dependencyConstraints = prerequisiteProjects.map((item: any) => ({ id: item.id, name: item.name, status: item.status, targetDate: item.targetDate || null, constrainsStart: Boolean(item.targetDate && !closed(item.status) && new Date(item.targetDate).getTime() >= rawBaseStart.getTime()) }));
    const forecastReasons = [
      stages.length ? `${configured}/${stages.length} delivery stages are materialized as Project Control phases.` : "This Project Type has no configured delivery stages.",
      overdue.length ? `${overdue.length} stage${overdue.length === 1 ? " is" : "s are"} past the current due date.` : "No configured delivery stage is currently overdue.",
      linked ? `${linked} blocking relationship${linked === 1 ? "" : "s"} connect pipeline stages to dependency evidence.` : "No blocking relationships currently connect the pipeline stages.",
      dependencyDelayDays ? `Cross-project prerequisites push the forecast start by ${dependencyDelayDays} day${dependencyDelayDays === 1 ? "" : "s"}; latest constraint is ${latestConstraint?.name || "another project"}.` : prerequisiteProjects.length ? `${prerequisiteProjects.length} cross-project prerequisite${prerequisiteProjects.length === 1 ? " is" : "s are"} visible without moving the current forecast start.` : "No cross-project prerequisite currently constrains the forecast start.",
    ];
    const deliveryGates = (deliveryLifecycle?.readiness?.gates || []).slice(0, 24).map((gate: any) => ({ id: gate.id, label: gate.label, required: Boolean(gate.required), state: gate.state, passed: Boolean(gate.passed), detail: gate.detail }));
    const projectTypeGatePolicy = definition.deliveryGatePolicy || { requiredGateIds: [], optionalGateIds: [], channels: [] };
    const activeGatePolicy = deliveryLifecycle?.readiness?.policy || null;
    const schedulerSuggestions = rows.filter((row: any) => row.schedulerSuggestion).map((row: any) => ({ stage: row.stage, label: row.label, ...row.schedulerSuggestion }));
    return { typeId: definition.id, typeLabel: definition.label, configured, stageCount: stages.length, overdue: overdue.length, blocked: blocked.length, linkedDependencies: linked, confidence, dependencyDelayDays, dependencyConstraints, forecastReasons, deliveryReady: Boolean(deliveryLifecycle?.releaseReady), deliveryRecommendedAction: deliveryLifecycle?.recommendedAction || null, deliveryGates, projectTypeGatePolicy, activeGatePolicy, schedulerSuggestions, stages: rows };
  }

  async function pipelineSnapshot(project: any) {
    if (!readModels) return loadPipelineSnapshot(project);
    return readModels.getOrLoad(project.id, () => loadPipelineSnapshot(project), 12_000, "intelligence-pipeline");
  }

  function invalidateProject(projectId: string) {
    readModels?.invalidate(projectId);
  }

  async function ensurePipeline(project: any, actorId?: string | null) {
    const definition = await projectType(project);
    const stages = (definition.deliveryStages || []).slice(0, 16);
    if (!stages.length) return { created: 0, linked: 0, stages: [] };
    const existing = await prisma.projectControlRecord.findMany({ where: { projectId: project.id, archived: false, category: { startsWith: "delivery-pipeline:" } }, take: 100 });
    const byStage = new Map(existing.map((record: any) => [String(parseJson(record.payload).pipelineStage || String(record.category || "").slice("delivery-pipeline:".length)), record]));
    const start = dayStart(project.startDate ? new Date(project.startDate) : new Date());
    const target = project.targetDate ? new Date(project.targetDate) : new Date(start.getTime() + stages.length * 14 * DAY);
    const span = Math.max(stages.length * DAY, target.getTime() - start.getTime());
    const stageSpan = span / stages.length;
    const rows: any[] = [];
    let created = 0;
    for (let index = 0; index < stages.length; index += 1) {
      const stage = stages[index];
      let record = byStage.get(stage);
      if (!record) {
        const stageStart = new Date(start.getTime() + stageSpan * index);
        const stageDue = new Date(start.getTime() + stageSpan * (index + 1));
        record = await prisma.projectControlRecord.create({ data: {
          projectId: project.id,
          kind: "phase",
          title: `${definition.label} · ${humanize(stage)}`,
          description: `Delivery pipeline stage for ${definition.label}.`,
          status: index === 0 ? "active" : "planned",
          priority: "high",
          category: stageCategory(stage),
          startDate: stageStart,
          dueDate: stageDue,
          progress: 0,
          sortOrder: index * 100,
          payload: JSON.stringify({ pipelineStage: stage, projectTypeId: definition.id, expectedOwnerDepartments: definition.stageOwnership?.[stage] || [], generatedBy: "project-intelligence-c2", generatedByUserId: actorId || null }),
        } });
        byStage.set(stage, record);
        created += 1;
      }
      rows.push(record);
    }
    let linked = 0;
    for (let index = 1; index < rows.length; index += 1) {
      const prerequisite = rows[index - 1];
      const dependent = rows[index];
      await prisma.projectRelationship.upsert({
        where: { projectId_sourceType_sourceId_targetType_targetId_relationship: { projectId: project.id, sourceType: "control", sourceId: prerequisite.id, targetType: "control", targetId: dependent.id, relationship: "blocks" } },
        update: { critical: true, description: "Generated delivery-pipeline sequence" },
        create: { projectId: project.id, sourceType: "control", sourceId: prerequisite.id, targetType: "control", targetId: dependent.id, relationship: "blocks", critical: true, description: "Generated delivery-pipeline sequence", createdById: actorId || null },
      });
      linked += 1;
    }
    invalidateProject(project.id);
    return { created, linked, stages: rows.map((record) => ({ id: record.id, title: record.title, status: record.status })) };
  }

  async function reconcilePipeline(project: any) {
    const definition = await projectType(project);
    const stages = (definition.deliveryStages || []).slice(0, 16);
    const records = await prisma.projectControlRecord.findMany({ where: { projectId: project.id, archived: false, category: { startsWith: "delivery-pipeline:" } }, orderBy: [{ sortOrder: "asc" }, { updatedAt: "asc" }], take: 100 });
    const byStage = new Map(records.map((record: any) => [String(parseJson(record.payload).pipelineStage || String(record.category || "").slice("delivery-pipeline:".length)), record]));
    let activated = 0;
    const changes: any[] = [];
    let prerequisiteComplete = true;
    for (const stage of stages) {
      const record: any = byStage.get(stage);
      if (!record) { prerequisiteComplete = false; continue; }
      const isDone = closed(record.status);
      if (!isDone && prerequisiteComplete && ["planned", "pending", "not_started", "open"].includes(String(record.status || "").toLowerCase())) {
        const updated = await prisma.projectControlRecord.update({ where: { id: record.id }, data: { status: "active", startDate: record.startDate || new Date(), revision: { increment: 1 } } });
        changes.push({ id: updated.id, stage, from: record.status, to: "active" });
        activated += 1;
      }
      prerequisiteComplete = prerequisiteComplete && isDone;
    }
    if (activated) invalidateProject(project.id);
    return { activated, changes };
  }

  async function schedulePipelineStage(project: any, stage: string, options: { startsAt?: Date | null; endsAt?: Date | null; allowConflict?: boolean; actorId?: string | null } = {}) {
    const snapshot = await pipelineSnapshot(project);
    const row = snapshot.stages.find((item: any) => item.stage === stage);
    if (!row?.recordId || !row.ownerId) throw new Error("Materialize the pipeline and assign an owner before scheduling this stage.");
    const startsAt = options.startsAt || new Date(row.schedulerSuggestion?.startsAt || row.startDate || row.forecastStart);
    const endsAt = options.endsAt || new Date(row.schedulerSuggestion?.endsAt || row.dueDate || row.forecastFinish);
    if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt.getTime() <= startsAt.getTime()) throw new Error("Scheduler placement requires a valid start and end time.");
    const member = await prisma.workspaceMember.findFirst({ where: { workspaceId: project.workspaceId, userId: row.ownerId, user: { archived: false } }, select: { userId: true } });
    if (!member) throw new Error("The delivery-stage owner is not an active Studio member.");
    const marker = `[cluster-intelligence-stage:${stage}]`;
    const conflicts = await prisma.scheduleBlock.findMany({ where: { userId: row.ownerId, startsAt: { lt: endsAt }, endsAt: { gt: startsAt }, NOT: { description: { contains: marker } } }, select: { id: true, projectId: true, title: true, startsAt: true, endsAt: true }, orderBy: { startsAt: "asc" }, take: 50 });
    if (conflicts.length && !options.allowConflict) return { placed: false, conflictRequired: true, conflicts, stage: row };
    const existing = await prisma.scheduleBlock.findFirst({ where: { projectId: project.id, userId: row.ownerId, description: { contains: marker } } });
    const data = { userId: row.ownerId, projectId: project.id, title: `${row.label} · ${project.name}`, description: `${marker} Explicit delivery-stage placement from Project Intelligence.`, startsAt, endsAt, type: "delivery" };
    const block = existing ? await prisma.scheduleBlock.update({ where: { id: existing.id }, data }) : await prisma.scheduleBlock.create({ data });
    invalidateProject(project.id);
    return { placed: true, conflictRequired: false, conflicts, block, stage: row };
  }

  async function applyProjectTypeGatePolicy(project: any, actorId?: string | null, channel = "release") {
    const definition = await projectType(project);
    const policy = definition.deliveryGatePolicy;
    if (!policy || (!policy.requiredGateIds.length && !policy.optionalGateIds.length)) return { applied: false, reason: "This Project Type has no delivery-gate policy." };
    const normalizedChannel = String(channel || "release").trim().toLowerCase().slice(0, 40) || "release";
    if (policy.channels?.length && !policy.channels.includes(normalizedChannel)) return { applied: false, reason: `The ${definition.label} policy does not define the ${normalizedChannel} channel.` };
    const entityId = `policy-${normalizedChannel}`;
    const existing = await prisma.clusterPersistenceRecord.findFirst({ where: { projectId: project.id, kind: "deliveryPolicy", entityId } });
    const now = new Date().toISOString();
    const payload = { id: entityId, projectId: project.id, channel: normalizedChannel, requiredGateIds: [...new Set(policy.requiredGateIds)].slice(0, 20), optionalGateIds: [...new Set(policy.optionalGateIds.filter((id) => !policy.requiredGateIds.includes(id)))].slice(0, 20), projectTypeId: definition.id, source: "project_type_policy", updatedById: actorId || null, updatedAt: now };
    const data = { title: `Delivery policy · ${normalizedChannel}`, projectId: project.id, entityType: "deliveryPolicy", entityId, ownerId: actorId || null, userId: actorId || null, status: "active", visibility: "internal", sourceKey: "project-intelligence-c3", payload: JSON.stringify(payload), archived: false, deletedAt: null, syncedAt: new Date() };
    const record = existing ? await prisma.clusterPersistenceRecord.update({ where: { id: existing.id }, data: { ...data, revision: { increment: 1 } } }) : await prisma.clusterPersistenceRecord.create({ data: { id: `project-type-policy-${project.id}-${normalizedChannel}`, kind: "deliveryPolicy", ...data, revision: 1 } });
    invalidateProject(project.id);
    return { applied: true, recordId: record.id, policy: payload };
  }

  async function portfolioHistory(workspaceId: string, limit = 30) {
    const records = await prisma.clusterPersistenceRecord.findMany({ where: { kind: "portfolioIntelligenceSnapshot", entityType: "workspace", entityId: workspaceId, archived: false }, orderBy: { createdAt: "desc" }, take: clamp(limit, 2, 90) });
    return records.map((record: any) => ({ id: record.id, createdAt: record.createdAt, ...parseJson(record.payload) })).reverse();
  }

  async function persistPortfolioHistory(workspaceId: string, snapshot: any) {
    const day = new Date(snapshot.generatedAt).toISOString().slice(0, 10);
    const id = `portfolio-${workspaceId}-${day}`;
    const payload = { generatedAt: snapshot.generatedAt, projectCount: snapshot.projectCount, atRisk: snapshot.atRisk, danger: snapshot.danger, crossProjectDependencies: snapshot.crossProjectDependencies, criticalCrossProjectDependencies: snapshot.criticalCrossProjectDependencies, highPressureOwners: snapshot.highPressureOwners, departments: snapshot.departments };
    await prisma.clusterPersistenceRecord.upsert({ where: { id }, update: { title: `Portfolio intelligence · ${day}`, payload: JSON.stringify(payload), syncedAt: new Date(), revision: { increment: 1 } }, create: { id, kind: "portfolioIntelligenceSnapshot", title: `Portfolio intelligence · ${day}`, entityType: "workspace", entityId: workspaceId, status: "recorded", visibility: "internal", sourceKey: "project-intelligence-c3", payload: JSON.stringify(payload), syncedAt: new Date(), revision: 1 } });
    const retained = await prisma.clusterPersistenceRecord.findMany({ where: { kind: "portfolioIntelligenceSnapshot", entityType: "workspace", entityId: workspaceId, archived: false }, select: { id: true }, orderBy: { createdAt: "desc" }, take: 120 });
    const expired = retained.slice(90).map((item: any) => item.id);
    if (expired.length) await prisma.clusterPersistenceRecord.updateMany({ where: { id: { in: expired } }, data: { archived: true, revision: { increment: 1 } } });
  }

  async function portfolioSnapshot(workspaceId: string) {
    const now = Date.now();
    const dueSoonCutoff = now + 14 * DAY;
    const importantUnownedKinds = new Set(["phase", "milestone", "deliverable", "issue", "risk", "change_request"]);
    const projectMetrics = new Map<string, { open: number; overdue: number; blocked: number; unowned: number }>();
    const ownerMetrics = new Map<string, { active: number; overdue: number; dueSoon: number }>();
    const criticalCrossProjectByProject = new Map<string, number>();
    let crossProjectDependencies = 0;
    let criticalCrossProjectDependencies = 0;

    const [recordScan, relationshipScan] = await Promise.all([
      scanById<any>(
        (cursor, take) => prisma.projectControlRecord.findMany({
          where: { project: { workspaceId, archived: false }, archived: false },
          select: { id: true, projectId: true, kind: true, status: true, priority: true, ownerId: true, dueDate: true },
          orderBy: { id: "asc" },
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          take,
        }),
        (records) => {
          for (const record of records) {
            if (closed(record.status)) continue;
            const dueAt = record.dueDate ? new Date(record.dueDate).getTime() : 0;
            const project = projectMetrics.get(record.projectId) || { open: 0, overdue: 0, blocked: 0, unowned: 0 };
            project.open += 1;
            if (dueAt && dueAt < now) project.overdue += 1;
            if (String(record.status).toLowerCase() === "blocked" || String(record.priority).toLowerCase() === "urgent") project.blocked += 1;
            if (!record.ownerId && importantUnownedKinds.has(record.kind)) project.unowned += 1;
            projectMetrics.set(record.projectId, project);
            if (record.ownerId) {
              const owner = ownerMetrics.get(record.ownerId) || { active: 0, overdue: 0, dueSoon: 0 };
              owner.active += 1;
              if (dueAt && dueAt < now) owner.overdue += 1;
              else if (dueAt && dueAt <= dueSoonCutoff) owner.dueSoon += 1;
              ownerMetrics.set(record.ownerId, owner);
            }
          }
        },
        { batchSize: 2_000, label: "Portfolio control-record scan" },
      ),
      scanById<any>(
        (cursor, take) => prisma.projectRelationship.findMany({
          where: { project: { workspaceId, archived: false }, relationship: { in: ["blocks", "depends_on", "blocked_by"] }, sourceType: "project", targetType: "project" },
          select: { id: true, sourceId: true, targetId: true, critical: true },
          orderBy: { id: "asc" },
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          take,
        }),
        (relationships) => {
          for (const relationship of relationships) {
            crossProjectDependencies += 1;
            if (!relationship.critical) continue;
            criticalCrossProjectDependencies += 1;
            criticalCrossProjectByProject.set(relationship.sourceId, (criticalCrossProjectByProject.get(relationship.sourceId) || 0) + 1);
            if (relationship.targetId !== relationship.sourceId) criticalCrossProjectByProject.set(relationship.targetId, (criticalCrossProjectByProject.get(relationship.targetId) || 0) + 1);
          }
        },
        { batchSize: 2_000, label: "Portfolio relationship scan" },
      ),
    ]);

    const projectRows: any[] = [];
    let projectCount = 0;
    let atRisk = 0;
    let danger = 0;
    const projectScan = await scanById<any>(
      (cursor, take) => prisma.project.findMany({
        where: { workspaceId, archived: false },
        select: { id: true, name: true, status: true, priority: true, targetDate: true, projectType: true },
        orderBy: { id: "asc" },
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        take,
      }),
      (projects) => {
        for (const project of projects) {
          projectCount += 1;
          const metrics = projectMetrics.get(project.id) || { open: 0, overdue: 0, blocked: 0, unowned: 0 };
          const targetOverdue = project.targetDate && new Date(project.targetDate).getTime() < now && !closed(project.status);
          const crossProjectCritical = criticalCrossProjectByProject.get(project.id) || 0;
          const signals = [metrics.overdue ? `${metrics.overdue} overdue control item${metrics.overdue === 1 ? "" : "s"}` : "", metrics.blocked ? `${metrics.blocked} blocked/urgent control item${metrics.blocked === 1 ? "" : "s"}` : "", metrics.unowned ? `${metrics.unowned} important unowned item${metrics.unowned === 1 ? "" : "s"}` : "", targetOverdue ? "Project target date has passed" : "", crossProjectCritical ? `${crossProjectCritical} critical cross-project dependency link${crossProjectCritical === 1 ? "" : "s"}` : ""].filter(Boolean);
          const risk = signals.length >= 3 || targetOverdue ? "danger" : signals.length ? "warning" : "good";
          if (risk !== "good") atRisk += 1;
          if (risk === "danger") danger += 1;
          projectRows.push({ id: project.id, name: project.name, projectType: project.projectType, status: project.status, priority: project.priority, targetDate: project.targetDate, open: metrics.open, overdue: metrics.overdue, blocked: metrics.blocked, unowned: metrics.unowned, crossProjectCritical, risk, signals });
        }
        projectRows.sort((a: any, b: any) => (b.risk === "danger" ? 2 : b.risk === "warning" ? 1 : 0) - (a.risk === "danger" ? 2 : a.risk === "warning" ? 1 : 0) || (b.overdue * 10 + b.blocked * 5 + b.unowned) - (a.overdue * 10 + a.blocked * 5 + a.unowned) || String(a.name).localeCompare(String(b.name)));
        if (projectRows.length > 1_000) projectRows.length = 1_000;
      },
      { batchSize: 1_000, label: "Portfolio project scan" },
    );

    const departmentMap = new Map<string, { department: string; owners: number; active: number; overdue: number; highPressureOwners: number }>();
    const topOwners: any[] = [];
    let highPressureOwners = 0;
    const userScan = await scanById<any>(
      (cursor, take) => prisma.user.findMany({
        where: { archived: false, memberships: { some: { workspaceId } } },
        select: {
          id: true, username: true, displayName: true,
          employment: { select: { capacityHours: true, department: { select: { name: true } } } },
          workforceStatus: { select: { availability: true, connectionVisibility: true } },
        },
        orderBy: { id: "asc" },
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        take,
      }),
      (users) => {
        for (const user of users) {
          const metrics = ownerMetrics.get(user.id);
          if (!metrics?.active && !metrics?.overdue) continue;
          const capacityHours = Number(user.employment?.capacityHours || 0);
          const heuristicCapacityUnits = capacityHours > 0 ? Math.max(1, Math.floor(capacityHours / 4)) : 8;
          const pressure = metrics.active > heuristicCapacityUnits * 1.25 || metrics.overdue >= 3 ? "high" : metrics.active > heuristicCapacityUnits || metrics.overdue ? "elevated" : "normal";
          if (pressure === "high") highPressureOwners += 1;
          const row = { id: user.id, name: user.displayName || user.username, department: user.employment?.department?.name || null, status: user.workforceStatus?.connectionVisibility === "invisible" ? "offline" : user.workforceStatus?.availability || "offline", capacityHours: capacityHours || null, active: metrics.active, overdue: metrics.overdue, dueSoon: metrics.dueSoon, pressure, formula: capacityHours ? `${metrics.active} active records vs ~${heuristicCapacityUnits} four-hour work units from ${capacityHours}h capacity` : `${metrics.active} active records vs default 8-record heuristic because capacity is unset` };
          const department = String(row.department || "Unassigned");
          const departmentRow = departmentMap.get(department) || { department, owners: 0, active: 0, overdue: 0, highPressureOwners: 0 };
          departmentRow.owners += 1;
          departmentRow.active += row.active;
          departmentRow.overdue += row.overdue;
          if (pressure === "high") departmentRow.highPressureOwners += 1;
          departmentMap.set(department, departmentRow);
          topOwners.push(row);
        }
        topOwners.sort((a: any, b: any) => (b.overdue * 10 + b.active) - (a.overdue * 10 + a.active));
        if (topOwners.length > 100) topOwners.length = 100;
      },
      { batchSize: 2_000, label: "Portfolio user scan" },
    );

    const snapshot = {
      generatedAt: new Date().toISOString(),
      projectCount,
      atRisk,
      danger,
      crossProjectDependencies,
      criticalCrossProjectDependencies,
      highPressureOwners,
      departments: [...departmentMap.values()].sort((a, b) => (b.overdue * 10 + b.active) - (a.overdue * 10 + a.active)).slice(0, 100),
      projects: projectRows,
      owners: topOwners,
      pagination: { projectsShown: projectRows.length, projectsTruncated: projectCount > projectRows.length, ownersShown: topOwners.length },
      scan: { projects: projectScan, controlRecords: recordScan, relationships: relationshipScan, users: userScan },
      methodology: "Portfolio risk is a transparent count of overdue, blocked/urgent, unowned, target-date, and critical cross-project dependency signals. Capacity pressure is a heuristic over active owned records and configured weekly capacity; it is not a predictive score. Metrics scan the full workspace in bounded cursor batches while presentation rows stay intentionally capped.",
    };
    await persistPortfolioHistory(workspaceId, snapshot);
    const history = await portfolioHistory(workspaceId, 30);
    const first = history[0] || snapshot;
    const last = history[history.length - 1] || snapshot;
    return { ...snapshot, trend: { samples: history.length, atRiskDelta: Number(last.atRisk || 0) - Number(first.atRisk || 0), dangerDelta: Number(last.danger || 0) - Number(first.danger || 0), highPressureDelta: Number(last.highPressureOwners || 0) - Number(first.highPressureOwners || 0), history } };
  }

  return { pipelineSnapshot, invalidateProject, ensurePipeline, reconcilePipeline, schedulePipelineStage, applyProjectTypeGatePolicy, portfolioSnapshot, portfolioHistory };
}
