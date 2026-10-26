CREATE TABLE "UploadCapacityLock" (
  "id" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UploadCapacityLock_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UploadSession" (
  "id" TEXT NOT NULL,
  "ownerId" TEXT NOT NULL,
  "workspaceId" TEXT,
  "fileName" TEXT NOT NULL,
  "totalBytes" BIGINT NOT NULL,
  "receivedBytes" BIGINT NOT NULL DEFAULT 0,
  "mode" TEXT NOT NULL DEFAULT 'cluster',
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "checksumSha256" TEXT,
  "storageProvider" TEXT,
  "storageTier" TEXT,
  "storageKey" TEXT,
  "multipartUploadId" TEXT,
  "partSize" INTEGER,
  "completedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UploadSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UploadSessionPart" (
  "uploadSessionId" TEXT NOT NULL,
  "partNumber" INTEGER NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "etag" TEXT,
  "authorizedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UploadSessionPart_pkey" PRIMARY KEY ("uploadSessionId","partNumber")
);

CREATE INDEX "UploadSession_ownerId_status_expiresAt_idx"
  ON "UploadSession"("ownerId","status","expiresAt");
CREATE INDEX "UploadSession_workspaceId_status_expiresAt_idx"
  ON "UploadSession"("workspaceId","status","expiresAt");
CREATE INDEX "UploadSession_status_expiresAt_idx"
  ON "UploadSession"("status","expiresAt");
CREATE INDEX "UploadSessionPart_uploadSessionId_completedAt_idx"
  ON "UploadSessionPart"("uploadSessionId","completedAt");

ALTER TABLE "UploadSessionPart"
  ADD CONSTRAINT "UploadSessionPart_uploadSessionId_fkey"
  FOREIGN KEY ("uploadSessionId") REFERENCES "UploadSession"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
