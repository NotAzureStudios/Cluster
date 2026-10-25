-- Cluster v0.337.0 initial PostgreSQL schema
-- Generated from apps/server/prisma/schema.prisma for the native-only cutover.

CREATE TABLE "User" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "discordUserId" TEXT,
  "discordUsername" TEXT,
  "discordDisplayName" TEXT,
  "discordAvatar" TEXT,
  "discordLinkedAt" TIMESTAMP(3),
  "discordLastVerifiedAt" TIMESTAMP(3),
  "username" TEXT NOT NULL,
  "passwordHash" TEXT,
  "accountState" TEXT NOT NULL DEFAULT 'PASSWORD_CHANGE_REQUIRED',
  "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil" TIMESTAMP(3),
  "passwordChangedAt" TIMESTAMP(3),
  "employeeNumber" TEXT,
  "displayName" TEXT,
  "email" TEXT,
  "avatarUrl" TEXT,
  "personalAccentColor" TEXT,
  "preferences" TEXT NOT NULL DEFAULT '{}',
  "pinHash" TEXT,
  "pinUpdatedAt" TIMESTAMP(3),
  "failedPinCount" INTEGER NOT NULL DEFAULT 0,
  "pinLockedUntil" TIMESTAMP(3),
  "title" TEXT,
  "department" TEXT,
  "teamName" TEXT,
  "legalName" TEXT,
  "preferredName" TEXT,
  "pronouns" TEXT,
  "phoneNumber" TEXT,
  "alternatePhoneNumber" TEXT,
  "alternateEmails" TEXT NOT NULL DEFAULT '[]',
  "addressLine1" TEXT,
  "addressLine2" TEXT,
  "city" TEXT,
  "stateProvince" TEXT,
  "postalCode" TEXT,
  "country" TEXT,
  "emergencyContactName" TEXT,
  "emergencyContactPhone" TEXT,
  "emergencyContactRelation" TEXT,
  "managerName" TEXT,
  "employmentType" TEXT,
  "accountType" TEXT NOT NULL DEFAULT 'employee',
  "accessExpiresAt" TIMESTAMP(3),
  "invitedById" TEXT,
  "workLocation" TEXT,
  "hideLegalName" BOOLEAN NOT NULL DEFAULT TRUE,
  "hideLocation" BOOLEAN NOT NULL DEFAULT FALSE,
  "timezone" TEXT,
  "status" TEXT NOT NULL DEFAULT 'available',
  "statusMessage" TEXT,
  "skills" TEXT NOT NULL DEFAULT '[]',
  "capacityHours" INTEGER,
  "minimumHours" INTEGER,
  "notes" TEXT,
  "startDate" TIMESTAMP(3),
  "archived" BOOLEAN NOT NULL DEFAULT FALSE,
  "lastSeenAt" TIMESTAMP(3),
  "toolPermissions" TEXT NOT NULL DEFAULT '{}',
  "projectPermissions" TEXT NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "AvatarAudit" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "previousUrl" TEXT,
  "newUrl" TEXT NOT NULL,
  "originalName" TEXT,
  "mimeType" TEXT,
  "sizeBytes" INTEGER,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "reviewNote" TEXT,
  "reviewedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "Session" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tokenHash" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "userAgent" TEXT,
  "ipAddress" TEXT,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "AccountSetupCredential" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "failedAttempts" INTEGER NOT NULL DEFAULT 0,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "DiscordLinkChallenge" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "stateHash" TEXT NOT NULL,
  "redirectUri" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "SecurityAuditEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "event" TEXT NOT NULL,
  "actorUserId" TEXT,
  "targetUserId" TEXT,
  "workspaceId" TEXT,
  "result" TEXT NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "requestId" TEXT,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "metadata" TEXT NOT NULL DEFAULT '{}',
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Workspace" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "gitEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "archived" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "WorkspaceMember" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'member'
);

CREATE TABLE "Project" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "objective" TEXT,
  "clientName" TEXT,
  "startDate" TIMESTAMP(3),
  "targetDate" TIMESTAMP(3),
  "priority" TEXT NOT NULL DEFAULT 'medium',
  "tags" TEXT NOT NULL DEFAULT '[]',
  "color" TEXT,
  "healthNote" TEXT,
  "teamRoles" TEXT NOT NULL DEFAULT '{}',
  "assignedUserIds" TEXT NOT NULL DEFAULT '[]',
  "giteaRepoUrl" TEXT,
  "source" TEXT NOT NULL DEFAULT 'manual',
  "gitProvider" TEXT,
  "gitDefaultBranch" TEXT,
  "discordForumChannelId" TEXT,
  "discordForumThreadId" TEXT,
  "discordForumUrl" TEXT,
  "discordForumTitle" TEXT,
  "projectType" TEXT NOT NULL DEFAULT 'unreal',
  "status" TEXT NOT NULL DEFAULT 'active',
  "productionTracks" TEXT NOT NULL DEFAULT '["game"]',
  "archived" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1,
  "libraryFolderId" TEXT
);

CREATE TABLE "ProjectControlRecord" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "status" TEXT NOT NULL DEFAULT 'open',
  "priority" TEXT NOT NULL DEFAULT 'medium',
  "ownerId" TEXT,
  "parentId" TEXT,
  "category" TEXT,
  "startDate" TIMESTAMP(3),
  "dueDate" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "progress" INTEGER NOT NULL DEFAULT 0,
  "probability" INTEGER,
  "impact" INTEGER,
  "confidence" INTEGER,
  "linkedEntityType" TEXT,
  "linkedEntityId" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "payload" TEXT NOT NULL DEFAULT '{}',
  "archived" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE "ProjectRelationship" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "relationship" TEXT NOT NULL DEFAULT 'relates_to',
  "description" TEXT,
  "critical" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "VideoAsset" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "pool" TEXT NOT NULL DEFAULT 'raw',
  "status" TEXT NOT NULL DEFAULT 'review',
  "versionLabel" TEXT,
  "platform" TEXT,
  "dueDate" TIMESTAMP(3),
  "reviewerId" TEXT,
  "fileName" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL DEFAULT 0,
  "durationSeconds" DOUBLE PRECISION,
  "uploadedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "VideoComment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "videoAssetId" TEXT NOT NULL,
  "userId" TEXT,
  "body" TEXT NOT NULL,
  "timecodeSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'open',
  "category" TEXT NOT NULL DEFAULT 'edit',
  "priority" TEXT NOT NULL DEFAULT 'medium',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "ProjectFile" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "category" TEXT NOT NULL DEFAULT 'shared',
  "fileName" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL DEFAULT 0,
  "uploadedById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "Board" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "gitEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "assignedUserIds" TEXT NOT NULL DEFAULT '[]',
  "backgroundColor" TEXT,
  "backgroundStyle" TEXT NOT NULL DEFAULT 'soft',
  "labelDefinitions" TEXT NOT NULL DEFAULT '[]',
  "archived" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE "BoardList" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "boardId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "color" TEXT,
  "wipLimit" INTEGER,
  "assignedUserIds" TEXT NOT NULL DEFAULT '[]',
  "isDone" BOOLEAN NOT NULL DEFAULT FALSE,
  "collapsed" BOOLEAN NOT NULL DEFAULT FALSE,
  "position" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE "Card" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "listId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "position" INTEGER NOT NULL,
  "priority" TEXT NOT NULL DEFAULT 'medium',
  "dueDate" TIMESTAMP(3),
  "startDate" TIMESTAMP(3),
  "labels" TEXT NOT NULL DEFAULT '[]',
  "category" TEXT,
  "coverColor" TEXT,
  "coverImage" TEXT,
  "estimatePoints" INTEGER,
  "memberIds" TEXT NOT NULL DEFAULT '[]',
  "watcherIds" TEXT NOT NULL DEFAULT '[]',
  "assigneeId" TEXT,
  "giteaIssueUrl" TEXT,
  "giteaIssueNumber" INTEGER,
  "giteaIssueTitle" TEXT,
  "giteaIssueState" TEXT,
  "giteaIssueLabels" TEXT NOT NULL DEFAULT '[]',
  "giteaIssueAssignee" TEXT,
  "giteaIssueUpdatedAt" TIMESTAMP(3),
  "discordMessageUrl" TEXT,
  "externalUrl" TEXT,
  "archived" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE "ChecklistItem" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "cardId" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "completed" BOOLEAN NOT NULL DEFAULT FALSE,
  "position" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "CardComment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "cardId" TEXT NOT NULL,
  "userId" TEXT,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "EntityComment" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "userId" TEXT,
  "body" TEXT NOT NULL,
  "pinned" BOOLEAN NOT NULL DEFAULT FALSE,
  "resolved" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "CardActivity" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "cardId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Whiteboard" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "elements" TEXT NOT NULL DEFAULT '[]',
  "categories" TEXT NOT NULL DEFAULT '[]',
  "labels" TEXT NOT NULL DEFAULT '[]',
  "productionLinks" TEXT NOT NULL DEFAULT '{}',
  "backgroundColor" TEXT NOT NULL DEFAULT '#f8fafc',
  "gridColor" TEXT NOT NULL DEFAULT '#cbd5e1',
  "gridStyle" TEXT NOT NULL DEFAULT 'lines',
  "canvasWidth" INTEGER NOT NULL DEFAULT 1800,
  "canvasHeight" INTEGER NOT NULL DEFAULT 950,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE "CalendarEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "location" TEXT,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3),
  "allDay" BOOLEAN NOT NULL DEFAULT FALSE,
  "color" TEXT,
  "source" TEXT NOT NULL DEFAULT 'manual',
  "externalUrl" TEXT,
  "eventType" TEXT NOT NULL DEFAULT 'meeting',
  "status" TEXT NOT NULL DEFAULT 'scheduled',
  "ownerId" TEXT,
  "attendeeIds" TEXT NOT NULL DEFAULT '[]',
  "reminderMinutes" INTEGER,
  "recurrenceRule" TEXT,
  "ticketId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE "ActivityEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT,
  "projectId" TEXT,
  "boardId" TEXT,
  "whiteboardId" TEXT,
  "cardId" TEXT,
  "type" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT,
  "title" TEXT NOT NULL,
  "message" TEXT,
  "metadata" TEXT NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "TimelineItem" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT,
  "userId" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3),
  "type" TEXT NOT NULL DEFAULT 'manual',
  "color" TEXT,
  "externalUrl" TEXT,
  "source" TEXT NOT NULL DEFAULT 'manual',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE "KnowledgeItem" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT,
  "ownerId" TEXT,
  "reviewerId" TEXT,
  "parentId" TEXT,
  "title" TEXT NOT NULL,
  "body" TEXT,
  "type" TEXT NOT NULL DEFAULT 'note',
  "status" TEXT NOT NULL DEFAULT 'active',
  "priority" TEXT NOT NULL DEFAULT 'medium',
  "tags" TEXT NOT NULL DEFAULT '[]',
  "externalUrl" TEXT,
  "pinned" BOOLEAN NOT NULL DEFAULT FALSE,
  "versionLabel" TEXT,
  "reviewDueAt" TIMESTAMP(3),
  "approvedAt" TIMESTAMP(3),
  "visibility" TEXT NOT NULL DEFAULT 'internal',
  "lifecycleNotes" TEXT,
  "changelog" TEXT NOT NULL DEFAULT '[]',
  "fileName" TEXT,
  "originalName" TEXT,
  "mimeType" TEXT,
  "sizeBytes" INTEGER,
  "checksumSha256" TEXT,
  "extension" TEXT,
  "previewText" TEXT,
  "metadata" TEXT NOT NULL DEFAULT '{}',
  "source" TEXT NOT NULL DEFAULT 'manual',
  "fileModifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE "FolderPermission" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "folderId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "access" TEXT NOT NULL DEFAULT 'view',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "ContextPack" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "payload" TEXT NOT NULL,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "TimeEntry" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "projectId" TEXT,
  "boardId" TEXT,
  "cardId" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "category" TEXT NOT NULL DEFAULT 'work',
  "timezone" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "endedAt" TIMESTAMP(3),
  "durationMinutes" INTEGER,
  "billable" BOOLEAN NOT NULL DEFAULT FALSE,
  "source" TEXT NOT NULL DEFAULT 'manual',
  "createdById" TEXT,
  "updatedById" TEXT,
  "lockedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "TimeBreak" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "timeEntryId" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'unpaid',
  "note" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "endedAt" TIMESTAMP(3),
  "durationMinutes" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "TimesheetWeek" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "weekStart" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "submittedAt" TIMESTAMP(3),
  "submittedById" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewedById" TEXT,
  "reviewNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "ScheduleBlock" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT,
  "projectId" TEXT,
  "boardId" TEXT,
  "cardId" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'work',
  "color" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "ProjectShareLink" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "tokenPreview" TEXT NOT NULL,
  "accessLevel" TEXT NOT NULL DEFAULT 'viewer',
  "allowedSections" TEXT NOT NULL DEFAULT '["overview"]',
  "expiresAt" TIMESTAMP(3),
  "maxUses" INTEGER,
  "useCount" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'active',
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "AccessRule" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "targetKind" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "projectId" TEXT,
  "subjectKind" TEXT NOT NULL,
  "subjectId" TEXT,
  "subjectName" TEXT NOT NULL,
  "effect" TEXT NOT NULL DEFAULT 'allow',
  "level" TEXT NOT NULL DEFAULT 'view',
  "sections" TEXT NOT NULL DEFAULT '[]',
  "status" TEXT NOT NULL DEFAULT 'active',
  "expiresAt" TIMESTAMP(3),
  "notes" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "AppSetting" (
  "key" TEXT NOT NULL PRIMARY KEY,
  "value" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "ClientStateRecord" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "scope" TEXT NOT NULL,
  "scopeId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "payload" TEXT NOT NULL DEFAULT 'null',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "ClusterPersistenceRecord" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "kind" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "projectId" TEXT,
  "entityType" TEXT,
  "entityId" TEXT,
  "userId" TEXT,
  "ownerId" TEXT,
  "status" TEXT,
  "visibility" TEXT DEFAULT 'internal',
  "sourceKey" TEXT,
  "schemaVersion" INTEGER NOT NULL DEFAULT 1,
  "checksum" TEXT,
  "validationState" TEXT NOT NULL DEFAULT 'unchecked',
  "validationSummary" TEXT,
  "lastValidatedAt" TIMESTAMP(3),
  "locked" BOOLEAN NOT NULL DEFAULT FALSE,
  "deletedAt" TIMESTAMP(3),
  "payload" TEXT NOT NULL DEFAULT '{}',
  "archived" BOOLEAN NOT NULL DEFAULT FALSE,
  "syncedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE "PersistenceAuditLog" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "recordId" TEXT,
  "kind" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "actorId" TEXT,
  "summary" TEXT NOT NULL,
  "metadata" TEXT NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "ClusterSyncDevice" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "name" TEXT,
  "platform" TEXT,
  "clientVersion" TEXT,
  "mutationSchemaVersion" INTEGER NOT NULL DEFAULT 1,
  "lastCursor" TEXT,
  "lastSeenAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "ClusterSyncReceipt" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "mutationId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "statusCode" INTEGER NOT NULL,
  "responsePayload" TEXT,
  "requestId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL
);

CREATE TABLE "ClusterSyncConflict" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "deviceId" TEXT NOT NULL,
  "mutationId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "entityType" TEXT,
  "entityId" TEXT,
  "classification" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "localPayload" TEXT,
  "serverPayload" TEXT,
  "allowedActions" TEXT NOT NULL,
  "resolution" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL,
  "resolvedAt" TIMESTAMP(3)
);

CREATE TABLE "SyncTombstone" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT,
  "projectId" TEXT,
  "parentEntityId" TEXT,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "visibleToUserIds" TEXT NOT NULL DEFAULT '[]',
  "deletedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "User_discordUserId_key" ON "User"("discordUserId");
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
CREATE UNIQUE INDEX "User_employeeNumber_key" ON "User"("employeeNumber");
CREATE INDEX "User_accountState_lockedUntil_idx" ON "User"("accountState", "lockedUntil");
CREATE INDEX "User_pinLockedUntil_idx" ON "User"("pinLockedUntil");
CREATE INDEX "User_archived_updatedAt_idx" ON "User"("archived", "updatedAt");
CREATE INDEX "User_status_lastSeenAt_idx" ON "User"("status", "lastSeenAt");

CREATE INDEX "AvatarAudit_userId_createdAt_idx" ON "AvatarAudit"("userId", "createdAt");
CREATE INDEX "AvatarAudit_status_createdAt_idx" ON "AvatarAudit"("status", "createdAt");

CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");
CREATE INDEX "Session_userId_lastSeenAt_idx" ON "Session"("userId", "lastSeenAt");
CREATE INDEX "Session_userId_revokedAt_expiresAt_idx" ON "Session"("userId", "revokedAt", "expiresAt");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

CREATE INDEX "AccountSetupCredential_userId_createdAt_idx" ON "AccountSetupCredential"("userId", "createdAt");
CREATE INDEX "AccountSetupCredential_expiresAt_consumedAt_idx" ON "AccountSetupCredential"("expiresAt", "consumedAt");

CREATE UNIQUE INDEX "DiscordLinkChallenge_stateHash_key" ON "DiscordLinkChallenge"("stateHash");
CREATE INDEX "DiscordLinkChallenge_userId_createdAt_idx" ON "DiscordLinkChallenge"("userId", "createdAt");
CREATE INDEX "DiscordLinkChallenge_sessionId_idx" ON "DiscordLinkChallenge"("sessionId");
CREATE INDEX "DiscordLinkChallenge_expiresAt_consumedAt_idx" ON "DiscordLinkChallenge"("expiresAt", "consumedAt");

CREATE INDEX "SecurityAuditEvent_occurredAt_idx" ON "SecurityAuditEvent"("occurredAt");
CREATE INDEX "SecurityAuditEvent_event_occurredAt_idx" ON "SecurityAuditEvent"("event", "occurredAt");
CREATE INDEX "SecurityAuditEvent_targetUserId_occurredAt_idx" ON "SecurityAuditEvent"("targetUserId", "occurredAt");
CREATE INDEX "SecurityAuditEvent_workspaceId_occurredAt_idx" ON "SecurityAuditEvent"("workspaceId", "occurredAt");


CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_userId_key" ON "WorkspaceMember"("workspaceId", "userId");

CREATE UNIQUE INDEX "Project_libraryFolderId_key" ON "Project"("libraryFolderId");
CREATE INDEX "Project_workspaceId_archived_updatedAt_idx" ON "Project"("workspaceId", "archived", "updatedAt");
CREATE INDEX "Project_status_archived_idx" ON "Project"("status", "archived");
CREATE INDEX "Project_targetDate_archived_idx" ON "Project"("targetDate", "archived");
CREATE INDEX "Project_priority_archived_updatedAt_idx" ON "Project"("priority", "archived", "updatedAt");

CREATE INDEX "ProjectControlRecord_projectId_kind_archived_status_idx" ON "ProjectControlRecord"("projectId", "kind", "archived", "status");
CREATE INDEX "ProjectControlRecord_projectId_dueDate_archived_idx" ON "ProjectControlRecord"("projectId", "dueDate", "archived");
CREATE INDEX "ProjectControlRecord_projectId_parentId_sortOrder_idx" ON "ProjectControlRecord"("projectId", "parentId", "sortOrder");
CREATE INDEX "ProjectControlRecord_ownerId_status_dueDate_idx" ON "ProjectControlRecord"("ownerId", "status", "dueDate");

CREATE UNIQUE INDEX "ProjectRelationship_unique_relation_key" ON "ProjectRelationship"("projectId", "sourceType", "sourceId", "targetType", "targetId", "relationship");
CREATE INDEX "ProjectRelationship_projectId_sourceType_sourceId_idx" ON "ProjectRelationship"("projectId", "sourceType", "sourceId");
CREATE INDEX "ProjectRelationship_projectId_targetType_targetId_idx" ON "ProjectRelationship"("projectId", "targetType", "targetId");
CREATE INDEX "ProjectRelationship_projectId_relationship_critical_idx" ON "ProjectRelationship"("projectId", "relationship", "critical");

CREATE INDEX "VideoAsset_projectId_idx" ON "VideoAsset"("projectId");
CREATE INDEX "VideoAsset_pool_idx" ON "VideoAsset"("pool");
CREATE INDEX "VideoAsset_status_idx" ON "VideoAsset"("status");
CREATE INDEX "VideoAsset_projectId_updatedAt_idx" ON "VideoAsset"("projectId", "updatedAt");
CREATE INDEX "VideoAsset_status_updatedAt_idx" ON "VideoAsset"("status", "updatedAt");

CREATE INDEX "VideoComment_videoAssetId_idx" ON "VideoComment"("videoAssetId");
CREATE INDEX "VideoComment_timecodeSeconds_idx" ON "VideoComment"("timecodeSeconds");

CREATE INDEX "ProjectFile_projectId_idx" ON "ProjectFile"("projectId");
CREATE INDEX "ProjectFile_category_idx" ON "ProjectFile"("category");
CREATE INDEX "ProjectFile_projectId_updatedAt_idx" ON "ProjectFile"("projectId", "updatedAt");

CREATE INDEX "Board_projectId_archived_updatedAt_idx" ON "Board"("projectId", "archived", "updatedAt");

CREATE INDEX "BoardList_boardId_position_idx" ON "BoardList"("boardId", "position");
CREATE INDEX "BoardList_boardId_isDone_position_idx" ON "BoardList"("boardId", "isDone", "position");

CREATE INDEX "Card_listId_archived_position_idx" ON "Card"("listId", "archived", "position");
CREATE INDEX "Card_assigneeId_archived_dueDate_idx" ON "Card"("assigneeId", "archived", "dueDate");
CREATE INDEX "Card_archived_updatedAt_idx" ON "Card"("archived", "updatedAt");
CREATE INDEX "Card_priority_archived_dueDate_idx" ON "Card"("priority", "archived", "dueDate");


CREATE INDEX "CardComment_cardId_createdAt_idx" ON "CardComment"("cardId", "createdAt");
CREATE INDEX "CardComment_userId_createdAt_idx" ON "CardComment"("userId", "createdAt");

CREATE INDEX "EntityComment_entityType_entityId_createdAt_idx" ON "EntityComment"("entityType", "entityId", "createdAt");
CREATE INDEX "EntityComment_userId_createdAt_idx" ON "EntityComment"("userId", "createdAt");


CREATE INDEX "Whiteboard_projectId_updatedAt_idx" ON "Whiteboard"("projectId", "updatedAt");
CREATE INDEX "Whiteboard_updatedAt_idx" ON "Whiteboard"("updatedAt");

CREATE INDEX "CalendarEvent_startsAt_idx" ON "CalendarEvent"("startsAt");
CREATE INDEX "CalendarEvent_projectId_startsAt_idx" ON "CalendarEvent"("projectId", "startsAt");
CREATE INDEX "CalendarEvent_ownerId_startsAt_idx" ON "CalendarEvent"("ownerId", "startsAt");
CREATE INDEX "CalendarEvent_status_startsAt_idx" ON "CalendarEvent"("status", "startsAt");

CREATE INDEX "ActivityEvent_createdAt_idx" ON "ActivityEvent"("createdAt");
CREATE INDEX "ActivityEvent_projectId_createdAt_idx" ON "ActivityEvent"("projectId", "createdAt");
CREATE INDEX "ActivityEvent_userId_createdAt_idx" ON "ActivityEvent"("userId", "createdAt");
CREATE INDEX "ActivityEvent_entityType_idx" ON "ActivityEvent"("entityType");
CREATE INDEX "ActivityEvent_type_idx" ON "ActivityEvent"("type");

CREATE INDEX "TimelineItem_startsAt_idx" ON "TimelineItem"("startsAt");
CREATE INDEX "TimelineItem_type_idx" ON "TimelineItem"("type");
CREATE INDEX "TimelineItem_projectId_startsAt_idx" ON "TimelineItem"("projectId", "startsAt");
CREATE INDEX "TimelineItem_userId_startsAt_idx" ON "TimelineItem"("userId", "startsAt");
CREATE INDEX "TimelineItem_updatedAt_idx" ON "TimelineItem"("updatedAt");

CREATE INDEX "KnowledgeItem_projectId_idx" ON "KnowledgeItem"("projectId");
CREATE INDEX "KnowledgeItem_projectId_parentId_status_idx" ON "KnowledgeItem"("projectId", "parentId", "status");
CREATE INDEX "KnowledgeItem_parentId_status_updatedAt_idx" ON "KnowledgeItem"("parentId", "status", "updatedAt");
CREATE INDEX "KnowledgeItem_ownerId_idx" ON "KnowledgeItem"("ownerId");
CREATE INDEX "KnowledgeItem_reviewerId_idx" ON "KnowledgeItem"("reviewerId");
CREATE INDEX "KnowledgeItem_type_idx" ON "KnowledgeItem"("type");
CREATE INDEX "KnowledgeItem_status_idx" ON "KnowledgeItem"("status");
CREATE INDEX "KnowledgeItem_visibility_idx" ON "KnowledgeItem"("visibility");
CREATE INDEX "KnowledgeItem_mimeType_idx" ON "KnowledgeItem"("mimeType");
CREATE INDEX "KnowledgeItem_source_idx" ON "KnowledgeItem"("source");
CREATE INDEX "KnowledgeItem_pinned_updatedAt_idx" ON "KnowledgeItem"("pinned", "updatedAt");
CREATE INDEX "KnowledgeItem_reviewDueAt_idx" ON "KnowledgeItem"("reviewDueAt");
CREATE INDEX "KnowledgeItem_updatedAt_idx" ON "KnowledgeItem"("updatedAt");

CREATE UNIQUE INDEX "FolderPermission_folderId_userId_key" ON "FolderPermission"("folderId", "userId");
CREATE INDEX "FolderPermission_userId_access_idx" ON "FolderPermission"("userId", "access");
CREATE INDEX "FolderPermission_folderId_access_idx" ON "FolderPermission"("folderId", "access");


CREATE INDEX "TimeEntry_userId_startedAt_idx" ON "TimeEntry"("userId", "startedAt");
CREATE INDEX "TimeEntry_userId_endedAt_idx" ON "TimeEntry"("userId", "endedAt");
CREATE INDEX "TimeEntry_projectId_startedAt_idx" ON "TimeEntry"("projectId", "startedAt");
CREATE INDEX "TimeEntry_cardId_idx" ON "TimeEntry"("cardId");
CREATE INDEX "TimeEntry_startedAt_idx" ON "TimeEntry"("startedAt");

CREATE INDEX "TimeBreak_timeEntryId_startedAt_idx" ON "TimeBreak"("timeEntryId", "startedAt");
CREATE INDEX "TimeBreak_endedAt_idx" ON "TimeBreak"("endedAt");

CREATE UNIQUE INDEX "TimesheetWeek_userId_weekStart_key" ON "TimesheetWeek"("userId", "weekStart");
CREATE INDEX "TimesheetWeek_status_weekStart_idx" ON "TimesheetWeek"("status", "weekStart");
CREATE INDEX "TimesheetWeek_weekStart_idx" ON "TimesheetWeek"("weekStart");

CREATE INDEX "ScheduleBlock_startsAt_idx" ON "ScheduleBlock"("startsAt");
CREATE INDEX "ScheduleBlock_userId_startsAt_idx" ON "ScheduleBlock"("userId", "startsAt");

CREATE UNIQUE INDEX "ProjectShareLink_tokenHash_key" ON "ProjectShareLink"("tokenHash");
CREATE INDEX "ProjectShareLink_projectId_status_idx" ON "ProjectShareLink"("projectId", "status");
CREATE INDEX "ProjectShareLink_expiresAt_idx" ON "ProjectShareLink"("expiresAt");

CREATE INDEX "AccessRule_targetKind_targetId_idx" ON "AccessRule"("targetKind", "targetId");
CREATE INDEX "AccessRule_projectId_idx" ON "AccessRule"("projectId");
CREATE INDEX "AccessRule_subjectKind_subjectId_idx" ON "AccessRule"("subjectKind", "subjectId");
CREATE INDEX "AccessRule_effect_idx" ON "AccessRule"("effect");
CREATE INDEX "AccessRule_status_idx" ON "AccessRule"("status");


CREATE UNIQUE INDEX "ClientStateRecord_scope_scopeId_key_key" ON "ClientStateRecord"("scope", "scopeId", "key");
CREATE INDEX "ClientStateRecord_scopeId_updatedAt_idx" ON "ClientStateRecord"("scopeId", "updatedAt");
CREATE INDEX "ClientStateRecord_scope_key_idx" ON "ClientStateRecord"("scope", "key");

CREATE INDEX "ClusterPersistenceRecord_kind_idx" ON "ClusterPersistenceRecord"("kind");
CREATE INDEX "ClusterPersistenceRecord_projectId_idx" ON "ClusterPersistenceRecord"("projectId");
CREATE INDEX "ClusterPersistenceRecord_entityType_entityId_idx" ON "ClusterPersistenceRecord"("entityType", "entityId");
CREATE INDEX "ClusterPersistenceRecord_userId_idx" ON "ClusterPersistenceRecord"("userId");
CREATE INDEX "ClusterPersistenceRecord_ownerId_idx" ON "ClusterPersistenceRecord"("ownerId");
CREATE INDEX "ClusterPersistenceRecord_status_idx" ON "ClusterPersistenceRecord"("status");
CREATE INDEX "ClusterPersistenceRecord_sourceKey_idx" ON "ClusterPersistenceRecord"("sourceKey");
CREATE INDEX "ClusterPersistenceRecord_schemaVersion_idx" ON "ClusterPersistenceRecord"("schemaVersion");
CREATE INDEX "ClusterPersistenceRecord_checksum_idx" ON "ClusterPersistenceRecord"("checksum");
CREATE INDEX "ClusterPersistenceRecord_validationState_idx" ON "ClusterPersistenceRecord"("validationState");
CREATE INDEX "ClusterPersistenceRecord_locked_idx" ON "ClusterPersistenceRecord"("locked");
CREATE INDEX "ClusterPersistenceRecord_archived_idx" ON "ClusterPersistenceRecord"("archived");
CREATE INDEX "ClusterPersistenceRecord_deletedAt_idx" ON "ClusterPersistenceRecord"("deletedAt");
CREATE INDEX "ClusterPersistenceRecord_updatedAt_idx" ON "ClusterPersistenceRecord"("updatedAt");
CREATE INDEX "ClusterPersistenceRecord_projectId_kind_archived_updatedAt_idx" ON "ClusterPersistenceRecord"("projectId", "kind", "archived", "updatedAt");
CREATE INDEX "ClusterPersistenceRecord_projectId_kind_entityId_idx" ON "ClusterPersistenceRecord"("projectId", "kind", "entityId");

CREATE INDEX "PersistenceAuditLog_recordId_idx" ON "PersistenceAuditLog"("recordId");
CREATE INDEX "PersistenceAuditLog_kind_idx" ON "PersistenceAuditLog"("kind");
CREATE INDEX "PersistenceAuditLog_action_idx" ON "PersistenceAuditLog"("action");
CREATE INDEX "PersistenceAuditLog_actorId_idx" ON "PersistenceAuditLog"("actorId");
CREATE INDEX "PersistenceAuditLog_createdAt_idx" ON "PersistenceAuditLog"("createdAt");


CREATE INDEX "ClusterSyncDevice_userId_lastSeenAt_idx" ON "ClusterSyncDevice"("userId", "lastSeenAt");

CREATE UNIQUE INDEX "ClusterSyncReceipt_userId_deviceId_idempotencyKey_key" ON "ClusterSyncReceipt"("userId", "deviceId", "idempotencyKey");
CREATE INDEX "ClusterSyncReceipt_deviceId_createdAt_idx" ON "ClusterSyncReceipt"("deviceId", "createdAt");

CREATE INDEX "ClusterSyncConflict_userId_status_createdAt_idx" ON "ClusterSyncConflict"("userId", "status", "createdAt");
CREATE INDEX "ClusterSyncConflict_deviceId_status_createdAt_idx" ON "ClusterSyncConflict"("deviceId", "status", "createdAt");

CREATE INDEX "SyncTombstone_deletedAt_idx" ON "SyncTombstone"("deletedAt");
CREATE INDEX "SyncTombstone_projectId_deletedAt_idx" ON "SyncTombstone"("projectId", "deletedAt");
CREATE INDEX "SyncTombstone_entityType_entityId_idx" ON "SyncTombstone"("entityType", "entityId");

ALTER TABLE "AvatarAudit" ADD CONSTRAINT "AvatarAudit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountSetupCredential" ADD CONSTRAINT "AccountSetupCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiscordLinkChallenge" ADD CONSTRAINT "DiscordLinkChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DiscordLinkChallenge" ADD CONSTRAINT "DiscordLinkChallenge_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SecurityAuditEvent" ADD CONSTRAINT "SecurityAuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SecurityAuditEvent" ADD CONSTRAINT "SecurityAuditEvent_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Project" ADD CONSTRAINT "Project_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Project" ADD CONSTRAINT "Project_libraryFolderId_fkey" FOREIGN KEY ("libraryFolderId") REFERENCES "KnowledgeItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProjectControlRecord" ADD CONSTRAINT "ProjectControlRecord_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectRelationship" ADD CONSTRAINT "ProjectRelationship_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VideoAsset" ADD CONSTRAINT "VideoAsset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VideoComment" ADD CONSTRAINT "VideoComment_videoAssetId_fkey" FOREIGN KEY ("videoAssetId") REFERENCES "VideoAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VideoComment" ADD CONSTRAINT "VideoComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProjectFile" ADD CONSTRAINT "ProjectFile_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Board" ADD CONSTRAINT "Board_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BoardList" ADD CONSTRAINT "BoardList_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Card" ADD CONSTRAINT "Card_listId_fkey" FOREIGN KEY ("listId") REFERENCES "BoardList"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Card" ADD CONSTRAINT "Card_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ChecklistItem" ADD CONSTRAINT "ChecklistItem_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CardComment" ADD CONSTRAINT "CardComment_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CardComment" ADD CONSTRAINT "CardComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "EntityComment" ADD CONSTRAINT "EntityComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CardActivity" ADD CONSTRAINT "CardActivity_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Whiteboard" ADD CONSTRAINT "Whiteboard_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CalendarEvent" ADD CONSTRAINT "CalendarEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_whiteboardId_fkey" FOREIGN KEY ("whiteboardId") REFERENCES "Whiteboard"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ActivityEvent" ADD CONSTRAINT "ActivityEvent_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TimelineItem" ADD CONSTRAINT "TimelineItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TimelineItem" ADD CONSTRAINT "TimelineItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KnowledgeItem" ADD CONSTRAINT "KnowledgeItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KnowledgeItem" ADD CONSTRAINT "KnowledgeItem_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KnowledgeItem" ADD CONSTRAINT "KnowledgeItem_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KnowledgeItem" ADD CONSTRAINT "KnowledgeItem_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "KnowledgeItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "FolderPermission" ADD CONSTRAINT "FolderPermission_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "KnowledgeItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FolderPermission" ADD CONSTRAINT "FolderPermission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContextPack" ADD CONSTRAINT "ContextPack_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TimeEntry" ADD CONSTRAINT "TimeEntry_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TimeBreak" ADD CONSTRAINT "TimeBreak_timeEntryId_fkey" FOREIGN KEY ("timeEntryId") REFERENCES "TimeEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TimesheetWeek" ADD CONSTRAINT "TimesheetWeek_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ScheduleBlock" ADD CONSTRAINT "ScheduleBlock_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ScheduleBlock" ADD CONSTRAINT "ScheduleBlock_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ScheduleBlock" ADD CONSTRAINT "ScheduleBlock_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ScheduleBlock" ADD CONSTRAINT "ScheduleBlock_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ProjectShareLink" ADD CONSTRAINT "ProjectShareLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
