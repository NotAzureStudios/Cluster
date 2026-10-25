-- Canonical Studio Team bundle inheritance uses the existing Team identity.
-- Stored references resolve through Studio Settings' authoritative bundle catalog.
ALTER TABLE "StudioTeam" ADD COLUMN "permissionBundleIds" TEXT NOT NULL DEFAULT '[]';
