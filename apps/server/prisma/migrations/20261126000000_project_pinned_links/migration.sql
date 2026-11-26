-- Links pinned under a project's title (repo, Discord, store page, docs),
-- stored as a JSON array of { label, url }.
ALTER TABLE "Project" ADD COLUMN "pinnedLinks" TEXT NOT NULL DEFAULT '[]';
