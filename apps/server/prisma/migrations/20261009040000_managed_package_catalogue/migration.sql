CREATE TABLE "ManagedPackageSigningKey" (
  "fingerprint" TEXT NOT NULL PRIMARY KEY, "label" TEXT NOT NULL, "publicKeyPem" TEXT NOT NULL,
  "disabledAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "ManagedPackage" (
  "id" TEXT NOT NULL PRIMARY KEY, "key" TEXT NOT NULL, "title" TEXT NOT NULL, "description" TEXT NOT NULL DEFAULT '',
  "createdById" TEXT, "archivedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "ManagedPackage_key_key" ON "ManagedPackage"("key");
CREATE TABLE "ManagedPackageRelease" (
  "id" TEXT NOT NULL PRIMARY KEY, "packageId" TEXT NOT NULL, "version" TEXT NOT NULL,
  "platform" TEXT NOT NULL, "filename" TEXT NOT NULL, "manifestJson" TEXT NOT NULL,
  "manifestSha256" TEXT NOT NULL, "signingKeyFingerprint" TEXT NOT NULL, "signature" TEXT NOT NULL,
  "artifactSha256" TEXT NOT NULL, "artifactSize" INTEGER NOT NULL, "artifact" BYTEA NOT NULL,
  "publishedById" TEXT, "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3), "revocationReason" TEXT,
  CONSTRAINT "ManagedPackageRelease_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "ManagedPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ManagedPackageRelease_packageId_version_platform_key" ON "ManagedPackageRelease"("packageId", "version", "platform");
CREATE INDEX "ManagedPackageRelease_packageId_publishedAt_idx" ON "ManagedPackageRelease"("packageId", "publishedAt");
CREATE TABLE "ManagedPackageRollout" (
  "id" TEXT NOT NULL PRIMARY KEY, "packageId" TEXT NOT NULL, "channel" TEXT NOT NULL,
  "releaseId" TEXT NOT NULL, "state" TEXT NOT NULL DEFAULT 'paused', "percentage" INTEGER NOT NULL DEFAULT 0,
  "revision" INTEGER NOT NULL DEFAULT 1, "changedById" TEXT, "changedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ManagedPackageRollout_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "ManagedPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ManagedPackageRollout_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "ManagedPackageRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ManagedPackageRollout_packageId_channel_key" ON "ManagedPackageRollout"("packageId", "channel");
CREATE TABLE "ManagedPackagePin" (
  "id" TEXT NOT NULL PRIMARY KEY, "packageId" TEXT NOT NULL, "deviceId" TEXT NOT NULL,
  "releaseId" TEXT NOT NULL, "reason" TEXT NOT NULL, "changedById" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true, "revision" INTEGER NOT NULL DEFAULT 1, "changedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ManagedPackagePin_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "ManagedPackage"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ManagedPackagePin_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "ManagedPackageRelease"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ManagedPackagePin_packageId_deviceId_key" ON "ManagedPackagePin"("packageId", "deviceId");

CREATE TABLE "ManagedPackageAuditEvent" (
  "id" TEXT NOT NULL PRIMARY KEY, "packageId" TEXT, "actorId" TEXT, "action" TEXT NOT NULL,
  "subjectId" TEXT NOT NULL, "detailsJson" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ManagedPackageAuditEvent_packageId_createdAt_idx" ON "ManagedPackageAuditEvent"("packageId", "createdAt");
