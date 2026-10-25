-- Keep submission identity and respondent answers OUT of Project work projections.
CREATE TABLE "StudioFormProjectFollowup" (
  "id" TEXT NOT NULL,
  "submissionId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "controlRecordId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudioFormProjectFollowup_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StudioFormProjectFollowup_controlRecordId_key" ON "StudioFormProjectFollowup"("controlRecordId");
CREATE UNIQUE INDEX "StudioFormProjectFollowup_submissionId_projectId_key" ON "StudioFormProjectFollowup"("submissionId", "projectId");
CREATE INDEX "StudioFormProjectFollowup_projectId_createdAt_idx" ON "StudioFormProjectFollowup"("projectId", "createdAt");
ALTER TABLE "StudioFormProjectFollowup" ADD CONSTRAINT "StudioFormProjectFollowup_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "StudioFormSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudioFormProjectFollowup" ADD CONSTRAINT "StudioFormProjectFollowup_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
