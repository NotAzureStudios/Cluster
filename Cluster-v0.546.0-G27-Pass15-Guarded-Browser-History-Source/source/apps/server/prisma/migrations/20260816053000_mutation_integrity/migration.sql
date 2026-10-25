CREATE TABLE "ApiMutationReceipt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'processing',
    "statusCode" INTEGER,
    "responsePayload" TEXT,
    "requestId" TEXT,
    "failureReason" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ApiMutationReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ApiMutationReceipt_userId_method_path_idempotencyKey_key"
ON "ApiMutationReceipt"("userId", "method", "path", "idempotencyKey");

CREATE INDEX "ApiMutationReceipt_state_updatedAt_idx" ON "ApiMutationReceipt"("state", "updatedAt");
CREATE INDEX "ApiMutationReceipt_createdAt_idx" ON "ApiMutationReceipt"("createdAt");
CREATE INDEX "ApiMutationReceipt_userId_createdAt_idx" ON "ApiMutationReceipt"("userId", "createdAt");
