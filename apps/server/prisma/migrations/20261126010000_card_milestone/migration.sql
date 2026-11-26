-- A card can count toward one project milestone (a TimelineItem of type
-- "milestone"); deleting the milestone leaves the card unassigned.
ALTER TABLE "Card" ADD COLUMN "milestoneId" TEXT;
ALTER TABLE "Card" ADD CONSTRAINT "Card_milestoneId_fkey" FOREIGN KEY ("milestoneId") REFERENCES "TimelineItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "Card_milestoneId_idx" ON "Card"("milestoneId");
