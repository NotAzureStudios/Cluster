import type { ClusterResourceAddress, ClusterResourceKind } from "@cluster/shared";
import { createProjectDeliveryService } from "./project-delivery-service.js";
function parseObject(value: unknown): Record<string, any> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, any>;
  if (typeof value !== "string" || !value.trim()) return {};
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; }
}
function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string" || !value.trim()) return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String) : []; } catch { return []; }
}
function normalized(value: unknown) { return String(value || "").trim().toLowerCase(); }
function workflowPayload(record: any) { return { ...parseObject(record.payload), id: record.entityId || record.id, projectId: record.projectId, createdAt: record.createdAt, updatedAt: record.updatedAt }; }
function buildKeys(build: any) { return [build?.id, build?.version, build?.buildNumber, build?.sourceRevision].map(normalized).filter(Boolean); }
function qaLinksBuild(qa: any, build: any) { return Boolean(build && normalized(qa?.buildId) === normalized(build.id)); }
function releaseLinksBuild(release: any, build: any) { return Boolean(build && normalized(release?.buildId) === normalized(build.id)); }
// A passing label or reviewer click never overrides failed test evidence. Historical
// inconsistent rows must fail closed even if newer writers reject such payloads.
function isQaFail(qa: any) { return ["failed", "blocked"].includes(normalized(qa.status)) || normalized(qa.decision) === "no-go" || Number(qa.failed || 0) > 0 || Number(qa.blocked || 0) > 0; }
function isQaPass(qa: any) { return !isQaFail(qa) && normalized(qa.status) === "passed"; }
function resource(kind: ClusterResourceKind, id: string, projectId?: string | null): ClusterResourceAddress { return { kind, id, ...(projectId ? { projectId } : {}) }; }
function projectResource(projectId: string): ClusterResourceAddress { return resource("project", projectId); }
function stage(id: string, label: string, state: "pending" | "active" | "complete" | "blocked", detail: string, target: ClusterResourceAddress | null = null) { return { id, label, state, detail, target }; }
function issueResource(projectId: string, issue: any) { return resource(issue.kind === "ticket" ? "ticket" : "card", issue.id, projectId); }

function releaseChannel(build: any, release: any) { return normalized(release?.channel || build?.channel || "internal") || "internal"; }
function softwareLikeProject(projectType: unknown) { return /game|software|app|application|desktop|web|client|server|tool/.test(normalized(projectType)); }
function defaultDeliveryPolicy(projectType: unknown, channelValue: unknown) {
  const channel = normalized(channelValue) || "internal";
  const external = ["beta", "rc", "release", "production", "external"].includes(channel);
  const finalChannel = ["release", "production", "external"].includes(channel);
  return {
    channel,
    requiredGateIds: [
      "qa_pass",
      "fixes_clear",
      "rebuild_clear",
      "build_approval",
      ...(external ? ["reviewer_approval"] : []),
      ...(finalChannel && softwareLikeProject(projectType) ? ["signed_artifact"] : []),
      ...(finalChannel ? ["launch_window", "availability_clear"] : []),
      "no_active_hold",
    ],
    optionalGateIds: ["release_notes", "delivery_schedule"],
  };
}
// Core gates cannot be removed by a project policy or bypassed with an exception.
// They connect Board fixes, QA, regression rebuilds, Build approval, and delivery holds.
export const CORE_RELEASE_GATE_IDS = ["qa_pass", "fixes_clear", "rebuild_clear", "build_approval", "source_review", "no_active_hold"] as const;
function latestDecisionForGate(records: any[], gateId: string, buildId?: string | null) {
  return records.find((record) => normalized(record.gateId) === normalized(gateId) && (!record.buildId || !buildId || record.buildId === buildId)) || null;
}
function decisionActive(record: any) {
  if (!record) return false;
  if (record.expiresAt && new Date(record.expiresAt).getTime() <= Date.now()) return false;
  return !["cleared", "revoked", "expired"].includes(normalized(record.state));
}
function gate(id: string, label: string, required: boolean, passed: boolean, detail: string, options: Record<string, any> = {}) {
  return { id, label, required, state: passed ? "passed" : required ? "blocked" : "warning", passed, detail, ...options };
}
function deliveryMarker(kind: string, buildId?: string | null) { return `[cluster-delivery:${kind}:${buildId || "project"}]`; }
function parseAttendees(value: unknown): string[] { return parseStringArray(value); }
function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) { return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime(); }
function latestStableIso(values: unknown[]) {
  let latest = 0;
  for (const value of values) {
    if (!value) continue;
    const timestamp = new Date(value as any).getTime();
    if (Number.isFinite(timestamp) && timestamp > latest) latest = timestamp;
  }
  return new Date(latest || 0).toISOString();
}

export function createProjectDeliveryLifecycleService(prisma: any) {
  async function snapshot(projectId: string, targetBuildId?: string | null) {
    const delivery = createProjectDeliveryService(prisma);
    const [project, workflowRecords, builds, qaPlanCount, qaSessions, releases, relationships, cards, calendarEvents, scheduleBlocks] = await Promise.all([
      prisma.project.findFirst({ where: { id: projectId, archived: false }, select: { id: true, name: true, status: true, projectType: true, targetDate: true, updatedAt: true } }),
      prisma.clusterPersistenceRecord.findMany({ where: { projectId, archived: false, deletedAt: null, kind: { in: ["deliveryApproval", "deliveryPolicy"] } }, select: { id: true, entityId: true, projectId: true, kind: true, payload: true, createdAt: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 2000 }),
      // Lifecycle only renders recent delivery history/failure loops. Keep the
      // snapshot bounded so old QA history cannot make every dashboard read grow forever.
      delivery.list([projectId], "build", 250),
      prisma.deliveryQaPlan.count({ where: { projectId, archived: false } }),
      delivery.list([projectId], "qa-session", 1_500),
      delivery.list([projectId], "release", 250),
      prisma.projectRelationship.findMany({ where: { projectId }, select: { sourceType: true, sourceId: true, targetType: true, targetId: true, relationship: true }, orderBy: { createdAt: "desc" }, take: 3000 }),
      prisma.card.findMany({ where: { archived: false, list: { board: { projectId, archived: false } } }, select: { id: true, title: true, labels: true, workItemKind: true, ticketStage: true, priority: true, updatedAt: true, list: { select: { id: true, title: true, isDone: true, board: { select: { id: true, name: true } } } } }, take: 5000 }),
      prisma.calendarEvent.findMany({ where: { projectId }, select: { id: true, title: true, description: true, startsAt: true, endsAt: true, ownerId: true, attendeeIds: true, updatedAt: true }, orderBy: { startsAt: "asc" }, take: 1000 }),
      prisma.scheduleBlock.findMany({ where: { projectId }, select: { id: true, title: true, description: true, startsAt: true, endsAt: true, userId: true, updatedAt: true }, orderBy: { startsAt: "asc" }, take: 1000 }),
    ]) as [any, any[], any[], number, any[], any[], any[], any[], any[], any[]];
    if (!project) return null;
    const byKind = new Map<string, any[]>();
    for (const record of workflowRecords) { const rows = byKind.get(record.kind) || []; rows.push(workflowPayload(record)); byKind.set(record.kind, rows); }
    const approvalRecords = (byKind.get("deliveryApproval") || []).sort((a,b)=>new Date(b.createdAt || b.updatedAt || 0).getTime()-new Date(a.createdAt || a.updatedAt || 0).getTime());
    const policyRecords = (byKind.get("deliveryPolicy") || []).sort((a,b)=>new Date(b.updatedAt || b.createdAt || 0).getTime()-new Date(a.updatedAt || a.createdAt || 0).getTime());
    const sortedBuilds = [...builds].sort((a,b)=>new Date(b.createdAt || b.updatedAt || 0).getTime()-new Date(a.createdAt || a.updatedAt || 0).getTime());
    const latestBuild = (targetBuildId ? sortedBuilds.find((build) => build.id === targetBuildId) : null) || sortedBuilds[0] || null;
    // Bounded reads must not silently certify a release with unexamined fix work.
    const evidenceLimits = [
      ["Build history", builds.length, 250], ["QA history", qaSessions.length, 1500],
      ["Relationships", relationships.length, 3000], ["Board work", cards.length, 5000],
      ["Release records", releases.length, 250], ["Delivery policy records", workflowRecords.length, 2000],
    ] as const;
    const incompleteEvidence = evidenceLimits.filter(([, count, limit]) => count >= limit).map(([name]) => name);
    const evidenceComplete = incompleteEvidence.length === 0;
    // Revalidate live Source review provenance at the moment of each snapshot.
    // A captured sourceSnapshot or a comment/approval from an unmerged review
    // does not prove the exact revision was delivered. If the linked review was
    // deleted or its repository no longer matches, publication fails closed.
    const capturedReviewId = typeof latestBuild?.provenance?.reviewId === "string" ? latestBuild.provenance.reviewId : null;
    const sourceReviewId = latestBuild?.sourceReviewId || capturedReviewId;
    // A nullable FK must not let review deletion silently turn off a gate:
    // the signed-off Build provenance snapshot remains the historical record.
    const sourceReviewLinkConsistent = !capturedReviewId || capturedReviewId === latestBuild?.sourceReviewId;
    const linkedSourceReview = sourceReviewId && sourceReviewLinkConsistent
      ? await prisma.sourceReview.findFirst({
          where: { id: sourceReviewId, projectId, repositoryId: latestBuild.sourceRepositoryId },
          select: { id: true, status: true, mergedRevision: true, sourceRevision: true, repositoryId: true },
        }) : null;
    const sourceReviewPassed = !sourceReviewId || Boolean(
      linkedSourceReview && normalized(linkedSourceReview.status) === "merged"
      && linkedSourceReview.mergedRevision && linkedSourceReview.mergedRevision === latestBuild.sourceRevision
    );
    const sourceReviewDetail = !sourceReviewId
      ? "This Build does not reference a Source review."
      : !sourceReviewLinkConsistent ? "The Build record no longer matches the Source review captured at creation."
      : !linkedSourceReview ? "The linked Source review is unavailable or no longer belongs to this repository."
      : normalized(linkedSourceReview.status) !== "merged" ? "The linked Source review has not been merged; comments and approvals alone do not clear release provenance."
      : linkedSourceReview.mergedRevision !== latestBuild.sourceRevision ? "The review's merged revision does not match the Build source revision."
      : "The linked Source review was merged at this exact Build revision.";
    const cardById = new Map(cards.map((card: any) => [card.id, card]));

    const issuesForRefs = (refs: Array<{ kind: string; id?: string | null }>) => {
      const keys = new Set(refs.filter((ref) => ref.id).map((ref) => `${normalized(ref.kind)}:${ref.id}`));
      const ids = new Set<string>();
      for (const relation of relationships) {
        const sourceKey = `${normalized(relation.sourceType)}:${relation.sourceId}`;
        const targetKey = `${normalized(relation.targetType)}:${relation.targetId}`;
        if (keys.has(sourceKey) && ["card", "ticket"].includes(normalized(relation.targetType))) ids.add(relation.targetId);
        if (keys.has(targetKey) && ["card", "ticket"].includes(normalized(relation.sourceType))) ids.add(relation.sourceId);
      }
      return [...ids].map((id) => cardById.get(id)).filter(Boolean).map((card: any) => {
        const kind = card.workItemKind === "ticket" ? "ticket" : "card";
        // Tickets own a triage lifecycle independent from the arbitrary names
        // or completion flags of a Board's Lists. This gate is also consumed by
        // Project closeout and release publication; a Done column cannot waive QA.
        const stage = kind === "ticket" ? normalized(card.ticketStage) || "new" : null;
        const done = kind === "ticket" ? stage === "resolved" : Boolean(card.list.isDone);
        const issue = { id: card.id, kind, title: card.title, priority: card.priority, done, ...(stage ? { ticketStage: stage } : {}), boardId: card.list.board.id, boardName: card.list.board.name, listId: card.list.id, listTitle: card.list.title };
        return { ...issue, resource: issueResource(projectId, issue) };
      });
    };

    const failedSessions = [...qaSessions].filter(isQaFail).sort((a,b)=>new Date(b.completedAt || b.updatedAt || 0).getTime()-new Date(a.completedAt || a.updatedAt || 0).getTime());
    const failureCycles = failedSessions.slice(0, 40).map((qa) => {
      const failedBuild = builds.find((build) => qaLinksBuild(qa, build)) || null;
      const issues = issuesForRefs([{ kind: "qa_session", id: qa.id }, { kind: "build", id: failedBuild?.id }]);
      const openIssues = issues.filter((issue: any) => !issue.done);
      const resolvedIssues = issues.filter((issue: any) => issue.done);
      const explicitRebuildRelation = failedBuild ? relationships.find((relation: any) => normalized(relation.relationship) === "supersedes" && normalized(relation.sourceType) === "build" && normalized(relation.targetType) === "build" && relation.targetId === failedBuild.id) : null;
      const failureAt = new Date(qa.completedAt || qa.updatedAt || qa.createdAt || 0).getTime();
      const chronologicalRebuild = failedBuild ? sortedBuilds.find((build) => build.id !== failedBuild.id && new Date(build.createdAt || build.updatedAt || 0).getTime() > failureAt && (!failedBuild.platform || !build.platform || normalized(build.platform) === normalized(failedBuild.platform))) : null;
      const rebuild = explicitRebuildRelation ? builds.find((build) => build.id === explicitRebuildRelation.sourceId) || chronologicalRebuild || null : chronologicalRebuild || null;
      const rebuildQa = rebuild ? qaSessions.filter((session) => qaLinksBuild(session, rebuild)) : [];
      const rebuildPassed = rebuildQa.some(isQaPass) || normalized(rebuild?.qaStatus) === "passed";
      const highPriorityOpen = openIssues.some((issue: any) => ["high", "urgent"].includes(normalized(issue.priority)));
      const regressionScope = ["regression", "certification"].includes(normalized(qa.scope));
      const regressionRisk = rebuildPassed ? "cleared" : !issues.length || highPriorityOpen ? "critical" : openIssues.length || regressionScope ? "high" : !rebuild ? "medium" : "low";
      const nextAction = !issues.length ? "Create a fix ticket" : openIssues.length ? "Resolve linked fix work" : !rebuild ? "Create the superseding rebuild" : !rebuildPassed ? "Retest the rebuild" : "Regression loop cleared";
      return {
        id: `failure:${qa.id}`,
        failedQa: { id: qa.id, build: qa.build, platform: qa.platform, scope: qa.scope, status: qa.status, decision: qa.decision, failed: Number(qa.failed || 0), blocked: Number(qa.blocked || 0), completedAt: qa.completedAt || qa.updatedAt || null, resource: resource("qa_session", qa.id, projectId) },
        failedBuild: failedBuild ? { id: failedBuild.id, title: failedBuild.title, version: failedBuild.version, platform: failedBuild.platform, resource: resource("build", failedBuild.id, projectId) } : null,
        issues,
        openFixes: openIssues.length,
        resolvedFixes: resolvedIssues.length,
        rebuild: rebuild ? { id: rebuild.id, title: rebuild.title, version: rebuild.version, platform: rebuild.platform, qaPassed: rebuildPassed, resource: resource("build", rebuild.id, projectId) } : null,
        rebuildRequired: Boolean(issues.length && openIssues.length === 0 && !rebuild),
        regressionRisk,
        regressionReasons: [!issues.length ? "No structured follow-up work is linked to the failure." : "", highPriorityOpen ? "High-priority fix work remains open." : "", regressionScope ? `${qa.scope} verification failed.` : "", issues.length && !openIssues.length && !rebuild ? "Fix work is resolved but no superseding rebuild exists." : "", rebuild && !rebuildPassed ? "A rebuild exists but has not cleared retest." : ""].filter(Boolean),
        nextAction,
        cleared: rebuildPassed && openIssues.length === 0,
      };
    });
    const latestFailure = failureCycles[0] || null;
    const activeFailure = failureCycles.find((cycle) => !cycle.cleared) || null;

    const linkedQa = latestBuild ? qaSessions.filter((qa)=>qaLinksBuild(qa, latestBuild)) : [];
    const passingQa = linkedQa.filter(isQaPass);
    const failingQa = linkedQa.filter(isQaFail);
    const generalIssues = latestBuild ? issuesForRefs([{ kind: "build", id: latestBuild.id }, ...linkedQa.map((row) => ({ kind: "qa_session", id: row.id }))]) : [];
    const issues = activeFailure?.issues?.length ? activeFailure.issues : generalIssues;
    const openIssues = issues.filter((issue:any)=>!issue.done);
    const fixedIssues = issues.filter((issue:any)=>issue.done);
    const releaseForLatest = latestBuild ? releases.filter((release)=>releaseLinksBuild(release, latestBuild)) : [];
    const publishedRelease = releaseForLatest.find((release)=>normalized(release.status)==="published") || null;
    const qaPassed = Boolean(passingQa.length) || normalized(latestBuild?.qaStatus) === "passed";
    const qaFailed = Boolean(failingQa.length) || normalized(latestBuild?.qaStatus) === "failed" || Boolean(activeFailure && !activeFailure.cleared && !activeFailure.rebuild?.qaPassed);
    const approved = normalized(latestBuild?.approval) === "approved";
    const channel = releaseChannel(latestBuild, releaseForLatest[0]);
    const defaultPolicy = defaultDeliveryPolicy(project.projectType, channel);
    const policyOverride = policyRecords.find((record) => !record.channel || normalized(record.channel) === channel) || null;
    const policy = {
      channel,
      projectType: project.projectType || "default",
      source: policyOverride ? "project_override" : "default",
      requiredGateIds: [...new Set([...defaultPolicy.requiredGateIds, ...(sourceReviewId ? ["source_review"] : []), ...(Array.isArray(policyOverride?.requiredGateIds) ? policyOverride.requiredGateIds.map(String) : [])])],
      optionalGateIds: Array.isArray(policyOverride?.optionalGateIds) ? policyOverride.optionalGateIds.map(String) : defaultPolicy.optionalGateIds,
    };
    const required = (id: string) => policy.requiredGateIds.includes(id);
    const latestDecision = (id: string) => latestDecisionForGate(approvalRecords, id, latestBuild?.id || null);
    const exceptionFor = (id: string) => {
      const latest = latestDecision(id);
      return latest && normalized(latest.decision) === "exception" && decisionActive(latest) ? latest : null;
    };
    const applyException = (id: string, passed: boolean) => passed || (!([...CORE_RELEASE_GATE_IDS, "reviewer_approval", "signed_artifact"] as string[]).includes(id) && Boolean(exceptionFor(id)));
    const reviewerDecision = latestDecision("reviewer_approval");
    const reviewerApproved = Boolean(
      reviewerDecision && normalized(reviewerDecision.decision) === "approved"
      && decisionActive(reviewerDecision)
      && reviewerDecision.reviewerId
      && ![latestBuild?.createdById, latestBuild?.ownerId].filter(Boolean).includes(reviewerDecision.reviewerId)
      && Number(reviewerDecision.reviewedBuildRevision || 0) === Number(latestBuild?.revision || 0)
    );
    const holdDecision = latestDecision("no_active_hold");
    const activeHold = Boolean(holdDecision && normalized(holdDecision.decision) === "hold" && decisionActive(holdDecision));
    const deliveryCalendarEvents = calendarEvents.filter((event: any) => String(event.description || "").includes("[cluster-delivery:"));
    const deliveryScheduleBlocks = scheduleBlocks.filter((block: any) => String(block.description || "").includes("[cluster-delivery:"));
    const launchWindow = deliveryCalendarEvents.find((event: any) => String(event.description || "").includes(deliveryMarker("release", latestBuild?.id))) || null;
    const availabilityConflicts: any[] = [];
    for (const event of deliveryCalendarEvents) {
      const eventEnd = new Date(event.endsAt || new Date(new Date(event.startsAt).getTime() + 60 * 60 * 1000));
      const eventPeople = new Set([event.ownerId, ...parseAttendees(event.attendeeIds)].filter(Boolean));
      for (const other of calendarEvents) {
        if (other.id === event.id || String(other.description || "").includes("[cluster-delivery:")) continue;
        const otherPeople = new Set([other.ownerId, ...parseAttendees(other.attendeeIds)].filter(Boolean));
        if (![...eventPeople].some((id) => otherPeople.has(id))) continue;
        const otherEnd = new Date(other.endsAt || new Date(new Date(other.startsAt).getTime() + 60 * 60 * 1000));
        if (overlaps(new Date(event.startsAt), eventEnd, new Date(other.startsAt), otherEnd)) availabilityConflicts.push({ kind: "calendar", id: other.id, title: other.title, startsAt: other.startsAt, ownerId: other.ownerId });
      }
      for (const block of scheduleBlocks) {
        if (!block.userId || !eventPeople.has(block.userId) || String(block.description || "").includes("[cluster-delivery:")) continue;
        if (overlaps(new Date(event.startsAt), eventEnd, new Date(block.startsAt), new Date(block.endsAt))) availabilityConflicts.push({ kind: "scheduler", id: block.id, title: block.title, startsAt: block.startsAt, ownerId: block.userId });
      }
    }
    const rebuildClear = !activeFailure || Boolean(activeFailure.cleared || activeFailure.rebuild?.qaPassed);
    const releaseNotesReady = Boolean(releaseForLatest.some((release) => ["review", "published"].includes(normalized(release.status)) && String(release.body || "").trim()));
    const gateRows = [
      gate("qa_pass", "QA passed", required("qa_pass"), applyException("qa_pass", Boolean(latestBuild && qaPassed && !qaFailed)), qaPassed && !qaFailed ? "Passing QA evidence exists for the target build." : "Passing QA evidence is required.", { resource: linkedQa[0] ? resource("qa_session", linkedQa[0].id, projectId) : projectResource(projectId) }),
      gate("fixes_clear", "Fix work clear", required("fixes_clear"), applyException("fixes_clear", openIssues.length === 0), openIssues.length ? `${openIssues.length} linked fix item(s) remain open.` : "No linked fix work remains open.", { resource: openIssues[0]?.resource || projectResource(projectId) }),
      gate("rebuild_clear", "Regression loop clear", required("rebuild_clear"), applyException("rebuild_clear", rebuildClear), rebuildClear ? "No unresolved failure cycle requires another rebuild." : activeFailure?.nextAction || "Delivery regression work remains open.", { resource: activeFailure?.rebuild?.resource || activeFailure?.failedQa?.resource || projectResource(projectId) }),
      gate("build_approval", "Build approved", required("build_approval"), applyException("build_approval", approved), approved ? "The target build is approved." : `Build approval is ${latestBuild?.approval || "not started"}.`, { resource: latestBuild ? resource("build", latestBuild.id, projectId) : projectResource(projectId) }),
      gate("source_review", "Source review provenance", required("source_review"), sourceReviewPassed, sourceReviewDetail, { resource: latestBuild ? resource("build", latestBuild.id, projectId) : projectResource(projectId) }),
      gate("reviewer_approval", "Delivery reviewer", required("reviewer_approval"), applyException("reviewer_approval", reviewerApproved), reviewerDecision ? `${reviewerDecision.reviewerName || "Reviewer"}: ${reviewerDecision.decision}${reviewerDecision.reason ? ` · ${reviewerDecision.reason}` : ""}` : "No delivery reviewer decision is recorded."),
      gate("signed_artifact", "Signed artifact", required("signed_artifact"), applyException("signed_artifact", Boolean(latestBuild?.signed)), latestBuild?.signed ? "The target artifact is signed." : "The target artifact is not marked as signed."),
      gate("launch_window", "Launch window", required("launch_window"), applyException("launch_window", Boolean(launchWindow)), launchWindow ? `${launchWindow.title} · ${new Date(launchWindow.startsAt).toISOString()}` : "No release launch window is scheduled.", { resource: launchWindow ? resource("calendar", launchWindow.id, projectId) : projectResource(projectId) }),
      gate("availability_clear", "Availability clear", required("availability_clear"), applyException("availability_clear", availabilityConflicts.length === 0), availabilityConflicts.length ? `${availabilityConflicts.length} scheduling conflict(s) overlap delivery windows.` : "No owner/reviewer/tester conflicts overlap delivery windows."),
      gate("no_active_hold", "No release hold", required("no_active_hold"), !activeHold, activeHold ? `${holdDecision?.reviewerName || "Reviewer"} placed a release hold${holdDecision?.reason ? `: ${holdDecision.reason}` : "."}` : "No active release hold is recorded."),
      gate("release_notes", "Release notes", required("release_notes"), applyException("release_notes", releaseNotesReady), releaseNotesReady ? "Release notes are in review or published." : "Release notes are still draft or missing."),
      gate("delivery_schedule", "Delivery schedule", required("delivery_schedule"), applyException("delivery_schedule", deliveryCalendarEvents.length >= 2), deliveryCalendarEvents.length ? `${deliveryCalendarEvents.length} delivery calendar milestone(s) scheduled.` : "Delivery milestones have not been orchestrated."),
    ];
    const mandatoryGates = gateRows.filter((row) => row.required);
    const releaseReady = Boolean(latestBuild && evidenceComplete && mandatoryGates.every((row) => row.passed));
    const rebuildComplete = Boolean(activeFailure?.rebuild);
    const stages = [
      stage("build", "Build", latestBuild ? "complete" : "pending", latestBuild ? `${latestBuild.version || latestBuild.title} · ${latestBuild.platform || "platform not set"}` : "Create the first delivery artifact.", latestBuild ? resource("build", latestBuild.id, projectId) : projectResource(projectId)),
      stage("qa", "QA", qaFailed ? "blocked" : qaPassed ? "complete" : linkedQa.length ? "active" : "pending", qaFailed ? `${failingQa.length || 1} failed or blocked verification session(s).` : qaPassed ? `${passingQa.length || 1} passing verification session(s).` : linkedQa.length ? `${linkedQa.length} verification session(s) in progress.` : "Start QA against the current build.", linkedQa[0] ? resource("qa_session", linkedQa[0].id, projectId) : projectResource(projectId)),
      stage("issue", "Issue", qaFailed ? (issues.length ? "complete" : "blocked") : "complete", qaFailed ? (issues.length ? `${issues.length} linked follow-up item(s) captured.` : "QA failed without a linked issue or ticket.") : "No failed QA requires escalation.", issues[0]?.resource || projectResource(projectId)),
      stage("fix", "Fix", openIssues.length ? "active" : qaFailed && !issues.length ? "blocked" : "complete", openIssues.length ? `${openIssues.length} linked issue(s) remain open.` : fixedIssues.length ? `${fixedIssues.length} linked issue(s) resolved.` : "No unresolved linked fix work.", openIssues[0]?.resource || projectResource(projectId)),
      stage("rebuild", "Rebuild", qaFailed ? (rebuildComplete ? "complete" : "pending") : latestBuild ? "complete" : "pending", qaFailed ? (rebuildComplete ? "A newer build exists after the failed QA cycle." : "Create a new build after the fix is complete.") : "No failed verification cycle requires a rebuild.", activeFailure?.rebuild?.resource || (latestBuild ? resource("build", latestBuild.id, projectId) : projectResource(projectId))),
      stage("approval", "Approval", approved ? "complete" : qaFailed ? "blocked" : latestBuild?.approval === "pending" ? "active" : "pending", approved ? "Current build is approved." : qaFailed ? "Approval is blocked by failed QA." : `Current approval: ${latestBuild?.approval || "not started"}.`, latestBuild ? resource("build", latestBuild.id, projectId) : projectResource(projectId)),
      stage("release", "Release", publishedRelease ? "complete" : releaseReady ? "active" : "pending", publishedRelease ? `${publishedRelease.title || "Release notes"} published.` : releaseReady ? "All core delivery gates are clear. Publish the release record." : "Waiting for a passing, approved build with no open linked issues.", publishedRelease ? resource("release", publishedRelease.id, projectId) : (latestBuild ? resource("build", latestBuild.id, projectId) : projectResource(projectId))),
    ];
    const deliveryCycles = sortedBuilds.slice(0, 30).map((build) => {
      const buildAt = new Date(build.createdAt || build.updatedAt || 0).getTime();
      const sessions = qaSessions.filter((qa) => qaLinksBuild(qa, build));
      const qaPass = sessions.filter(isQaPass).sort((a,b)=>new Date(a.completedAt || a.updatedAt || 0).getTime()-new Date(b.completedAt || b.updatedAt || 0).getTime())[0] || null;
      const release = releases.filter((item) => releaseLinksBuild(item, build)).sort((a,b)=>new Date(a.updatedAt || a.createdAt || 0).getTime()-new Date(b.updatedAt || b.createdAt || 0).getTime()).find((item)=>normalized(item.status)==="published") || null;
      const qaAt = qaPass ? new Date(qaPass.completedAt || qaPass.updatedAt || 0).getTime() : 0;
      const releaseAt = release ? new Date(release.updatedAt || release.createdAt || 0).getTime() : 0;
      return { id: build.id, version: build.version || build.title || build.id, platform: build.platform || null, channel: build.channel || null, createdAt: build.createdAt || build.updatedAt || null, qaPassedAt: qaPass?.completedAt || qaPass?.updatedAt || null, releasedAt: release?.updatedAt || release?.createdAt || null, qaHours: qaAt > buildAt ? Math.round(((qaAt-buildAt)/3_600_000)*10)/10 : null, releaseHours: releaseAt > buildAt ? Math.round(((releaseAt-buildAt)/3_600_000)*10)/10 : null, releaseId: release?.id || null };
    });
    const average = (values: Array<number | null>) => { const rows=values.filter((value): value is number=>typeof value==="number"&&Number.isFinite(value)); return rows.length ? Math.round((rows.reduce((sum,value)=>sum+value,0)/rows.length)*10)/10 : null; };
    const firstBlockedGate = gateRows.find((row) => row.required && !row.passed) || null;
    const recommendedAction = !latestBuild ? "Create a build artifact" : !evidenceComplete ? `Delivery evidence incomplete: ${incompleteEvidence.join(", ")}` : activeFailure && !activeFailure.cleared ? activeFailure.nextAction : firstBlockedGate ? `Resolve: ${firstBlockedGate.label}` : !publishedRelease ? "Publish the release" : "Delivery cycle complete";
    const automationSignals = [
      ...(activeFailure && !activeFailure.issues.length ? [{ id: `failure-escalation:${activeFailure.failedQa.id}`, kind: "failure_escalation", title: "QA failure needs fix work", message: activeFailure.nextAction, entityType: "qa_session", entityId: activeFailure.failedQa.id, resource: activeFailure.failedQa.resource, priority: "critical" }] : []),
      ...(activeFailure?.rebuildRequired ? [{ id: `rebuild-reminder:${activeFailure.failedQa.id}`, kind: "rebuild_reminder", title: "Resolved fixes need a rebuild", message: activeFailure.nextAction, entityType: activeFailure.failedBuild ? "build" : "qa_session", entityId: activeFailure.failedBuild?.id || activeFailure.failedQa.id, resource: activeFailure.failedBuild?.resource || activeFailure.failedQa.resource, priority: "high" }] : []),
      ...(activeFailure?.rebuild && !activeFailure.rebuild.qaPassed ? [{ id: `retest-request:${activeFailure.rebuild.id}`, kind: "retest_request", title: "Rebuild needs QA retest", message: activeFailure.nextAction, entityType: "build", entityId: activeFailure.rebuild.id, resource: activeFailure.rebuild.resource, priority: "high" }] : []),
      ...(releaseReady && !publishedRelease && latestBuild ? [{ id: `release-ready:${latestBuild.id}`, kind: "release_ready", title: "Build is release ready", message: "All required delivery gates are clear. Review and publish the release when appropriate.", entityType: "build", entityId: latestBuild.id, resource: resource("build", latestBuild.id, projectId), priority: "medium" }] : []),
    ];
    // Keep the snapshot timestamp tied to source-data revisions. A wall-clock
    // timestamp would change the payload hash on every recompute and defeat ETag/304 revalidation.
    const generatedAt = latestStableIso([
      project.updatedAt,
      ...workflowRecords.map((row: any) => row.updatedAt),
      ...builds.map((row: any) => row.updatedAt),
      ...qaSessions.map((row: any) => row.updatedAt),
      ...releases.map((row: any) => row.updatedAt),
      ...cards.map((row: any) => row.updatedAt),
      ...calendarEvents.map((row: any) => row.updatedAt),
      ...scheduleBlocks.map((row: any) => row.updatedAt),
    ]);
    return {
      project: { id: project.id, name: project.name, status: project.status, projectType: project.projectType, targetDate: project.targetDate },
      generatedAt, releaseReady, recommendedAction, latestBuild,
      readiness: {
        channel,
        policy,
        gates: gateRows,
        required: mandatoryGates.length,
        passed: mandatoryGates.filter((row) => row.passed).length,
        blocked: mandatoryGates.filter((row) => !row.passed).length,
        canPublish: releaseReady,
        evidenceComplete, incompleteEvidence,
        activeHold: activeHold ? { ...holdDecision } : null,
        latestReviewerDecision: reviewerDecision || null,
        linkedSourceReview: sourceReviewId ? { id: sourceReviewId, status: linkedSourceReview?.status || "unavailable", revisionMatch: sourceReviewPassed, sourceRevision: latestBuild.sourceRevision } : null,
        decisions: approvalRecords.slice(0, 60),
        exceptions: approvalRecords.filter((record) => normalized(record.decision) === "exception" && decisionActive(record)).slice(0, 30),
      },
      orchestration: {
        calendarEvents: deliveryCalendarEvents.map((event: any) => ({ id: event.id, title: event.title, startsAt: event.startsAt, endsAt: event.endsAt, ownerId: event.ownerId, attendeeIds: parseAttendees(event.attendeeIds), resource: resource("calendar", event.id, projectId) })),
        scheduleBlocks: deliveryScheduleBlocks.map((block: any) => ({ id: block.id, title: block.title, startsAt: block.startsAt, endsAt: block.endsAt, ownerId: block.userId, resource: resource("scheduler", block.id, projectId) })),
        conflicts: availabilityConflicts.slice(0, 50),
        launchWindow: launchWindow ? { id: launchWindow.id, title: launchWindow.title, startsAt: launchWindow.startsAt, endsAt: launchWindow.endsAt } : null,
      },
      history: {
        cycles: deliveryCycles,
        averageQaHours: average(deliveryCycles.map((cycle) => cycle.qaHours)),
        averageReleaseHours: average(deliveryCycles.map((cycle) => cycle.releaseHours)),
        failureCycles: failureCycles.length,
        clearedFailureCycles: failureCycles.filter((cycle) => cycle.cleared).length,
        releases: releases.slice(0, 30).map((item) => ({ id: item.id, title: item.title, status: item.status, buildVersion: item.buildVersion, platform: item.platform, updatedAt: item.updatedAt || item.createdAt })),
      },
      qa: { plans: Number(qaPlanCount || 0), sessions: linkedQa, passed: passingQa.length, failed: failingQa.length },
      issues: { total: issues.length, open: openIssues.length, resolved: fixedIssues.length, items: issues.slice(0,50) },
      failureLoop: activeFailure || latestFailure,
      failures: failureCycles,
      regressionRisk: activeFailure?.regressionRisk || "none",
      release: publishedRelease || releaseForLatest[0] || null,
      automation: { signals: automationSignals },
      stages,
    };
  }
  return { snapshot };
}

export async function emitProjectDeliveryAutomationSignals(input: { prisma: any; logActivity: (input: any) => Promise<unknown>; projectId: string; actorId?: string | null }) {
  const snapshot = await createProjectDeliveryLifecycleService(input.prisma).snapshot(input.projectId);
  if (!snapshot?.automation?.signals?.length) return { emitted: 0, signals: [] as any[] };
  const emitted: any[] = [];
  const since = new Date(Date.now() - 6 * 60 * 60 * 1000);
  for (const signal of snapshot.automation.signals) {
    const existing = await input.prisma.activityEvent.findFirst({ where: { projectId: input.projectId, type: "delivery_automation", entityType: signal.entityType, entityId: signal.id, createdAt: { gte: since } }, select: { id: true } });
    if (existing) continue;
    await input.logActivity({
      userId: input.actorId || undefined,
      projectId: input.projectId,
      type: "delivery_automation",
      entityType: signal.entityType,
      entityId: signal.id,
      title: signal.title,
      message: signal.message,
      metadata: { priority: signal.priority, notifyInbox: true, sourceKind: signal.resource?.kind || signal.entityType, sourceId: signal.resource?.id || signal.entityId, projectId: signal.resource?.projectId || input.projectId, deliverySignal: signal.kind },
    });
    emitted.push(signal);
  }
  return { emitted: emitted.length, signals: emitted };
}
