-- Version-bound private respondent recovery. Never expose drafts in reviewer submission queries.
CREATE TABLE "StudioFormResponseDraft" (
  "id" TEXT NOT NULL,
  "formId" TEXT NOT NULL,
  "formVersionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "answersJson" TEXT NOT NULL DEFAULT '{}',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudioFormResponseDraft_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StudioFormResponseDraft_formId_userId_key" ON "StudioFormResponseDraft"("formId", "userId");
CREATE INDEX "StudioFormResponseDraft_userId_updatedAt_idx" ON "StudioFormResponseDraft"("userId", "updatedAt");
ALTER TABLE "StudioFormResponseDraft" ADD CONSTRAINT "StudioFormResponseDraft_formId_fkey" FOREIGN KEY ("formId") REFERENCES "StudioForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudioFormResponseDraft" ADD CONSTRAINT "StudioFormResponseDraft_formVersionId_fkey" FOREIGN KEY ("formVersionId") REFERENCES "StudioFormVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudioFormResponseDraft" ADD CONSTRAINT "StudioFormResponseDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
