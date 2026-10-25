-- Phase 9H: Project Platform 2.0 authority split.
ALTER TABLE "ProjectMembership" ADD COLUMN IF NOT EXISTS "startsAt" TIMESTAMP(3);
ALTER TABLE "ProjectMembership" ADD COLUMN IF NOT EXISTS "endsAt" TIMESTAMP(3);
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "productionProfile" TEXT NOT NULL DEFAULT 'generic';
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "blueprintKey" TEXT;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "workspacePresetKey" TEXT;
ALTER TABLE "Project" ADD COLUMN IF NOT EXISTS "provisioningKey" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Project_provisioningKey_key" ON "Project"("provisioningKey");
CREATE INDEX IF NOT EXISTS "ProjectMembership_projectId_status_startsAt_endsAt_idx" ON "ProjectMembership"("projectId", "status", "startsAt", "endsAt");

-- Technology-specific legacy Project Type IDs become purpose + Production Profile.
UPDATE "Project" SET "productionProfile" = 'unreal', "projectType" = 'game' WHERE "projectType" = 'unreal';
UPDATE "Project" SET "productionProfile" = 'unreal_video', "projectType" = 'game' WHERE "projectType" = 'game_video';
UPDATE "Project" SET "productionProfile" = 'blender', "projectType" = 'creative' WHERE "projectType" = 'blender';
UPDATE "Project" SET "productionProfile" = 'uefn', "projectType" = 'game' WHERE "projectType" = 'fortnite_island';
UPDATE "Project" SET "productionProfile" = 'curseforge', "projectType" = 'game' WHERE "projectType" = 'curseforge';
UPDATE "Project" SET "productionProfile" = 'ark_mod', "projectType" = 'game' WHERE "projectType" = 'ark_mod';
UPDATE "Project" SET "productionProfile" = 'ark_map', "projectType" = 'game' WHERE "projectType" = 'ark_map';
UPDATE "Project" SET "productionProfile" = 'minecraft_map', "projectType" = 'game' WHERE "projectType" = 'minecraft_map';
UPDATE "Project" SET "productionProfile" = 'minecraft_mod', "projectType" = 'game' WHERE "projectType" = 'minecraft_mod';

-- Backfill normalized memberships from the legacy JSON projection.  The JSON fields remain only as a compatibility cache until Phase 9N fossil retirement.
INSERT INTO "ProjectMembership" ("id", "projectId", "userId", "roleKey", "roleLabel", "allocationPercent", "accessLevel", "isLead", "status", "createdAt", "updatedAt")
SELECT
  'pm9h_' || md5(p."id" || ':' || member.value),
  p."id",
  member.value,
  CASE WHEN lower(COALESCE((p."teamRoles"::jsonb ->> member.value), '')) ~ '(lead|producer|manager|owner)' THEN 'lead' ELSE 'member' END,
  NULLIF(p."teamRoles"::jsonb ->> member.value, ''),
  100,
  CASE WHEN lower(COALESCE((p."teamRoles"::jsonb ->> member.value), '')) ~ '(lead|producer|manager|owner)' THEN 'manage' ELSE 'contribute' END,
  lower(COALESCE((p."teamRoles"::jsonb ->> member.value), '')) ~ '(lead|producer|manager|owner)',
  'active',
  NOW(),
  NOW()
FROM "Project" p
CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN p."assignedUserIds" ~ '^\\s*\\[' THEN p."assignedUserIds"::jsonb ELSE '[]'::jsonb END) member(value)
JOIN "User" u ON u."id" = member.value
ON CONFLICT ("projectId", "userId") DO NOTHING;
