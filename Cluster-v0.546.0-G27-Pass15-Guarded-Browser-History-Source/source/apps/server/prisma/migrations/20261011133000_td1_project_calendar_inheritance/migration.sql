-- TD1: real Project-scoped Tool Config storage with project deletion cleanup.
-- Only the validated Calendar defaultView field is enrolled in this pass.
CREATE TABLE "ProjectToolSettingOverride" (
  "projectId" TEXT NOT NULL,
  "tool" TEXT NOT NULL,
  "field" TEXT NOT NULL,
  "valueJson" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "updatedById" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectToolSettingOverride_pkey" PRIMARY KEY ("projectId", "tool", "field"),
  CONSTRAINT "ProjectToolSettingOverride_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ProjectToolSettingOverride_revision_check" CHECK ("revision" >= 1),
  CONSTRAINT "ProjectToolSettingOverride_length_check" CHECK (length("valueJson") <= 1024)
);
CREATE INDEX "ProjectToolSettingOverride_tool_field_idx" ON "ProjectToolSettingOverride"("tool", "field");
