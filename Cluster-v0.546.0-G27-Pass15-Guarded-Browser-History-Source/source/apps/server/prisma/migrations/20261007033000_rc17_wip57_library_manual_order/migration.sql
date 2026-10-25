-- WIP57 Library 2.0: stable user-defined ordering within a Library folder.
ALTER TABLE "LibraryItem" ADD COLUMN "manualOrder" DOUBLE PRECISION;
CREATE INDEX "LibraryItem_parentId_manualOrder_id_idx" ON "LibraryItem"("parentId", "manualOrder", "id");
