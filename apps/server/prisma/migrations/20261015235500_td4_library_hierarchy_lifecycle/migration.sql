CREATE TABLE "LibraryHierarchyLifecycleEntry" (
    "jobId" TEXT NOT NULL,
    "rootId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "priorStatus" TEXT NOT NULL,
    "priorLifecycleState" TEXT NOT NULL,
    "priorDeletedAt" TIMESTAMP(3),
    "priorDeletedById" TEXT,
    "appliedRevision" INTEGER NOT NULL,
    "appliedDeletedAt" TIMESTAMP(3),
    "appliedDeletedById" TEXT,
    "restoredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LibraryHierarchyLifecycleEntry_pkey" PRIMARY KEY ("jobId", "itemId")
);
CREATE INDEX "LibraryHierarchyLifecycleEntry_itemId_restoredAt_createdAt_idx" ON "LibraryHierarchyLifecycleEntry"("itemId", "restoredAt", "createdAt");
CREATE INDEX "LibraryHierarchyLifecycleEntry_jobId_rootId_restoredAt_idx" ON "LibraryHierarchyLifecycleEntry"("jobId", "rootId", "restoredAt");
