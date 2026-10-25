CREATE TABLE "PrivacyDataRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "requestType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "note" TEXT,
    "resolutionNote" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PrivacyDataRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PrivacyDataRequest_userId_status_requestedAt_idx" ON "PrivacyDataRequest"("userId", "status", "requestedAt");
CREATE INDEX "PrivacyDataRequest_requestType_status_requestedAt_idx" ON "PrivacyDataRequest"("requestType", "status", "requestedAt");
ALTER TABLE "PrivacyDataRequest" ADD CONSTRAINT "PrivacyDataRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
