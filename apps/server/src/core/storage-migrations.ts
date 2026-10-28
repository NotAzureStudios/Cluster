export type StorageVerificationResult = {
  ok: true;
  verifiedAt: string;
  appliedMigrations: string[];
};

export type StorageSchemaStatus = {
  ok: boolean;
  checkedAt: string;
  appliedMigrations: string[];
  missingTables: string[];
  missingColumns: Array<{ table: string; columns: string[] }>;
  missingIndexes: string[];
  migrationState: {
    historyAvailable: boolean;
    incomplete: Array<{ migrationName: string; startedAt: string | null; logs: string | null }>;
    latestApplied: string | null;
    requiredLatest: string;
    requiredLatestApplied: boolean;
  };
};

type PrismaRawClient = {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
};

type VerificationLogger = {
  info?: (payload: unknown, message?: string) => void;
  warn?: (payload: unknown, message?: string) => void;
};

const REQUIRED_LATEST_MIGRATION = "20261114000000_rc45_discord_role_index_name";

const REQUIRED_TABLES = [
  "User", "AvatarAudit", "Session", "DiscordLinkChallenge", "DiscordRoleProjection", "SecurityAuditEvent",
  "Workspace", "WorkspaceMember", "StudioTeam", "StudioTeamMember", "Project", "ProjectControlRecord", "ProjectRelationship", "ReviewAsset", "AssetArtifact", "MediaWorkerHeartbeat", "MediaProcessingPolicy",
  "ReviewComment", "ProjectFile", "Board", "BoardList", "Card", "ChecklistItem", "CardComment", "EntityComment",
  "CardActivity", "Whiteboard", "CalendarEvent", "ActivityEvent", "TimelineItem", "LibraryItem", "FolderPermission",
  "ContextPack", "TimeEntry", "TimeBreak", "ScheduleBlock", "ScheduleResource", "ScheduleBlockResource", "ProjectShareLink", "AccessRule",
  "AppSetting", "LegalPolicyVersion", "PolicyAcceptance", "ThirdPartyDisclosureProvider", "BehavioralAnalyticsProvider", "BehavioralAnalyticsEvent", "PrivacyConsentPreference", "PrivacyDataRequest", "PrivacyLegalHold", "PrivacyErasureReceipt", "DataRetentionPolicy", "DataRetentionRun", "CopyrightCase", "CopyrightCounterNotice", "CopyrightEvidence", "CopyrightCaseEvent", "CopyrightResourceRestriction", "CopyrightStrike", "SavedDataView", "ClientStateRecord", "ClusterPersistenceRecord", "PersistenceAuditLog", "ApiMutationReceipt",
  "ClusterSyncDevice", "ClusterSyncReceipt", "ClusterSyncConflict", "SyncTombstone",
  "BackgroundJob", "BackgroundJobAttempt", "LibraryBulkCheckpoint", "NotificationInboxItem", "NotificationDigestDelivery",
  "DeviceRegistration", "Authenticator", "AuthenticatorRecoveryCode", "AuthenticatorChallenge", "ServiceCredential",
] as const;

const REQUIRED_INDEXES = [
  "Session_tokenHash_key",
  "Session_userId_deviceId_revokedAt_expiresAt_idx",
  "DeviceRegistration_userId_deviceId_key",
  "DeviceRegistration_userId_revokedAt_lastSeenAt_idx",
  "DeviceRegistration_deviceId_lastSeenAt_idx",
  "Authenticator_credentialId_key",
  "Authenticator_userId_state_kind_idx",
  "Authenticator_userId_revokedAt_lastUsedAt_idx",
  "AuthenticatorRecoveryCode_codeHash_key",
  "AuthenticatorRecoveryCode_userId_consumedAt_createdAt_idx",
  "AuthenticatorChallenge_challengeHash_key",
  "AuthenticatorChallenge_userId_flow_consumedAt_expiresAt_idx",
  "AuthenticatorChallenge_authenticatorId_consumedAt_expiresAt_idx",
  "AuthenticatorChallenge_expiresAt_consumedAt_idx",
  "ServiceCredential_tokenHash_key",
  "ServiceCredential_credentialType_revokedAt_expiresAt_idx",
  "ServiceCredential_createdById_revokedAt_createdAt_idx",
  "DiscordRoleProjection_owner_key",
  "DiscordRoleProjection_connectionId_guildId_status_idx",
  "DiscordRoleProjection_userId_status_idx",
  "WorkspaceMember_workspaceId_userId_key",
  "StudioTeam_workspaceId_name_key",
  "StudioTeam_workspaceId_archived_updatedAt_idx",
  "StudioTeam_leadUserId_archived_idx",
  "StudioTeamMember_teamId_userId_key",
  "StudioTeamMember_userId_archived_primaryMembership_idx",
  "StudioTeamMember_teamId_archived_idx",
    // User.managerUserId was retired by WIP43. PostgreSQL dropped its index with the column.
  "Project_workspaceId_archived_updatedAt_idx",
  "Board_projectId_archived_updatedAt_idx",
  "BoardList_boardId_isDone_position_idx",
  "Card_listId_archived_position_idx",
  "Card_archived_dueDate_idx",
  "LibraryItem_projectId_parentId_status_idx",
  "SavedDataView_workspaceId_scope_visibility_archived_updatedAt_i",
  "SavedDataView_ownerId_scope_archived_updatedAt_idx",
  "SavedDataView_projectId_scope_archived_updatedAt_idx",
  "SavedDataView_workspaceId_scope_isDefault_archived_idx",
  "ClientStateRecord_scope_scopeId_key_key",
  "ClusterSyncReceipt_userId_deviceId_idempotencyKey_key",
  "ApiMutationReceipt_userId_method_path_idempotencyKey_key",
  "ApiMutationReceipt_state_updatedAt_idx",
  "LegalPolicyVersion_kind_version_key",
  "LegalPolicyVersion_kind_status_effectiveAt_idx",
  "PolicyAcceptance_evidenceHash_key",
  "PolicyAcceptance_subjectPolicyKey_key",
  "PolicyAcceptance_policyId_acceptedAt_idx",
  "PolicyAcceptance_userId_acceptedAt_idx",
  "ThirdPartyDisclosureProvider_sourceKey_key",
  "ThirdPartyDisclosureProvider_status_publicVisible_idx",
  "ThirdPartyDisclosureProvider_category_idx",
  "ThirdPartyDisclosureProvider_reviewedAt_idx",
  "BehavioralAnalyticsProvider_enabled_reviewedAt_idx",
  "BehavioralAnalyticsProvider_adapter_idx",
  "BehavioralAnalyticsEvent_providerId_createdAt_idx",
  "BehavioralAnalyticsEvent_userId_createdAt_idx",
  "BehavioralAnalyticsEvent_eventName_createdAt_idx",
  "BehavioralAnalyticsEvent_surface_createdAt_idx",
  "PrivacyConsentPreference_userId_key",
  "PrivacyConsentPreference_noticeVersion_updatedAt_idx",
  "PrivacyDataRequest_userId_status_requestedAt_idx",
  "PrivacyDataRequest_requestType_status_requestedAt_idx",
  "PrivacyLegalHold_userId_status_createdAt_idx",
  "PrivacyLegalHold_status_createdAt_idx",
  "PrivacyErasureReceipt_requestId_key",
  "PrivacyErasureReceipt_userId_createdAt_idx",
  "PrivacyErasureReceipt_actorUserId_createdAt_idx",
  "DataRetentionPolicy_enabled_retentionDays_idx",
  "DataRetentionPolicy_updatedAt_idx",
  "DataRetentionRun_createdAt_idx",
  "DataRetentionRun_status_createdAt_idx",
  "DataRetentionRun_actorUserId_createdAt_idx",
  "CopyrightCase_publicReference_key",
  "CopyrightCase_status_submittedAt_idx",
  "CopyrightCounterNotice_caseId_key",
  "CopyrightResourceRestriction_active_resource_key",
  "CopyrightStrike_caseId_userId_key",
  "CopyrightStrike_userId_status_createdAt_idx",
  "AssetArtifact_reviewAssetId_kind_variantKey_key",
  "AssetArtifact_reviewAssetId_kind_idx",
  "AssetArtifact_kind_updatedAt_idx",
  "MediaWorkerHeartbeat_status_lastSeenAt_idx",
  "MediaWorkerHeartbeat_desiredState_lastSeenAt_idx",
  "MediaWorkerHeartbeat_selectedAcceleration_status_idx",
  "MediaProcessingPolicy_projectType_medium_assetRole_key",
  "MediaProcessingPolicy_enabled_projectType_medium_idx",
  "BackgroundJob_status_runAfter_priority_idx",
  "BackgroundJob_queue_status_runAfter_idx",
  "BackgroundJob_type_status_createdAt_idx",
  "BackgroundJob_dedupeKey_status_idx",
  "BackgroundJob_library_bulk_intent_once_idx",
  "BackgroundJob_finishedAt_idx",
  "BackgroundJobAttempt_jobId_attempt_key",
  "BackgroundJobAttempt_jobId_startedAt_idx",
  "BackgroundJobAttempt_status_startedAt_idx",
  "NotificationInboxItem_userId_activityEventId_key",
  "NotificationInboxItem_userId_dismissedAt_createdAt_idx",
  "NotificationInboxItem_userId_readAt_createdAt_idx",
  "NotificationInboxItem_userId_snoozedUntil_createdAt_idx",
  "NotificationInboxItem_userId_priority_createdAt_idx",
  "NotificationInboxItem_userId_category_createdAt_idx",
  "NotificationInboxItem_userId_groupKey_createdAt_idx",
  "NotificationInboxItem_userId_tool_createdAt_idx",
  "NotificationInboxItem_userId_signal_createdAt_idx",
  "NotificationInboxItem_userId_requiresAction_readAt_createdAt_id",
  "NotificationInboxItem_userId_requiresAction_acknowledgedAt_esca",
  "NotificationInboxItem_lastEscalatedAt_idx",
  "NotificationInboxItem_projectId_createdAt_idx",
  "NotificationInboxItem_createdAt_idx",
  "NotificationDigestDelivery_userId_cadence_periodKey_key",
  "NotificationDigestDelivery_scheduledFor_deliveredAt_idx",
  "NotificationDigestDelivery_userId_deliveredAt_idx",
  "NotificationDigestDelivery_createdAt_idx",
  "ActivityEvent_cardId_createdAt_idx",
  "ActivityEvent_type_createdAt_idx",
  "ActivityEvent_entityType_createdAt_idx",
  "ProjectFile_projectId_archived_updatedAt_idx",
  "ProjectFile_projectId_category_assetRole_idx",
  "ProjectFile_projectId_versionGroupId_versionNumber_idx",
  "ProjectFile_projectId_checksumSha256_idx",
  "ProjectFile_projectId_status_updatedAt_idx",
  "ProjectFile_lockedById_lockExpiresAt_idx",
  "ProjectFile_ingestSessionId_key",
  "ProjectFile_projectId_versionGroupId_versionNumber_key",
  "ScheduleBlock_projectId_startsAt_idx",
  "ScheduleBlock_calendarEventId_idx",
  "ScheduleBlock_status_startsAt_idx",
  "ScheduleBlock_windowKind_startsAt_idx",
  "ScheduleBlock_recurrenceGroupId_recurrenceIndex_idx",
  "ScheduleResource_status_type_name_idx",
  "ScheduleResource_type_name_idx",
  "ScheduleResource_updatedAt_idx",
  "ScheduleBlockResource_blockId_resourceId_key",
  "ScheduleBlockResource_resourceId_blockId_idx",
] as const;

export async function inspectStorageSchema(prisma: PrismaRawClient): Promise<StorageSchemaStatus> {
  const [tableRows, indexRows, migrationInspection] = await Promise.all([
    prisma.$queryRawUnsafe<Array<{ table_name: string }>>("SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema()"),
    prisma.$queryRawUnsafe<Array<{ indexname: string }>>("SELECT indexname FROM pg_indexes WHERE schemaname = current_schema()"),
    prisma.$queryRawUnsafe<Array<{ migration_name: string; started_at: Date | string | null; finished_at: Date | string | null; rolled_back_at: Date | string | null; logs: string | null }>>("SELECT migration_name, started_at, finished_at, rolled_back_at, logs FROM \"_prisma_migrations\" ORDER BY started_at").then((rows) => ({ available: true, rows })).catch(() => ({ available: false, rows: [] as Array<{ migration_name: string; started_at: Date | string | null; finished_at: Date | string | null; rolled_back_at: Date | string | null; logs: string | null }> })),
  ]);
  const migrationRows = migrationInspection.rows.filter((row) => row.finished_at != null && row.rolled_back_at == null);
  const incompleteMigrations = migrationInspection.rows.filter((row) => row.finished_at == null && row.rolled_back_at == null).map((row) => ({ migrationName: String(row.migration_name), startedAt: row.started_at ? new Date(row.started_at).toISOString() : null, logs: row.logs ? String(row.logs).slice(-2000) : null }));
  const appliedMigrationNames = migrationRows.map((row) => String(row.migration_name));
  const requiredLatestApplied = appliedMigrationNames.includes(REQUIRED_LATEST_MIGRATION);
  const tables = new Set(tableRows.map((row) => String(row.table_name)));
  const indexes = new Set(indexRows.map((row) => String(row.indexname)));
  const missingTables = REQUIRED_TABLES.filter((table) => !tables.has(table));
  const missingIndexes = REQUIRED_INDEXES.filter((index) => !indexes.has(index));
  const checkedAt = new Date().toISOString();
  return {
    ok: missingTables.length === 0 && missingIndexes.length === 0 && incompleteMigrations.length === 0 && migrationInspection.available && requiredLatestApplied,
    checkedAt,
    appliedMigrations: appliedMigrationNames,
    missingTables: [...missingTables],
    missingColumns: [],
    missingIndexes: [...missingIndexes],
    migrationState: {
      historyAvailable: migrationInspection.available,
      incomplete: incompleteMigrations,
      latestApplied: appliedMigrationNames.at(-1) || null,
      requiredLatest: REQUIRED_LATEST_MIGRATION,
      requiredLatestApplied,
    },
  };
}

export async function verifyStorageSchema(prisma: PrismaRawClient, logger?: VerificationLogger): Promise<StorageVerificationResult> {
  const status = await inspectStorageSchema(prisma);
  if (!status.ok) {
    logger?.warn?.(status, "PostgreSQL schema is not current");
    const migrationDetail = status.migrationState.incomplete.length
      ? ` Incomplete Prisma migrations: ${status.migrationState.incomplete.map((row) => row.migrationName).join(", ")}.`
      : !status.migrationState.historyAvailable
        ? " Prisma migration history is unavailable."
        : !status.migrationState.requiredLatestApplied
          ? ` Required migration ${status.migrationState.requiredLatest} is not applied.`
          : "";
    const error = new Error(`Cluster PostgreSQL schema is incomplete. Missing tables: ${status.missingTables.join(", ") || "none"}; missing indexes: ${status.missingIndexes.join(", ") || "none"}.${migrationDetail} Run npm run db:deploy; do not start Cluster against a partially migrated database.`) as Error & { code?: string };
    error.code = "DATABASE_SCHEMA_OUT_OF_DATE";
    throw error;
  }
  logger?.info?.({ migrations: status.appliedMigrations.length, verifiedAt: status.checkedAt }, "PostgreSQL schema verified");
  return { ok: true, verifiedAt: status.checkedAt, appliedMigrations: status.appliedMigrations };
}
