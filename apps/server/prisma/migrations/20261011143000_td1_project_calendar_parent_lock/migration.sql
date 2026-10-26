-- TD1: Project Calendar default policy, limited to blocking personal default-view preferences.
-- Existing Project overrides remain unlocked unless an admin explicitly opts in.
ALTER TABLE "ProjectToolSettingOverride" ADD COLUMN "lockUserOverride" BOOLEAN NOT NULL DEFAULT FALSE;
