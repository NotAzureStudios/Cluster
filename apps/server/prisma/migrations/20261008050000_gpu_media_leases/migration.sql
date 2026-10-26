CREATE TABLE "GpuMediaLease" (
    "id" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GpuMediaLease_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "GpuMediaLease_host_deviceId_expiresAt_idx" ON "GpuMediaLease"("host", "deviceId", "expiresAt");
CREATE INDEX "GpuMediaLease_jobId_idx" ON "GpuMediaLease"("jobId");