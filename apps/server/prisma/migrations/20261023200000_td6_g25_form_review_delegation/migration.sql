-- Scoped review grants are separate from respondent assignments and settings rights.
CREATE TABLE "StudioFormReviewer" (
  "id" TEXT NOT NULL,
  "formId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'active',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudioFormReviewer_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StudioFormReviewer_formId_userId_key" ON "StudioFormReviewer"("formId", "userId");
CREATE INDEX "StudioFormReviewer_userId_status_idx" ON "StudioFormReviewer"("userId", "status");
CREATE INDEX "StudioFormReviewer_formId_status_idx" ON "StudioFormReviewer"("formId", "status");
ALTER TABLE "StudioFormReviewer" ADD CONSTRAINT "StudioFormReviewer_formId_fkey" FOREIGN KEY ("formId") REFERENCES "StudioForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudioFormReviewer" ADD CONSTRAINT "StudioFormReviewer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
