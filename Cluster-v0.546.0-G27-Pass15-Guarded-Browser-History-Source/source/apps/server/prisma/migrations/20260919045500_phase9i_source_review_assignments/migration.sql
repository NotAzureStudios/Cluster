-- Phase 9I: explicit source-review audience authority.
ALTER TABLE "SourceReview" ADD COLUMN "reviewerIds" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "SourceReview" ADD COLUMN "reviewerTeamIds" TEXT NOT NULL DEFAULT '[]';
