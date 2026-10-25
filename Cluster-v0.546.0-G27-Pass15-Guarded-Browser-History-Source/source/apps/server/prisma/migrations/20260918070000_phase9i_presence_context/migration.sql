ALTER TABLE "WorkforceStatus"
  ADD COLUMN "declaredStatus" TEXT,
  ADD COLUMN "presenceDisclosure" TEXT NOT NULL DEFAULT 'work_state';

CREATE INDEX "WorkforceStatus_presenceDisclosure_updatedAt_idx"
  ON "WorkforceStatus"("presenceDisclosure", "updatedAt");

CREATE TABLE "PresenceContext" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "applicationKey" TEXT,
  "projectId" TEXT,
  "repositoryId" TEXT,
  "branch" TEXT,
  "resourceKind" TEXT,
  "resourceId" TEXT,
  "source" TEXT NOT NULL DEFAULT 'declared',
  "sensitivity" TEXT NOT NULL DEFAULT 'normal',
  "expiresAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PresenceContext_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PresenceContext_userId_key" ON "PresenceContext"("userId");
CREATE INDEX "PresenceContext_projectId_updatedAt_idx" ON "PresenceContext"("projectId", "updatedAt");
CREATE INDEX "PresenceContext_repositoryId_updatedAt_idx" ON "PresenceContext"("repositoryId", "updatedAt");
CREATE INDEX "PresenceContext_expiresAt_idx" ON "PresenceContext"("expiresAt");
ALTER TABLE "PresenceContext" ADD CONSTRAINT "PresenceContext_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
