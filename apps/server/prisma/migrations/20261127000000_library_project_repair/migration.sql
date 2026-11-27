-- Items created or moved into a project folder before they inherited its
-- project: give each one (and its contents) the nearest project above it.
WITH RECURSIVE fix AS (
  SELECT child.id, parent."projectId"
  FROM "LibraryItem" child JOIN "LibraryItem" parent ON parent.id = child."parentId"
  WHERE child."projectId" IS NULL AND parent."projectId" IS NOT NULL
  UNION
  SELECT child.id, fix."projectId"
  FROM "LibraryItem" child JOIN fix ON child."parentId" = fix.id
  WHERE child."projectId" IS NULL
)
UPDATE "LibraryItem" item SET "projectId" = fix."projectId" FROM fix WHERE item.id = fix.id;
