ALTER TABLE "AssetArtifact"
  ADD COLUMN "recipeKey" TEXT NOT NULL DEFAULT 'unversioned';

CREATE INDEX "AssetArtifact_kind_variantKey_sourceChecksumSha256_recipeKey_idx"
  ON "AssetArtifact"("kind", "variantKey", "sourceChecksumSha256", "recipeKey");
