import { CLUSTER_WORK_ASSIGNMENT_ACTIVITY_TYPE, type ClusterAssignmentChange } from "@cluster/shared";
import { resolveStudioAudienceUserIds } from "../access/studio-audience.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function addDays(value: Date, days: unknown) {
  const count = Number(days || 0);
  return Number.isFinite(count) && count > 0 ? new Date(value.getTime() + Math.floor(count) * DAY_MS) : null;
}

function sameInstant(a: unknown, b: unknown) {
  const left = a ? new Date(a as any).getTime() : 0;
  const right = b ? new Date(b as any).getTime() : 0;
  return left === right;
}

export function packetCompletionState(definition: any, completions: any[], now: Date = new Date()) {
  const ordered = [...(completions || [])].sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime());
  const matching = ordered.find((entry) => String(entry.packetVersionLabel || "") === String(definition.versionLabel || ""));
  const latest = ordered[0] || null;
  if (!matching) return { state: latest ? "version_changed" : "pending", completion: null, latest, validUntil: null } as const;
  const validUntil = matching.validUntil ? new Date(matching.validUntil) : addDays(new Date(matching.completedAt), definition.recertifyDays);
  if (validUntil && validUntil.getTime() <= now.getTime()) return { state: "expired", completion: matching, latest, validUntil } as const;
  return { state: "complete", completion: matching, latest, validUntil } as const;
}

function assignmentActivity(input: { userId: string; resourceKind: "packet" | "policy"; resourceId: string; resourceVersionId?: string | null; label: string; dueAt?: Date | null; active: boolean; previousActive: boolean; state: string; force?: boolean }) {
  if (!input.force && input.active === input.previousActive) return null;
  const subject = input.active ? { kind: "user" as const, id: input.userId } : null;
  const previousSubject = input.previousActive ? { kind: "user" as const, id: input.userId } : null;
  const assignment: ClusterAssignmentChange = {
    resource: { kind: input.resourceKind, id: input.resourceId },
    kind: "responsible",
    subject,
    previousSubject,
    startsAt: null,
    dueAt: input.dueAt?.toISOString() || null,
    actorUserId: null,
    sourceLabel: input.label,
  };
  return {
    userId: null,
    type: CLUSTER_WORK_ASSIGNMENT_ACTIVITY_TYPE,
    entityType: input.resourceKind,
    entityId: input.resourceId,
    title: input.active ? "Required knowledge assigned" : "Required knowledge satisfied",
    message: input.label,
    metadata: {
      source: { kind: input.resourceKind, id: input.resourceId, label: input.label },
      assignment,
      targetUserId: input.userId,
      userIds: [input.userId],
      dueAt: assignment.dueAt,
      notifyInbox: input.active,
      requiresAction: input.active,
      notificationSignal: input.active ? "assignment" : "resolved",
      notificationPriority: "normal",
      notificationGroupKey: `knowledge:${input.resourceKind}:${input.resourceId}:${input.userId}`,
      knowledgeAssignmentState: input.state,
      resourceVersionId: input.resourceVersionId || null,
    },
  };
}

async function reconcilePacket(input: { prisma: any; definition: any; now: Date; logActivity?: any; userIds?: string[] }) {
  const { prisma, definition, now, logActivity } = input;
  const packetId = String(definition.libraryFolderId);
  const eligible = definition.required && definition.completionMode !== "none"
    ? new Set<string>(await resolveStudioAudienceUserIds(prisma, definition.audienceJson))
    : new Set<string>();
  if (input.userIds) {
    const requested = new Set<string>(input.userIds.map(String));
    for (const id of [...eligible]) if (!requested.has(id)) eligible.delete(id);
  }
  const existing = await prisma.studioKnowledgeAssignment.findMany({ where: { resourceKind: "packet", resourceId: packetId, ...(input.userIds ? { userId: { in: input.userIds } } : {}) } });
  const existingByUser = new Map<string, any>(existing.map((row: any) => [String(row.userId), row] as [string, any]));
  const allUserIds = [...new Set<string>([...eligible, ...existingByUser.keys()])];
  const completions = allUserIds.length ? await prisma.packetCompletion.findMany({ where: { packetDefinitionId: definition.id, userId: { in: allUserIds } }, orderBy: { completedAt: "desc" } }) : [];
  const completionsByUser = new Map<string, any[]>();
  for (const completion of completions) {
    const rows = completionsByUser.get(String(completion.userId)) || [];
    rows.push(completion);
    completionsByUser.set(String(completion.userId), rows);
  }
  const events: any[] = [];
  let changed = 0;
  for (const userId of allUserIds) {
    const prior = existingByUser.get(userId) as any;
    const isEligible = eligible.has(userId);
    if (!isEligible) {
      if (prior && prior.state !== "cancelled") {
        await prisma.studioKnowledgeAssignment.update({ where: { id: prior.id }, data: { state: "cancelled", cancelledAt: now, dueAt: null, nextRequiredAt: null } });
        changed += 1;
        const event = assignmentActivity({ userId, resourceKind: "packet", resourceId: packetId, label: definition.libraryFolder?.title || "Packet", active: false, previousActive: prior.state === "active", state: "cancelled" });
        if (event) events.push(event);
      }
      continue;
    }
    const completion = packetCompletionState(definition, completionsByUser.get(userId) || [], now);
    const satisfied = completion.state === "complete";
    const versionChanged = Boolean(prior && prior.versionKey !== String(definition.versionLabel));
    const reopening = Boolean(prior && (prior.state !== "active") && !satisfied);
    const cycleStartedAt = !prior || versionChanged || reopening ? now : new Date(prior.cycleStartedAt);
    const dueAt = satisfied ? null : addDays(cycleStartedAt, definition.dueDays);
    const next = {
      resourceVersionId: null,
      versionKey: String(definition.versionLabel),
      state: satisfied ? "completed" : "active",
      source: "audience",
      cycleStartedAt,
      dueAt,
      satisfiedAt: satisfied ? new Date(completion.completion!.completedAt) : null,
      nextRequiredAt: satisfied ? completion.validUntil : null,
      evidenceId: satisfied ? completion.completion!.id : null,
      cancelledAt: null,
    };
    let saved: any;
    let differs = !prior;
    if (!prior) {
      saved = await prisma.studioKnowledgeAssignment.create({ data: { userId, resourceKind: "packet", resourceId: packetId, ...next } });
      changed += 1;
    } else {
      differs = prior.state !== next.state || prior.versionKey !== next.versionKey || prior.evidenceId !== next.evidenceId || !sameInstant(prior.dueAt, next.dueAt) || !sameInstant(prior.nextRequiredAt, next.nextRequiredAt);
      saved = differs ? await prisma.studioKnowledgeAssignment.update({ where: { id: prior.id }, data: next }) : prior;
      if (differs) changed += 1;
    }
    const event = assignmentActivity({ userId, resourceKind: "packet", resourceId: packetId, label: definition.libraryFolder?.title || "Packet", dueAt: saved.dueAt, active: saved.state === "active", previousActive: prior?.state === "active", state: saved.state, force: Boolean(prior && prior.state === "active" && saved.state === "active" && differs) });
    if (event) events.push(event);
  }
  for (const event of events) await logActivity?.(event);
  return { changed, evaluated: allUserIds.length };
}

async function reconcilePolicy(input: { prisma: any; policy: any; now: Date; logActivity?: any; userIds?: string[] }) {
  const { prisma, policy, now, logActivity } = input;
  const version = policy.versions?.[0] || null;
  const needsAcceptance = policy.status === "active" && version?.status === "published" && version.acceptanceMode !== "none";
  const eligible = needsAcceptance ? new Set<string>(await resolveStudioAudienceUserIds(prisma, policy.audienceJson)) : new Set<string>();
  if (input.userIds) {
    const requested = new Set<string>(input.userIds.map(String));
    for (const id of [...eligible]) if (!requested.has(id)) eligible.delete(id);
  }
  const existing = await prisma.studioKnowledgeAssignment.findMany({ where: { resourceKind: "policy", resourceId: policy.id, ...(input.userIds ? { userId: { in: input.userIds } } : {}) } });
  const existingByUser = new Map<string, any>(existing.map((row: any) => [String(row.userId), row] as [string, any]));
  const allUserIds = [...new Set<string>([...eligible, ...existingByUser.keys()])];
  const acceptances = version && allUserIds.length ? await prisma.studioPolicyAcceptance.findMany({ where: { policyVersionId: version.id, userId: { in: allUserIds } } }) : [];
  const acceptedByUser = new Map(acceptances.filter((row: any) => row.policyContentHash === version?.contentHash).map((row: any) => [String(row.userId), row]));
  const events: any[] = [];
  let changed = 0;
  for (const userId of allUserIds) {
    const prior = existingByUser.get(userId) as any;
    if (!eligible.has(userId) || !version) {
      if (prior && prior.state !== "cancelled") {
        await prisma.studioKnowledgeAssignment.update({ where: { id: prior.id }, data: { state: "cancelled", cancelledAt: now, dueAt: null } });
        changed += 1;
        const event = assignmentActivity({ userId, resourceKind: "policy", resourceId: policy.id, resourceVersionId: version?.id, label: policy.title, active: false, previousActive: prior.state === "active", state: "cancelled" });
        if (event) events.push(event);
      }
      continue;
    }
    const acceptance = acceptedByUser.get(userId) as any;
    const satisfied = Boolean(acceptance);
    const versionKey = `${version.id}:${version.contentHash}`;
    const versionChanged = Boolean(prior && prior.versionKey !== versionKey);
    const reopening = Boolean(prior && prior.state !== "active" && !satisfied);
    const cycleStartedAt = !prior || versionChanged || reopening ? now : new Date(prior.cycleStartedAt);
    const next = {
      resourceVersionId: version.id,
      versionKey,
      state: satisfied ? "completed" : "active",
      source: "audience",
      cycleStartedAt,
      dueAt: null,
      satisfiedAt: satisfied ? new Date(acceptance.acceptedAt) : null,
      nextRequiredAt: null,
      evidenceId: satisfied ? acceptance.id : null,
      cancelledAt: null,
    };
    let saved: any;
    let differs = !prior;
    if (!prior) {
      saved = await prisma.studioKnowledgeAssignment.create({ data: { userId, resourceKind: "policy", resourceId: policy.id, ...next } });
      changed += 1;
    } else {
      differs = prior.state !== next.state || prior.versionKey !== next.versionKey || prior.resourceVersionId !== next.resourceVersionId || prior.evidenceId !== next.evidenceId;
      saved = differs ? await prisma.studioKnowledgeAssignment.update({ where: { id: prior.id }, data: next }) : prior;
      if (differs) changed += 1;
    }
    const event = assignmentActivity({ userId, resourceKind: "policy", resourceId: policy.id, resourceVersionId: version.id, label: policy.title, active: saved.state === "active", previousActive: prior?.state === "active", state: saved.state, force: Boolean(prior && prior.state === "active" && saved.state === "active" && differs) });
    if (event) events.push(event);
  }
  for (const event of events) await logActivity?.(event);
  return { changed, evaluated: allUserIds.length };
}

export async function reconcileStudioKnowledgeAssignments(input: { prisma: any; logActivity?: any; now?: Date; resourceKind?: "packet" | "policy"; resourceId?: string; userIds?: string[] }) {
  const now = input.now || new Date();
  let changed = 0;
  let evaluated = 0;
  if (!input.resourceKind || input.resourceKind === "packet") {
    const definitions = await input.prisma.packetDefinition.findMany({
      where: input.resourceId ? { libraryFolderId: input.resourceId } : undefined,
      include: { libraryFolder: { select: { id: true, title: true, status: true } } },
    });
    for (const definition of definitions.filter((row: any) => row.libraryFolder?.status !== "archived")) {
      const result = await reconcilePacket({ ...input, definition, now });
      changed += result.changed; evaluated += result.evaluated;
    }
  }
  if (!input.resourceKind || input.resourceKind === "policy") {
    const policies = await input.prisma.studioPolicy.findMany({
      where: input.resourceId ? { id: input.resourceId } : undefined,
      include: { versions: { where: { status: "published" }, orderBy: { version: "desc" }, take: 1 } },
    });
    for (const policy of policies) {
      const result = await reconcilePolicy({ ...input, policy, now });
      changed += result.changed; evaluated += result.evaluated;
    }
  }
  return { changed, evaluated, at: now.toISOString() };
}
