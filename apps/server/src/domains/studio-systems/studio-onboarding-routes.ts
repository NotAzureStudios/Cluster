import { studioAudienceSchema, studioOnboardingAssignmentLifecycleSchema, studioOnboardingPlanCreateSchema, studioOnboardingPlanVersionCreateSchema } from "@cluster/shared";
import { z } from "zod";
import { parseStudioJson, resolveStudioAudienceUserIds, studioAudienceMatchesUser } from "../access/studio-audience.js";
import { serializeStudioForm, serializeStudioFormVersion } from "./studio-form-runtime.js";
import { createStudioOnboardingAssignments, studioOnboardingAssignmentView, studioOnboardingDueAt } from "./studio-onboarding-runtime.js";
import { commitStudioOnboardingPublication } from "./studio-onboarding-publication.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function serializePlan(plan: any) {
  return { ...plan, audience: studioAudienceSchema.parse(parseStudioJson(plan.audienceJson, { mode: "all", targets: [] })), audienceJson: undefined, versions: Array.isArray(plan.versions) ? plan.versions.map(serializeVersion) : undefined };
}

function serializeVersion(version: any) {
  return {
    ...version,
    steps: Array.isArray(version.steps) ? version.steps.map((step: any) => ({ id: step.id, position: step.position, kind: step.kind, resourceId: step.resourceId, resourceLabel: step.resourceLabel, resourceVersionLabel: step.resourceVersionLabel, required: Boolean(step.required) })) : undefined,
    assignments: undefined,
    supersededAssignments: undefined,
    assignmentCount: Array.isArray(version.assignments) ? version.assignments.length : Number(version._count?.assignments || 0),
  };
}

async function resolveStepResources(prisma: any, steps: Array<{ kind: string; resourceId: string; required: boolean }>) {
  const packetIds = steps.filter((step) => step.kind === "packet").map((step) => step.resourceId);
  const policyIds = steps.filter((step) => step.kind === "policy").map((step) => step.resourceId);
  const formIds = steps.filter((step) => step.kind === "form").map((step) => step.resourceId);
  const [packets, policies, forms] = await Promise.all([
    packetIds.length ? prisma.packetDefinition.findMany({ where: { id: { in: packetIds } }, include: { libraryFolder: { select: { id: true, title: true, status: true } } } }) : [],
    policyIds.length ? prisma.studioPolicyVersion.findMany({ where: { id: { in: policyIds }, status: "published" }, include: { policy: { select: { id: true, title: true, status: true } } } }) : [],
    formIds.length ? prisma.studioFormVersion.findMany({ where: { id: { in: formIds }, status: "published" }, include: { form: { select: { id: true, title: true, status: true } } } }) : [],
  ]);
  const packetMap = new Map(packets.filter((item: any) => item.libraryFolder?.status !== "archived").map((item: any) => [String(item.id), item]));
  const policyMap = new Map(policies.filter((item: any) => item.policy?.status === "active").map((item: any) => [String(item.id), item]));
  const formMap = new Map(forms.filter((item: any) => item.form?.status === "active").map((item: any) => [String(item.id), item]));
  return steps.map((step, position) => {
    if (step.kind === "packet") {
      const record: any = packetMap.get(step.resourceId);
      if (!record) throw Object.assign(new Error("Choose an active packet."), { code: "ONBOARDING_PACKET_INVALID" });
      return { ...step, position, resourceLabel: record.libraryFolder.title, resourceVersionLabel: record.versionLabel || null };
    }
    if (step.kind === "policy") {
      const record: any = policyMap.get(step.resourceId);
      if (!record) throw Object.assign(new Error("Choose a published Studio Policy version."), { code: "ONBOARDING_POLICY_INVALID" });
      return { ...step, position, resourceLabel: record.policy.title, resourceVersionLabel: record.versionLabel || String(record.version || "") || null };
    }
    const record: any = formMap.get(step.resourceId);
    if (!record) throw Object.assign(new Error("Choose a published reusable Form version."), { code: "ONBOARDING_FORM_INVALID" });
    return { ...step, position, resourceLabel: record.form.title, resourceVersionLabel: `v${record.version}` };
  });
}

export async function completionStateForUsers(prisma: any, userIds: string[], steps: any[]) {
  const users = [...new Set(userIds.map(String).filter(Boolean))];
  const packetIds = [...new Set(steps.filter((step) => step.kind === "packet").map((step) => String(step.resourceId)))];
  const policyIds = [...new Set(steps.filter((step) => step.kind === "policy").map((step) => String(step.resourceId)))];
  const formIds = [...new Set(steps.filter((step) => step.kind === "form").map((step) => String(step.resourceId)))];
  const [packetCompletions, policyVersions, policyAcceptances, formSubmissions] = await Promise.all([
    users.length && packetIds.length ? prisma.packetCompletion.findMany({ where: { userId: { in: users }, packetDefinitionId: { in: packetIds } }, select: { userId: true, packetDefinitionId: true, completedAt: true } }) : [],
    policyIds.length ? prisma.studioPolicyVersion.findMany({ where: { id: { in: policyIds } }, select: { id: true, acceptanceMode: true, contentHash: true } }) : [],
    users.length && policyIds.length ? prisma.studioPolicyAcceptance.findMany({ where: { userId: { in: users }, policyVersionId: { in: policyIds } }, select: { userId: true, policyVersionId: true, policyContentHash: true, acceptedAt: true } }) : [],
    users.length && formIds.length ? prisma.studioFormSubmission.findMany({ where: { userId: { in: users }, formVersionId: { in: formIds }, status: { in: ["submitted", "approved"] } }, orderBy: { submittedAt: "desc" }, select: { userId: true, formVersionId: true, submittedAt: true } }) : [],
  ]);
  const key = (userId: string, resourceId: string) => `${userId}:${resourceId}`;
  const packetMap = new Map(packetCompletions.map((item: any) => [key(String(item.userId), String(item.packetDefinitionId)), item]));
  const policyVersionMap = new Map(policyVersions.map((item: any) => [String(item.id), item]));
  const policyAcceptanceMap = new Map(policyAcceptances.map((item: any) => [key(String(item.userId), String(item.policyVersionId)), item]));
  const formMap = new Map<string, any>();
  for (const item of formSubmissions) { const entryKey = key(String(item.userId), String(item.formVersionId)); if (!formMap.has(entryKey)) formMap.set(entryKey, item); }
  const states = new Map<string, any[]>();
  for (const userId of users) states.set(userId, steps.map((step) => {
    if (step.kind === "packet") {
      const completion: any = packetMap.get(key(userId, String(step.resourceId)));
      return { ...step, complete: Boolean(completion), completedAt: completion?.completedAt || null };
    }
    if (step.kind === "policy") {
      const version: any = policyVersionMap.get(String(step.resourceId));
      const acceptance: any = policyAcceptanceMap.get(key(userId, String(step.resourceId)));
      const complete = version?.acceptanceMode === "none" || Boolean(acceptance && acceptance.policyContentHash === version?.contentHash);
      return { ...step, complete, completedAt: complete ? (acceptance?.acceptedAt || null) : null };
    }
    const submission: any = formMap.get(key(userId, String(step.resourceId)));
    return { ...step, complete: Boolean(submission), completedAt: submission?.submittedAt || null };
  }));
  return states;
}

async function completionStateForUser(prisma: any, userId: string, steps: any[]) {
  return (await completionStateForUsers(prisma, [userId], steps)).get(userId) || [];
}

async function memberStepActions(prisma: any, user: any, steps: any[]) {
  const formIds = [...new Set(steps.filter((step) => step.kind === "form").map((step) => String(step.resourceId)))];
  const policyIds = [...new Set(steps.filter((step) => step.kind === "policy").map((step) => String(step.resourceId)))];
  const packetIds = [...new Set(steps.filter((step) => step.kind === "packet").map((step) => String(step.resourceId)))];
  const [forms, policies, packets] = await Promise.all([
    formIds.length ? prisma.studioFormVersion.findMany({ where: { id: { in: formIds }, status: "published" }, include: { form: true } }) : [],
    policyIds.length ? prisma.studioPolicyVersion.findMany({ where: { id: { in: policyIds }, status: "published" }, include: { policy: true } }) : [],
    packetIds.length ? prisma.packetDefinition.findMany({ where: { id: { in: packetIds } }, include: { libraryFolder: { select: { id: true, title: true, status: true } } } }) : [],
  ]);
  const policyFormIds = [...new Set(policies.flatMap((version: any) => version.formVersionId ? [String(version.formVersionId)] : []))];
  const [policyForms, policyFormSubmissions] = await Promise.all([
    policyFormIds.length ? prisma.studioFormVersion.findMany({ where: { id: { in: policyFormIds }, status: "published" }, include: { form: true } }) : [],
    policyFormIds.length ? prisma.studioFormSubmission.findMany({ where: { userId: user.id, formVersionId: { in: policyFormIds }, status: { in: ["submitted", "approved"] } }, orderBy: { submittedAt: "desc" }, select: { id: true, formVersionId: true } }) : [],
  ]);
  const formMap = new Map(forms.map((entry: any) => [String(entry.id), entry]));
  const policyMap = new Map(policies.map((entry: any) => [String(entry.id), entry]));
  const packetMap = new Map(packets.map((entry: any) => [String(entry.id), entry]));
  const policyFormMap = new Map(policyForms.map((entry: any) => [String(entry.id), entry]));
  const submissionMap = new Map<string, string>();
  for (const item of policyFormSubmissions) if (!submissionMap.has(String(item.formVersionId))) submissionMap.set(String(item.formVersionId), String(item.id));
  const actions = new Map<string, any>();
  for (const step of steps) {
    if (step.kind === "packet") {
      const packet: any = packetMap.get(String(step.resourceId));
      const visible = Boolean(packet?.libraryFolder && packet.libraryFolder.status !== "archived" && await studioAudienceMatchesUser(prisma, packet.audienceJson, user));
      actions.set(String(step.id), visible ? { kind: "packet", packetId: packet.libraryFolder.id, completionMode: packet.completionMode } : { kind: "unavailable", reason: "This packet is outside your current access audience." });
      continue;
    }
    if (step.kind === "form") {
      const version: any = formMap.get(String(step.resourceId));
      const visible = Boolean(version?.form?.status === "active" && await studioAudienceMatchesUser(prisma, version?.form?.audienceJson, user));
      actions.set(String(step.id), visible ? { kind: "form", document: { form: serializeStudioForm({ ...version.form, versions: undefined }), version: serializeStudioFormVersion(version) } } : { kind: "unavailable", reason: "This form is outside your current access audience." });
      continue;
    }
    const version: any = policyMap.get(String(step.resourceId));
    const visible = Boolean(version?.policy?.status === "active" && await studioAudienceMatchesUser(prisma, version?.policy?.audienceJson, user));
    if (!visible) { actions.set(String(step.id), { kind: "unavailable", reason: "This policy is outside your current access audience." }); continue; }
    let formDocument = null;
    const formVersion: any = version?.formVersionId ? policyFormMap.get(String(version.formVersionId)) : null;
    if (formVersion?.form?.status === "active" && await studioAudienceMatchesUser(prisma, formVersion.form.audienceJson, user)) formDocument = { form: serializeStudioForm({ ...formVersion.form, versions: undefined }), version: serializeStudioFormVersion(formVersion) };
    actions.set(String(step.id), { kind: "policy", policy: { id: version.policy.id, title: version.policy.title, summary: version.policy.summary }, version: { id: version.id, versionLabel: version.versionLabel, bodyMarkdown: version.bodyMarkdown, acceptanceMode: version.acceptanceMode, formVersionId: version.formVersionId }, formDocument, existingFormSubmissionId: version.formVersionId ? submissionMap.get(String(version.formVersionId)) || null : null });
  }
  return actions;
}

export async function runStudioOnboardingLifecycleTick(input: { prisma: any; logActivity?: any; now?: Date; limit?: number }) {
  const { prisma, logActivity } = input;
  const now = input.now || new Date();
  const assignments = await prisma.studioOnboardingAssignment.findMany({
    where: { status: "active", dueAt: { not: null } },
    include: { planVersion: { include: { plan: true, steps: { orderBy: { position: "asc" } } } } },
    orderBy: { dueAt: "asc" },
    take: Math.min(Math.max(Number(input.limit || 1000), 1), 5000),
  });
  const adminMemberships = assignments.length ? await prisma.workspaceMember.findMany({ where: { role: { in: ["owner", "admin"] }, user: { archived: false, accountState: { notIn: ["SUSPENDED", "DISABLED", "PRIVACY_ERASED"] } } }, select: { userId: true } }) : [];
  const adminIds = [...new Set(adminMemberships.map((item: any) => String(item.userId)).filter(Boolean))];
  const byVersion = new Map<string, any[]>();
  for (const assignment of assignments) { const id = String(assignment.planVersionId); const rows = byVersion.get(id) || []; rows.push(assignment); byVersion.set(id, rows); }
  let reminded = 0; let escalated = 0; let inspected = 0;
  for (const rows of byVersion.values()) {
    const version = rows[0]?.planVersion; if (!version) continue;
    const states = await completionStateForUsers(prisma, rows.map((row) => String(row.userId)), version.steps || []);
    for (const assignment of rows) {
      inspected += 1;
      const steps = states.get(String(assignment.userId)) || [];
      const required = steps.filter((step: any) => step.required);
      const done = required.every((step: any) => step.complete);
      if (done || !assignment.dueAt) continue;
      const dueAt = new Date(assignment.dueAt);
      const reminderDays = version.reminderDaysBefore == null ? null : Math.max(0, Number(version.reminderDaysBefore));
      const escalationDays = version.escalationDaysAfter == null ? null : Math.max(0, Number(version.escalationDaysAfter));
      const reminderThreshold = reminderDays == null ? null : new Date(dueAt.getTime() - reminderDays * DAY_MS);
      const reminderWindowEnd = new Date(dueAt.getTime() + DAY_MS);
      if (reminderThreshold && !assignment.lastReminderAt && now.getTime() >= reminderThreshold.getTime() && now.getTime() < reminderWindowEnd.getTime()) {
        await logActivity?.({ type: "onboarding_reminder", entityType: "studio_onboarding_assignment", entityId: assignment.id, title: "Onboarding due soon", message: `${version.plan.title} is due ${dueAt.toLocaleDateString()}.`, metadata: { notifyInbox: true, userIds: [assignment.userId], notificationSignal: "due", notificationPriority: "high", requiresAction: true, notificationGroupKey: `onboarding:${assignment.id}:reminder`, onboardingAssignmentId: assignment.id, dueAt: dueAt.toISOString() } });
        await prisma.studioOnboardingAssignment.update({ where: { id: assignment.id }, data: { lastReminderAt: now } }); reminded += 1;
      }
      const escalationThreshold = escalationDays == null ? null : new Date(dueAt.getTime() + escalationDays * DAY_MS);
      if (escalationThreshold && !assignment.escalatedAt && now.getTime() >= escalationThreshold.getTime()) {
        const userIds = [...new Set([String(assignment.userId), ...adminIds])];
        await logActivity?.({ type: "onboarding_escalated", entityType: "studio_onboarding_assignment", entityId: assignment.id, title: "Onboarding overdue", message: `${version.plan.title} is overdue.`, metadata: { notifyInbox: true, userIds, notificationSignal: "due", notificationPriority: "high", requiresAction: true, escalationLevel: 1, notificationGroupKey: `onboarding:${assignment.id}:escalation`, onboardingAssignmentId: assignment.id, dueAt: dueAt.toISOString() } });
        await prisma.studioOnboardingAssignment.update({ where: { id: assignment.id }, data: { escalatedAt: now } }); escalated += 1;
      }
    }
  }
  return { inspected, reminded, escalated };
}

export function registerStudioOnboardingRoutes(deps: any) {
  const { app, prisma, authorization, getCurrentUser, logActivity, jobQueue } = deps;
  async function requireAdmin(request: any, reply: any) { return authorization.requireTool(request, reply, "settings", "edit"); }
  async function requireUser(request: any, reply: any) { const user = await getCurrentUser(request); if (!user) { reply.code(401).send({ ok: false, code: "AUTH_REQUIRED", error: "Login required." }); return null; } return user; }

  app.get("/api/studio-audience/options", async (request: any, reply: any) => {
    if (!(await requireUser(request, reply))) return;
    const [users, departments, teams, roles, projects] = await Promise.all([
      prisma.user.findMany({ where: { archived: false, accountState: { notIn: ["PRIVACY_ERASED", "DISABLED"] } }, select: { id: true, username: true, displayName: true, preferredName: true }, orderBy: [{ displayName: "asc" }, { username: "asc" }], take: 5000 }),
      prisma.department.findMany({ where: { archived: false }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 1000 }),
      prisma.studioTeam.findMany({ where: { archived: false }, select: { id: true, name: true, departmentAuthority: { select: { name: true } } }, orderBy: { name: "asc" }, take: 1000 }),
      prisma.jobRole.findMany({ where: { archived: false }, select: { id: true, name: true, department: { select: { name: true } } }, orderBy: { name: "asc" }, take: 1000 }),
      prisma.project.findMany({ where: { archived: false }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 5000 }),
    ]);
    return {
      departments: departments.map((item: any) => ({ id: item.id, label: item.name })),
      teams: teams.map((team: any) => ({ id: team.id, label: team.name, detail: team.departmentAuthority?.name || undefined })),
      roles: roles.map((role: any) => ({ id: role.id, label: role.name, detail: role.department?.name || undefined })),
      projects: projects.map((project: any) => ({ id: project.id, label: project.name })),
      users: users.map((item: any) => ({ id: item.id, label: item.preferredName || item.displayName || item.username, detail: item.username })),
    };
  });

  app.get("/api/studio-systems/onboarding", async (request: any, reply: any) => {
    if (!(await requireAdmin(request, reply))) return;
    const plans = await prisma.studioOnboardingPlan.findMany({ include: { versions: { include: { steps: { orderBy: { position: "asc" } }, _count: { select: { assignments: true } } }, orderBy: { version: "desc" }, take: 20 } }, orderBy: { updatedAt: "desc" } });
    return { plans: plans.map(serializePlan) };
  });

  app.post("/api/studio-systems/onboarding", async (request: any, reply: any) => {
    if (!(await requireAdmin(request, reply))) return;
    const body = studioOnboardingPlanCreateSchema.parse(request.body || {});
    if (await prisma.studioOnboardingPlan.findUnique({ where: { key: body.key }, select: { id: true } })) return reply.code(409).send({ ok: false, code: "ONBOARDING_KEY_EXISTS", error: "An onboarding plan already uses this key." });
    const plan = await prisma.studioOnboardingPlan.create({ data: { key: body.key, title: body.title, description: body.description || null, audienceJson: JSON.stringify(body.audience) }, include: { versions: true } });
    const actor = await getCurrentUser(request); await logActivity?.({ userId: actor?.id, type: "created", entityType: "studio_onboarding_plan", entityId: plan.id, title: "Onboarding plan created", message: plan.title });
    return reply.code(201).send(serializePlan(plan));
  });

  app.post("/api/studio-systems/onboarding/:planId/versions", async (request: any, reply: any) => {
    if (!(await requireAdmin(request, reply))) return;
    const { planId } = z.object({ planId: z.string().min(1) }).parse(request.params); const body = studioOnboardingPlanVersionCreateSchema.parse(request.body || {});
    const plan = await prisma.studioOnboardingPlan.findUnique({ where: { id: planId } }); if (!plan) return reply.code(404).send({ ok: false, code: "ONBOARDING_NOT_FOUND", error: "Onboarding plan not found." });
    let resolved: any[]; try { resolved = await resolveStepResources(prisma, body.steps); } catch (error: any) { return reply.code(400).send({ ok: false, code: error?.code || "ONBOARDING_STEP_INVALID", error: error instanceof Error ? error.message : "An onboarding step is invalid." }); }
    // Resolve the audience before entering the transaction; publication, assignments and
    // supersession must all commit (or all roll back) as one user-visible operation.
    const userIds = body.publish ? await resolveStudioAudienceUserIds(prisma, plan.audienceJson) : [];
    const publishedAt = body.publish ? new Date() : null;
    const { created, assigned, superseded } = await commitStudioOnboardingPublication(prisma, { planId, body, resolved, userIds, publishedAt });
    const actor = await getCurrentUser(request); await logActivity?.({ userId: actor?.id, type: body.publish ? "published" : "created", entityType: "studio_onboarding_version", entityId: created.id, title: body.publish ? "Onboarding plan published" : "Onboarding version created", message: `${plan.title} ${body.versionLabel}`, metadata: { assigned, superseded } });
    return reply.code(201).send({ version: serializeVersion(created), assigned, superseded });
  });

  app.post("/api/studio-systems/onboarding/versions/:versionId/assign", async (request: any, reply: any) => {
    if (!(await requireAdmin(request, reply))) return;
    const { versionId } = z.object({ versionId: z.string().min(1) }).parse(request.params); const version = await prisma.studioOnboardingPlanVersion.findUnique({ where: { id: versionId }, include: { plan: true } });
    if (!version || version.status !== "published" || version.plan.status !== "active") return reply.code(404).send({ ok: false, code: "ONBOARDING_VERSION_NOT_FOUND", error: "Published onboarding version not found." });
    const userIds = await resolveStudioAudienceUserIds(prisma, version.plan.audienceJson); const result = await createStudioOnboardingAssignments(prisma, version, userIds, "audience_reconcile");
    return { ok: true, eligible: userIds.length, assigned: result.count };
  });

  // Single-person assignment is intentionally NOT the audience-wide /assign
  // operation. It verifies person workspace, plan publication and audience
  // policy before a single idempotent assignment is persisted.
  app.post("/api/studio-systems/onboarding/versions/:versionId/assign-person", async (request: any, reply: any) => {
    if (!(await requireAdmin(request, reply))) return;
    const actor = await getCurrentUser(request);
    if (!actor) return reply.code(401).send({ ok: false, code: "AUTH_REQUIRED" });
    const actorMembership = await prisma.workspaceMember.findFirst({
      where: { userId: actor.id },
      orderBy: { workspaceId: "asc" },
      select: { workspaceId: true, role: true },
    });
    if (!actorMembership || !["owner", "admin"].includes(actorMembership.role))
      return reply.code(403).send({ ok: false, code: "ROLE_ADMIN_REQUIRED" });
    const params = z.object({ versionId: z.string().trim().min(1).max(160) }).safeParse(request.params || {});
    const input = z.object({ userId: z.string().trim().min(1).max(160) }).strict().safeParse(request.body || {});
    if (!params.success || !input.success)
      return reply.code(400).send({ ok: false, code: "ONBOARDING_ASSIGNMENT_INPUT_INVALID", error: "Choose a published onboarding version and one person." });

    const assigned = await prisma.$transaction(async (tx: any) => {
      const version = await tx.studioOnboardingPlanVersion.findUnique({
        where: { id: params.data.versionId },
        include: { plan: true },
      });
      if (!version || version.status !== "published" || version.plan.status !== "active")
        return { ok: false, status: 404, code: "ONBOARDING_VERSION_NOT_FOUND", error: "Published onboarding version not found." };
      const target = await tx.user.findFirst({
        where: {
          id: input.data.userId,
          archived: false,
          accountState: { notIn: ["DISABLED", "PRIVACY_ERASED"] },
          memberships: { some: { workspaceId: actorMembership.workspaceId } },
        },
      });
      if (!target)
        return { ok: false, status: 404, code: "ONBOARDING_TARGET_UNAVAILABLE", error: "Active account not found in this workspace." };
      if (target.accessExpiresAt && new Date(target.accessExpiresAt) <= new Date())
        return { ok: false, status: 409, code: "ONBOARDING_TARGET_EXPIRED", error: "Renew this person's access before assigning onboarding." };
      if (!(await studioAudienceMatchesUser(tx, version.plan.audienceJson, target)))
        return { ok: false, status: 409, code: "ONBOARDING_AUDIENCE_MISMATCH", error: "This person is not eligible for the selected onboarding plan." };

      const assignedAt = new Date();
      const created = await tx.studioOnboardingAssignment.createMany({
        data: [{
          planVersionId: version.id,
          userId: target.id,
          source: "admin_person",
          status: "active",
          assignedAt,
          dueAt: studioOnboardingDueAt(version, assignedAt),
        }],
        skipDuplicates: true,
      });
      const assignment = await tx.studioOnboardingAssignment.findUniqueOrThrow({
        where: { planVersionId_userId: { planVersionId: version.id, userId: target.id } },
        select: { id: true, status: true, dueAt: true },
      });
      if (!created?.count && assignment.status !== "active")
        return { ok: false, status: 409, code: "ONBOARDING_ASSIGNMENT_INACTIVE", error: "An inactive assignment already exists. Use the governed reactivation process." };
      return {
        ok: true, created: Number(created?.count || 0) > 0,
        assignmentId: assignment.id, status: assignment.status,
        dueAt: assignment.dueAt, planTitle: version.plan.title, userId: target.id,
      };
    });
    if (!assigned.ok)
      return reply.code(assigned.status).send({ ok: false, code: assigned.code, error: assigned.error });
    if (assigned.created) {
      try {
        await logActivity?.({
          userId: actor.id, type: "assigned", entityType: "studio_onboarding_assignment",
          entityId: assigned.assignmentId, title: "Onboarding assigned",
          message: assigned.planTitle, metadata: { targetUserId: assigned.userId, source: "admin_person" },
        });
      } catch { /* Committed assignment must not be misreported as failed or retried blindly. */ }
    }
    return {
      ok: true, created: assigned.created, assignmentId: assigned.assignmentId,
      status: assigned.status, dueAt: assigned.dueAt,
      message: assigned.created ? "Onboarding assigned." : "This onboarding version was already assigned.",
    };
  });

  app.patch("/api/studio-systems/onboarding/assignments/:assignmentId/lifecycle", async (request: any, reply: any) => {
    if (!(await requireAdmin(request, reply))) return;
    const actor = await getCurrentUser(request); const { assignmentId } = z.object({ assignmentId: z.string().min(1) }).parse(request.params); const body = studioOnboardingAssignmentLifecycleSchema.parse(request.body || {});
    const assignment = await prisma.studioOnboardingAssignment.findUnique({ where: { id: assignmentId }, include: { user: true, planVersion: { include: { plan: true } } } });
    if (!assignment) return reply.code(404).send({ ok: false, code: "ONBOARDING_ASSIGNMENT_NOT_FOUND", error: "Onboarding assignment not found." });
    if (body.action === "reactivate") {
      if (assignment.planVersion.status !== "published" || assignment.planVersion.plan.status !== "active") return reply.code(409).send({ ok: false, code: "ONBOARDING_VERSION_INACTIVE", error: "Only an active published onboarding version can be reactivated." });
      if (!(await studioAudienceMatchesUser(prisma, assignment.planVersion.plan.audienceJson, assignment.user))) return reply.code(409).send({ ok: false, code: "ONBOARDING_AUDIENCE_MISMATCH", error: "This person is no longer in the onboarding plan audience." });
      const now = new Date();
      const saved = await prisma.studioOnboardingAssignment.update({ where: { id: assignment.id }, data: { status: "active", dueAt: studioOnboardingDueAt(assignment.planVersion, now), lastReminderAt: null, escalatedAt: null, revokedAt: null, revokedById: null, lifecycleNote: body.reason || null, supersededAt: null, supersededByVersionId: null } });
      await logActivity?.({ userId: actor?.id, type: "reactivated", entityType: "studio_onboarding_assignment", entityId: saved.id, title: "Onboarding assignment reactivated", message: assignment.planVersion.plan.title, metadata: { targetUserId: assignment.userId } });
      return { ok: true, assignment: saved };
    }
    if (assignment.status !== "active") return reply.code(409).send({ ok: false, code: "ONBOARDING_ASSIGNMENT_INACTIVE", error: "Only an active assignment can be revoked or cancelled." });
    const now = new Date();
    const saved = await prisma.studioOnboardingAssignment.update({ where: { id: assignment.id }, data: { status: body.action, revokedAt: now, revokedById: actor?.id || null, lifecycleNote: body.reason || null } });
    await logActivity?.({ userId: actor?.id, type: body.action, entityType: "studio_onboarding_assignment", entityId: saved.id, title: `Onboarding assignment ${body.action === "revoke" ? "revoked" : "cancelled"}`, message: assignment.planVersion.plan.title, metadata: { targetUserId: assignment.userId } });
    return { ok: true, assignment: saved };
  });

  app.post("/api/studio-systems/onboarding/lifecycle/run", async (request: any, reply: any) => {
    if (!(await requireAdmin(request, reply))) return;
    if (!jobQueue?.enqueue) return reply.code(503).send({ ok: false, code: "BACKGROUND_JOBS_UNAVAILABLE", error: "Onboarding lifecycle processing is unavailable." });
    const job = await jobQueue.enqueue({ type: "studio.onboarding-lifecycle", queue: "maintenance", dedupeKey: "studio-onboarding-lifecycle", maxAttempts: 5, priority: 10 });
    return reply.code(202).send({ ok: true, queued: true, jobId: job.id, status: job.status });
  });

  app.get("/api/onboarding", async (request: any, reply: any) => {
    reply.header("Cache-Control", "private, no-store");
    const user = await requireUser(request, reply); if (!user) return;
    const assignments = await prisma.studioOnboardingAssignment.findMany({ where: { userId: user.id, status: "active" }, include: { planVersion: { include: { plan: true, steps: { orderBy: { position: "asc" } } } } }, orderBy: { assignedAt: "desc" } });
    const activeAssignments = assignments.filter((assignment: any) => assignment.planVersion.status === "published" && assignment.planVersion.plan.status === "active");
    const allSteps = activeAssignments.flatMap((assignment: any) => assignment.planVersion.steps);
    const completionByStep = new Map((await completionStateForUser(prisma, user.id, allSteps)).map((step: any) => [String(step.id), step]));
    const actions = await memberStepActions(prisma, user, allSteps);
    const plans = activeAssignments.map((assignment: any) => {
      const enriched = assignment.planVersion.steps.map((step: any) => {
        const action = actions.get(String(step.id)) || { kind: "unavailable", reason: "This resource is currently unavailable." };
        const state = completionByStep.get(String(step.id)) || step;
        // Publication audience can change after assignment. Do not disclose a
        // newly restricted resource ID, title, or version through the onboarding
        // checklist merely because it was visible when the plan was published.
        return action.kind === "unavailable"
          ? { ...state, resourceId: null, resourceLabel: "Restricted onboarding resource", resourceVersionLabel: null, action }
          : { ...state, action };
      });
      const required = enriched.filter((step: any) => step.required); const done = required.every((step: any) => step.complete);
      return { assignmentId: assignment.id, assignedAt: assignment.assignedAt, lifecycle: studioOnboardingAssignmentView(assignment, done), plan: { id: assignment.planVersion.plan.id, key: assignment.planVersion.plan.key, title: assignment.planVersion.plan.title, description: assignment.planVersion.plan.description }, version: { id: assignment.planVersion.id, version: assignment.planVersion.version, versionLabel: assignment.planVersion.versionLabel, publishedAt: assignment.planVersion.publishedAt }, steps: enriched, progress: { complete: enriched.filter((step: any) => step.complete).length, total: enriched.length, requiredComplete: required.filter((step: any) => step.complete).length, requiredTotal: required.length, done } };
    });
    return { plans };
  });

  app.get("/api/studio-systems/onboarding/versions/:versionId/report", async (request: any, reply: any) => {
    reply.header("Cache-Control", "private, no-store");
    if (!(await requireAdmin(request, reply))) return;
    const { versionId } = z.object({ versionId: z.string().min(1) }).parse(request.params); const version = await prisma.studioOnboardingPlanVersion.findUnique({ where: { id: versionId }, include: { plan: true, steps: { orderBy: { position: "asc" } }, assignments: { include: { user: { select: { id: true, username: true, displayName: true, preferredName: true } } }, orderBy: { assignedAt: "asc" } } } });
    if (!version) return reply.code(404).send({ ok: false, code: "ONBOARDING_VERSION_NOT_FOUND", error: "Onboarding version not found." });
    const states = await completionStateForUsers(prisma, version.assignments.map((assignment: any) => String(assignment.userId)), version.steps);
    const people = version.assignments.map((assignment: any) => {
      const steps = states.get(String(assignment.userId)) || []; const required = steps.filter((step: any) => step.required); const done = required.every((step: any) => step.complete); const lifecycle = studioOnboardingAssignmentView(assignment, done);
      return { assignmentId: assignment.id, user: assignment.user, assignedAt: assignment.assignedAt, complete: steps.filter((step: any) => step.complete).length, total: steps.length, requiredComplete: required.filter((step: any) => step.complete).length, requiredTotal: required.length, done, lifecycle, steps };
    });
    return { plan: { id: version.plan.id, title: version.plan.title }, version: serializeVersion(version), assigned: people.length, active: people.filter((person: any) => person.lifecycle.status === "active").length, completed: people.filter((person: any) => person.done).length, overdue: people.filter((person: any) => person.lifecycle.overdue).length, people };
  });
}
