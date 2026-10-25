-- Tickets have their own triage state. Board List names remain user-defined.
ALTER TABLE "Card" ADD COLUMN "ticketStage" TEXT;
CREATE INDEX "Card_workItemKind_ticketStage_archived_idx" ON "Card"("workItemKind", "ticketStage", "archived");
