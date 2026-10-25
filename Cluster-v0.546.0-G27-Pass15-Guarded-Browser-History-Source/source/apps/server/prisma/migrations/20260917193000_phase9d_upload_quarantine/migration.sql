ALTER TABLE "UploadSession"
  ADD COLUMN "quarantineCode" TEXT,
  ADD COLUMN "quarantineReason" TEXT,
  ADD COLUMN "scanProvider" TEXT,
  ADD COLUMN "scanVerdict" TEXT,
  ADD COLUMN "scannedAt" TIMESTAMP(3);
