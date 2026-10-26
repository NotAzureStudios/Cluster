-- WIP57: complete the canonical Project identity model for v1.
-- `name` remains the internal studio name. External/public naming, codename, and aliases
-- are explicit fields rather than being overloaded into description/client metadata.
ALTER TABLE "Project" ADD COLUMN "externalName" TEXT;
ALTER TABLE "Project" ADD COLUMN "codename" TEXT;
ALTER TABLE "Project" ADD COLUMN "aliases" TEXT NOT NULL DEFAULT '[]';

CREATE INDEX "Project_externalName_idx" ON "Project"("externalName");
CREATE INDEX "Project_codename_idx" ON "Project"("codename");
