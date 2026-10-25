CREATE TABLE "ReviewAssetDecision" (
    "id" TEXT NOT NULL,
    "reviewAssetId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "sourceChecksumSha256" TEXT,
    "decision" TEXT NOT NULL,
    "reason" TEXT,
    "actorId" TEXT NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReviewAssetDecision_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ReviewAssetDecision_reviewAssetId_decidedAt_id_idx" ON "ReviewAssetDecision"("reviewAssetId", "decidedAt", "id");
CREATE INDEX "ReviewAssetDecision_actorId_decidedAt_idx" ON "ReviewAssetDecision"("actorId", "decidedAt");
ALTER TABLE "ReviewAssetDecision" ADD CONSTRAINT "ReviewAssetDecision_reviewAssetId_fkey" FOREIGN KEY ("reviewAssetId") REFERENCES "ReviewAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
