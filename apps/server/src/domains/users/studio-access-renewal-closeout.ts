/** Settles pending two-person access reviews in the same transaction as
 * offboarding. Old pending approvals must never survive account shutdown. */
export async function closePendingAccessRenewals(tx: any, input: { userId: string; actorId: string | null; now: Date }) {
  const pending = await tx.studioAccessRenewal.findMany({
    where: { subjectUserId: input.userId, status: "pending" },
    select: { id: true }, take: 1001,
  });
  if (pending.length > 1000) throw Object.assign(new Error("Too many pending access reviews to close safely."), {
    code: "OFFBOARDING_RENEWAL_REVIEW_LIMIT", statusCode: 409,
  });
  if (!pending.length) {
    await resolveAccessExpiryActions(tx, input.userId, input.now);
    return { count: 0 };
  }
  const closed = await tx.studioAccessRenewal.updateMany({
    where: { subjectUserId: input.userId, status: "pending", id: { in: pending.map((r: any) => r.id) } },
    data: { status: "cancelled", reviewedAt: input.now, reviewedById: input.actorId,
      reviewReason: "Cancelled automatically when offboarding completed" },
  });
  if (closed.count !== pending.length) throw Object.assign(new Error("Access renewal reviews changed during offboarding."), {
    code: "OFFBOARDING_RENEWAL_STALE", statusCode: 409,
  });
  await tx.notificationInboxItem.updateMany({
    where: { groupKey: { in: pending.map((r: any) => `access-renewal:${r.id}`) }, requiresAction: true },
    data: { requiresAction: false, acknowledgedAt: input.now, readAt: input.now },
  });
  await resolveAccessExpiryActions(tx, input.userId, input.now);
  return closed;
}

/** Previously issued expiry actions are obsolete after approved extension or
 * completed offboarding. Resolve them without hiding audit/notice history. */
export async function resolveAccessExpiryActions(tx: any, userId: string, now: Date) {
  return tx.notificationInboxItem.updateMany({
    where: { resourceKind: "user", resourceId: userId, signal: "access_expiration", requiresAction: true },
    data: { requiresAction: false, acknowledgedAt: now, readAt: now },
  });
}
