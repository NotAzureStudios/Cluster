-- Phase 9G: normalize organization, employment, workforce state, skills, team roles and project membership.
CREATE OR REPLACE FUNCTION cluster_try_jsonb(value TEXT) RETURNS JSONB AS $$
BEGIN
  RETURN value::jsonb;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE TABLE "Department" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "parentId" TEXT,
  "leadUserId" TEXT,
  "color" TEXT,
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Department_workspaceId_name_key" ON "Department"("workspaceId", "name");
CREATE INDEX "Department_workspaceId_archived_name_idx" ON "Department"("workspaceId", "archived", "name");
CREATE INDEX "Department_parentId_archived_idx" ON "Department"("parentId", "archived");
CREATE INDEX "Department_leadUserId_archived_idx" ON "Department"("leadUserId", "archived");
ALTER TABLE "Department" ADD CONSTRAINT "Department_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Department" ADD CONSTRAINT "Department_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Department" ADD CONSTRAINT "Department_leadUserId_fkey" FOREIGN KEY ("leadUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "JobRole" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "departmentId" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "defaultCapacityHours" INTEGER,
  "defaultMinimumHours" INTEGER,
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "JobRole_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "JobRole_workspaceId_name_key" ON "JobRole"("workspaceId", "name");
CREATE INDEX "JobRole_workspaceId_archived_name_idx" ON "JobRole"("workspaceId", "archived", "name");
CREATE INDEX "JobRole_departmentId_archived_idx" ON "JobRole"("departmentId", "archived");
ALTER TABLE "JobRole" ADD CONSTRAINT "JobRole_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "JobRole" ADD CONSTRAINT "JobRole_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "Employment" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "departmentId" TEXT,
  "jobRoleId" TEXT,
  "managerUserId" TEXT,
  "employmentType" TEXT,
  "workLocation" TEXT,
  "startDate" TIMESTAMP(3),
  "endDate" TIMESTAMP(3),
  "capacityHours" INTEGER,
  "minimumHours" INTEGER,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Employment_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Employment_userId_key" ON "Employment"("userId");
CREATE INDEX "Employment_workspaceId_active_updatedAt_idx" ON "Employment"("workspaceId", "active", "updatedAt");
CREATE INDEX "Employment_departmentId_active_idx" ON "Employment"("departmentId", "active");
CREATE INDEX "Employment_jobRoleId_active_idx" ON "Employment"("jobRoleId", "active");
CREATE INDEX "Employment_managerUserId_active_idx" ON "Employment"("managerUserId", "active");
ALTER TABLE "Employment" ADD CONSTRAINT "Employment_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Employment" ADD CONSTRAINT "Employment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Employment" ADD CONSTRAINT "Employment_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Employment" ADD CONSTRAINT "Employment_jobRoleId_fkey" FOREIGN KEY ("jobRoleId") REFERENCES "JobRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Employment" ADD CONSTRAINT "Employment_managerUserId_fkey" FOREIGN KEY ("managerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "Skill" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Skill_workspaceId_name_key" ON "Skill"("workspaceId", "name");
CREATE INDEX "Skill_workspaceId_archived_name_idx" ON "Skill"("workspaceId", "archived", "name");
ALTER TABLE "Skill" ADD CONSTRAINT "Skill_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PersonSkill" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "skillId" TEXT NOT NULL,
  "level" TEXT NOT NULL DEFAULT 'working',
  "years" DOUBLE PRECISION,
  "primary" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PersonSkill_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PersonSkill_userId_skillId_key" ON "PersonSkill"("userId", "skillId");
CREATE INDEX "PersonSkill_skillId_level_idx" ON "PersonSkill"("skillId", "level");
CREATE INDEX "PersonSkill_userId_primary_idx" ON "PersonSkill"("userId", "primary");
ALTER TABLE "PersonSkill" ADD CONSTRAINT "PersonSkill_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PersonSkill" ADD CONSTRAINT "PersonSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "WorkingPattern" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "timezone" TEXT,
  "hoursJson" TEXT NOT NULL DEFAULT '{}',
  "capacityHours" INTEGER,
  "minimumHours" INTEGER,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkingPattern_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WorkingPattern_userId_key" ON "WorkingPattern"("userId");
ALTER TABLE "WorkingPattern" ADD CONSTRAINT "WorkingPattern_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "WorkforceStatus" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "availability" TEXT NOT NULL DEFAULT 'available',
  "availabilityMessage" TEXT,
  "connectionVisibility" TEXT NOT NULL DEFAULT 'visible',
  "focusState" TEXT,
  "updatedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkforceStatus_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WorkforceStatus_userId_key" ON "WorkforceStatus"("userId");
CREATE INDEX "WorkforceStatus_availability_updatedAt_idx" ON "WorkforceStatus"("availability", "updatedAt");
CREATE INDEX "WorkforceStatus_connectionVisibility_updatedAt_idx" ON "WorkforceStatus"("connectionVisibility", "updatedAt");
ALTER TABLE "WorkforceStatus" ADD CONSTRAINT "WorkforceStatus_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "AvailabilityException" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'unavailable',
  "status" TEXT NOT NULL DEFAULT 'confirmed',
  "reason" TEXT,
  "source" TEXT NOT NULL DEFAULT 'manual',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AvailabilityException_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AvailabilityException_userId_startsAt_endsAt_idx" ON "AvailabilityException"("userId", "startsAt", "endsAt");
CREATE INDEX "AvailabilityException_status_startsAt_idx" ON "AvailabilityException"("status", "startsAt");
ALTER TABLE "AvailabilityException" ADD CONSTRAINT "AvailabilityException_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "TeamRole" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "createdById" TEXT,
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TeamRole_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TeamRole_teamId_name_key" ON "TeamRole"("teamId", "name");
CREATE INDEX "TeamRole_workspaceId_archived_name_idx" ON "TeamRole"("workspaceId", "archived", "name");
ALTER TABLE "TeamRole" ADD CONSTRAINT "TeamRole_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamRole" ADD CONSTRAINT "TeamRole_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "StudioTeam"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TeamRole" ADD CONSTRAINT "TeamRole_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "StudioTeam" ADD COLUMN "departmentId" TEXT;
ALTER TABLE "StudioTeamMember" ADD COLUMN "teamRoleId" TEXT;
ALTER TABLE "StudioTeam" ADD CONSTRAINT "StudioTeam_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StudioTeamMember" ADD CONSTRAINT "StudioTeamMember_teamRoleId_fkey" FOREIGN KEY ("teamRoleId") REFERENCES "TeamRole"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "StudioTeam_departmentId_archived_idx" ON "StudioTeam"("departmentId", "archived");
CREATE INDEX "StudioTeamMember_teamRoleId_archived_idx" ON "StudioTeamMember"("teamRoleId", "archived");

CREATE TABLE "ProjectMembership" (
  "id" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "roleKey" TEXT,
  "roleLabel" TEXT,
  "allocationPercent" INTEGER NOT NULL DEFAULT 100,
  "accessLevel" TEXT NOT NULL DEFAULT 'contribute',
  "isLead" BOOLEAN NOT NULL DEFAULT false,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProjectMembership_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProjectMembership_projectId_userId_key" ON "ProjectMembership"("projectId", "userId");
CREATE INDEX "ProjectMembership_userId_status_updatedAt_idx" ON "ProjectMembership"("userId", "status", "updatedAt");
CREATE INDEX "ProjectMembership_projectId_status_isLead_idx" ON "ProjectMembership"("projectId", "status", "isLead");
ALTER TABLE "ProjectMembership" ADD CONSTRAINT "ProjectMembership_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectMembership" ADD CONSTRAINT "ProjectMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Pick a deterministic workspace for legacy single-studio profile fields.
WITH membership AS (
  SELECT DISTINCT ON ("userId") "userId", "workspaceId" FROM "WorkspaceMember" ORDER BY "userId", "workspaceId"
), departments AS (
  SELECT DISTINCT m."workspaceId", trim(u."department") AS name
  FROM "User" u JOIN membership m ON m."userId" = u."id"
  WHERE nullif(trim(coalesce(u."department", '')), '') IS NOT NULL
)
INSERT INTO "Department" ("id", "workspaceId", "name")
SELECT 'dept_' || md5("workspaceId" || ':' || lower(name)), "workspaceId", name FROM departments
ON CONFLICT ("workspaceId", "name") DO NOTHING;

WITH membership AS (
  SELECT DISTINCT ON ("userId") "userId", "workspaceId" FROM "WorkspaceMember" ORDER BY "userId", "workspaceId"
), roles AS (
  SELECT DISTINCT m."workspaceId", trim(u."title") AS name
  FROM "User" u JOIN membership m ON m."userId" = u."id"
  WHERE nullif(trim(coalesce(u."title", '')), '') IS NOT NULL
)
INSERT INTO "JobRole" ("id", "workspaceId", "name")
SELECT 'role_' || md5("workspaceId" || ':' || lower(name)), "workspaceId", name FROM roles
ON CONFLICT ("workspaceId", "name") DO NOTHING;

WITH membership AS (
  SELECT DISTINCT ON ("userId") "userId", "workspaceId" FROM "WorkspaceMember" ORDER BY "userId", "workspaceId"
)
INSERT INTO "Employment" ("id", "workspaceId", "userId", "departmentId", "jobRoleId", "managerUserId", "employmentType", "workLocation", "startDate", "capacityHours", "minimumHours", "active")
SELECT 'emp_' || md5(u."id"), m."workspaceId", u."id", d."id", r."id", u."managerUserId", u."employmentType", u."workLocation", u."startDate", u."capacityHours", u."minimumHours", NOT u."archived"
FROM "User" u
JOIN membership m ON m."userId" = u."id"
LEFT JOIN "Department" d ON d."workspaceId" = m."workspaceId" AND lower(d."name") = lower(trim(coalesce(u."department", '')))
LEFT JOIN "JobRole" r ON r."workspaceId" = m."workspaceId" AND lower(r."name") = lower(trim(coalesce(u."title", '')))
ON CONFLICT ("userId") DO NOTHING;

INSERT INTO "WorkingPattern" ("id", "userId", "timezone", "hoursJson", "capacityHours", "minimumHours")
SELECT 'wp_' || md5("id"), "id", "timezone", COALESCE(NULLIF("workingHours", ''), '{}'), "capacityHours", "minimumHours" FROM "User"
ON CONFLICT ("userId") DO NOTHING;

INSERT INTO "WorkforceStatus" ("id", "userId", "availability", "availabilityMessage", "connectionVisibility", "updatedByUserId")
SELECT 'ws_' || md5("id"), "id",
  CASE WHEN lower(coalesce("status", '')) IN ('available','busy','away','focus','do_not_disturb') THEN lower("status") ELSE 'available' END,
  "statusMessage",
  CASE WHEN lower(coalesce("status", '')) = 'invisible' THEN 'invisible' ELSE 'visible' END,
  "id"
FROM "User"
ON CONFLICT ("userId") DO NOTHING;

-- Normalize existing expertise arrays when they are valid JSON; malformed legacy data is ignored rather than blocking migration.
WITH membership AS (
  SELECT DISTINCT ON ("userId") "userId", "workspaceId" FROM "WorkspaceMember" ORDER BY "userId", "workspaceId"
), expertise AS (
  SELECT u."id" AS "userId", m."workspaceId", value
  FROM "User" u JOIN membership m ON m."userId" = u."id"
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(cluster_try_jsonb(u."expertise")) = 'array' THEN cluster_try_jsonb(u."expertise") ELSE '[]'::jsonb END) value
), named AS (
  SELECT "workspaceId", trim(CASE WHEN jsonb_typeof(value) = 'string' THEN value #>> '{}' ELSE value->>'name' END) AS name
  FROM expertise
)
INSERT INTO "Skill" ("id", "workspaceId", "name")
SELECT 'skill_' || md5("workspaceId" || ':' || lower(name)), "workspaceId", name FROM named WHERE nullif(name, '') IS NOT NULL
ON CONFLICT ("workspaceId", "name") DO NOTHING;

WITH membership AS (
  SELECT DISTINCT ON ("userId") "userId", "workspaceId" FROM "WorkspaceMember" ORDER BY "userId", "workspaceId"
), expertise AS (
  SELECT u."id" AS "userId", m."workspaceId", value
  FROM "User" u JOIN membership m ON m."userId" = u."id"
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(cluster_try_jsonb(u."expertise")) = 'array' THEN cluster_try_jsonb(u."expertise") ELSE '[]'::jsonb END) value
), normalized AS (
  SELECT "userId", "workspaceId",
    trim(CASE WHEN jsonb_typeof(value) = 'string' THEN value #>> '{}' ELSE value->>'name' END) AS name,
    COALESCE(NULLIF(value->>'level',''), 'working') AS level
  FROM expertise
)
INSERT INTO "PersonSkill" ("id", "userId", "skillId", "level")
SELECT 'ps_' || md5(n."userId" || ':' || s."id"), n."userId", s."id", n.level
FROM normalized n JOIN "Skill" s ON s."workspaceId" = n."workspaceId" AND lower(s."name") = lower(n.name)
WHERE nullif(n.name, '') IS NOT NULL
ON CONFLICT ("userId", "skillId") DO NOTHING;

INSERT INTO "TeamRole" ("id", "workspaceId", "teamId", "name")
SELECT 'tr_' || md5(t."id" || ':' || lower(trim(m."roleLabel"))), t."workspaceId", t."id", trim(m."roleLabel")
FROM "StudioTeamMember" m JOIN "StudioTeam" t ON t."id" = m."teamId"
WHERE nullif(trim(coalesce(m."roleLabel", '')), '') IS NOT NULL
ON CONFLICT ("teamId", "name") DO NOTHING;

UPDATE "StudioTeamMember" m SET "teamRoleId" = r."id"
FROM "TeamRole" r
WHERE r."teamId" = m."teamId" AND lower(r."name") = lower(trim(coalesce(m."roleLabel", '')));

UPDATE "StudioTeam" t SET "departmentId" = d."id"
FROM "Department" d
WHERE d."workspaceId" = t."workspaceId" AND lower(d."name") = lower(trim(coalesce(t."department", '')));

WITH assigned AS (
  SELECT p."id" AS "projectId", value #>> '{}' AS "userId", p."teamRoles"
  FROM "Project" p
  CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(cluster_try_jsonb(p."assignedUserIds")) = 'array' THEN cluster_try_jsonb(p."assignedUserIds") ELSE '[]'::jsonb END) value
)
INSERT INTO "ProjectMembership" ("id", "projectId", "userId", "roleLabel", "isLead")
SELECT 'pm_' || md5(a."projectId" || ':' || a."userId"), a."projectId", a."userId",
  CASE WHEN jsonb_typeof(cluster_try_jsonb(a."teamRoles")) = 'object' THEN cluster_try_jsonb(a."teamRoles")->>a."userId" ELSE NULL END,
  CASE WHEN lower(COALESCE(CASE WHEN jsonb_typeof(cluster_try_jsonb(a."teamRoles")) = 'object' THEN cluster_try_jsonb(a."teamRoles")->>a."userId" END, '')) IN ('lead','project lead','owner') THEN true ELSE false END
FROM assigned a JOIN "User" u ON u."id" = a."userId"
ON CONFLICT ("projectId", "userId") DO NOTHING;

DROP FUNCTION cluster_try_jsonb(TEXT);
