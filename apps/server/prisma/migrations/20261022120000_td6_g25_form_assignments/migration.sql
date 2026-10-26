-- Person-specific Form obligations; audience authorization remains authoritative.
CREATE TABLE "StudioFormAssignment" (
  "id" TEXT NOT NULL,
  "formId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "assignedById" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "required" BOOLEAN NOT NULL DEFAULT TRUE,
  "dueAt" TIMESTAMP(3),
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudioFormAssignment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StudioFormAssignment_formId_userId_key" ON "StudioFormAssignment"("formId", "userId");
CREATE INDEX "StudioFormAssignment_userId_status_dueAt_idx" ON "StudioFormAssignment"("userId", "status", "dueAt");
CREATE INDEX "StudioFormAssignment_formId_status_idx" ON "StudioFormAssignment"("formId", "status");
ALTER TABLE "StudioFormAssignment" ADD CONSTRAINT "StudioFormAssignment_formId_fkey" FOREIGN KEY ("formId") REFERENCES "StudioForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudioFormAssignment" ADD CONSTRAINT "StudioFormAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
