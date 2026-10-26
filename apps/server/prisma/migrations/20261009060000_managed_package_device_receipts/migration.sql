CREATE TABLE "ManagedPackageDeviceDeployment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "packageId" TEXT NOT NULL,
  "releaseId" TEXT NOT NULL,
  "deviceRegistrationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'offered',
  "revision" INTEGER NOT NULL DEFAULT 0,
  "challengeHash" TEXT NOT NULL,
  "challengeExpiresAt" TIMESTAMP(3) NOT NULL,
  "artifactSha256" TEXT NOT NULL,
  "offeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastReportedAt" TIMESTAMP(3)
);
CREATE INDEX "ManagedPackageDeviceDeployment_deviceRegistrationId_offeredAt_idx" ON "ManagedPackageDeviceDeployment"("deviceRegistrationId", "offeredAt");
CREATE INDEX "ManagedPackageDeviceDeployment_packageId_offeredAt_idx" ON "ManagedPackageDeviceDeployment"("packageId", "offeredAt");
CREATE INDEX "ManagedPackageDeviceDeployment_releaseId_offeredAt_idx" ON "ManagedPackageDeviceDeployment"("releaseId", "offeredAt");
CREATE TABLE "ManagedPackageDeviceReceipt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "deploymentId" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "state" TEXT NOT NULL,
  "reportedArtifactSha256" TEXT NOT NULL,
  "detail" TEXT NOT NULL DEFAULT '',
  "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ManagedPackageDeviceReceipt_deploymentId_fkey" FOREIGN KEY ("deploymentId") REFERENCES "ManagedPackageDeviceDeployment"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ManagedPackageDeviceReceipt_deploymentId_eventId_key" ON "ManagedPackageDeviceReceipt"("deploymentId", "eventId");
CREATE UNIQUE INDEX "ManagedPackageDeviceReceipt_deploymentId_sequence_key" ON "ManagedPackageDeviceReceipt"("deploymentId", "sequence");
CREATE INDEX "ManagedPackageDeviceReceipt_deploymentId_reportedAt_idx" ON "ManagedPackageDeviceReceipt"("deploymentId", "reportedAt");
