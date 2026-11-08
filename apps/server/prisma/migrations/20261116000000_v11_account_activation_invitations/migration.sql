-- Single-use account activation tickets. Never persist plaintext tokens.
CREATE TABLE "StudioAccountInvitation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "issuedById" TEXT NOT NULL,
    "revokedById" TEXT,
    "tokenHash" TEXT NOT NULL,
    "authGeneration" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "StudioAccountInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StudioAccountInvitation_tokenHash_key" ON "StudioAccountInvitation"("tokenHash");
CREATE INDEX "StudioAccountInvitation_workspaceId_userId_createdAt_idx" ON "StudioAccountInvitation"("workspaceId", "userId", "createdAt");
CREATE INDEX "AccountInvite_user_lifecycle_idx" ON "StudioAccountInvitation"("userId", "consumedAt", "revokedAt", "expiresAt");

ALTER TABLE "StudioAccountInvitation" ADD CONSTRAINT "StudioAccountInvitation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudioAccountInvitation" ADD CONSTRAINT "StudioAccountInvitation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudioAccountInvitation" ADD CONSTRAINT "StudioAccountInvitation_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StudioAccountInvitation" ADD CONSTRAINT "StudioAccountInvitation_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
