CREATE TABLE "BackgroundJob" (
    "id" TEXT NOT NULL,
    "queue" TEXT NOT NULL DEFAULT 'default',
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "payload" TEXT NOT NULL DEFAULT '{}',
    "result" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "cancelRequestedAt" TIMESTAMP(3),
    "progress" INTEGER NOT NULL DEFAULT 0,
    "progressMessage" TEXT,
    "lastError" TEXT,
    "dedupeKey" TEXT,
    "createdById" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BackgroundJob_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BackgroundJobAttempt" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL,
    "workerId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "error" TEXT,
    CONSTRAINT "BackgroundJobAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BackgroundJob_status_runAfter_priority_idx" ON "BackgroundJob"("status", "runAfter", "priority");
CREATE INDEX "BackgroundJob_queue_status_runAfter_idx" ON "BackgroundJob"("queue", "status", "runAfter");
CREATE INDEX "BackgroundJob_type_status_createdAt_idx" ON "BackgroundJob"("type", "status", "createdAt");
CREATE INDEX "BackgroundJob_dedupeKey_status_idx" ON "BackgroundJob"("dedupeKey", "status");
CREATE INDEX "BackgroundJob_finishedAt_idx" ON "BackgroundJob"("finishedAt");
CREATE UNIQUE INDEX "BackgroundJobAttempt_jobId_attempt_key" ON "BackgroundJobAttempt"("jobId", "attempt");
CREATE INDEX "BackgroundJobAttempt_jobId_startedAt_idx" ON "BackgroundJobAttempt"("jobId", "startedAt");
CREATE INDEX "BackgroundJobAttempt_status_startedAt_idx" ON "BackgroundJobAttempt"("status", "startedAt");
ALTER TABLE "BackgroundJobAttempt" ADD CONSTRAINT "BackgroundJobAttempt_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "BackgroundJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
