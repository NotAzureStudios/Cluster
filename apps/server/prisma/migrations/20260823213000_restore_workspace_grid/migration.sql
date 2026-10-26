-- Cluster v0.447 restores the grid as the default workspace texture.
-- Existing explicit non-clean backgrounds are preserved.
UPDATE "AppSetting"
SET "value" = '"grid"'
WHERE "key" = 'backgroundStyle'
  AND "value" = '"clean"';

UPDATE "User"
SET "preferences" = (
  COALESCE(NULLIF("preferences", ''), '{}')::jsonb
  || '{"backgroundStyle":"grid"}'::jsonb
)::text
WHERE COALESCE(NULLIF("preferences", ''), '{}')::jsonb ->> 'backgroundStyle' = 'clean';
