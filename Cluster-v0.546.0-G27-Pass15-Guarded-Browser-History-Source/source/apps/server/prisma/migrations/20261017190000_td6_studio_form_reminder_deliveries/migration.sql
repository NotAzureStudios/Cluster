-- Durable, per-recipient reminder claims for published Form version deadlines.
CREATE TABLE "StudioFormReminderDelivery" (
    "id" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "formVersionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "claimToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "StudioFormReminderDelivery_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StudioFormReminderDelivery_formVersionId_userId_stage_key" ON "StudioFormReminderDelivery"("formVersionId", "userId", "stage");
CREATE INDEX "StudioFormReminderDelivery_state_leaseUntil_idx" ON "StudioFormReminderDelivery"("state", "leaseUntil");
CREATE INDEX "StudioFormReminderDelivery_userId_deliveredAt_idx" ON "StudioFormReminderDelivery"("userId", "deliveredAt");
ALTER TABLE "StudioFormReminderDelivery" ADD CONSTRAINT "StudioFormReminderDelivery_formId_fkey" FOREIGN KEY ("formId") REFERENCES "StudioForm"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudioFormReminderDelivery" ADD CONSTRAINT "StudioFormReminderDelivery_formVersionId_fkey" FOREIGN KEY ("formVersionId") REFERENCES "StudioFormVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudioFormReminderDelivery" ADD CONSTRAINT "StudioFormReminderDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
