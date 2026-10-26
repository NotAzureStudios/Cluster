import { CLUSTER_WORKFLOW_RELATIONSHIP_META, type ClusterWorkflowRelationship } from "@cluster/shared";
import { createProjectDeliveryLifecycleService } from "./project-delivery-lifecycle-service.js";
import { createProjectDeliveryService } from "./project-delivery-service.js";
import { analyzeProjectDependencies } from "./project-dependency-intelligence.js";
import type { ProjectReadModelRuntime } from "../../core/project-read-model-runtime.js";
import type { AuthorizationService } from "../access/authorization.js";
import { canAccessCalendarEvent } from "../planning/calendar-access.js";

const WORKFLOW_KINDS = ["meeting", "dependency", "versionSnapshot"] as const;

type ProjectIntelligenceAccessContext = { request: any; authorization: AuthorizationService };

function parseObject(value: unknown): Record<string, any> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, any>;
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)).filter(Boolean) : [];
  } catch {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
}

function normalized(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function workflowPayload(record: any) {
  return { ...parseObject(record.payload), id: record.entityId || record.id, projectId: record.projectId, createdAt: record.createdAt, updatedAt: record.updatedAt };
}

function isClosedStatus(value: unknown) {
  return ["done", "completed", "resolved", "approved", "accepted", "closed", "published", "cancelled", "passed", "go"].includes(normalized(value));
}

function isFailedStatus(value: unknown) {
  return ["failed", "blocked", "no-go", "rejected"].includes(normalized(value));
}

function buildKey(build: Record<string, any>) { return [build.id, build.version, build.buildNumber, build.sourceRevision].map(normalized).filter(Boolean); }

function qaLinksBuild(qa: Record<string, any>, build: Record<string, any>) { return normalized(qa.buildId) === normalized(build.id); }

function releaseLinksBuild(release: Record<string, any>, build: Record<string, any>) { return normalized(release.buildId) === normalized(build.id); }

function nodeKey(kind: string, id: string) {
  return `${kind}:${id}`;
}

function projectSectionForKind(kind: string) {
  if (["board", "card", "ticket"].includes(kind)) return kind === "ticket" ? "tickets" : "boards";
  if (kind === "whiteboard") return "whiteboards";
  if (["build", "release"].includes(kind)) return "builds";
  if (["qa_plan", "qa_session", "qa"].includes(kind)) return "qa";
  if (kind === "library") return "library";
  if (kind === "file") return "assets";
  if (kind === "control") return "control";
  if (["timeline", "meeting"].includes(kind)) return "plan";
  return "overview";
}

function readinessFactor(id: string, label: string, score: number, maximum: number, explanation: string, affected: string[]) {
  const bounded = Math.max(0, Math.min(maximum, Math.round(score)));
  const state = bounded >= maximum * 0.8 ? "good" : bounded <= maximum * 0.35 ? "danger" : "warning";
  return { id, label, score: bounded, maximum, explanation, state, affected: affected.slice(0, 20) };
}

export function createProjectIntelligenceService(prisma: any, readModels?: ProjectReadModelRuntime) {
  async function loadSnapshot(projectId: string, access?: ProjectIntelligenceAccessContext) {
    const delivery = createProjectDeliveryService(prisma);
    let [project, workflowRecords, builds, qaPlans, qaSessions, releases, controlRecords, boards, whiteboards, libraryItems, files, timelineItems, calendarEvents, scheduleBlocks, relationships, activity] = await Promise.all([
      prisma.project.findFirst({ where: { id: projectId, archived: false }, select: { id: true, name: true, status: true, projectType: true, updatedAt: true, targetDate: true } }),
      prisma.clusterPersistenceRecord.findMany({ where: { projectId, archived: false, kind: { in: [...WORKFLOW_KINDS] } }, orderBy: { updatedAt: "desc" }, take: 5_000 }),
      delivery.list([projectId], "build"),
      delivery.list([projectId], "qa-plan"),
      delivery.list([projectId], "qa-session"),
      delivery.list([projectId], "release"),
      prisma.projectControlRecord.findMany({ where: { projectId, archived: false }, orderBy: { updatedAt: "desc" }, take: 5_000 }),
      prisma.board.findMany({
        where: { projectId, archived: false }, orderBy: { updatedAt: "desc" }, take: 200,
        select: { id: true, name: true, updatedAt: true, lists: { orderBy: { position: "asc" }, take: 100, select: { id: true, title: true, isDone: true, cards: { where: { archived: false }, orderBy: { updatedAt: "desc" }, take: 500, select: { id: true, title: true, priority: true, dueDate: true, labels: true, assigneeId: true, workItemKind: true, updatedAt: true } } } } },
      }),
      prisma.whiteboard.findMany({ where: { projectId }, orderBy: { updatedAt: "desc" }, take: 300, select: { id: true, name: true, updatedAt: true } }),
      prisma.libraryItem.findMany({ where: { projectId, status: { not: "archived" } }, orderBy: { updatedAt: "desc" }, take: 500, select: { id: true, title: true, type: true, status: true, ownerId: true, reviewerId: true, reviewDueAt: true, updatedAt: true } }),
      prisma.projectFile.findMany({ where: { projectId, archived: false }, orderBy: { updatedAt: "desc" }, take: 500, select: { id: true, title: true, category: true, uploadedById: true, updatedAt: true } }),
      prisma.timelineItem.findMany({ where: { projectId }, orderBy: { updatedAt: "desc" }, take: 500, select: { id: true, title: true, type: true, startsAt: true, updatedAt: true } }),
      prisma.calendarEvent.findMany({ where: { projectId }, orderBy: { startsAt: "desc" }, take: 500, select: { id: true, title: true, eventType: true, status: true, visibility: true, ownerId: true, attendeeIds: true, startsAt: true, updatedAt: true } }),
      prisma.scheduleBlock.findMany({ where: { projectId }, orderBy: { startsAt: "desc" }, take: 500, select: { id: true, title: true, type: true, userId: true, cardId: true, startsAt: true, endsAt: true, updatedAt: true } }),
      prisma.projectRelationship.findMany({ where: { OR: [{ projectId }, { sourceType: "project", sourceId: projectId }, { targetType: "project", targetId: projectId }] }, orderBy: [{ critical: "desc" }, { createdAt: "desc" }], take: 2_000 }),
      prisma.activityEvent.findMany({ where: { projectId }, orderBy: { createdAt: "desc" }, take: 40, include: { user: { select: { id: true, username: true, displayName: true, avatarUrl: true } } } }),
    ]) as [any, any[], any[], any[], any[], any[], any[], any[], any[], any[], any[], any[], any[], any[], any[], any[]];
    if (!project) return null;

    let canSeeDeliveryLifecycle = true;
    if (access) {
      const { request, authorization } = access;
      const identity = await authorization.identityForRequest(request);
      canSeeDeliveryLifecycle = Boolean(identity.user && (identity.decorated?.isAdmin || authorization.hasToolPermission(identity.user, identity.role, "builds", "view")));
      boards = await authorization.filterTargetsForRequest(request, boards, "board", project, "view");
      for (const board of boards) {
        for (const list of board.lists || []) {
          const candidates = (list.cards || []).map((card: any) => ({ ...card, boardId: board.id }));
          list.cards = await authorization.filterCardsForRequest(request, candidates, project, "view");
        }
      }
      whiteboards = await authorization.filterTargetsForRequest(request, whiteboards, "whiteboard", project, "view");
      libraryItems = await authorization.filterTargetsForRequest(request, libraryItems, "library", project, "view");
      files = await authorization.filterTargetsForRequest(request, files, "file", project, "view");
      timelineItems = await authorization.filterTargetsForRequest(request, timelineItems, "timeline", project, "view");
      scheduleBlocks = await authorization.filterTargetsForRequest(request, scheduleBlocks, "schedule", project, "view");
      controlRecords = await authorization.filterTargetsForRequest(request, controlRecords, "control", project, "view");
      builds = await authorization.filterTargetsForRequest(request, builds, "build", project, "view");
      qaPlans = await authorization.filterTargetsForRequest(request, qaPlans, "qa_plan", project, "view");
      qaSessions = await authorization.filterTargetsForRequest(request, qaSessions, "qa_session", project, "view");
      releases = await authorization.filterTargetsForRequest(request, releases, "release", project, "view");
      const visibleCalendar: any[] = [];
      for (const event of calendarEvents) {
        const candidate = { ...event, projectId, project };
        if (await canAccessCalendarEvent(authorization, request, candidate, "view")) visibleCalendar.push(event);
      }
      calendarEvents = visibleCalendar;
      activity = await authorization.filterActivityEventsForRequest(request, activity, "view");
    }

    const lifecycle = canSeeDeliveryLifecycle ? await createProjectDeliveryLifecycleService(prisma).snapshot(projectId) : null;

    const byKind = new Map<string, any[]>();
    for (const record of workflowRecords) {
      const rows = byKind.get(record.kind) || [];
      rows.push(workflowPayload(record));
      byKind.set(record.kind, rows);
    }
    const meetings = byKind.get("meeting") || [];
    const cards = boards.flatMap((board: any) => board.lists.flatMap((list: any) => list.cards.map((card: any) => ({ ...card, boardId: board.id, boardName: board.name, listId: list.id, listTitle: list.title, done: Boolean(list.isDone) }))));

    const nodeMap = new Map<string, Record<string, any>>();
    const edges: Array<Record<string, any>> = [];
    const addNode = (kind: string, entityId: string, data: Record<string, any>) => {
      const id = nodeKey(kind, entityId);
      if (!nodeMap.has(id)) nodeMap.set(id, { id, kind, entityId, section: projectSectionForKind(kind), ...data });
      return id;
    };

    addNode("project", project.id, { title: project.name, status: project.status || "active", dueDate: project.targetDate || null, updatedAt: project.updatedAt });
    for (const board of boards) addNode("board", board.id, { title: board.name, status: "active", updatedAt: board.updatedAt });
    for (const card of cards) addNode("card", card.id, { title: card.title, status: card.done ? "completed" : "open", priority: card.priority, dueDate: card.dueDate, ownerId: card.assigneeId || null, updatedAt: card.updatedAt, boardId: card.boardId });
    for (const whiteboard of whiteboards) addNode("whiteboard", whiteboard.id, { title: whiteboard.name, status: "active", updatedAt: whiteboard.updatedAt });
    for (const build of builds) addNode("build", build.id, { title: build.title || build.version || "Build", status: build.qaStatus || build.approval || "untested", version: build.version || null, commit: build.sourceRevision || null, platform: build.platform || null, ownerId: build.ownerId || null, updatedAt: build.updatedAt || build.createdAt || null });
    for (const plan of qaPlans) addNode("qa_plan", plan.id, { title: plan.title || "QA plan", status: plan.status || "draft", platform: plan.platform || null, ownerId: plan.ownerId || null, updatedAt: plan.updatedAt || plan.createdAt || null });
    for (const qa of qaSessions) addNode("qa_session", qa.id, { title: qa.build || qa.scope || "QA session", status: qa.decision || qa.status || "planned", platform: qa.platform || null, ownerId: qa.ownerId || null, updatedAt: qa.updatedAt || qa.completedAt || qa.createdAt || null });
    for (const release of releases) addNode("release", release.id, { title: release.title || release.buildVersion || "Release notes", status: release.status || "draft", version: release.buildVersion || null, updatedAt: release.updatedAt || release.createdAt || null });
    for (const meeting of meetings) addNode("meeting", meeting.id, { title: meeting.name || meeting.title || "Meeting", status: meeting.status || "planned", startsAt: meeting.start || null, dueDate: meeting.end || null, ownerId: meeting.ownerId || null, updatedAt: meeting.updatedAt || meeting.createdAt || null });
    for (const control of controlRecords) addNode("control", control.id, { title: control.title || control.kind, status: control.status || "open", priority: control.priority || "medium", dueDate: control.dueDate || null, updatedAt: control.updatedAt });
    for (const item of timelineItems) addNode("timeline", item.id, { title: item.title, status: item.type, startsAt: item.startsAt, updatedAt: item.updatedAt });
    for (const event of calendarEvents) addNode("calendar", event.id, { title: event.title, status: event.status, eventType: event.eventType, ownerId: event.ownerId || null, startsAt: event.startsAt, updatedAt: event.updatedAt });
    for (const block of scheduleBlocks) addNode("scheduler", block.id, { title: block.title, status: block.type, ownerId: block.userId || null, startsAt: block.startsAt, endsAt: block.endsAt, updatedAt: block.updatedAt });
    for (const item of libraryItems) addNode("library", item.id, { title: item.title, status: item.status, ownerId: item.ownerId || null, reviewerId: item.reviewerId || null, dueDate: item.reviewDueAt || null, updatedAt: item.updatedAt });
    for (const file of files) addNode("file", file.id, { title: file.title, status: file.category || "file", ownerId: file.uploadedById || null, updatedAt: file.updatedAt });

    // Preserve stable Build -> QA -> Release inference for older records while clearly marking it inferred.
    for (const build of builds) {
      const linkedQa = qaSessions.filter((qa) => qaLinksBuild(qa, build));
      const linkedReleases = releases.filter((release) => releaseLinksBuild(release, build));
      for (const qa of linkedQa) edges.push({ id: `inferred:build:${build.id}:qa:${qa.id}`, from: nodeKey("build", build.id), to: nodeKey("qa_session", qa.id), relationship: "verified_by", authority: normalized(qa.buildId) === normalized(build.id) ? "explicit" : "inferred" });
      for (const release of linkedReleases) edges.push({ id: `inferred:build:${build.id}:release:${release.id}`, from: nodeKey("build", build.id), to: nodeKey("release", release.id), relationship: "documented_by", authority: normalized(release.buildId) === normalized(build.id) ? "explicit" : "inferred" });
    }
    for (const qa of qaSessions) {
      for (const release of releases) {
        const qaBuild = normalized(qa.build);
        const releaseBuild = normalized(release.buildVersion || release.version);
        if (qaBuild && releaseBuild && qaBuild === releaseBuild) edges.push({ id: `inferred:qa:${qa.id}:release:${release.id}`, from: nodeKey("qa_session", qa.id), to: nodeKey("release", release.id), relationship: "supports", authority: "inferred" });
      }
    }

    const relationshipMeta = (value: unknown) => CLUSTER_WORKFLOW_RELATIONSHIP_META[normalized(value) as ClusterWorkflowRelationship];

    const referencedUserIds = new Set<string>();
    for (const card of cards) if (card.assigneeId) referencedUserIds.add(card.assigneeId);
    for (const build of builds) { if (build.ownerId) referencedUserIds.add(String(build.ownerId)); for (const id of build.reviewerIds || []) referencedUserIds.add(String(id)); }
    for (const plan of qaPlans) { if (plan.ownerId) referencedUserIds.add(String(plan.ownerId)); for (const id of plan.testerIds || []) referencedUserIds.add(String(id)); for (const testCase of plan.cases || []) if (testCase.assigneeId) referencedUserIds.add(String(testCase.assigneeId)); }
    for (const qa of qaSessions) { if (qa.ownerId) referencedUserIds.add(String(qa.ownerId)); for (const id of qa.testerIds || []) referencedUserIds.add(String(id)); }
    for (const event of calendarEvents) { if (event.ownerId) referencedUserIds.add(event.ownerId); for (const id of parseStringList(event.attendeeIds)) referencedUserIds.add(id); }
    for (const block of scheduleBlocks) if (block.userId) referencedUserIds.add(block.userId);
    for (const item of libraryItems) { if (item.ownerId) referencedUserIds.add(item.ownerId); if (item.reviewerId) referencedUserIds.add(item.reviewerId); }
    for (const relationship of relationships) { if (relationship.sourceType === "user") referencedUserIds.add(relationship.sourceId); if (relationship.targetType === "user") referencedUserIds.add(relationship.targetId); }
    const users = referencedUserIds.size ? await prisma.user.findMany({ where: { id: { in: [...referencedUserIds].slice(0, 500) }, archived: false }, select: { id: true, username: true, displayName: true, avatarUrl: true, employment: { select: { department: { select: { name: true } } } }, workforceStatus: { select: { availability: true, connectionVisibility: true } } } }) : [];
    for (const user of users) addNode("user", user.id, { title: user.displayName || user.username || "User", status: user.workforceStatus?.connectionVisibility === "invisible" ? "offline" : user.workforceStatus?.availability || "offline", department: user.employment?.department?.name || null });

    relationships = relationships.filter((relationship: any) => {
      const sourceKind = normalized(relationship.sourceType).replace(/-/g, "_") || "related";
      const targetKind = normalized(relationship.targetType).replace(/-/g, "_") || "related";
      return nodeMap.has(nodeKey(sourceKind, relationship.sourceId)) && nodeMap.has(nodeKey(targetKind, relationship.targetId));
    });
    for (const relationship of relationships) {
      const sourceKind = normalized(relationship.sourceType).replace(/-/g, "_") || "related";
      const targetKind = normalized(relationship.targetType).replace(/-/g, "_") || "related";
      edges.push({ id: `relationship:${relationship.id}`, relationshipId: relationship.id, from: nodeKey(sourceKind, relationship.sourceId), to: nodeKey(targetKind, relationship.targetId), relationship: relationship.relationship, authority: "explicit", critical: Boolean(relationship.critical), description: relationship.description || null });
    }
    const dependency = analyzeProjectDependencies(projectId, relationships, nodeMap as Map<string, any>);
    const blockingRelationships = relationships.filter((relationship: any) => Boolean(relationshipMeta(relationship.relationship)?.blocking));
    const criticalRelationships = relationships.filter((relationship: any) => Boolean(relationship.critical));

    const unlinkedBuilds = builds.filter((build) => !qaSessions.some((qa) => qaLinksBuild(qa, build)) && !edges.some((edge) => edge.from === nodeKey("build", build.id) && ["tests", "validates", "verified_by"].includes(edge.relationship)));
    const unlinkedQa = qaSessions.filter((qa) => !builds.some((build) => qaLinksBuild(qa, build)) && !edges.some((edge) => edge.to === nodeKey("qa_session", qa.id) || edge.from === nodeKey("qa_session", qa.id)));
    const failedQa = qaSessions.filter((qa) => isFailedStatus(qa.status) || normalized(qa.decision) === "no-go");
    const releaseReadyBuilds = lifecycle?.releaseReady && lifecycle?.latestBuild ? [lifecycle.latestBuild] : [];
    const openControls = controlRecords.filter((record: any) => !isClosedStatus(record.status));
    const controlBlockers = openControls.filter((record: any) => normalized(record.status) === "blocked" || normalized(record.priority) === "urgent" || (record.kind === "risk" && Number(record.probability || 0) * Number(record.impact || 0) >= 12));
    const openCards = cards.filter((card: any) => !card.done);
    const blockedCards = openCards.filter((card: any) => parseStringList(card.labels).some((label) => ["blocked", "blocker"].includes(normalized(label))));
    const urgentCards = openCards.filter((card: any) => normalized(card.priority) === "urgent");
    const now = Date.now();
    const overdueCriticalCards = openCards.filter((card: any) => card.dueDate && new Date(card.dueDate).getTime() < now && ["high", "urgent"].includes(normalized(card.priority)));
    const latestBuild = [...builds].sort((a, b) => new Date(b.createdAt || b.updatedAt || 0).getTime() - new Date(a.createdAt || a.updatedAt || 0).getTime())[0] || null;
    const latestBuildQa = latestBuild ? qaSessions.filter((qa) => qaLinksBuild(qa, latestBuild)) : [];
    const latestQaPassed = latestBuildQa.some((qa) => normalized(qa.status) === "passed" || normalized(qa.decision) === "go");
    const latestQaFailed = latestBuildQa.some((qa) => isFailedStatus(qa.status) || normalized(qa.decision) === "no-go");
    const criticalAffected = [
      ...urgentCards.map((card: any) => nodeKey("card", card.id)),
      ...overdueCriticalCards.map((card: any) => nodeKey("card", card.id)),
      ...criticalRelationships.flatMap((relationship: any) => [nodeKey(normalized(relationship.sourceType).replace(/-/g, "_"), relationship.sourceId), nodeKey(normalized(relationship.targetType).replace(/-/g, "_"), relationship.targetId)]),
    ];
    const blockerAffected = [
      ...blockedCards.map((card: any) => nodeKey("card", card.id)),
      ...controlBlockers.map((record: any) => nodeKey("control", record.id)),
      ...blockingRelationships.flatMap((relationship: any) => [nodeKey(normalized(relationship.sourceType).replace(/-/g, "_"), relationship.sourceId), nodeKey(normalized(relationship.targetType).replace(/-/g, "_"), relationship.targetId)]),
    ];
    const criticalScore = 20 - Math.min(20, urgentCards.length * 4 + overdueCriticalCards.length * 3 + criticalRelationships.length * 2);
    const blockerScore = 20 - Math.min(20, blockedCards.length * 5 + controlBlockers.length * 5 + blockingRelationships.length * 3);
    let buildScore = 0;
    if (latestBuild) buildScore = normalized(latestBuild.approval) === "approved" ? 20 : normalized(latestBuild.qaStatus) === "passed" ? 16 : normalized(latestBuild.qaStatus) === "testing" ? 10 : latestBuild.promotedAt ? 8 : 5;
    let qaScore = latestBuild ? (latestQaPassed ? 20 : latestQaFailed ? 0 : latestBuildQa.length ? 10 : 4) : 0;
    if (qaPlans.some((plan) => ["failed", "blocked"].includes(normalized(plan.status)))) qaScore = Math.max(0, qaScore - 4);
    const approvalScore = latestBuild ? normalized(latestBuild.approval) === "approved" ? 10 : normalized(latestBuild.approval) === "pending" ? 5 : normalized(latestBuild.approval) === "blocked" ? 0 : 2 : 0;
    const workflowNodeIds = new Set([...builds.map((row) => nodeKey("build", row.id)), ...qaPlans.map((row) => nodeKey("qa_plan", row.id)), ...qaSessions.map((row) => nodeKey("qa_session", row.id)), ...releases.map((row) => nodeKey("release", row.id))]);
    const linkedWorkflowNodeIds = new Set(edges.flatMap((edge) => [edge.from, edge.to]).filter((id) => workflowNodeIds.has(id)));
    const explicitWorkflowEdges = edges.filter((edge) => edge.authority === "explicit" && (workflowNodeIds.has(edge.from) || workflowNodeIds.has(edge.to))).length;
    const traceScore = workflowNodeIds.size ? Math.min(10, Math.round((linkedWorkflowNodeIds.size / workflowNodeIds.size) * 8) + Math.min(2, explicitWorkflowEdges)) : 10;
    const dependencyScore = 10 - Math.min(10, dependency.cycles.length * 5 + dependency.crossProject.filter((item: any) => item.critical).length * 2);
    const factors = [
      readinessFactor("critical_work", "Critical work", criticalScore, 20, urgentCards.length || overdueCriticalCards.length || criticalRelationships.length ? `${urgentCards.length} urgent, ${overdueCriticalCards.length} overdue high-priority, and ${criticalRelationships.length} critical linked relationship(s) reduce readiness.` : "No urgent, overdue high-priority, or critical linked work is open.", criticalAffected),
      readinessFactor("blockers", "Blockers", blockerScore, 20, blockedCards.length || controlBlockers.length || blockingRelationships.length ? `${blockedCards.length} blocked card(s), ${controlBlockers.length} blocking control record(s), and ${blockingRelationships.length} blocking relationship(s) are open.` : "No explicit delivery blockers are open.", blockerAffected),
      readinessFactor("build_maturity", "Build maturity", buildScore, 20, latestBuild ? `Latest build ${latestBuild.version || latestBuild.title || latestBuild.id} is QA ${latestBuild.qaStatus || "untested"} / approval ${latestBuild.approval || "draft"}.` : "No build artifact exists yet.", latestBuild ? [nodeKey("build", latestBuild.id)] : []),
      readinessFactor("qa_confidence", "QA confidence", qaScore, 20, latestBuild ? latestQaPassed ? "Latest build has passing QA evidence." : latestQaFailed ? "Latest build has failed or blocked QA." : latestBuildQa.length ? "Latest build has QA in progress." : "Latest build has no linked QA session." : "QA confidence cannot be established without a build.", latestBuildQa.map((qa) => nodeKey("qa_session", qa.id))),
      readinessFactor("approval", "Approval", approvalScore, 10, latestBuild ? `Latest build approval is ${latestBuild.approval || "draft"}.` : "No build is available for approval.", latestBuild ? [nodeKey("build", latestBuild.id)] : []),
      readinessFactor("traceability", "Traceability", traceScore, 10, workflowNodeIds.size ? `${linkedWorkflowNodeIds.size}/${workflowNodeIds.size} workflow object(s) are connected; ${explicitWorkflowEdges} explicit relationship(s) carry the highest confidence.` : "No delivery workflow objects exist yet.", [...workflowNodeIds].filter((id) => !linkedWorkflowNodeIds.has(id))),
      readinessFactor("dependency_integrity", "Dependency integrity", dependencyScore, 10, dependency.cycles.length ? `${dependency.cycles.length} dependency cycle(s) make sequencing ambiguous.` : dependency.crossProject.length ? `${dependency.crossProject.length} cross-project dependency link(s) are visible; ${dependency.crossProject.filter((item: any) => item.critical).length} are marked critical.` : "The blocking dependency graph has no cycles or cross-project critical links.", dependency.cycles.flatMap((cycle: any) => cycle.nodeIds).slice(0, 20)),
    ];
    const scoreMaximum = factors.reduce((sum, factor) => sum + factor.maximum, 0) || 1;
    const score = Math.round((factors.reduce((sum, factor) => sum + factor.score, 0) / scoreMaximum) * 100);
    const signals = factors.filter((factor) => factor.state !== "good").map((factor) => ({ id: factor.id, label: factor.label, severity: factor.state, explanation: factor.explanation, affected: factor.affected }));

    const workspace = [
      { id: "overview", group: "work", label: "Overview", count: 1, ready: true },
      { id: "plan", group: "work", label: "Plan", count: controlRecords.filter((row: any) => ["phase", "milestone", "deliverable", "goal"].includes(row.kind)).length + timelineItems.length, ready: true },
      { id: "control", group: "work", label: "Control", count: controlRecords.length, ready: true },
      { id: "tickets", group: "work", label: "Tickets", count: blockedCards.length + urgentCards.length, ready: true },
      { id: "builds", group: "work", label: "Builds", count: builds.length, ready: true },
      { id: "qa", group: "work", label: "QA", count: qaSessions.length + qaPlans.length, ready: true },
      { id: "boards", group: "spaces", label: "Boards", count: boards.length, ready: true },
      { id: "whiteboards", group: "spaces", label: "Whiteboards", count: whiteboards.length, ready: true },
      { id: "library", group: "spaces", label: "Library", count: libraryItems.length + files.length, ready: true },
    ];

    const blockers = [
      ...blockingRelationships.map((relationship: any) => {
        const sourceKind = normalized(relationship.sourceType).replace(/-/g, "_");
        const targetKind = normalized(relationship.targetType).replace(/-/g, "_");
        const sourceNode = nodeMap.get(nodeKey(sourceKind, relationship.sourceId));
        const targetNode = nodeMap.get(nodeKey(targetKind, relationship.targetId));
        const meta = relationshipMeta(relationship.relationship);
        return {
          id: `relationship:${relationship.id}`,
          relationshipId: relationship.id,
          nodeId: nodeKey(sourceKind, relationship.sourceId),
          targetNodeId: nodeKey(targetKind, relationship.targetId),
          kind: "relationship",
          title: `${sourceNode?.title || relationship.sourceType} ${meta?.outgoing || relationship.relationship} ${targetNode?.title || relationship.targetType}`,
          status: "blocked",
          priority: relationship.critical ? "urgent" : "high",
          dueDate: null,
          critical: Boolean(relationship.critical),
          relationship: relationship.relationship,
        };
      }),
      ...controlBlockers.map((row: any) => ({ id: row.id, nodeId: nodeKey("control", row.id), kind: row.kind, title: row.title, status: row.status, priority: row.priority, dueDate: row.dueDate || null })),
      ...blockedCards.map((card: any) => ({ id: card.id, nodeId: nodeKey("card", card.id), kind: "card", title: card.title, status: "blocked", priority: card.priority, dueDate: card.dueDate || null })),
    ].slice(0, 50);

    return {
      project,
      generatedAt: new Date().toISOString(),
      score,
      readiness: { factors, signals },
      dependencies: dependency,
      workspace,
      counts: {
        boards: boards.length, cards: cards.length, openCards: openCards.length, whiteboards: whiteboards.length,
        builds: builds.length, qaPlans: qaPlans.length, qaSessions: qaSessions.length, releases: releases.length,
        controlRecords: controlRecords.length, blockers: blockers.length, releaseReadyBuilds: releaseReadyBuilds.length,
        unlinkedBuilds: unlinkedBuilds.length, unlinkedQa: unlinkedQa.length, timelineItems: timelineItems.length,
        calendarEvents: calendarEvents.length, scheduleBlocks: scheduleBlocks.length, libraryItems: libraryItems.length, files: files.length,
        referencedUsers: users.length, projectAutomations: controlRecords.filter((row: any) => row.kind === "automation").length,
      },
      delivery: {
        stage: lifecycle?.readiness?.activeHold ? "release_hold" : lifecycle?.readiness?.blocked ? "gates_blocked" : lifecycle?.releaseReady ? "release_ready" : blockers.length ? "blocked" : failedQa.length ? "qa_attention" : qaSessions.length || qaPlans.length ? "in_qa" : builds.length ? "artifact_ready" : "not_started",
        blockers,
        unlinkedBuildIds: unlinkedBuilds.map((row) => row.id),
        unlinkedQaIds: unlinkedQa.map((row) => row.id),
        readiness: lifecycle?.readiness || null,
        recommendedAction: lifecycle?.recommendedAction || null,
        orchestration: lifecycle?.orchestration || null,
        history: lifecycle?.history || null,
      },
      traceability: { nodes: [...nodeMap.values()].slice(0, 2_000), edges: edges.slice(0, 4_000) },
      activity: activity.map((event: any) => ({
        id: event.id, type: event.type, entityType: event.entityType, entityId: event.entityId || null, title: event.title, message: event.message || null,
        createdAt: event.createdAt?.toISOString?.() || event.createdAt,
        user: event.user ? { id: event.user.id, username: event.user.username, displayName: event.user.displayName, avatarUrl: event.user.avatarUrl } : null,
      })),
    };
  }

  async function snapshot(projectId: string, access?: ProjectIntelligenceAccessContext) {
    if (access) return loadSnapshot(projectId, access);
    if (!readModels) return loadSnapshot(projectId);
    return readModels.getOrLoad(projectId, () => loadSnapshot(projectId), 15_000);
  }

  return { snapshot };
}
