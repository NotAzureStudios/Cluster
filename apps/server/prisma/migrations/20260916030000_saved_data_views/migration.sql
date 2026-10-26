CREATE TABLE "SavedDataView" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ownerId" TEXT,
    "projectId" TEXT,
    "scope" TEXT NOT NULL,
    "resourceKind" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'personal',
    "presentation" TEXT NOT NULL DEFAULT 'table',
    "density" TEXT NOT NULL DEFAULT 'comfortable',
    "query" JSONB NOT NULL,
    "layout" JSONB NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SavedDataView_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SavedDataView_workspaceId_scope_visibility_archived_updatedAt_idx" ON "SavedDataView"("workspaceId", "scope", "visibility", "archived", "updatedAt");
CREATE INDEX "SavedDataView_ownerId_scope_archived_updatedAt_idx" ON "SavedDataView"("ownerId", "scope", "archived", "updatedAt");
CREATE INDEX "SavedDataView_projectId_scope_archived_updatedAt_idx" ON "SavedDataView"("projectId", "scope", "archived", "updatedAt");
CREATE INDEX "SavedDataView_workspaceId_scope_isDefault_archived_idx" ON "SavedDataView"("workspaceId", "scope", "isDefault", "archived");

ALTER TABLE "SavedDataView" ADD CONSTRAINT "SavedDataView_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SavedDataView" ADD CONSTRAINT "SavedDataView_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SavedDataView" ADD CONSTRAINT "SavedDataView_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
