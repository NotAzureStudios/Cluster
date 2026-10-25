-- Explicit collection organization sharing; no LibraryItem file access is granted.
CREATE TABLE "LibraryCollectionGrant" (
  "collectionId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'viewer',
  "grantedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "LibraryCollectionGrant_pkey" PRIMARY KEY ("collectionId", "userId"),
  CONSTRAINT "LibraryCollectionGrant_role_check" CHECK ("role" IN ('viewer', 'editor')),
  CONSTRAINT "LibraryCollectionGrant_collectionId_fkey" FOREIGN KEY ("collectionId") REFERENCES "LibraryCollection"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "LibraryCollectionGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "LibraryCollectionGrant_userId_collectionId_idx" ON "LibraryCollectionGrant"("userId", "collectionId");
