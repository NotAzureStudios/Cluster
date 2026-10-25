-- Program 32B: make repository state operational and provider-neutral.

ALTER TABLE "SourceRepository"
  ADD COLUMN "headRevision" TEXT,
  ADD COLUMN "syncState" TEXT NOT NULL DEFAULT 'idle',
  ADD COLUMN "lastSyncedAt" TIMESTAMP(3),
  ADD COLUMN "lastFetchAt" TIMESTAMP(3),
  ADD COLUMN "lastPushAt" TIMESTAMP(3);

CREATE TABLE "SourceBranch" (
  "id" TEXT NOT NULL,
  "repositoryId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "headRevision" TEXT,
  "upstreamName" TEXT,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "protected" BOOLEAN NOT NULL DEFAULT false,
  "aheadCount" INTEGER NOT NULL DEFAULT 0,
  "behindCount" INTEGER NOT NULL DEFAULT 0,
  "lastCommitAt" TIMESTAMP(3),
  "lastSyncedAt" TIMESTAMP(3),
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SourceBranch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SourceCommit" (
  "id" TEXT NOT NULL,
  "repositoryId" TEXT NOT NULL,
  "revision" TEXT NOT NULL,
  "shortRevision" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "authorName" TEXT,
  "authorEmail" TEXT,
  "authoredAt" TIMESTAMP(3),
  "committedAt" TIMESTAMP(3),
  "webUrl" TEXT,
  "additions" INTEGER,
  "deletions" INTEGER,
  "filesChanged" INTEGER,
  "parentRevisions" TEXT NOT NULL DEFAULT '[]',
  "branchNames" TEXT NOT NULL DEFAULT '[]',
  "metadata" TEXT NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SourceCommit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SourceChange" (
  "id" TEXT NOT NULL,
  "repositoryId" TEXT NOT NULL,
  "commitId" TEXT,
  "revision" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "previousPath" TEXT,
  "changeType" TEXT NOT NULL,
  "additions" INTEGER,
  "deletions" INTEGER,
  "binary" BOOLEAN NOT NULL DEFAULT false,
  "metadata" TEXT NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SourceChange_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SourceOperation" (
  "id" TEXT NOT NULL,
  "repositoryId" TEXT NOT NULL,
  "operationType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "branchName" TEXT,
  "targetBranch" TEXT,
  "requestedById" TEXT,
  "backgroundJobId" TEXT,
  "progress" INTEGER NOT NULL DEFAULT 0,
  "progressMessage" TEXT,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "lastError" TEXT,
  "resultMetadata" TEXT NOT NULL DEFAULT '{}',
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SourceOperation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SourceRepository_syncState_lastSyncedAt_idx" ON "SourceRepository"("syncState", "lastSyncedAt");
CREATE UNIQUE INDEX "SourceBranch_repositoryId_name_key" ON "SourceBranch"("repositoryId", "name");
CREATE INDEX "SourceBranch_repositoryId_archived_isDefault_idx" ON "SourceBranch"("repositoryId", "archived", "isDefault");
CREATE INDEX "SourceBranch_repositoryId_lastCommitAt_idx" ON "SourceBranch"("repositoryId", "lastCommitAt");
CREATE UNIQUE INDEX "SourceCommit_repositoryId_revision_key" ON "SourceCommit"("repositoryId", "revision");
CREATE INDEX "SourceCommit_repositoryId_committedAt_idx" ON "SourceCommit"("repositoryId", "committedAt");
CREATE INDEX "SourceCommit_revision_idx" ON "SourceCommit"("revision");
CREATE UNIQUE INDEX "SourceChange_repositoryId_revision_path_key" ON "SourceChange"("repositoryId", "revision", "path");
CREATE INDEX "SourceChange_repositoryId_revision_idx" ON "SourceChange"("repositoryId", "revision");
CREATE INDEX "SourceChange_commitId_idx" ON "SourceChange"("commitId");
CREATE INDEX "SourceOperation_repositoryId_createdAt_idx" ON "SourceOperation"("repositoryId", "createdAt");
CREATE INDEX "SourceOperation_repositoryId_status_createdAt_idx" ON "SourceOperation"("repositoryId", "status", "createdAt");
CREATE INDEX "SourceOperation_backgroundJobId_idx" ON "SourceOperation"("backgroundJobId");

ALTER TABLE "SourceBranch" ADD CONSTRAINT "SourceBranch_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "SourceRepository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SourceCommit" ADD CONSTRAINT "SourceCommit_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "SourceRepository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SourceChange" ADD CONSTRAINT "SourceChange_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "SourceRepository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SourceChange" ADD CONSTRAINT "SourceChange_commitId_fkey" FOREIGN KEY ("commitId") REFERENCES "SourceCommit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SourceOperation" ADD CONSTRAINT "SourceOperation_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "SourceRepository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
