ALTER TABLE "Card" ADD COLUMN "workItemKind" TEXT NOT NULL DEFAULT 'card';

UPDATE "Card"
SET "workItemKind" = 'ticket'
WHERE "labels" ILIKE '%"ticket"%'
   OR "labels" ILIKE '%"report-ticket"%'
   OR COALESCE("description", '') ~* '(^|\n)Type:[[:space:]]*';

CREATE INDEX "Card_workItemKind_archived_updatedAt_idx" ON "Card"("workItemKind", "archived", "updatedAt");
