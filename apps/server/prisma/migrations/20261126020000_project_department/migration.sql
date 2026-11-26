ALTER TABLE "Project" ADD COLUMN "departmentId" TEXT;
ALTER TABLE "Project" ADD CONSTRAINT "Project_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Project_departmentId_archived_idx" ON "Project"("departmentId", "archived");
