-- Deleting a project set its Library folder's projectId to NULL but left the
-- folder pinned, so every deleted project added another pinned
-- "<name> Library" folder. Unpin those orphans. Folders and their files are
-- kept; owners can review and trash them from the Library as usual.
UPDATE "LibraryItem"
SET "pinned" = false,
    "revision" = "revision" + 1,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "type" = 'folder'
  AND "source" = 'project-folder'
  AND "projectId" IS NULL
  AND "pinned" = true;
