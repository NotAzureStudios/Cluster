CREATE TABLE "StudioScopedGrantRequest" (
  "id" TEXT NOT NULL,
  "subjectUserId" TEXT NOT NULL,
  "requestedById" TEXT NOT NULL,
  "reviewedById" TEXT,
  "targetKind" TEXT NOT NULL DEFAULT 'project',
  "targetId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "accessRuleId" TEXT,
  "expectedRuleUpdatedAt" TIMESTAMP(3),
  "previousExpiresAt" TIMESTAMP(3),
  "level" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "expectedProfileRevision" INTEGER NOT NULL,
  "reason" TEXT NOT NULL,
  "reviewReason" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "grantedRuleId" TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  "personnelRecordId" TEXT,
  CONSTRAINT "StudioScopedGrantRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StudioScopedGrantRequest_targetKind_targetId_subjectUserId_status_idx" ON "StudioScopedGrantRequest"("targetKind", "targetId", "subjectUserId", "status");
CREATE INDEX "StudioScopedGrantRequest_status_requestedAt_idx" ON "StudioScopedGrantRequest"("status", "requestedAt");
CREATE INDEX "StudioScopedGrantRequest_subjectUserId_requestedAt_idx" ON "StudioScopedGrantRequest"("subjectUserId", "requestedAt");
-- Transaction locks govern competing requests; a partial index also prevents duplicate pending submissions.
CREATE UNIQUE INDEX "StudioScopedGrantRequest_pending_unique" ON "StudioScopedGrantRequest"("targetKind", "targetId", "subjectUserId") WHERE "status" = 'pending';
ALTER TABLE "StudioScopedGrantRequest" ADD CONSTRAINT "StudioScopedGrantRequest_subjectUserId_fkey" FOREIGN KEY ("subjectUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudioScopedGrantRequest" ADD CONSTRAINT "StudioScopedGrantRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StudioScopedGrantRequest" ADD CONSTRAINT "StudioScopedGrantRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A governed personal allow grant must not accidentally turn an otherwise
-- permissive Project into an exclusive allowlist for everybody else.
ALTER TABLE "AccessRule" ADD COLUMN "governedGrantId" TEXT;
CREATE UNIQUE INDEX "AccessRule_governedGrantId_key" ON "AccessRule"("governedGrantId");
