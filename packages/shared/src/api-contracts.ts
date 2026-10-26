import type { ClusterRemoteSearchScope, ClusterSearchResultKind } from "./cluster-manifest.js";
import type { ClusterResourceAddress } from "./resource-address.js";
import type { NotificationCategory, NotificationPriority, NotificationDeliveryMode, NotificationProjectMode, NotificationPriorityFloor, NotificationEscalationMode, NotificationTool, NotificationSignal } from "./notification-contracts.js";
export type { NotificationCategory, NotificationPriority, NotificationDeliveryMode, NotificationProjectMode, NotificationPriorityFloor, NotificationEscalationMode, NotificationTool, NotificationSignal } from "./notification-contracts.js";

export const CLUSTER_SERVER_CAPABILITIES = [
  "api-contracts",
  "client-transport-v2",
  "client-state",
  "direct-resource-authorization",
  "mutation-integrity-v2",
  "sync-integrity-v2",
  "offline-sync",
  "realtime-collaboration-v2",
  "tagged-query-invalidation",
  "renderer-performance-baseline-v2",
  "desktop-local-renderer",
  "desktop-durable-offline-cache",
  "desktop-resumable-transfers",
  "desktop-os-credential-vault",
  "desktop-native-notifications",
  "desktop-native-filesystem",
  "desktop-native-collaboration",
  "desktop-qa-capture",
  "desktop-multi-window",
  "desktop-offline-resilience",
  "project-workflows",
  "project-intelligence",
  "build-qa-traceability",
  "workflow-automation-v2",
  "work-inbox-v2",
  "operations-observability-v2",
  "search-v2",
  "postgresql-server",
  "postgresql-startup-lock",
  "postgresql-scalability-v2",
  "graceful-drain",
  "durable-background-jobs",
  "resumable-uploads",
  "cost-aware-backpressure",
  "backup-recovery-v2",
  "operational-health",
  "performance-budgets",
  "integration-provider-contract",
  "production-build-foundation",
  "production-distribution-foundation",
  "public-health-status-v2",
  "public-release-certification-v2",
  "accessibility-preferences",
  "policy-acceptance",
  "privacy-data-controls",
  "data-retention",
  "behavioral-analytics-consent",
] as const;

export type ClusterServerCapability = (typeof CLUSTER_SERVER_CAPABILITIES)[number];

export const API_CONTRACT = {
  version: "2026-08-02.63",
  compatibility: "0.505.x",
  minimumClientVersion: "0.505.0",
  responseHeaders: {
    requestId: "X-Request-Id",
    clusterVersion: "X-Cluster-Version",
    contractVersion: "X-Cluster-Api-Contract",
    minimumClientVersion: "X-Cluster-Minimum-Client-Version",
    transportProtocol: "X-Cluster-Transport-Protocol",
    clientCompatibility: "X-Cluster-Client-Compatibility",
    protocolCompatibility: "X-Cluster-Client-Protocol-Compatibility",
    serverState: "X-Cluster-Server-State",
  },
  identity: {
    sessionRotation: true,
    centralizedAuthorization: true,
    domainOwnedAuthRoutes: true,
    domainOwnedUsers: true,
    domainOwnedPresence: true,
    roleDirectory: "/api/roles",
    departmentDirectory: "/api/departments",
  },
  events: {
    durableDomainEventOutbox: true,
    resourceChangeFeed: true,
    resourceChangeCatchupEndpoint: "/api/changes",
    resourceChangeStreamEndpoint: "/api/changes/stream",
    domainEventMetrics: true,
    activityProjection: true,
    notificationProjection: true,
    securityAuditDomain: true,
    collaborationDomain: true,
  },
  pagination: {
    projectsMaximum: 500,
    ticketBoardsDefault: 160,
    ticketBoardsMaximum: 200,
    ticketUsersDefault: 1000,
    ticketUsersMaximum: 1000,
    activityDefault: 100,
    activityMaximum: 250,
    notificationsDefault: 100,
    notificationsMaximum: 250,
    securityEventsMaximum: 500,
    usersDefault: 200,
    usersMaximum: 500,
    auditDefault: 100,
    auditMaximum: 250,
    conflictsDefault: 50,
    conflictsMaximum: 200,
  },

  sync: {
    deviceIdentity: true,
    mutationSchemaVersion: 1,
    durableReceipts: true,
    signedScopeBoundCursors: true,
    authorizationFilteredDeltas: true,
    accountScopedDeviceIdentity: true,
    canonicalOfflineReplay: true,
    perDeviceAcknowledgements: true,
    conflictClassification: true,
    quarantinedOperations: true,
    tombstoneRetentionDays: 90,
    conflictActions: ["keep_mine", "keep_server", "merge", "restore", "duplicate", "discard"],
    syncCenterV2: true,
    serverDevicePosture: true,
  },

  search: {
    indexedCorpus: true,
    fuzzyRanking: true,
    scopedQueries: true,
    projectWorkflowKinds: ["control", "build", "qa", "release"],
    permissionAware: true,
    savedQueries: true,
    resourceNavigationHandoff: true,
    resultCacheSeconds: 5,
    indexRefreshSeconds: 15,
    maximumResults: 80,
  },
  notifications: {
    serverBackedInbox: true,
    durableReadState: true,
    snooze: true,
    dismissRestore: true,
    digest: true,
    cursorPagination: true,
    activityProjection: true,
  },
  integrations: {
    providerContractVersion: 1,
    trustedServerRegistrationOnly: true,
    dynamicCodeLoading: false,
    secretValuesExposedByCatalog: false,
    adminCatalogEndpoint: "/api/admin/integrations/providers",
  },
  tickets: {
    summaryWorkspace: true,
    summaryDetailMode: "summary",
    virtualizedClientRows: true,
    optimisticBulkMutations: true,
  },
  database: {
    providers: ["postgresql"],
    minimumPostgresqlMajor: 15,
    reviewedMigrations: true,
    transactionAdvisoryLock: true,
    mutationIdempotency: "durable-preclaim",
    optimisticConcurrency: true,
    nativeBackups: true,
    queryPercentiles: true,
    groupedQueryDiagnostics: true,
    tablePressureDiagnostics: true,
    indexUsageDiagnostics: true,
    performanceBudgeting: true,
    readModelBudgets: true,
  },
  storage: {
    schemaVerification: true,
    statusEndpoint: "/api/admin/storage/status",
    verifyEndpoint: "/api/admin/storage/verify",
  },
  clients: {
    modularRenderer: true,
    browserHost: true,
    nativeQtDesktop: true,
    nativeOfflineQueue: true,
    resumableUploads: true,
    nativeCredentialVault: true,
    nativeCollaboration: true,
    capabilityNegotiation: true,
    minimumTransportProtocolVersion: 1,
    transportProtocolVersion: 2,
    versionHeaders: true,
  },
  documentation: {
    openApi: "/api/meta/openapi.json",
    errorCodes: "/api/meta/error-codes",
    compatibility: "/api/meta/compatibility",
    deprecationPolicy: "pre-release-clean-slate",
  },
  domains: {
    auth: 1,
    sessions: 1,
    users: 1,
    roles: 1,
    departments: 1,
    presence: 1,
    access: 1,
    projects: 2,
    boards: 1,
    cards: 1,
    tickets: 2,
    activity: 1,
    notifications: 2,
    audit: 1,
    collaboration: 2,
    changes: 1,
    uploads: 1,
    sync: 3,
    diagnostics: 6,
    database: 3,
    storage: 1,
    openapi: 1,
    search: 2,
    legal: 9,
    privacy: 6,
    jobs: 1,
    automation: 2,
    architecture: 1,
  },
} as const;

export type ApiErrorCode =
  | "CLIENT_RENDER_ERROR"
  | "CLIENT_FEATURE_RENDER_ERROR"
  | "BAD_REQUEST"
  | "VALIDATION_FAILED"
  | "UNAUTHORIZED"
  | "AUTH_REQUIRED"
  | "AUTH_SESSION_UNAVAILABLE"
  | "PASSWORD_HASH_UNAVAILABLE"
  | "ACCOUNT_SETUP_REQUIRED"
  | "ACCESS_DENIED"
  | "RESOURCE_NOT_FOUND"
  | "ROUTE_NOT_FOUND"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VERSION_CONFLICT"
  | "REVISION_CONFLICT"
  | "IDEMPOTENCY_KEY_INVALID"
  | "IDEMPOTENCY_KEY_REUSED"
  | "IDEMPOTENCY_IN_PROGRESS"
  | "IDEMPOTENCY_ALREADY_COMMITTED"
  | "IDEMPOTENCY_RESULT_UNKNOWN"
  | "IDEMPOTENCY_UNAVAILABLE"
  | "RATE_LIMITED"
  | "TOOL_DISABLED"
  | "BODY_TOO_LARGE"
  | "STORAGE_SCHEMA_OUT_OF_DATE"
  | "STORAGE_VERIFY_FAILED"
  | "BACKGROUND_JOB_NOT_FOUND"
  | "BACKGROUND_JOB_RETRY_NOT_ALLOWED"
  | "BACKGROUND_JOB_CANCEL_NOT_ALLOWED"
  | "WORKSPACE_NOT_READY"
  | "PROJECT_LEAD_REQUIRED"
  | "PROJECT_CREATE_FAILED"
  | "PROJECT_LIBRARY_DEFERRED"
  | "CLIENT_ERROR"
  | "CLIENT_UPGRADE_REQUIRED"
  | "REQUEST_TIMEOUT"
  | "NETWORK_UNAVAILABLE"
  | "SERVER_RESPONSE_INVALID"
  | "SERVICE_UNAVAILABLE"
  | "PERMISSION_DENIED"
  | "ORIGIN_BLOCKED"
  | "DEPENDENCY_UNAVAILABLE"
  | "SYNC_DEVICE_OWNERSHIP_CONFLICT"
  | "SYNC_DEVICE_NOT_FOUND"
  | "SYNC_DUPLICATE_MUTATION_ID"
  | "SYNC_DEPENDENCY_ORDER_INVALID"
  | "SYNC_SENSITIVE_PAYLOAD_BLOCKED"
  | "SYNC_PATH_NOT_ALLOWED"
  | "SYNC_SCHEMA_UNSUPPORTED"
  | "SYNC_DEPENDENCY_FAILED"
  | "CONFLICT_RESOLUTION_NOT_ALLOWED"
  | "PRIVACY_POLICY_NOT_PUBLISHED"
  | "TERMS_NOT_PUBLISHED"
  | "OPERATOR_AGREEMENT_NOT_PUBLISHED"
  | "COPYRIGHT_POLICY_NOT_PUBLISHED"
  | "SECURITY_POLICY_NOT_PUBLISHED"
  | "COPYRIGHT_CASE_NOT_FOUND"
  | "COPYRIGHT_EVIDENCE_NOT_FOUND"
  | "COPYRIGHT_RESOURCE_NOT_FOUND"
  | "COPYRIGHT_RESOURCE_REQUIRED"
  | "COPYRIGHT_RESOURCE_ALREADY_DISABLED"
  | "COPYRIGHT_ACCESS_DISABLED"
  | "COPYRIGHT_COUNTER_NOT_AVAILABLE"
  | "COPYRIGHT_COUNTER_ALREADY_SUBMITTED"
  | "COPYRIGHT_COUNTER_FORWARD_CONFIRMATION_REQUIRED"
  | "COPYRIGHT_COUNTER_NOT_FORWARDED"
  | "COPYRIGHT_RESTORE_TOO_EARLY"
  | "COPYRIGHT_LEGAL_HOLD"
  | "COPYRIGHT_RESOURCE_NOT_DISABLED"
  | "COPYRIGHT_UPLOADER_UNKNOWN"
  | "COPYRIGHT_ACTION_NOTE_REQUIRED"
  | "POLICY_ACCEPTANCE_REQUIRED"
  | "POLICY_ACCEPTANCE_INVALID"
  | "POLICY_ACCEPTANCE_STALE"
  | "POLICY_ACCEPTANCE_INCOMPLETE"
  | "PRIVACY_CONSENT_NOTICE_STALE"
  | "ANALYTICS_CONSENT_REQUIRED"
  | "ANALYTICS_PROVIDER_REVIEW_REQUIRED"
  | "ANALYTICS_EVENT_INVALID"
  | "PRIVACY_DATA_REQUEST_EXISTS"
  | "PRIVACY_DATA_REQUEST_FINAL"
  | "PRIVACY_ERASURE_NOT_APPROVED"
  | "PRIVACY_ERASURE_SELF_BLOCKED"
  | "PRIVACY_ERASURE_LEGAL_HOLD"
  | "PRIVACY_LEGAL_HOLD_FINAL"
  | "PRIVACY_INTEGRATION_REQUIRED"
  | "RETENTION_CATEGORY_INVALID"
  | "LEGAL_POLICY_NOT_FOUND"
  | "LEGAL_POLICY_VERSION_EXISTS"
  | "LEGAL_POLICY_PUBLISHED_IMMUTABLE"
  | "LEGAL_POLICY_ALREADY_PUBLISHED"
  | "INTERNAL_ERROR";

export type ApiErrorDetail = {
  path?: string;
  message: string;
  code?: string;
};

export type ApiErrorResponse = {
  ok: false;
  error: string;
  title?: string;
  code: ApiErrorCode | string;
  action?: string;
  retryable?: boolean;
  requestId: string;
  contractVersion: string;
  /** Bounded METHOD + route-template label. Never includes query strings or request bodies. */
  operation: string;
  /** Server-side occurrence timestamp for support correlation and recovery UX. */
  occurredAt: string;
  details?: Record<string, unknown>;
  issues?: ApiErrorDetail[];
};

export type ApiSuccessResponse<T> = {
  ok: true;
  data: T;
  requestId: string;
  contractVersion: string;
};

export type CursorPage<T> = {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
};

export type ClusterPresenceStatus = "available" | "busy" | "focus" | "away" | "offline";
export type ClusterAccountType = "employee" | "contractor" | "client" | "guest";
export type ClusterWorkspaceRole = "owner" | "admin" | "member" | "viewer" | "external" | string;

export type UserDirectoryQuery = {
  limit?: number;
  cursor?: string;
  includeArchived?: boolean;
  department?: string;
  role?: string;
};

export type UserPresenceUpdate = {
  status: ClusterPresenceStatus;
  statusMessage?: string | null;
};

export type RoleDirectoryItem = {
  name: string;
  members: number;
  toolPermissions: Record<string, string>;
};

export type DepartmentDirectoryItem = {
  name: string;
  members: number;
};

export type ActivityQuery = {
  limit?: number;
  cursor?: string;
  type?: string;
  entityType?: string;
  projectId?: string;
  userId?: string;
};

export type ActivityRecord = {
  id: string;
  userId?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  boardId?: string | null;
  whiteboardId?: string | null;
  cardId?: string | null;
  type: string;
  entityType: string;
  entityId?: string | null;
  title: string;
  message?: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type NotificationItem = {
  id: string;
  type: string;
  category: NotificationCategory;
  title: string;
  message?: string | null;
  priority: NotificationPriority;
  read: boolean;
  readAt?: string | null;
  dismissedAt?: string | null;
  snoozedUntil?: string | null;
  createdAt: string;
  projectId?: string | null;
  projectName?: string | null;
  boardId?: string | null;
  cardId?: string | null;
  entityType: string;
  entityId?: string | null;
  actor?: string | null;
  groupKey?: string | null;
  tool?: NotificationTool | null;
  signal?: NotificationSignal | null;
  requiresAction?: boolean;
  escalationLevel?: number;
  acknowledgedAt?: string | null;
  lastEscalatedAt?: string | null;
  resource?: ClusterResourceAddress | null;
  metadata: Record<string, unknown>;
};

export type NotificationSummary = { total: number; unread: number; snoozed: number; critical: number; high: number; requiresAction?: number; unacknowledged?: number; categories: Record<string, number>; tools?: Record<string, number> };
export type NotificationGroupSummary = { key: string; label: string; count: number; unread: number; critical: number; high: number; requiresAction: number; latestAt: string; latest: NotificationItem; projectId?: string | null; projectName?: string | null; category?: NotificationCategory | null; tool?: NotificationTool | null; signal?: NotificationSignal | null };
export type NotificationPage = {
  items: NotificationItem[];
  nextCursor?: string | null;
  hasMore?: boolean;
  summary: NotificationSummary;
};

export type NotificationStateMutation = {
  ids: string[];
  read?: boolean;
};

export type NotificationSnoozeMutation = { ids: string[]; until: string | null };
export type NotificationAcknowledgeMutation = { ids: string[]; acknowledged?: boolean };

export type CollaborationTool = "project" | "board" | "whiteboard" | "build" | "qa" | "timeline" | "calendar" | "scheduler" | "library" | "release" | "control";
export type CollaborationEntityReference = {
  entityType: string;
  entityId: string;
  label?: string | null;
};

export type CollaborationHeartbeat = {
  tool: CollaborationTool;
  resourceId: string;
  projectId?: string | null;
  clientId?: string | null;
  cursor?: { x: number; y: number } | null;
  viewport?: { x: number; y: number; zoom?: number | null } | null;
  activity?: string | null;
  selection?: CollaborationEntityReference | null;
  editing?: CollaborationEntityReference | null;
};

export type CollaborationActionInput = {
  tool: CollaborationTool;
  resourceId: string;
  projectId?: string | null;
  entity?: CollaborationEntityReference | null;
  action: string;
  detail?: string | null;
  resourceChanged?: boolean;
};


export type CommandSearchScope = ClusterRemoteSearchScope;
export type CommandSearchResultKind = ClusterSearchResultKind;
export type CommandSearchResult = {
  id: string;
  kind: CommandSearchResultKind;
  title: string;
  detail: string;
  projectId?: string | null;
  projectName?: string | null;
  boardId?: string | null;
  cardId?: string | null;
  whiteboardId?: string | null;
  status?: string | null;
  assigneeId?: string | null;
  priority?: string | null;
  updatedAt?: string | null;
  createdAt?: string | null;
  dueDate?: string | null;
  personId?: string | null;
  avatarUrl?: string | null;
  department?: string | null;
  teamName?: string | null;
  roleName?: string | null;
  presence?: string | null;
  location?: string | null;
  timezone?: string | null;
  labels?: string[];
  categories?: string[];
  flags?: string[];
  score: number;
  matchReason?: string | null;
};
export type CommandSearchMeta = {
  query: string;
  scope: CommandSearchScope;
  count: number;
  elapsedMs: number;
  cached: boolean;
  indexAgeMs: number;
  candidateCount?: number;
  totalIndexed?: number;
  rebuilding?: boolean;
  operators?: Record<string, string[]>;
};

export type ApiCapabilityResponse = {
  ok: true;
  requestId: string;
  clusterVersion: string;
  api: typeof API_CONTRACT;
  resources: typeof import("./cluster-manifest.js").CLUSTER_RESOURCE_MANIFEST;
  commands: typeof import("./command-registry.js").CLUSTER_COMMAND_MANIFEST;
};


export type SyncConflictAction = "keep_mine" | "keep_server" | "merge" | "restore" | "duplicate" | "discard";
export type SyncConflictClassification = "REMOTE_DELETED" | "REVISION_DIVERGED" | "MUTATION_REJECTED" | "UNSUPPORTED_SCHEMA" | "DEPENDENCY_FAILED";

export type SyncDeviceRegistration = {
  deviceId?: string;
  name?: string | null;
  platform?: string | null;
  clientVersion?: string | null;
  mutationSchemaVersion?: number;
};

export type SyncConflict = {
  id: string;
  deviceId: string;
  mutationId: string;
  entityType?: string | null;
  entityId?: string | null;
  classification: SyncConflictClassification | string;
  status: "OPEN" | "QUARANTINED" | "RESOLVED" | string;
  allowedActions: SyncConflictAction[];
  resolution?: SyncConflictAction | null;
  localPayload: unknown;
  serverPayload: unknown;
  createdAt: string;
  resolvedAt?: string | null;
};

