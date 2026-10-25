CREATE TABLE "LegalPolicyVersion" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "bodyMarkdown" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "effectiveAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "publishedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LegalPolicyVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LegalPolicyVersion_kind_version_key" ON "LegalPolicyVersion"("kind", "version");
CREATE INDEX "LegalPolicyVersion_kind_status_effectiveAt_idx" ON "LegalPolicyVersion"("kind", "status", "effectiveAt");
CREATE INDEX "LegalPolicyVersion_kind_publishedAt_idx" ON "LegalPolicyVersion"("kind", "publishedAt");
CREATE INDEX "LegalPolicyVersion_contentHash_idx" ON "LegalPolicyVersion"("contentHash");
