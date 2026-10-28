-- Resource identity is separate from lifecycle/status. Existing projects inherit a semantic icon.
ALTER TABLE "Project" ADD COLUMN "iconId" TEXT;
