CREATE TABLE "PrivacyConsentPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "noticeVersion" TEXT NOT NULL,
    "preferences" BOOLEAN NOT NULL DEFAULT false,
    "analytics" BOOLEAN NOT NULL DEFAULT false,
    "externalContent" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'web',
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PrivacyConsentPreference_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PrivacyConsentPreference_userId_key" ON "PrivacyConsentPreference"("userId");
CREATE INDEX "PrivacyConsentPreference_noticeVersion_updatedAt_idx" ON "PrivacyConsentPreference"("noticeVersion", "updatedAt");
ALTER TABLE "PrivacyConsentPreference" ADD CONSTRAINT "PrivacyConsentPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
