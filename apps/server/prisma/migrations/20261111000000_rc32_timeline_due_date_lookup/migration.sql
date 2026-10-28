-- RC32: index the existing Timeline due-card range predicate.
-- PostgreSQL remains authoritative; no change to visibility or query results.
CREATE INDEX "Card_archived_dueDate_idx" ON "Card"("archived", "dueDate");
