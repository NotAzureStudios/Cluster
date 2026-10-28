import { createHash } from "node:crypto";

export const PRIVACY_ERASURE_SCHEMA_VERSION = 1;

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
function digest(value: unknown) { return createHash("sha256").update(canonical(value)).digest("hex"); }

export async function buildPrivacyErasurePlan(prisma: any, userId: string) {
  const [user, activeHolds, sessions, consent, analytics, notifications, discordChallenges, avatarAudits, memberships, entityCommentDrafts, entityCommentReadStates, entityCommentThreadReadStates, formAssignments, formReviewGrants, formDrafts, formReminders, packetDeliveryIssuances, packetReleaseAcknowledgments, packetReleaseRequirements, packetReleaseReminders, activeDiscordRoles] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.privacyLegalHold.findMany({ where: { userId, status: "active" }, orderBy: { createdAt: "asc" } }),
    prisma.session.count({ where: { userId } }),
    prisma.privacyConsentPreference.count({ where: { userId } }),
    prisma.behavioralAnalyticsEvent.count({ where: { userId } }),
    prisma.notificationInboxItem.count({ where: { userId } }),
    prisma.discordLinkChallenge.count({ where: { userId } }),
    prisma.avatarAudit.count({ where: { userId } }),
    prisma.workspaceMember.count({ where: { userId } }),
    prisma.entityCommentDraft.count({ where: { userId } }),
    prisma.entityCommentReadState.count({ where: { userId } }),
    prisma.entityCommentThreadReadState.count({ where: { userId } }),
    prisma.studioFormAssignment.count({ where: { userId } }),
    prisma.studioFormReviewer.count({ where: { userId } }),
    prisma.studioFormResponseDraft.count({ where: { userId } }),
    prisma.studioFormReminderDelivery.count({ where: { userId } }),
    prisma.packetDeliveryReceipt.count({ where: { recipientId: userId } }),
    prisma.packetReleaseAcknowledgment.count({ where: { recipientId: userId } }),
    prisma.packetReleaseRequirement.count({ where: { recipientId: userId } }),
    prisma.packetReleaseReminderDelivery.count({ where: { recipientId: userId } }),
    prisma.discordRoleProjection.findMany({ where: { userId, status: { in: ["managed", "revoking", "pending", "uncertain"] } }, select: { id: true, guildId: true, status: true }, take: 101 }),
  ]);
  if (!user) return null;
  const plan = {
    schemaVersion: PRIVACY_ERASURE_SCHEMA_VERSION,
    userId,
    mode: "pseudonymize",
    blockers: [
      ...activeHolds.map((hold: any) => ({ type: "legal_hold", id: hold.id, reason: hold.reason, authorityRef: hold.authorityRef || null })),
      ...activeDiscordRoles.map((role: any) => ({ type: "discord_role_cleanup", id: role.id, reason: "Reconcile or manually verify removal of the Discord role before erasing its linked identity.", guildId: role.guildId, status: role.status })),
    ],
    destructive: { sessions, consent, analytics, notifications, discordChallenges, avatarAudits, memberships, entityCommentDrafts, entityCommentReadStates, entityCommentThreadReadStates, formAssignments, formReviewGrants, formDrafts, formReminders },
    preservedCounts: { packetDeliveryIssuances, packetReleaseAcknowledgments, packetReleaseRequirements, packetReleaseReminders },
    preserved: ["published Packet delivery issuance, required release assignments, reminder deliveries and release-bound recipient acknowledgment evidence (account pseudonymized, subject to retention)", "submitted Form response evidence (contains submitted answers governed by retention)", "authored work records", "security audit evidence", "policy acceptance evidence", "privacy request/erasure evidence"],
  };
  return { ...plan, planHash: digest(plan) };
}

export async function fulfillPrivacyErasure(prisma: any, input: { requestId: string; actorUserId: string }) {
  const request = await prisma.privacyDataRequest.findUnique({ where: { id: input.requestId }, include: { user: true } });
  if (!request) return { ok: false as const, code: "RESOURCE_NOT_FOUND", error: "Privacy request not found." };
  const existingReceipt = await prisma.privacyErasureReceipt.findUnique({ where: { requestId: request.id } });
  if (existingReceipt) return { ok: true as const, alreadyFulfilled: true, receipt: existingReceipt };
  if (request.status !== "approved") return { ok: false as const, code: "PRIVACY_ERASURE_NOT_APPROVED", error: "Only an approved privacy erasure request can be fulfilled." };
  if (request.userId === input.actorUserId) return { ok: false as const, code: "PRIVACY_ERASURE_SELF_BLOCKED", error: "Administrators cannot fulfill erasure of their own active account." };
  const plan = await buildPrivacyErasurePlan(prisma, request.userId);
  if (!plan) return { ok: false as const, code: "RESOURCE_NOT_FOUND", error: "Privacy request subject no longer exists." };
  if (plan.blockers.length) return { ok: false as const,
    code: plan.blockers.some((blocker: any) => blocker.type === "legal_hold") ? "PRIVACY_ERASURE_LEGAL_HOLD" : "PRIVACY_ERASURE_DISCORD_ROLE_CLEANUP",
    error: "Resolve legal holds and any Cluster-managed Discord roles before erasing this identity.", blockers: plan.blockers };

  const now = new Date();
  const subjectKey = `privacy-erased:${request.userId}`;
  const pseudonym = `deleted-${request.userId.toLowerCase()}`;
  const result = await prisma.$transaction(async (tx: any) => {
    const counts: Record<string, number> = {};
    for (const [key, model, where] of [
      ["sessions", "session", { userId: request.userId }],
      ["consent", "privacyConsentPreference", { userId: request.userId }],
      ["analytics", "behavioralAnalyticsEvent", { userId: request.userId }],
      ["notifications", "notificationInboxItem", { userId: request.userId }],
      ["discordChallenges", "discordLinkChallenge", { userId: request.userId }],
      ["discordRoleHistory", "discordRoleProjection", { userId: request.userId, status: { in: ["revoked", "external"] } }],
      ["avatarAudits", "avatarAudit", { userId: request.userId }],
      ["memberships", "workspaceMember", { userId: request.userId }],
      ["entityCommentDrafts", "entityCommentDraft", { userId: request.userId }],
      ["entityCommentReadStates", "entityCommentReadState", { userId: request.userId }],
      ["entityCommentThreadReadStates", "entityCommentThreadReadState", { userId: request.userId }],
      ["formAssignments", "studioFormAssignment", { userId: request.userId }],
      ["formReviewGrants", "studioFormReviewer", { userId: request.userId }],
      ["formDrafts", "studioFormResponseDraft", { userId: request.userId }],
      ["formReminders", "studioFormReminderDelivery", { userId: request.userId }],
    ] as const) {
      const deleted = await tx[model].deleteMany({ where }); counts[key] = deleted.count;
    }
    // Preserve review evidence but stop retaining redundant respondent identifiers
    // outside the erased account. Answer payloads remain governed by retention.
    const redactedForms = await tx.studioFormSubmission.updateMany({ where: { userId: request.userId }, data: { respondentName: "Deleted user", respondentEmail: null } });
    counts.formSubmissionIdentifiersRedacted = redactedForms.count;
    const workforceDeletions = await Promise.all([
      tx.personSkill.deleteMany({ where: { userId: request.userId } }),
      tx.studioTeamMember.deleteMany({ where: { userId: request.userId } }),
      tx.workingPattern.deleteMany({ where: { userId: request.userId } }),
      tx.workforceStatus.deleteMany({ where: { userId: request.userId } }),
      tx.employment.deleteMany({ where: { userId: request.userId } }),
    ]);
    counts.workforceAuthorities = workforceDeletions.reduce((sum: number, row: any) => sum + Number(row?.count || 0), 0);
    await tx.user.update({ where: { id: request.userId }, data: {
      username: pseudonym, passwordHash: null, pinHash: null, passwordChangedAt: null, pinUpdatedAt: null, accountState: "PRIVACY_ERASED", archived: true,
      discordUserId: null, discordUsername: null, discordDisplayName: null, discordAvatar: null, discordLinkedAt: null, discordLastVerifiedAt: null,
      employeeNumber: null, displayName: "Deleted user", email: null, avatarUrl: null, personalAccentColor: null, preferences: "{}",
      legalName: null, preferredName: null, pronouns: null, phoneNumber: null,
      alternatePhoneNumber: null, alternateEmails: "[]", addressLine1: null, addressLine2: null, city: null, stateProvince: null,
      postalCode: null, country: null, emergencyContactName: null, emergencyContactPhone: null, emergencyContactRelation: null,
      accountType: "former", accessExpiresAt: now, invitedById: null, hideLegalName: true, hideLocation: false,
      notes: null, lastSeenAt: null,
      toolPermissions: "{}", projectPermissions: "{}", failedLoginCount: 0, lastFailedLoginAt: null, lockedUntil: null,
      failedPinCount: 0, pinLockedUntil: null,
    } });
    const evidenceBody = { schemaVersion: PRIVACY_ERASURE_SCHEMA_VERSION, requestId: request.id, userId: request.userId, subjectKey, actorUserId: input.actorUserId, mode: "pseudonymize", planHash: plan.planHash, counts, fulfilledAt: now.toISOString() };
    const evidenceHash = digest(evidenceBody);
    const receipt = await tx.privacyErasureReceipt.create({ data: { requestId: request.id, userId: request.userId, subjectKey, actorUserId: input.actorUserId, mode: "pseudonymize", planHash: plan.planHash, resultJson: JSON.stringify({ counts, preserved: plan.preserved }), evidenceHash, createdAt: now } });
    await tx.privacyDataRequest.update({ where: { id: request.id }, data: { status: "fulfilled", fulfilledAt: now, fulfilledById: input.actorUserId, fulfillmentMode: "pseudonymize", fulfillmentDigest: evidenceHash } });
    return { receipt, counts };
  });
  return { ok: true as const, alreadyFulfilled: false, plan, ...result };
}
