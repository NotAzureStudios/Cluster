-- F11: distinct Package recipient authority; no entitlement is inferred from rollouts/pins.
CREATE TABLE "ManagedPackageEntitlement" (
  "id" TEXT NOT NULL, "packageId" TEXT NOT NULL, "userId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL, "revokedAt" TIMESTAMP(3),
  "revokedById" TEXT, "revokedReason" TEXT,
  "approvedById" TEXT NOT NULL, "approvedRequestId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ManagedPackageEntitlement_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ManagedPackageEntitlement_packageId_userId_key" ON "ManagedPackageEntitlement"("packageId", "userId");
CREATE INDEX "ManagedPackageEntitlement_userId_revokedAt_expiresAt_idx" ON "ManagedPackageEntitlement"("userId", "revokedAt", "expiresAt");
CREATE INDEX "ManagedPackageEntitlement_packageId_revokedAt_expiresAt_idx" ON "ManagedPackageEntitlement"("packageId", "revokedAt", "expiresAt");
CREATE TABLE "ManagedPackageEntitlementRequest" (
  "id" TEXT NOT NULL, "packageId" TEXT NOT NULL, "userId" TEXT NOT NULL,
  "action" TEXT NOT NULL, "requestedById" TEXT NOT NULL, "reviewedById" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL, "expectedRevision" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending', "reason" TEXT NOT NULL,
  "reviewReason" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  CONSTRAINT "ManagedPackageEntitlementRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ManagedPackageEntitlementRequest_packageId_status_createdAt_idx" ON "ManagedPackageEntitlementRequest"("packageId", "status", "createdAt");
CREATE INDEX "ManagedPackageEntitlementRequest_userId_status_idx" ON "ManagedPackageEntitlementRequest"("userId", "status");
-- One pending request per package and recipient; all new requests serialize via package row lock.
CREATE UNIQUE INDEX "ManagedPackageEntitlementRequest_pending_subject_unique" ON "ManagedPackageEntitlementRequest"("packageId", "userId") WHERE "status" = 'pending';
