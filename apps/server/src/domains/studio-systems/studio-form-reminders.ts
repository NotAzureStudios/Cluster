import { randomUUID } from "node:crypto";
import { parseStudioJson, loadStudioAudienceUserContext, studioAudienceMatchesContext, parseStudioAudience } from "../access/studio-audience.js";

const DAY_MS = 86_400_000;
const LEASE_MS = 5 * 60_000;
export type FormReminderStage = "before_due" | "overdue";

/** Published deadline uses an absolute instant. Deadlines do not close submissions. */
export function getFormReminderStage(settings: any, now: Date): FormReminderStage | null {
  if (settings?.acceptingResponses === false || !settings?.dueAt) return null;
  const due = new Date(settings.dueAt).getTime();
  if (!Number.isFinite(due)) return null;
  if (now.getTime() >= due) return settings.remindWhenOverdue === true ? "overdue" : null;
  const days = settings.reminderDaysBefore;
  if (!Number.isInteger(days) || days < 1 || days > 30) return null;
  return now.getTime() >= due - days * DAY_MS ? "before_due" : null;
}

/**
 * Bounded periodic job, backed by durable per-user + published-version + stage claims.
 * No public application recipients; no draft or response contents in notifications.
 * Dedupe delivery groups are stable across crashes/retries and worker failover.
 */
export async function runStudioFormReminderTick(input: { prisma: any; logActivity: (entry: any) => Promise<unknown>; now?: Date; maxDeliveries?: number }) {
  const { prisma, logActivity } = input;
  const now = input.now ?? new Date();
  const limit = Math.min(1000, Math.max(1, input.maxDeliveries ?? 250));
  const active = await prisma.studioForm.findMany({
    where: { status: "active", purpose: { not: "application" }, versions: { some: { status: "published" } } },
    include: { versions: { where: { status: "published" }, orderBy: { version: "desc" }, take: 1 } },
    orderBy: { id: "asc" }, take: 501,
  });
  if (active.length > 500) throw new Error("Form reminder scan exceeds 500 published forms; paginate before enabling more.");
  // An assignment can override an audience deadline (or set one where none exists).
  // Load bounded obligations once, not in a loop over every user and form.
  const assignments = active.length ? await prisma.studioFormAssignment.findMany({
    where: { formId: { in: active.map((form: any) => form.id) } },
    select: { formId: true, userId: true, status: true, dueAt: true, required: true }, take: 5001,
  }) : [];
  if (assignments.length > 5000) throw new Error("Form reminder scan exceeds 5000 individual assignments; paginate before enabling more.");
  const assigned = new Map<string, any>(assignments.map((row: any) => [`${row.formId}:${row.userId}`, row]));
  const due = active.flatMap((form: any) => {
    const version = form.versions?.[0];
    if (!version) return [];
    const settings = parseStudioJson(version.settingsJson, {});
    // An assignment-specific deadline may be the only deadline for this form.
    return getFormReminderStage(settings, now) || assignments.some((row: any) => row.formId === form.id && row.status === "active" && row.dueAt && getFormReminderStage({ ...settings, dueAt: row.dueAt }, now))
      ? [{ form, version, settings }] : [];
  });
  if (!due.length) return { forms: 0, inspected: 0, sent: 0, exhausted: false };
  const users = await prisma.user.findMany({
    where: { archived: false, accountState: { notIn: ["SUSPENDED", "DISABLED", "PRIVACY_ERASED"] }, OR: [{ accessExpiresAt: null }, { accessExpiresAt: { gt: now } }] },
    select: { id: true, username: true, accountState: true, archived: true, accessExpiresAt: true },
    orderBy: { id: "asc" }, take: 5001,
  });
  if (users.length > 5000) throw new Error("Form reminder scan exceeds 5000 active accounts; paginate before enabling more.");
  // A failed membership read must never become a permissive exclusion match.
  // Only load the normalized memberships when the audience requires them.
  async function matchesAudience(form: any, user: any) {
    const audience = parseStudioAudience(form.audienceJson);
    if (audience.mode === "all" || !audience.targets.length) return true;
    const context = await loadStudioAudienceUserContext(prisma, user, { strict: true });
    return studioAudienceMatchesContext(audience, String(user.id), context);
  }
  let inspected = 0; let sent = 0;
  for (const { form, version, settings } of due) {
    const completed = await prisma.studioFormSubmission.findMany({
      where: { formId: form.id, status: { in: ["submitted", "under_review", "approved"] }, userId: { not: null } },
      select: { userId: true }, distinct: ["userId"],
    });
    const submitted = new Set(completed.map((row: any) => String(row.userId)));
    for (const user of users) {
      inspected += 1;
      if (submitted.has(user.id) || !(await matchesAudience(form, user))) continue;
      const assignment = assigned.get(`${form.id}:${user.id}`);
      if (assignment?.status === "revoked") continue;
      const recipientSettings = assignment?.status === "active" && assignment.dueAt ? { ...settings, dueAt: assignment.dueAt } : settings;
      const stage = getFormReminderStage(recipientSettings, now);
      if (!stage) continue;
      // The unique record is the authority for this recipient/stage/version.
      const record = await prisma.studioFormReminderDelivery.upsert({
        where: { formVersionId_userId_stage: { formVersionId: version.id, userId: user.id, stage } },
        create: { formId: form.id, formVersionId: version.id, userId: user.id, stage }, update: {},
      });
      if (record.state === "sent" || (record.state === "sending" && record.leaseUntil && new Date(record.leaseUntil) > now)) continue;
      const token = randomUUID();
      const claimed = await prisma.studioFormReminderDelivery.updateMany({
        where: { id: record.id, OR: [{ state: "pending" }, { state: "sending", leaseUntil: { lte: now } }] },
        data: { state: "sending", claimToken: token, leaseUntil: new Date(now.getTime() + LEASE_MS) },
      });
      if (!claimed.count) continue;
      try {
        // Re-read mutable authority after winning the claim: audience and completion
        // might have changed while this maintenance job was scanning.
        const [currentForm, currentVersion, currentUser, completion, currentAssignment] = await Promise.all([
          prisma.studioForm.findUnique({ where: { id: form.id } }),
          prisma.studioFormVersion.findFirst({ where: { formId: form.id, status: "published" }, orderBy: { version: "desc" } }),
          prisma.user.findUnique({ where: { id: user.id } }),
          prisma.studioFormSubmission.findFirst({ where: { formId: form.id, userId: user.id, status: { in: ["submitted", "under_review", "approved"] } }, select: { id: true } }),
          prisma.studioFormAssignment.findUnique({ where: { formId_userId: { formId: form.id, userId: user.id } }, select: { status: true, dueAt: true, required: true } }),
        ]);
        const currentSettings = parseStudioJson(currentVersion?.settingsJson, {});
        const currentDue = currentAssignment?.status === "active" && currentAssignment.dueAt ? currentAssignment.dueAt : currentSettings.dueAt;
        const stillEligible = currentForm?.status === "active"
          && currentForm.purpose !== "application"
          && currentVersion?.id === version.id
          && getFormReminderStage({ ...currentSettings, dueAt: currentDue }, now) === stage
          && currentUser && !currentUser.archived
          && !["SUSPENDED", "DISABLED", "PRIVACY_ERASED"].includes(currentUser.accountState)
          && (!currentUser.accessExpiresAt || new Date(currentUser.accessExpiresAt) > now)
          && currentAssignment?.status !== "revoked"
          && !completion && await matchesAudience(currentForm, currentUser);
        if (!stillEligible) {
          await prisma.studioFormReminderDelivery.updateMany({ where: { id: record.id, claimToken: token }, data: { state: "pending", claimToken: null, leaseUntil: null } });
          continue;
        }
        const dueAt = new Date(currentDue).toISOString();
        const groupKey = `studio-form-deadline:${version.id}:${user.id}:${stage}`;
        await logActivity({
          type: stage === "overdue" ? "studio_form_overdue" : "studio_form_due",
          entityType: "studio_form", entityId: form.id,
          title: stage === "overdue" ? "Form overdue" : "Form due soon",
          message: `${form.title} · ${stage === "overdue" ? "was due" : "due"} ${new Date(dueAt).toLocaleDateString("en-US", { timeZone: "UTC" })}`,
          metadata: { userIds: [user.id], notifyInbox: true, notificationSignal: "due", notificationPriority: stage === "overdue" ? "high" : "normal", requiresAction: currentAssignment?.status === "active" ? currentAssignment.required === true : true, notificationGroupKey: groupKey, formId: form.id, formVersionId: version.id, dueAt },
        });
        await prisma.studioFormReminderDelivery.updateMany({ where: { id: record.id, claimToken: token }, data: { state: "sent", deliveredAt: new Date(), claimToken: null, leaseUntil: null } });
        sent += 1;
      } catch (error) {
        // Retry, preserving the same stable group key across uncertain delivery.
        await prisma.studioFormReminderDelivery.updateMany({ where: { id: record.id, claimToken: token }, data: { state: "pending", claimToken: null, leaseUntil: null } });
        throw error;
      }
      if (sent >= limit) return { forms: due.length, inspected, sent, exhausted: true };
    }
  }
  return { forms: due.length, inspected, sent, exhausted: false };
}
