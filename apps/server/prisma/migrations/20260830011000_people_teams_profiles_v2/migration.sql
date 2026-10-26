-- Block K1: People, Teams & Profiles 2.0
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "expertise" TEXT NOT NULL DEFAULT '[]';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "workingHours" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "customProfileFields" TEXT NOT NULL DEFAULT '{}';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "profileRevision" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "managerUserId" TEXT;

CREATE TABLE IF NOT EXISTS "StudioTeam" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "department" TEXT,
  "leadUserId" TEXT,
  "color" TEXT,
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudioTeam_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "StudioTeamMember" (
  "id" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "roleLabel" TEXT,
  "allocationPercent" INTEGER NOT NULL DEFAULT 100,
  "primaryMembership" BOOLEAN NOT NULL DEFAULT false,
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StudioTeamMember_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "StudioTeam_workspaceId_name_key" ON "StudioTeam"("workspaceId", "name");
CREATE INDEX IF NOT EXISTS "StudioTeam_workspaceId_archived_updatedAt_idx" ON "StudioTeam"("workspaceId", "archived", "updatedAt");
CREATE INDEX IF NOT EXISTS "StudioTeam_leadUserId_archived_idx" ON "StudioTeam"("leadUserId", "archived");
CREATE UNIQUE INDEX IF NOT EXISTS "StudioTeamMember_teamId_userId_key" ON "StudioTeamMember"("teamId", "userId");
CREATE INDEX IF NOT EXISTS "StudioTeamMember_userId_archived_primaryMembership_idx" ON "StudioTeamMember"("userId", "archived", "primaryMembership");
CREATE INDEX IF NOT EXISTS "StudioTeamMember_teamId_archived_idx" ON "StudioTeamMember"("teamId", "archived");
CREATE INDEX IF NOT EXISTS "User_managerUserId_archived_idx" ON "User"("managerUserId", "archived");
DO $$ BEGIN
  ALTER TABLE "User" ADD CONSTRAINT "User_managerUserId_fkey" FOREIGN KEY ("managerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "StudioTeam" ADD CONSTRAINT "StudioTeam_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "StudioTeam" ADD CONSTRAINT "StudioTeam_leadUserId_fkey" FOREIGN KEY ("leadUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "StudioTeamMember" ADD CONSTRAINT "StudioTeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "StudioTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "StudioTeamMember" ADD CONSTRAINT "StudioTeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
