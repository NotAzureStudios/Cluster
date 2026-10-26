-- Studio domain governance: attach binding to an actual server installation,
-- not an arbitrary operator label. Registrar data is operator-reported only.
ALTER TABLE "StudioManagedDomain"
  ADD COLUMN "registrar" TEXT,
  ADD COLUMN "expiresOn" TIMESTAMP(3),
  ADD COLUMN "bindingServerInstanceId" TEXT,
  ADD COLUMN "bindingDnsType" TEXT,
  ADD COLUMN "bindingDnsTarget" TEXT;
CREATE INDEX "StudioManagedDomain_bindingServerInstanceId_idx" ON "StudioManagedDomain"("bindingServerInstanceId");
CREATE INDEX "StudioManagedDomain_expiresOn_idx" ON "StudioManagedDomain"("expiresOn");
-- Free-form server labels are display-only and no longer define binding identity.
DROP INDEX IF EXISTS "StudioManagedDomain_bindingServerLabel_idx";
