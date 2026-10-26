ALTER TABLE "WhiteboardOperation"
  ADD COLUMN "historyBefore" TEXT,
  ADD COLUMN "historyAfter" TEXT,
  ADD COLUMN "historyState" TEXT NOT NULL DEFAULT 'applied',
  ADD COLUMN "historyAnchorSequence" INTEGER,
  ADD COLUMN "historyAction" TEXT,
  ADD COLUMN "historyOfId" TEXT;
CREATE INDEX "WhiteboardOperation_whiteboardId_actorUserId_sequence_idx"
  ON "WhiteboardOperation"("whiteboardId", "actorUserId", "sequence");
