-- Phase 10 RC16: ProjectMembership is the sole project-team authority.
ALTER TABLE "Project" DROP COLUMN IF EXISTS "assignedUserIds";
ALTER TABLE "Project" DROP COLUMN IF EXISTS "teamRoles";
