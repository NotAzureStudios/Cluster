// G26 Batch H. One atomic offboarding disposition, not another grant authority.
// Caller holds the subject User FOR UPDATE in the same transaction. All
// entitlement issuers must hold that same lock before reading eligibility.
// Never select ciphertext, return Vault IDs, or treat revocation of a revealed
// commercial key as provider-side revocation/rotation.
export const OFFBOARDING_KEY_SCOPE_LIMIT = 1000;

export async function settleOffboardingCredentials(tx: any, input: {
  subjectUserId: string; caseId: string; actorId: string | null; now: Date;
}) {
  const { subjectUserId, caseId, actorId, now } = input;
  const assigned = await tx.studioInventoryKey.findMany({
    where: { userId: subjectUserId, status: "assigned" },
    select: { id: true, vaultSecretId: true, firstRevealedAt: true },
    orderBy: { id: "asc" }, take: OFFBOARDING_KEY_SCOPE_LIMIT + 1,
  });
  if (assigned.length > OFFBOARDING_KEY_SCOPE_LIMIT) {
    throw Object.assign(new Error("Too many assigned keys for an atomic settlement; review custody before offboarding."),
      { code: "OFFBOARDING_KEY_SCOPE_EXCEEDED", statusCode: 409 });
  }
  // Bound both review queues BEFORE mutations; a partial review-task cleanup
  // is not allowed to disguise an incomplete offboarding.
  const [pendingInventory, pendingPackages] = await Promise.all([
    tx.studioInventoryAccessRequest.findMany({ where: { userId: subjectUserId, status: "pending" },
      select: { id: true }, take: 1001 }),
    tx.managedPackageEntitlementRequest.findMany({ where: { userId: subjectUserId, status: "pending" },
      select: { id: true }, take: 1001 }),
  ]);
  if (pendingInventory.length > 1000 || pendingPackages.length > 1000) {
    throw Object.assign(new Error("Too many pending credential reviews for atomic cancellation."),
      { code: "OFFBOARDING_PENDING_REVIEW_SCOPE_EXCEEDED", statusCode: 409 });
  }
  const exposedKeysRequireExternalReview = assigned.filter((key: any) => Boolean(key.firstRevealedAt)).length;
  const ids = assigned.map((key: any) => key.id);
  let assignedKeysRevoked = 0;
  let keyVaultSecretsRevoked = 0;
  if (ids.length) {
    const changed = await tx.studioInventoryKey.updateMany({
      where: { id: { in: ids }, userId: subjectUserId, status: "assigned" },
      data: { status: "revoked", closedAt: now, closedById: actorId,
        closedReason: `Offboarding case ${caseId}: key access revoked`, revision: { increment: 1 } },
    });
    if (changed.count !== ids.length) throw Object.assign(new Error("Assigned key custody changed during offboarding."),
      { code: "OFFBOARDING_KEY_CUSTODY_STALE", statusCode: 409 });
    assignedKeysRevoked = changed.count;
    // A key secret cannot be shared by two key records (schema unique). Its
    // Vault access is revoked even if a previous reveal cannot be un-disclosed.
    const stopped = await tx.studioVaultSecret.updateMany({
      where: { id: { in: assigned.map((key: any) => key.vaultSecretId) }, revokedAt: null },
      data: { revokedAt: now, revision: { increment: 1 } },
    });
    keyVaultSecretsRevoked = stopped.count;
  }
  const packages = await tx.managedPackageEntitlement.updateMany({
    where: { userId: subjectUserId, revokedAt: null },
    data: { revokedAt: now, revokedById: actorId, revokedReason: `Offboarding case ${caseId}`,
      revision: { increment: 1 } },
  });
  const inventoryPending = await tx.studioInventoryAccessRequest.updateMany({
    where: { userId: subjectUserId, status: "pending" },
    data: { status: "cancelled", reviewedById: actorId, reviewedAt: now,
      reviewReason: `Cancelled by offboarding case ${caseId}` },
  });
  const packagePending = await tx.managedPackageEntitlementRequest.updateMany({
    where: { userId: subjectUserId, status: "pending" },
    data: { status: "cancelled", reviewedById: actorId, reviewedAt: now,
      reviewReason: `Cancelled by offboarding case ${caseId}` },
  });
  // Remove stale review tasks at the same time as closing the requests.
  // These are projections, not an alternate access-control authority.
  if (inventoryPending.count || packagePending.count) {
    if (inventoryPending.count !== pendingInventory.length || packagePending.count !== pendingPackages.length) {
      throw Object.assign(new Error("Pending credential reviews changed during offboarding."),
        { code: "OFFBOARDING_PENDING_REVIEW_STALE", statusCode: 409 });
    }
    const groupKeys = [
      ...pendingInventory.map((row: any) => `inventory-approval:${row.id}`),
      ...pendingPackages.map((row: any) => `package-entitlement:${row.id}`),
    ];
    if (groupKeys.length) await tx.notificationInboxItem.updateMany({
      where: { groupKey: { in: groupKeys }, requiresAction: true },
      data: { requiresAction: false, dismissedAt: now },
    });
  }
  if (exposedKeysRequireExternalReview) {
    // A People manager may execute offboarding without retaining administrator
    // Inbox visibility. Route rotation obligations to CURRENT studio admins,
    // not solely to the initiating actor or the now-disabled recipient.
    const roster = await tx.workspaceMember.findMany({
      where: { role: { in: ["owner", "admin"] }, user: { archived: false,
        accountState: "ACTIVE", OR: [{ accessExpiresAt: null }, { accessExpiresAt: { gt: now } }] } },
      select: { userId: true }, take: 501,
    });
    if (roster.length > 500) throw Object.assign(new Error("Administrator reminder audience is too large to verify."),
      { code: "OFFBOARDING_ROTATION_REVIEWER_SCOPE_EXCEEDED", statusCode: 409 });
    const administrators = [...new Set(roster.map((row: { userId: string }) => row.userId))]
      .filter((id) => id !== subjectUserId);
    if (!administrators.length) throw Object.assign(new Error("A separate active administrator is needed to review previously revealed keys."),
      { code: "OFFBOARDING_ROTATION_REVIEWER_REQUIRED", statusCode: 409 });
    await tx.notificationInboxItem.createMany({ data: administrators.map((userId) => ({
      userId, category: "action", priority: "high", requiresAction: true,
      title: "Offboarding: review previously revealed license keys",
      message: `${exposedKeysRequireExternalReview} previously revealed key(s) require a provider-side rotation/revocation review. Vault access has been blocked; external use cannot be recalled.`,
      entityType: "studio_offboarding", entityId: caseId,
      groupKey: `offboarding-key-rotation:${caseId}`, tool: "inventory",
      signal: "offboarding_key_rotation_review",
    })) });
  }
  return {
    assignedKeysRevoked, keyVaultSecretsRevoked,
    exposedKeysRequireExternalReview,
    packageEntitlementsRevoked: packages.count,
    pendingInventoryRequestsCancelled: inventoryPending.count,
    pendingPackageRequestsCancelled: packagePending.count,
    externalProviderRevocationVerified: false,
    standaloneVaultCredentialsAutomaticallyRotated: false,
  };
}
