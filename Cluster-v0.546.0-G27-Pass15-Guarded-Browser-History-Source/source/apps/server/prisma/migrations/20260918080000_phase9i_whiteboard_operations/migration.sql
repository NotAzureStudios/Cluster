ALTER TABLE "Whiteboard" ADD COLUMN "operationSequence" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "WhiteboardOperation" (
  "id" TEXT NOT NULL,
  "whiteboardId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "actorUserId" TEXT,
  "clientId" TEXT,
  "kind" TEXT NOT NULL,
  "targets" TEXT NOT NULL DEFAULT '[]',
  "payload" TEXT NOT NULL DEFAULT '{}',
  "baseSequence" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WhiteboardOperation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WhiteboardOperation_whiteboardId_sequence_key" ON "WhiteboardOperation"("whiteboardId", "sequence");
CREATE INDEX "WhiteboardOperation_whiteboardId_createdAt_idx" ON "WhiteboardOperation"("whiteboardId", "createdAt");
CREATE INDEX "WhiteboardOperation_actorUserId_createdAt_idx" ON "WhiteboardOperation"("actorUserId", "createdAt");
ALTER TABLE "WhiteboardOperation" ADD CONSTRAINT "WhiteboardOperation_whiteboardId_fkey" FOREIGN KEY ("whiteboardId") REFERENCES "Whiteboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "WhiteboardSnapshot" (
  "id" TEXT NOT NULL,
  "whiteboardId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "revision" INTEGER NOT NULL,
  "elements" TEXT NOT NULL DEFAULT '[]',
  "categories" TEXT NOT NULL DEFAULT '[]',
  "labels" TEXT NOT NULL DEFAULT '[]',
  "productionLinks" TEXT NOT NULL DEFAULT '{}',
  "settings" TEXT NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WhiteboardSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WhiteboardSnapshot_whiteboardId_sequence_key" ON "WhiteboardSnapshot"("whiteboardId", "sequence");
CREATE INDEX "WhiteboardSnapshot_whiteboardId_createdAt_idx" ON "WhiteboardSnapshot"("whiteboardId", "createdAt");
ALTER TABLE "WhiteboardSnapshot" ADD CONSTRAINT "WhiteboardSnapshot_whiteboardId_fkey" FOREIGN KEY ("whiteboardId") REFERENCES "Whiteboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
