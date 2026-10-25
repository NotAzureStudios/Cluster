ALTER TABLE "ProjectFile"
  ALTER COLUMN "sizeBytes" TYPE BIGINT USING "sizeBytes"::BIGINT,
  ADD COLUMN "ingestSessionId" TEXT;

CREATE UNIQUE INDEX "ProjectFile_ingestSessionId_key" ON "ProjectFile"("ingestSessionId");

WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "projectId", "versionGroupId" ORDER BY "versionNumber", "createdAt", "id")::integer AS next_version
  FROM "ProjectFile"
  WHERE "versionGroupId" IS NOT NULL
)
UPDATE "ProjectFile" AS file
SET "versionNumber" = ranked.next_version,
    "versionLabel" = CASE WHEN file."versionLabel" IS NULL OR file."versionLabel" ~* '^v[0-9]+$' THEN 'v' || ranked.next_version::text ELSE file."versionLabel" END
FROM ranked WHERE ranked."id" = file."id";

CREATE UNIQUE INDEX "ProjectFile_projectId_versionGroupId_versionNumber_key"
  ON "ProjectFile"("projectId", "versionGroupId", "versionNumber")
  WHERE "versionGroupId" IS NOT NULL;
