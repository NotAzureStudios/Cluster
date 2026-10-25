ALTER TABLE "SourceBranchPolicy"
  ADD COLUMN "requiredApprovals" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "requireQa" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "requireBuild" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "SourceReview" (
  "id" TEXT NOT NULL,
  "repositoryId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "workingCopyId" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "sourceBranch" TEXT NOT NULL,
  "targetBranch" TEXT NOT NULL,
  "sourceRevision" TEXT NOT NULL,
  "targetRevision" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'open',
  "eligibilityState" TEXT NOT NULL DEFAULT 'checking',
  "eligibilityMessage" TEXT,
  "changeSummary" TEXT NOT NULL DEFAULT '{}',
  "linkedWork" TEXT NOT NULL DEFAULT '[]',
  "createdById" TEXT,
  "mergedById" TEXT,
  "mergedRevision" TEXT,
  "mergedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SourceReview_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SourceReviewDecision" (
  "id" TEXT NOT NULL,
  "reviewId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "comment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SourceReviewDecision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SourceReview_projectId_status_updatedAt_idx" ON "SourceReview"("projectId", "status", "updatedAt");
CREATE INDEX "SourceReview_repositoryId_sourceBranch_targetBranch_updatedAt_idx" ON "SourceReview"("repositoryId", "sourceBranch", "targetBranch", "updatedAt");
CREATE INDEX "SourceReview_workingCopyId_status_idx" ON "SourceReview"("workingCopyId", "status");
CREATE UNIQUE INDEX "SourceReviewDecision_reviewId_userId_key" ON "SourceReviewDecision"("reviewId", "userId");
CREATE INDEX "SourceReviewDecision_reviewId_decision_updatedAt_idx" ON "SourceReviewDecision"("reviewId", "decision", "updatedAt");
CREATE INDEX "SourceReviewDecision_userId_updatedAt_idx" ON "SourceReviewDecision"("userId", "updatedAt");

ALTER TABLE "SourceReview" ADD CONSTRAINT "SourceReview_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "SourceRepository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SourceReview" ADD CONSTRAINT "SourceReview_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SourceReview" ADD CONSTRAINT "SourceReview_workingCopyId_fkey" FOREIGN KEY ("workingCopyId") REFERENCES "SourceWorkingCopy"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SourceReviewDecision" ADD CONSTRAINT "SourceReviewDecision_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "SourceReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;
