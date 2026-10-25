CREATE TABLE "StudioManagedDomain" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "note" TEXT,
    "verificationToken" TEXT NOT NULL,
    "verificationState" TEXT NOT NULL DEFAULT 'pending',
    "verifiedAt" TIMESTAMP(3),
    "bindingHostname" TEXT,
    "bindingServerLabel" TEXT,
    "bindingNote" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StudioManagedDomain_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StudioManagedDomain_domain_key" ON "StudioManagedDomain"("domain");
CREATE INDEX "StudioManagedDomain_verificationState_idx" ON "StudioManagedDomain"("verificationState");
CREATE INDEX "StudioManagedDomain_bindingServerLabel_idx" ON "StudioManagedDomain"("bindingServerLabel");

CREATE UNIQUE INDEX "StudioManagedDomain_bindingHostname_key" ON "StudioManagedDomain"("bindingHostname");
