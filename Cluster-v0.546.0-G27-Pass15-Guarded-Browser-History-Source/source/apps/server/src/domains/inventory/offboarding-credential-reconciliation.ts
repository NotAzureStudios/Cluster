// Administrator-only read model: verify access remaining after an offboarding
// case was committed. This is diagnostic, NOT an authority to issue/revoke.
export async function inspectOffboardingCredentialClosure(db: any, input: {
  subjectUserId: string; caseId: string; outcome: Record<string, any>;
}) {
  const { subjectUserId, outcome } = input;
  const registered = await db.deviceRegistration.findMany({ where: { userId: subjectUserId },
    select: { id: true }, take: 1001 });
  if (registered.length > 1000) throw Object.assign(new Error("Device review exceeds the bounded inspection scope."),
    { code: "OFFBOARDING_CREDENTIAL_REVIEW_SCOPE_EXCEEDED", statusCode: 409 });
  const [digitalSeats, keys, packageGrants, pendingInventory, pendingPackages, devicePins] = await Promise.all([
    db.studioInventoryAllocation.count({ where: { userId: subjectUserId, status: "active",
      asset: { kind: { in: ["digital", "license"] } } } }),
    db.studioInventoryKey.count({ where: { userId: subjectUserId, status: "assigned" } }),
    db.managedPackageEntitlement.count({ where: { userId: subjectUserId, revokedAt: null } }),
    db.studioInventoryAccessRequest.count({ where: { userId: subjectUserId, status: "pending" } }),
    db.managedPackageEntitlementRequest.count({ where: { userId: subjectUserId, status: "pending" } }),
    registered.length ? db.managedPackagePin.count({ where: { active: true,
      deviceId: { in: registered.map((row: { id: string }) => row.id) } } }) : Promise.resolve(0),
  ]);
  const remaining = { digitalSeats, assignedKeys: keys, packageEntitlements: packageGrants,
    pendingInventoryRequests: pendingInventory, pendingPackageRequests: pendingPackages, devicePins };
  const exposedPreviouslyRevealedKeys = Number(outcome.exposedKeysRequireExternalReview || 0);
  const legacySettlementEvidenceMissing = !Object.hasOwn(outcome, "assignedKeysRevoked")
    || !Object.hasOwn(outcome, "packageEntitlementsRevoked");
  return { remaining, residualAccessDetected: Object.values(remaining).some((v) => v > 0),
    exposedPreviouslyRevealedKeys, legacySettlementEvidenceMissing,
    providerSideKeyRotationVerified: false, secretValuesIncluded: false,
    operatorReviewRequired: Object.values(remaining).some((v) => v > 0) || exposedPreviouslyRevealedKeys > 0 || legacySettlementEvidenceMissing,
    note: "Already revealed license values cannot be recalled by Vault revocation. Review the external provider before marking key rotation complete. Physical equipment is separate custody." };
}
