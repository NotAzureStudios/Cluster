CREATE TABLE "ThirdPartyDisclosureProvider" (
  "id" TEXT NOT NULL,
  "sourceKey" TEXT,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "dataCategoriesJson" TEXT NOT NULL DEFAULT '[]',
  "recipientRole" TEXT NOT NULL DEFAULT 'unclassified',
  "feature" TEXT,
  "consentCategory" TEXT,
  "privacyUrl" TEXT,
  "termsUrl" TEXT,
  "regionsJson" TEXT NOT NULL DEFAULT '[]',
  "retentionNote" TEXT,
  "transferNote" TEXT,
  "operatorNote" TEXT,
  "required" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'active',
  "publicVisible" BOOLEAN NOT NULL DEFAULT false,
  "reviewedAt" TIMESTAMP(3),
  "reviewedById" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ThirdPartyDisclosureProvider_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ThirdPartyDisclosureProvider_sourceKey_key" ON "ThirdPartyDisclosureProvider"("sourceKey");
CREATE INDEX "ThirdPartyDisclosureProvider_status_publicVisible_idx" ON "ThirdPartyDisclosureProvider"("status", "publicVisible");
CREATE INDEX "ThirdPartyDisclosureProvider_category_idx" ON "ThirdPartyDisclosureProvider"("category");
CREATE INDEX "ThirdPartyDisclosureProvider_reviewedAt_idx" ON "ThirdPartyDisclosureProvider"("reviewedAt");
