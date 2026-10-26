-- Retain columns and their archived Card/Ticket provenance rather than cascading their destruction.
ALTER TABLE "BoardList" ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "BoardList_boardId_archived_position_idx" ON "BoardList"("boardId", "archived", "position");
