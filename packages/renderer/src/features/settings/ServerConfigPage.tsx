import "../application/admin-control-center.css";

import { useEffect, useRef, useState } from "react";
import { ClusterNativeSelect, ClusterInput, ClusterTextarea } from "../../components/ClusterNativeControls";
import { API_URL, ApiError, api, queryApi } from "../../core/api";
import { TIMEZONE_OPTIONS, WORKING_DAY_OPTIONS, optionsWithCurrent } from "../../core/options";
import { compactDateTime } from "../../core/date-time";
import { requestSecurityPin, requestSecurityPinSetup } from "../../core/security-pin";
import { confirmCluster, promptCluster } from "../../components/cluster-dialog-service";
import { ClusterIcon, type ClusterIconName } from "../../components/ClusterIcon";
import { SettingsStateChip } from "../../components/SettingsStateChip";
import { SettingsWorkspaceShell } from "../../components/SettingsWorkspaceShell";
import { ClusterSettingsChangeReview, ClusterSettingsHelp } from "../../components/ClusterSettingsPrimitives";
import type { SecurityDiagnostics, ServerBackupRecord, ServerBackupVerification, ServerConfigField, ServerConfigSection, ServerSessionRecord, Settings } from "../application/application-models";
import "./settings-workspace.css";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterCopyButton } from "../../components/ClusterCopyButton";
import { ServerDomainsPanel } from "../domains/DomainManagementPanel";
import { ServerConnectionGuide } from "./ServerConnectionGuide";
import { ServerNetworkTopology } from "./ServerNetworkTopology";
import { ClusterEmptyState } from "../../components/ClusterEmptyState";
import { RequestErrorState } from "../../components/RequestState";

import type { ServerConfigPageProps } from "./settings-workspace-contracts";
import { SERVER_CONFIG_DEPENDENCIES } from "./server-config-dependencies";
import { SettingsLoadingState } from "../../components/LoadingState";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";

type AdminDeviceRecord = { id: string; deviceId: string; label: string; platform?: string | null; userAgent: string; lastSeenAt: string; activeSessionCount: number; current?: boolean; userId: string; proofStatus?: string; proofKeyFingerprint?: string | null; cryptographicallyBound?: boolean; user?: { id: string; username: string; displayName?: string | null } };
type ServiceCredentialRecord = { id: string; name: string; credentialType: "api_token" | "webhook_signing" | "extension_token"; scopes: string[]; tokenPrefix?: string | null; secretFingerprint?: string | null; expiresAt?: string | null; lastUsedAt?: string | null; revokedAt?: string | null; createdAt: string; rotationDue?: boolean; scopePolicyCompliant?: boolean };
type StudioSecurityPolicy = { mfaRequirement: "optional" | "admins" | "all"; mfaMinimumStrength: "mfa" | "phishing_resistant" | "hardware_backed"; adminMfaMinimumStrength: "mfa" | "phishing_resistant" | "hardware_backed"; highRiskVerificationMinimumStrength: "knowledge" | "mfa" | "phishing_resistant" | "hardware_backed"; highRiskRequireDeviceProof: boolean; sessionDays: number; sessionIdleHours: number; sessionMaxPerUser: number; credentialRequireExpiry: boolean; credentialMaxLifetimeDays: number; credentialRotationDays: number; credentialAllowedScopes: string[] };
type WebhookEndpointRecord = { id: string; name: string; urlDisplay: string; eventTypes: string[]; projectId?: string | null; enabled: boolean; allowPrivateNetwork: boolean; allowHttpPrivateNetwork: boolean; timeoutMs: number; lastSuccessAt?: string | null; lastFailureAt?: string | null; consecutiveFailures: number; createdAt: string; updatedAt: string };
type WebhookDeliveryRecord = { id: string; endpointId: string; eventId: string; eventType: string; payloadHash: string; status: string; attempts: number; lastStatusCode?: number | null; lastError?: string | null; latencyMs?: number | null; deliveredAt?: string | null; createdAt: string; updatedAt: string };
type SecurityPostureFinding = { id: string; severity: "critical" | "warning" | "info"; title: string; detail: string; remediation: string };
type SecurityPosture = { activeUsers: number; mfaEnabledUsers: number; mfaRequiredUsers: number; mfaEnrollmentGaps: number; mfaStrengthGaps: number; activeSessions: number; requiredSessionsWithoutMfa: number; registeredDevices: number; verifiedDevices: number; unverifiedDevices: number; activeCredentials: number; credentialRotationDue: number; credentialsWithoutExpiry: number; credentialScopePolicyViolations: number; credentialLifetimePolicyViolations: number; encryptionKeyConfigured: boolean; encryptionKeyId?: string | null; previousEncryptionKeyIds: string[]; findings: SecurityPostureFinding[]; healthy: boolean };
type NetworkReview = {
  ok: boolean;
  editedKeys: string[];
  blockers: { code: string; field: string; message: string }[];
  warnings: { code: string; field: string; message: string }[];
  exposure: { api: string; gateway: string; windowsFirewall: string; routerForwarding: string; externalTls: string; clientReachability: string };
  requiresRestart: boolean;
  requiresExposureConfirmation: boolean;
  note: string;
  checkedAt: string;
  boundDomainProfiles: { checked: number; mismatches: { id: string; webPortMismatch: boolean; apiPortMismatch: boolean }[]; truncated: boolean } | null;
};
type MaintenanceWindowPreview = { enabled: boolean; timezone: string; days: string[]; localStart: string; durationMinutes: number; checkedAt: string; windows: Array<{startAt: string; endAt: string; localDate: string; active: boolean}>; executable: false; note: string };
type MaintenancePreflight = { ok: boolean; intent: string; checkedAt: string; blockers: Array<{code: string; detail: string; category: string}>; warnings: Array<{code: string; detail: string; category: string}>; observed: { runningTasks: number | null; runningJobs: number | null; heavyInFlight: number | null; criticalInFlight: number | null; mode: string; window: { enabled: boolean; active: boolean; nextStartAt: string | null } | null; recovery: { state: string; evidenceAt: string | null } | null }; executable: false; note: string };
type NetworkDeploymentStatus = { ok: boolean; state: "none" | "staged" | "verified" | "rolled_back"; createdAt?: string; requiresManagedRestart: boolean; configMatch?: "candidate" | "previous" | "unexpected"; publicationPending?: boolean; advisory?: string };
type LocalListenerDiagnostic = { configuredHost: string; port: number; probeHost: string | null; status: "tcp_open" | "tcp_closed" | "not_local" | "invalid" };
type LocalNetworkDiagnostics = { ok: boolean; checkedAt: string; web: LocalListenerDiagnostic; api: LocalListenerDiagnostic; external: "not_checked"; note: string };
const NETWORK_REVIEW_FIELDS = ["serverHost", "serverPort", "webHost", "webPort", "allowInsecureLanHttp", "webTlsCertFile", "webTlsKeyFile", "publicApiUrl", "publicWebUrl", "corsOrigins", "trustedProxy", "sessionSecure", "lanDiscoveryEnabled"] as const;

type ServerGovernorRuntimeRead = {
  ok: true;
  checkedAt: string;
  governor: {
    mode: "normal" | "busy" | "saturated" | "critical";
    profile: "automatic" | "interactive-first" | "background-throughput";
    maximumJobConcurrency: number;
    recoveryHoldMs: number;
    requestCapacityScale: number;
    backgroundConcurrencyScale: number;
    allowBackgroundTasks: boolean;
    allowMaintenanceTasks: boolean;
    allowedJobQueues: string[];
    runtime: {
      cpuPercent: number;
      eventLoopP95Ms: number;
      databaseUtilization: number;
      requestP95Ms: number;
    };
  };
};

type RecoveryReadiness = { ok: boolean; state: "ready" | "warning" | "critical"; generatedAt: string; checks: { generationPresent: boolean; completeSchema: boolean; verificationPassed: boolean; restoreDrillPassed: boolean; backupFresh: boolean; drillFresh: boolean; secretKeyAvailable: boolean | null }; latest?: ServerBackupRecord & { schemaVersion?: number; recoveryReady?: boolean; evidence?: { verification?: { checkedAt: string; ok: boolean } | null; restoreDrill?: { checkedAt: string; ok: boolean; mismatchCount: number } | null } }; backupAgeMs?: number | null; restoreDrillAgeMs?: number | null; note?: string };

const SERVER_CONFIG_FIELDS: ServerConfigField[] = [
  { key: "serverResourceProfile", label: "Resource scheduling profile", section: "performance", group: "Background worker policy", type: "select", restart: true, wide: true, options: [
    { value: "automatic", label: "Automatic (recommended)" },
    { value: "interactive-first", label: "Interactive first · reduce background work" },
    { value: "background-throughput", label: "Background throughput · increase normal-load workers" },
  ] },
  { key: "serverResourceWorkerCap", label: "Maximum concurrent background jobs", section: "performance", group: "Worker limits", type: "number", min: 1, max: 128, step: 1, placeholder: "128 (default)", restart: true },
  { key: "serverResourceRecoveryHoldMs", label: "Overload recovery hold (milliseconds)", section: "performance", group: "Worker limits", type: "number", min: 1000, max: 120000, step: 500, placeholder: "7500 (default)", restart: true },
  { key: "maintenanceWindowEnabled", label: "Enable maintenance window planning", section: "maintenance", group: "Planned service windows", type: "boolean" },
  { key: "maintenanceWindowTimezone", label: "Maintenance timezone (IANA)", section: "maintenance", group: "Planned service windows", type: "text", placeholder: "America/New_York" },
  { key: "maintenanceWindowDaysCsv", label: "Weekdays (Sun, Mon, Tue...)", section: "maintenance", group: "Planned service windows", type: "text", placeholder: "Sun" },
  { key: "maintenanceWindowStart", label: "Local start (HH:mm)", section: "maintenance", group: "Planned service windows", type: "text", placeholder: "03:00" },
  { key: "maintenanceWindowDurationMinutes", label: "Window duration (minutes)", section: "maintenance", group: "Planned service windows", type: "number", min: 15, max: 240 },
  { key: "operationsReadinessIntervalMinutes", label: "Dependency checks (minutes)", section: "maintenance", group: "Health monitoring", type: "number", min: 2, max: 15 },
  { key: "operationsEscalationIntervalMinutes", label: "Incident escalation sweep (minutes)", section: "maintenance", group: "Alert delivery", type: "number", min: 2, max: 5 },
  { key: "operationsNativeReconcileIntervalMinutes", label: "Native emergency import (minutes)", section: "maintenance", group: "Alert delivery", type: "number", min: 2, max: 5 },
  { key: "operationsIntegrityScanHours", label: "Integrity scan (hours)", section: "maintenance", group: "Integrity checks", type: "number", min: 1, max: 24 },
  {
    key: "serverDisplayName",
    label: "Server name",
    section: "network",
    group: "Server identity",
    type: "text",
    placeholder: "Cluster Server",
    wide: true,
  },
  {
    key: "lanDiscoveryEnabled",
    label: "Allow LAN discovery",
    section: "network",
    group: "Server identity",
    type: "boolean",
    restart: true,
  },
  {
    key: "serverHost",
    label: "Private API bind host",
    section: "network",
    group: "Bind addresses",
    type: "text",
    placeholder: "127.0.0.1",
    restart: true,
  },
  {
    key: "serverPort",
    label: "Internal API port",
    section: "network",
    group: "Bind addresses",
    type: "number",
    min: 1,
    max: 65535,
    restart: true,
  },
  {
    key: "webHost",
    label: "Gateway bind host",
    section: "network",
    group: "Bind addresses",
    type: "text",
    placeholder: "localhost",
    restart: true,
  },
  {
    key: "webPort",
    label: "Web gateway port",
    section: "network",
    group: "Bind addresses",
    type: "number",
    min: 1,
    max: 65535,
    restart: true,
  },
  {
    key: "allowInsecureLanHttp",
    label: "Allow plain HTTP on a private LAN",
    section: "network",
    group: "Transport & TLS",
    type: "boolean",
    restart: true,
  },
  {
    key: "webTlsCertFile",
    label: "Direct HTTPS certificate file",
    section: "network",
    group: "Transport & TLS",
    type: "text",
    placeholder: "C:\\Cluster\\Certificates\\server.crt",
    restart: true,
    wide: true,
  },
  {
    key: "webTlsKeyFile",
    label: "Direct HTTPS private key file",
    section: "network",
    group: "Transport & TLS",
    type: "text",
    placeholder: "C:\\Cluster\\Certificates\\server.key",
    restart: true,
    wide: true,
  },
  {
    key: "publicApiUrl",
    label: "Public API URL",
    section: "network",
    group: "Public routing",
    type: "text",
    placeholder: "https://cluster.example.com",
    restart: true,
    wide: true,
  },
  {
    key: "publicWebUrl",
    label: "Public web URL",
    section: "network",
    group: "Public routing",
    type: "text",
    placeholder: "https://cluster.example.com",
    restart: true,
    wide: true,
  },
  {
    key: "corsOrigins",
    label: "Allowed CORS origins",
    section: "network",
    group: "Public routing",
    type: "textarea",
    placeholder: "https://cluster.example.com, http://localhost:3000",
    restart: true,
    wide: true,
  },
  {
    key: "trustedProxy",
    label: "Trust reverse proxy headers",
    section: "network",
    group: "Public routing",
    type: "boolean",
    restart: true,
  },
  {
    key: "requestBodyLimitMb",
    label: "Request body limit (MB)",
    section: "network",
    group: "Request limits",
    type: "number",
    min: 1,
    restart: true,
  },
  {
    key: "uploadLimitMb",
    label: "Upload limit (MB)",
    section: "network",
    group: "Request limits",
    type: "number",
    min: 1,
    restart: true,
  },
  {
    key: "requestTimeoutSeconds",
    label: "External request timeout (seconds)",
    section: "network",
    group: "Request limits",
    type: "number",
    min: 1,
    restart: true,
  },
  {
    key: "authRequired",
    label: "Require authentication",
    section: "security",
    group: "Authentication",
    type: "boolean",
  },
  {
    key: "devLoginEnabled",
    label: "Allow local development login",
    section: "security",
    group: "Authentication",
    type: "boolean",
  },
  {
    key: "requireDiscordLink",
    label: "Require Discord identity link",
    section: "security",
    group: "Authentication",
    type: "boolean",
  },
  {
    key: "sessionDays",
    label: "Session lifetime (days)",
    section: "security",
    group: "Sessions",
    type: "number",
    min: 1,
  },
  {
    key: "sessionIdleHours",
    label: "Idle timeout (hours)",
    section: "security",
    group: "Sessions",
    type: "number",
    min: 1,
    max: 8760,
  },
  {
    key: "sessionMaxPerUser",
    label: "Maximum sessions per user",
    section: "security",
    group: "Sessions",
    type: "number",
    min: 1,
    max: 100,
  },
  {
    key: "sessionSecure",
    label: "Secure-only session cookies",
    section: "security",
    group: "Sessions",
    type: "boolean",
    restart: true,
  },
  {
    key: "rateLimitEnabled",
    label: "Enable rate limiting",
    section: "security",
    group: "Request protection",
    type: "boolean",
  },
  {
    key: "rateLimitMax",
    label: "Requests per window",
    section: "security",
    group: "Request protection",
    type: "number",
    min: 600,
  },
  {
    key: "rateLimitWindowMinutes",
    label: "Rate-limit window (minutes)",
    section: "security",
    group: "Request protection",
    type: "number",
    min: 1,
  },
  {
    key: "authRateLimitMax",
    label: "Authentication attempts per window",
    section: "security",
    group: "Request protection",
    type: "number",
    min: 3,
    max: 1000,
  },
  {
    key: "securityHeadersEnabled",
    label: "Enable security headers",
    section: "security",
    group: "Request protection",
    type: "boolean",
    restart: true,
  },
  {
    key: "requireMutationOrigin",
    label: "Require valid mutation origin",
    section: "security",
    group: "Request protection",
    type: "boolean",
  },
  {
    key: "avatarUploadLimitMb",
    label: "Avatar limit (MB)",
    section: "security",
    group: "Upload policy",
    type: "number",
    min: 1,
    max: 25,
  },
  {
    key: "allowExecutableUploads",
    label: "Allow executable uploads",
    section: "security",
    group: "Upload policy",
    type: "boolean",
  },
  {
    key: "allowedUploadMimeCsv",
    label: "Allowed upload MIME patterns",
    section: "security",
    group: "Upload policy",
    type: "textarea",
    wide: true,
  },
  {
    key: "logLevel",
    label: "Log level",
    section: "security",
    group: "Audit and logging",
    type: "select",
    options: [
      { value: "trace", label: "Trace" },
      { value: "debug", label: "Debug" },
      { value: "info", label: "Info" },
      { value: "warn", label: "Warn" },
      { value: "error", label: "Error" },
      { value: "fatal", label: "Fatal" },
      { value: "silent", label: "Silent" },
    ],
    restart: true,
  },
  {
    key: "enableRequestLogs",
    label: "Enable request logs",
    section: "security",
    group: "Audit and logging",
    type: "boolean",
    restart: true,
  },
  {
    key: "dataRootOverride",
    label: "Data root override",
    section: "storage",
    group: "Path overrides",
    type: "text",
    placeholder: "D:\\Cluster\\data",
    restart: true,
    wide: true,
  },
  { key: "projectsRootOverride", label: "Projects location", section: "storage", group: "Advanced storage locations", type: "text", placeholder: "E:\\ClusterData\\Projects", restart: true, wide: true },
  { key: "libraryRootOverride", label: "Library location", section: "storage", group: "Advanced storage locations", type: "text", placeholder: "E:\\ClusterData\\Library", restart: true, wide: true },
  { key: "usersRootOverride", label: "User data location", section: "storage", group: "Advanced storage locations", type: "text", placeholder: "E:\\ClusterData\\Users", restart: true, wide: true },
  { key: "backupsRootOverride", label: "Backups location", section: "storage", group: "Advanced storage locations", type: "text", placeholder: "\\\\NAS\\ClusterBackups", restart: true, wide: true },
  { key: "logsRootOverride", label: "Logs location", section: "storage", group: "Advanced storage locations", type: "text", placeholder: "E:\\ClusterData\\Logs", restart: true, wide: true },
  { key: "runtimeRootOverride", label: "Runtime/cache location", section: "storage", group: "Advanced storage locations", type: "text", placeholder: "C:\\ClusterCache", restart: true, wide: true },
  { key: "exportsRootOverride", label: "Exports location", section: "storage", group: "Advanced storage locations", type: "text", placeholder: "E:\\ClusterData\\Exports", restart: true, wide: true },
  { key: "brandingRootOverride", label: "Branding location", section: "storage", group: "Advanced storage locations", type: "text", placeholder: "E:\\ClusterData\\Branding", restart: true, wide: true },
  {
    key: "uploadRootOverride",
    label: "Upload root override",
    section: "storage",
    group: "Path overrides",
    type: "text",
    placeholder: "D:\\Cluster\\data\\uploads",
    restart: true,
    wide: true,
  },
  {
    key: "configFileOverride",
    label: "Config file override",
    section: "storage",
    group: "Path overrides",
    type: "text",
    placeholder: "D:\\Cluster\\cluster.config.json",
    restart: true,
    wide: true,
  },
  {
    key: "databaseUrlOverride",
    label: "Database URL override",
    section: "storage",
    group: "Path overrides",
    type: "password",
    placeholder: "postgresql://cluster@127.0.0.1:5432/cluster",
    restart: true,
    wide: true,
  },
  {
    key: "accelerationMode",
    label: "Acceleration backend",
    section: "integrations",
    group: "Server acceleration",
    type: "select",
    options: [
      { value: "auto", label: "Automatic (Redis when configured)" },
      { value: "memory", label: "Local memory only" },
      { value: "redis-required", label: "Redis required" },
    ],
    restart: true,
  },
  {
    key: "redisUrlOverride",
    label: "Redis-compatible URL",
    section: "integrations",
    group: "Server acceleration",
    type: "password",
    placeholder: "redis://127.0.0.1:6379",
    restart: true,
    wide: true,
  },
  {
    key: "redisKeyPrefix",
    label: "Acceleration key prefix",
    section: "integrations",
    group: "Server acceleration",
    type: "text",
    placeholder: "cluster",
    restart: true,
  },
  {
    key: "autoSeed",
    label: "Seed starter data on empty database",
    section: "storage",
    group: "Startup",
    type: "boolean",
    restart: true,
  },
  {
    key: "backupEnabled",
    label: "Enable scheduled backups",
    section: "backups",
    group: "Schedule",
    type: "boolean",
  },
  {
    key: "backupFrequency",
    label: "Frequency",
    section: "backups",
    group: "Schedule",
    type: "select",
    options: [
      { value: "hourly", label: "Hourly" },
      { value: "daily", label: "Daily" },
      { value: "weekly", label: "Weekly" },
      { value: "monthly", label: "Monthly" },
      { value: "custom", label: "Custom" },
    ],
  },
  {
    key: "backupScheduleDate",
    label: "Start date",
    section: "backups",
    group: "Schedule",
    type: "date",
  },
  {
    key: "backupScheduleTime",
    label: "Run time",
    section: "backups",
    group: "Schedule",
    type: "time",
  },
  {
    key: "backupScheduleDaysCsv",
    label: "Scheduled days",
    section: "backups",
    group: "Schedule",
    type: "select",
    options: [...WORKING_DAY_OPTIONS],
    wide: true,
  },
  {
    key: "backupTimezone",
    label: "Timezone",
    section: "backups",
    group: "Schedule",
    type: "select",
    options: [...TIMEZONE_OPTIONS],
  },
  {
    key: "backupScheduleRule",
    label: "Custom schedule rule",
    section: "backups",
    group: "Schedule",
    type: "textarea",
    wide: true,
  },
  {
    key: "backupRetentionDays",
    label: "Retention (days)",
    section: "backups",
    group: "Verification and retention",
    type: "number",
    min: 1,
  },
  {
    key: "backupVerifyAfterCreate",
    label: "Verify every new backup",
    section: "backups",
    group: "Verification and retention",
    type: "boolean",
  },

];
const SERVER_CONFIG_HELP: Partial<Record<keyof Settings, string>> = {
  operationsReadinessIntervalMinutes: "How often the existing cached API dependency monitor samples shared health signals. Two to fifteen minutes; no additional probe per tool.",
  operationsEscalationIntervalMinutes: "Sweep unacknowledged incident deadlines using durable notification receipts. Two to five minutes; escalation policy deadlines are separate.",
  operationsNativeReconcileIntervalMinutes: "Import bounded native supervisor emergency events into durable Incidents after recovery. Two to five minutes.",
  operationsIntegrityScanHours: "Interval for the existing data-integrity reconciliation. One to twenty-four hours. A scan still runs on normal server startup.",
  maintenanceWindowEnabled: "Plan service windows and show when maintenance would be permitted. Does NOT automatically restart, update or drain anything.",
  maintenanceWindowTimezone: "IANA timezone for the local maintenance clock, for example America/New_York. Daylight saving time is handled by actual local instants.",
  maintenanceWindowDaysCsv: "Unique weekday abbreviations, comma-separated: Sun, Mon, Tue, Wed, Thu, Fri, Sat.",
  maintenanceWindowStart: "Local 24-hour start time. A missing spring DST time is skipped; the first repeated autumn time is used.",
  maintenanceWindowDurationMinutes: "A 15 to 240 minute advisory window. Service actions require a separate protected authorization and fresh preflight.",
  serverDisplayName: "A human-readable name shown to Cluster clients after they verify this server. The immutable server identity is generated during bootstrap.",
  lanDiscoveryEnabled: "Reply to local-network Cluster discovery probes with public connection metadata. Discovery never authenticates a client and exposes no credentials.",
  serverHost: "Managed Cluster keeps the Node API on loopback. LAN access is controlled by the gateway bind host instead.",
  serverPort: "Private Node API listener. Managed Cluster proxies API traffic through the web gateway; do not expose this port in Windows Firewall or Cloudflare.",
  webHost: "Network interface used by the managed Web/API gateway. Keep 127.0.0.1 for local-only access or use 0.0.0.0 for trusted-LAN hosting.",
  webPort: "Local TCP port for the single Web + API gateway. LAN, VPN, reverse proxy and Cloudflare origin routes must point to this port.",
  allowInsecureLanHttp: "Explicitly allow HTTP on one private LAN interface only. Requires a trusted network and a restricted Windows Firewall rule; passwords travel without TLS.",
  webTlsCertFile: "Absolute path to the PEM certificate for native direct HTTPS. The Windows service must be able to read it. Leave blank for loopback proxy/tunnel HTTPS termination.",
  webTlsKeyFile: "Absolute path to the matching PEM private key. This field is a file path, never paste a private key here.",
  publicApiUrl: "Browser-visible API address used outside the server machine. Set this to the reverse-proxy or LAN URL used by clients.",
  publicWebUrl: "Canonical address users open for Cluster. Used in generated links and integration callbacks.",
  corsOrigins: "Comma-separated browser origins allowed to call the API. Only list trusted Cluster web addresses.",
  trustedProxy: "Accept forwarded client IP and protocol headers from a reverse proxy. Enable only when traffic passes through a trusted proxy.",
  requestBodyLimitMb: "Maximum size of a complete API request. This must be at least as large as the upload limit plus request metadata.",
  uploadLimitMb: "Largest individual upload accepted by the server before tool-specific limits are applied.",
  requestTimeoutSeconds: "Maximum time Cluster waits for outbound Git, Discord, and other external requests before failing them.",
  authRequired: "Require a signed-in Cluster account for application and API access. Disabling this is unsafe outside isolated development.",
  devLoginEnabled: "Expose the local development sign-in shortcut. Keep disabled on shared or production servers.",
  requireDiscordLink: "Block normal workspace access until the user links the Discord identity required by studio policy.",
  sessionDays: "Absolute session lifetime before a user must sign in again, even if the session remains active.",
  sessionIdleHours: "Sign users out after this many hours without authenticated activity.",
  sessionMaxPerUser: "Maximum concurrent browser or device sessions allowed for one account.",
  sessionSecure: "Send session cookies only over HTTPS. Enable for any deployment served through TLS.",
  rateLimitEnabled: "Limit repeated API requests to reduce abuse, accidental loops, and brute-force traffic.",
  rateLimitMax: "Maximum general API requests allowed during one rate-limit window.",
  rateLimitWindowMinutes: "Length of the general and authentication rate-limit window.",
  authRateLimitMax: "Maximum sign-in attempts allowed per window before temporary blocking.",
  securityHeadersEnabled: "Send browser security headers for framing, MIME sniffing, referrers, and related protections.",
  requireMutationOrigin: "Reject write requests whose browser Origin does not match an allowed Cluster origin.",
  avatarUploadLimitMb: "Maximum file size for user and studio profile images.",
  allowExecutableUploads: "Permit executable or script-like files in Library uploads. Leave disabled unless the storage is tightly controlled.",
  allowedUploadMimeCsv: "Comma-separated MIME patterns accepted by the global upload gate. Tool-specific rules can narrow this further.",
  logLevel: "Minimum server log severity. Debug and trace create much larger logs and should be temporary.",
  enableRequestLogs: "Record one log entry for each HTTP request. Useful for diagnosis, noisy for long-term production use.",
  serverResourceProfile: "Automatic retains measured load-based scheduling. Interactive first limits background concurrency; Background throughput increases normal-load workers only. Critical overload controls still apply.",
  serverResourceWorkerCap: "Hard cap for claimed durable background workers. Does not replace queue authorization, rate limits, or job admission safety.",
  serverResourceRecoveryHoldMs: "Time required before the governor relaxes an overload state, one level at a time. Changes take effect after a managed server restart.",
  dataRootOverride: "Absolute directory containing Cluster projects, Library files, exports, runtime data, and system state.",
  uploadRootOverride: "Absolute directory used for uploaded file payloads when it must differ from the main data root.",
  configFileOverride: "Absolute path to the JSON configuration file loaded at startup.",
  databaseUrlOverride: "Protected PostgreSQL connection URL. Cluster never returns the stored credential; changing it points the server at a different database and requires a restart.",
  accelerationMode: "Automatic uses Redis when configured and falls back to bounded memory. Redis required refuses startup when the shared acceleration tier is unavailable.",
  redisUrlOverride: "Protected Redis-compatible connection URL used for shared cache, signaling, rate limits, deduplication, and coordination. PostgreSQL remains authoritative.",
  redisKeyPrefix: "Namespace applied to Cluster acceleration keys so multiple servers can share one Redis-compatible deployment safely.",
  autoSeed: "Create starter workspace data when the database is empty. Disable after initial setup when empty databases must remain empty.",
  backupEnabled: "Run automatic backups using the schedule and retention rules below.",
  backupFrequency: "Base recurrence used by the backup scheduler. Custom uses the custom schedule rule.",
  backupScheduleDate: "First date on which the configured backup schedule is allowed to run.",
  backupScheduleTime: "Local clock time used for daily, weekly, and monthly backup runs.",
  backupScheduleDaysCsv: "Weekdays allowed for weekly or custom backup runs, written as comma-separated short names.",
  backupTimezone: "IANA timezone used to interpret the backup date and time, such as America/New_York.",
  backupScheduleRule: "Advanced recurrence rule used only when Frequency is Custom.",
  backupRetentionDays: "Delete automatic backup files older than this age after a successful newer backup exists.",
  backupVerifyAfterCreate: "Read and validate each backup immediately after creation so corrupt archives are detected early.",

};
export function ServerConfigPage({ onSettingsSaved, initialSection, onSectionChange, currentUser }: ServerConfigPageProps) {
  const { SERVER_MANAGED_SETTING_KEYS } = SERVER_CONFIG_DEPENDENCIES;
  const [settings, setSettings] = useState<Settings>({});
  const [savedSettings, setSavedSettings] = useState<Settings>({});
  const loadedRawSettingsRef = useRef<Settings>({});
  const [serverConfigConflict, setServerConfigConflict] = useState(false);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [savingConfig, setSavingConfig] = useState(false);
  const [restartRequestPending, setRestartRequestPending] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [networkDeployment, setNetworkDeployment] = useState<NetworkDeploymentStatus | null>(null);
  const [networkDeploymentError, setNetworkDeploymentError] = useState("");
  async function refreshNetworkDeployment() {
    try {
      const status = await api<NetworkDeploymentStatus>("/api/server-config/network/deployment");
      setNetworkDeployment(status);
      setNetworkDeploymentError("");
      if (status.state === "verified" || status.state === "rolled_back") {
        // A successful native verification or guarded rollback releases the
        // save interlock. Do not leave the previous 409 permanently disabling
        // the UI after the operator refreshes deployment status.
        setSaveError((current: unknown) => current instanceof ApiError &&
          current.status === 409 && (current.payload as any)?.code === "NETWORK_DEPLOYMENT_PENDING"
          ? null : current);
        if (status.state === "rolled_back") {
          setStatus("The native supervisor restored the previous network configuration. Refresh Server Configuration and review your local draft before attempting another save.");
        }
      }
    } catch (error) {
      setNetworkDeployment(null);
      setNetworkDeploymentError(error instanceof Error ? error.message : "Cannot inspect the network deployment record.");
    }
  }
  const [networkReview, setNetworkReview] = useState<{ fingerprint: string; result: NetworkReview } | null>(null);
  const [networkReviewPending, setNetworkReviewPending] = useState(false);
  const [localNetworkDiagnostics, setLocalNetworkDiagnostics] = useState<LocalNetworkDiagnostics | null>(null);
  const [localNetworkChecking, setLocalNetworkChecking] = useState(false);
  const [localNetworkError, setLocalNetworkError] = useState("");
  async function checkLocalNetwork() {
    setLocalNetworkChecking(true);
    setLocalNetworkError("");
    try {
      const result = await api<LocalNetworkDiagnostics>("/api/server-config/network/local-diagnostics");
      setLocalNetworkDiagnostics(result);
    } catch (error) {
      setLocalNetworkDiagnostics(null);
      setLocalNetworkError(error instanceof Error ? error.message : "Could not inspect local listeners.");
    } finally {
      setLocalNetworkChecking(false);
    }
  }
  const [networkReviewError, setNetworkReviewError] = useState("");
  const [securityDiagnostics, setSecurityDiagnostics] = useState<SecurityDiagnostics | null>(null);
  const [serverSessions, setServerSessions] = useState<ServerSessionRecord[]>([]);
  const [serverBackups, setServerBackups] = useState<ServerBackupRecord[]>([]);
  const [recoveryReadiness, setRecoveryReadiness] = useState<RecoveryReadiness | null>(null);
  const [serverDevices, setServerDevices] = useState<AdminDeviceRecord[]>([]);
  const [serviceCredentials, setServiceCredentials] = useState<ServiceCredentialRecord[]>([]);
  const [credentialName, setCredentialName] = useState("");
  const [credentialType, setCredentialType] = useState<ServiceCredentialRecord["credentialType"]>("api_token");
  const [credentialScopes, setCredentialScopes] = useState("projects.read");
  const [credentialExpiry, setCredentialExpiry] = useState("");
  const [credentialSecret, setCredentialSecret] = useState<{ name: string; value: string } | null>(null);
  const [webhookEndpoints, setWebhookEndpoints] = useState<WebhookEndpointRecord[]>([]);
  const [webhookDeliveries, setWebhookDeliveries] = useState<WebhookDeliveryRecord[]>([]);
  const [webhookName, setWebhookName] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookEventTypes, setWebhookEventTypes] = useState("activity.recorded");
  const [webhookProjectId, setWebhookProjectId] = useState("");
  const [webhookAllowPrivate, setWebhookAllowPrivate] = useState(false);
  const [webhookAllowHttpPrivate, setWebhookAllowHttpPrivate] = useState(false);
  const [webhookSecret, setWebhookSecret] = useState<{ name: string; value: string } | null>(null);
  const [operationsLoading, setOperationsLoading] = useState(false);
  const [governorRuntime, setGovernorRuntime] = useState<ServerGovernorRuntimeRead | null>(null);
  const [governorRuntimeLoading, setGovernorRuntimeLoading] = useState(false);
  const [governorRuntimeError, setGovernorRuntimeError] = useState("");
  async function refreshGovernorRuntime() {
    if (governorRuntimeLoading) return;
    setGovernorRuntimeLoading(true);
    setGovernorRuntimeError("");
    try {
      const result = await api<ServerGovernorRuntimeRead>("/api/server-config/performance/runtime");
      setGovernorRuntime(result);
    } catch (reason) {
      setGovernorRuntime(null);
      setGovernorRuntimeError(reason instanceof Error ? reason.message : "Resource diagnostics unavailable.");
    } finally {
      setGovernorRuntimeLoading(false);
    }
  }
  const [maintenanceWindows, setMaintenanceWindows] = useState<MaintenanceWindowPreview | null>(null);
  const [maintenanceWindowsError, setMaintenanceWindowsError] = useState("");
  const [maintenanceWindowsLoading, setMaintenanceWindowsLoading] = useState(false);
  const [maintenanceIntent, setMaintenanceIntent] = useState<"enter-maintenance" | "enter-read-only" | "restart" | "update">("enter-maintenance");
  const [maintenancePreflight, setMaintenancePreflight] = useState<MaintenancePreflight | null>(null);
  const [maintenancePreflightLoading, setMaintenancePreflightLoading] = useState(false);
  const [maintenancePreflightError, setMaintenancePreflightError] = useState("");
  const operationsRequestSequence = useRef(0);
  const [securityPolicy, setSecurityPolicy] = useState<StudioSecurityPolicy | null>(null);
  const [securityPosture, setSecurityPosture] = useState<SecurityPosture | null>(null);
  const [section, setSection] = useState<ServerConfigSection>(() => {
    const requested = initialSection || window.sessionStorage.getItem("cluster-server-config-section");
    window.sessionStorage.removeItem("cluster-server-config-section");
    return (["overview", "performance", "network", "domains", "security", "storage", "backups", "maintenance", "integrations", "sessions", "advanced"] as ServerConfigSection[]).includes(requested as ServerConfigSection) ? (requested as ServerConfigSection) : "overview";
  });
  useEffect(() => {
    if (section === "performance") void refreshGovernorRuntime();
  }, [section]);

  function selectSection(nextSection: ServerConfigSection) {
    setSection(nextSection);
    onSectionChange?.(nextSection);
  }
  useEffect(() => {
    if (initialSection && initialSection !== section) setSection(initialSection);
  }, [initialSection]);
  const [configSearch, setConfigSearch] = useState("");
  const dirty = JSON.stringify(settings) !== JSON.stringify(savedSettings);
  useUnsavedChangesGuard({
    dirty,
    title: "Discard unsaved server configuration?",
    message: "You have unsaved server configuration changes. Leave this work and discard them?",
  });
  useEffect(() => {
    api<Settings>("/api/server-config")
      .then((loaded) => {
        const merged: Settings = {
          serverHost: "127.0.0.1",
          serverPort: 4000,
          webHost: "127.0.0.1",
          webPort: 3000,
          publicApiUrl: API_URL,
          publicWebUrl: window.location.origin,
          corsOrigins: "http://localhost:3000, http://127.0.0.1:3000, http://localhost:5173, http://127.0.0.1:5173",
          requestBodyLimitMb: 512,
          uploadLimitMb: 512,
          requestTimeoutSeconds: 15,
          authRequired: true,
          devLoginEnabled: false,
          requireDiscordLink: false,
          sessionDays: 7,
          sessionSecure: false,
          rateLimitEnabled: true,
          rateLimitMax: 12000,
          rateLimitWindowMinutes: 1,
          authRateLimitMax: 12,
          sessionIdleHours: 168,
          sessionMaxPerUser: 10,
          securityHeadersEnabled: true,
          requireMutationOrigin: true,
          avatarUploadLimitMb: 5,
          allowExecutableUploads: false,
          allowedUploadMimeCsv: "image/*, video/*, audio/*, application/pdf, application/zip, application/gzip, application/json, text/plain, application/octet-stream",
          backupVerifyAfterCreate: true,
          logLevel: "info",
          enableRequestLogs: false,
          autoSeed: false,
          backupEnabled: false,
          operationsReadinessIntervalMinutes: 2,
          operationsEscalationIntervalMinutes: 2,
          operationsNativeReconcileIntervalMinutes: 2,
          operationsIntegrityScanHours: 6,
          maintenanceWindowEnabled: false,
          maintenanceWindowTimezone: "America/New_York",
          maintenanceWindowDaysCsv: "Sun",
          maintenanceWindowStart: "03:00",
          maintenanceWindowDurationMinutes: 60,
          backupRetentionDays: 14,
          backupScheduleDate: new Date().toISOString().slice(0, 10),
          backupScheduleTime: "03:00",
          backupFrequency: "daily",
          backupScheduleDaysCsv: "Mon, Tue, Wed, Thu, Fri",
          backupScheduleRule: "Run backup into data/backups",
          backupTimezone: "America/New_York",
          trustedProxy: false,
          ...loaded,
        };
        loadedRawSettingsRef.current = loaded;
        setSettings(merged);
        setSavedSettings(merged);
      })
      .finally(() => setLoading(false));
    void refreshNetworkDeployment();
  }, []);
  function patch(key: keyof Settings, value: unknown) {
    if (String(key).startsWith("maintenanceWindow")) setMaintenanceWindows(null);
    setSettings((prev) => {
      const next: Settings = { ...prev, [key]: value };
      // Changing the local Web gateway port must also update browser-facing
      // loopback URLs and CORS entries. External proxy/tunnel origins are left
      // completely unchanged because their public port may be 443.
      if (key === "webPort" && typeof value === "number" && Number.isInteger(value) &&
        value >= 1 && value <= 65535) {
        const oldWebPort = Number(prev.webPort || 3000);
        const oldApiPort = Number(prev.serverPort || 4000);
        const relocateLocalOrigin = (raw: string, includePrivateApi = false) => {
          try {
            const url = new URL(raw);
            const localHost = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname.toLowerCase());
            if (localHost && url.protocol === "http:" &&
              (Number(url.port || "80") === oldWebPort ||
                (includePrivateApi && Number(url.port || "80") === oldApiPort))) {
              url.port = String(value);
              return url.origin;
            }
          } catch { /* Keep non-URL or unrelated operator configuration intact. */ }
          return raw;
        };
        next.publicWebUrl = relocateLocalOrigin(String(prev.publicWebUrl || ""));
        next.publicApiUrl = relocateLocalOrigin(String(prev.publicApiUrl || ""), true);
        if (typeof prev.corsOrigins === "string") {
          next.corsOrigins = prev.corsOrigins.split(/[,\n]/).map((origin) =>
            relocateLocalOrigin(origin.trim())).filter(Boolean).join(", ");
        }
      }
      return next;
    });
    if ((NETWORK_REVIEW_FIELDS as readonly string[]).includes(String(key))) {
      setNetworkReview(null);
      setNetworkReviewError("");
    }
  }
  async function previewSavedMaintenanceWindows() {
    setMaintenanceWindowsLoading(true);
    setMaintenanceWindowsError("");
    try {
      const result = await api<MaintenanceWindowPreview>("/api/admin/operations/maintenance/windows");
      setMaintenanceWindows(result);
    } catch (error) {
      setMaintenanceWindows(null);
      setMaintenanceWindowsError(error instanceof Error ? error.message : "Maintenance calendar preview unavailable.");
    } finally { setMaintenanceWindowsLoading(false); }
  }
  function networkDraft() {
    return Object.fromEntries(NETWORK_REVIEW_FIELDS.filter(key => JSON.stringify(settings[key]) !== JSON.stringify(savedSettings[key]))
      .map(key => [key, settings[key]]).filter(([, value]) => value !== undefined));
  }
  async function previewMaintenance() {
    setMaintenancePreflightLoading(true);
    setMaintenancePreflight(null);
    setMaintenancePreflightError("");
    try {
      const result = await api<MaintenancePreflight>(`/api/admin/operations/maintenance/preflight?intent=${encodeURIComponent(maintenanceIntent)}`);
      setMaintenancePreflight(result);
    } catch (error) {
      setMaintenancePreflightError(error instanceof Error ? error.message : "Maintenance preflight failed.");
    } finally { setMaintenancePreflightLoading(false); }
  }
  async function previewNetworkDraft() {
    const draft = networkDraft();
    const fingerprint = JSON.stringify(draft);
    setNetworkReviewPending(true);
    setNetworkReview(null);
    setNetworkReviewError("");
    try {
      const result = await api<NetworkReview>("/api/server-config/network/preview", {
        method: "POST", body: JSON.stringify({ changes: draft }),
      });
      // Do not present evidence for a superseded draft after an in-flight request.
      setNetworkReview({ fingerprint, result });
    } catch (error) {
      setNetworkReviewError(error instanceof Error ? error.message : "Network preview failed.");
    } finally { setNetworkReviewPending(false); }
  }
  async function refreshAfterServerConfigConflict() {
    const edited = Object.fromEntries(
      Object.keys(settings).filter((key) => JSON.stringify((settings as Record<string, unknown>)[key]) !== JSON.stringify((savedSettings as Record<string, unknown>)[key]))
        .map((key) => [key, (settings as Record<string, unknown>)[key]]),
    );
    try {
      const loaded = await api<Settings>("/api/server-config");
      loadedRawSettingsRef.current = loaded;
      const newBaseline = { ...savedSettings, ...loaded };
      setSavedSettings(newBaseline);
      setSettings({ ...newBaseline, ...edited });
      setNetworkReview(null);
      setSaveError(null);
      setServerConfigConflict(false);
      setStatus("Latest server configuration loaded. Review your retained edits before saving.");
    } catch (error) { setSaveError(error); }
  }
  async function save(confirmation?: string, pinOverride?: string, restartAfter = false): Promise<boolean> {
    // Do not open a second PIN dialog while a save is already in flight.
    // A confirmed 412 retry reuses the existing PIN through pinOverride.
    if (savingConfig && !pinOverride) return false;
    // Determine whether anything needs saving BEFORE interrupting the operator
    // with a PIN or a restart confirmation.
    const selectedKeys = Object.keys(settings).filter(key =>
      JSON.stringify((settings as Record<string, unknown>)[key]) !== JSON.stringify((savedSettings as Record<string, unknown>)[key]));
    if (!selectedKeys.length) {
      setStatus("No server configuration changes to save.");
      return false;
    }
    // Staged network rollback is file-only while PostgreSQL may be offline.
    // Don't ask for a PIN just to reject a mixed database/network transaction.
    if (selectedKeys.some(key => (NETWORK_REVIEW_FIELDS as readonly string[]).includes(key)) &&
        selectedKeys.some(key => !(NETWORK_REVIEW_FIELDS as readonly string[]).includes(key))) {
      setStatus("Save networking changes separately from other settings so a failed service restart can restore the complete network transaction.");
      return false;
    }
    // Confirm the interruption before asking for the Security PIN. The
    // authenticated restart is issued only if the server Save succeeds.
    if (restartAfter && !pinOverride &&
      !window.confirm("Save these settings and restart Cluster Server? Active sessions will temporarily disconnect while the native Windows supervisor drains and relaunches the server.")) return false;
    const pin = pinOverride || (currentUser.pinConfigured
      ? await requestSecurityPin({
          title: "Apply Server Configuration",
          description: "Enter your security PIN to apply these changes.",
          purpose: "apply_server_configuration",
          confirmLabel: "Apply configuration",
        })
      : await requestSecurityPinSetup({
          title: "Create security PIN",
          description: "Create a PIN before applying Server Configuration.",
          purpose: "setup_for_apply_server_configuration",
        }));
    if (!pin) return false;
    const changedKeys = Object.keys(settings).filter((key) => JSON.stringify((settings as Record<string, unknown>)[key]) !== JSON.stringify((savedSettings as Record<string, unknown>)[key]));
    // The operator may have reset the draft while the PIN dialog was open.
    // Never report a no-op as a successful protected save.
    if (!changedKeys.length) {
      setStatus("No server configuration changes to save.");
      return false;
    }
    const original = loadedRawSettingsRef.current as Record<string, unknown>;
    const changes = Object.fromEntries(changedKeys.map((key) => [key, (settings as Record<string, unknown>)[key]]));
    const expectedSettings = Object.fromEntries(changedKeys.map((key) => [key,
      Object.prototype.hasOwnProperty.call(original, key) ? { exists: true, value: original[key] } : { exists: false },
    ]));
    setSavingConfig(true);
    setSaveError(null);
    setStatus("Saving server configuration…");
    try {
      await api("/api/server-config", {
        method: "PUT",
        headers: confirmation ? { "X-Cluster-Confirmation": confirmation } : undefined,
        body: JSON.stringify({ ...changes, expectedSettings, securityPin: pin }),
      });
      // A successful server save may canonicalize URLs, paths, or masked secrets.
      // Refresh the baseline where possible so the next compare-and-swap uses
      // what the server actually persisted, not merely the submitted draft.
      let persisted = { ...settings };
      try {
        const refreshed = await api<Settings>("/api/server-config");
        loadedRawSettingsRef.current = refreshed;
        persisted = { ...persisted, ...refreshed };
      } catch {
        // The write has already succeeded; avoid reporting a false save failure.
        loadedRawSettingsRef.current = { ...loadedRawSettingsRef.current, ...changes };
      }
      setSettings(persisted);
      setSavedSettings(persisted);
      setNetworkReview(null);
      setServerConfigConflict(false);
      onSettingsSaved?.({ ...persisted, appDisplayName: "Cluster" });
      if (restartAfter) {
        try {
          // Use the PIN already provided for this exact operator action.
          // The API writes a one-shot request; the independent native supervisor
          // owns stopping, draining, starting, and guarded network rollback.
          await api("/api/server-config/restart", {
            method: "POST",
            body: JSON.stringify({ securityPin: pin, confirmation: "RESTART CLUSTER SERVER" }),
          });
          setStatus("Settings saved. Restart accepted by the Windows supervisor; the page may disconnect while Cluster is restarting.");
        } catch (restartError) {
          setStatus("Settings saved, but the native restart request was not accepted. Use the Restart button in Cluster Server Manager. " + (restartError instanceof Error ? restartError.message : ""));
        }
      } else {
        setStatus(selectedKeys.some(key => (NETWORK_REVIEW_FIELDS as readonly string[]).includes(key))
          ? "Networking changes saved. Apply the staged profile through an authorized native restart; the supervisor can roll back if the new listener fails."
          : "Server configuration saved." );
      }
      void refreshNetworkDeployment();
      void Promise.all([fetchSecurityDiagnostics(true).then(setSecurityDiagnostics), refreshSecurityPosture(true)]);
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 412) {
        const expected = String((error.payload as any)?.confirmation || "APPLY INSECURE CONFIG");
        const typed = await promptCluster({ title: expected === "CONFIRM NETWORK EXPOSURE" ? "Confirm network exposure" : "Confirm security-sensitive change", message: expected === "CONFIRM NETWORK EXPOSURE" ? "This network change may make your gateway accessible outside localhost. Review firewall, proxy and TLS settings before confirming." : "This change weakens a security control.", label: "Required confirmation", expectedValue: expected, confirmLabel: "Apply change", tone: "danger" }) || "";
        // Keep the original save pending until the authorized retry settles.
        // Otherwise the outer finally can clear savingConfig mid-flight.
        if (typed === expected) return await save(expected, pin, restartAfter);
        setStatus("Security-sensitive change cancelled.");
        return false;
      }
      setStatus("");
      setServerConfigConflict(error instanceof ApiError && error.status === 409 && (error.payload as any)?.code === "SERVER_CONFIG_CONFLICT");
      setSaveError(error);
      return false;
    } finally {
      setSavingConfig(false);
    }
  }
  async function authorizePendingRestart() {
    if (restartRequestPending) return;
    // Network rollout was staged by a previous, successful configuration save.
    // A 409 is a safety interlock, not a request to retry that same PUT.
    if (!window.confirm(
      "Restart the managed Cluster Server to verify the staged network change? " +
      "Existing unsaved edits will NOT be applied and may be lost if this page reloads. " +
      "Active sessions and background work will be interrupted temporarily."
    )) return;
    const pin = currentUser.pinConfigured
      ? await requestSecurityPin({
          title: "Restart Cluster Server",
          description: "Authorize the native Windows supervisor to apply the staged network change.",
          purpose: "apply_server_configuration",
          confirmLabel: "Authorize restart",
        })
      : await requestSecurityPinSetup({
          title: "Create security PIN",
          description: "Create a security PIN before authorizing a managed restart.",
          purpose: "setup_for_apply_server_configuration",
        });
    if (!pin) return;
    setRestartRequestPending(true);
    try {
      await api("/api/server-config/restart", {
        method: "POST",
        body: JSON.stringify({ securityPin: pin, confirmation: "RESTART CLUSTER SERVER" }),
      });
      setStatus("Managed restart accepted. Wait for local API readiness, then refresh the deployment status. External DNS/TLS still needs a separate check.");
      setSaveError(null);
    } catch (error) {
      setStatus("Native restart request unavailable. Restart from Cluster Windows Server Manager, then reload configuration. " + (error instanceof Error ? error.message : ""));
    } finally {
      setRestartRequestPending(false);
    }
  }
  async function fetchSecurityDiagnostics(force = false) {
    return queryApi<SecurityDiagnostics>("/api/security/diagnostics", { force, staleMs: 8_000, maxAgeMs: 2 * 60_000, tags: ["security-diagnostics", "operations"] });
  }
  async function fetchServerSessions(force = false) {
    return queryApi<{ ok: boolean; sessions: ServerSessionRecord[] }>("/api/admin/sessions", { force, staleMs: 5_000, maxAgeMs: 2 * 60_000, tags: ["sessions", "security"] });
  }
  async function fetchServerBackups(force = false) {
    return Promise.all([
      queryApi<{ ok: boolean; backups: ServerBackupRecord[] }>("/api/admin/backups", { force, staleMs: 10_000, maxAgeMs: 5 * 60_000, tags: ["backups", "recovery"] }),
      queryApi<RecoveryReadiness>("/api/admin/backups/recovery-readiness", { force, staleMs: 10_000, maxAgeMs: 5 * 60_000, tags: ["backups", "recovery"] }).catch(() => null),
    ]);
  }
  async function fetchServerDevices(force = false) {
    return queryApi<{ ok: boolean; devices: AdminDeviceRecord[] }>("/api/admin/devices", { force, staleMs: 5_000, maxAgeMs: 2 * 60_000, tags: ["devices", "security"] }).catch(() => ({ ok: false, devices: [] }));
  }
  async function fetchServiceCredentials(force = false) {
    return queryApi<{ ok: boolean; credentials: ServiceCredentialRecord[] }>("/api/admin/security/credentials", { force, staleMs: 8_000, maxAgeMs: 2 * 60_000, tags: ["credentials", "security"] }).catch(() => ({ ok: false, credentials: [] }));
  }
  async function fetchSecurityPolicy(force = false) {
    return queryApi<{ ok: boolean; policy: StudioSecurityPolicy }>("/api/admin/security/policy", { force, staleMs: 10_000, maxAgeMs: 5 * 60_000, tags: ["security-policy", "security"] }).catch(() => ({ ok: false, policy: null as unknown as StudioSecurityPolicy }));
  }
  async function fetchSecurityPosture(force = false) {
    return queryApi<{ ok: boolean; posture: SecurityPosture }>("/api/admin/security/posture", { force, staleMs: 8_000, maxAgeMs: 2 * 60_000, tags: ["security-posture", "security"] }).catch(() => ({ ok: false, posture: null as unknown as SecurityPosture }));
  }
  async function fetchWebhooks(force = false) {
    return queryApi<{ ok: boolean; endpoints: WebhookEndpointRecord[]; deliveries: WebhookDeliveryRecord[] }>("/api/admin/integrations/webhooks", { force, staleMs: 5_000, maxAgeMs: 2 * 60_000, tags: ["webhooks", "integrations"] }).catch(() => ({ ok: false, endpoints: [], deliveries: [] }));
  }
  async function refreshSessions(force = true) {
    const result = await fetchServerSessions(force); setServerSessions(result.sessions || []);
  }
  async function refreshDevices(force = true) {
    const result = await fetchServerDevices(force); setServerDevices(result.devices || []);
  }
  async function refreshBackups(force = true) {
    const [backupsResult, readinessResult] = await fetchServerBackups(force); setServerBackups(backupsResult.backups || []); setRecoveryReadiness(readinessResult);
  }
  async function refreshSecurityPosture(force = true) {
    const result = await fetchSecurityPosture(force); if (result.ok && result.posture) setSecurityPosture(result.posture);
  }
  async function refreshWebhooks(force = true) {
    const result = await fetchWebhooks(force); setWebhookEndpoints(result.endpoints || []); setWebhookDeliveries(result.deliveries || []);
  }
  async function loadOperationalData(force = false) {
    const sequence = ++operationsRequestSequence.current;
    setOperationsLoading(true);
    try {
      const [diagnostics, sessionsResult, backupBundle, devicesResult, credentialsResult, policyResult, postureResult, webhooksResult] = await Promise.all([
        fetchSecurityDiagnostics(force),
        fetchServerSessions(force),
        fetchServerBackups(force),
        fetchServerDevices(force),
        fetchServiceCredentials(force),
        fetchSecurityPolicy(force),
        fetchSecurityPosture(force),
        fetchWebhooks(force),
      ]);
      if (sequence !== operationsRequestSequence.current) return;
      const [backupsResult, readinessResult] = backupBundle;
      setSecurityDiagnostics(diagnostics);
      setServerSessions(sessionsResult.sessions || []);
      setServerBackups(backupsResult.backups || []);
      setRecoveryReadiness(readinessResult);
      setServerDevices(devicesResult.devices || []);
      setServiceCredentials(credentialsResult.credentials || []);
      setWebhookEndpoints(webhooksResult.endpoints || []);
      setWebhookDeliveries(webhooksResult.deliveries || []);
      if (policyResult.ok && policyResult.policy) setSecurityPolicy(policyResult.policy);
      if (postureResult.ok && postureResult.posture) setSecurityPosture(postureResult.posture);
    } catch (error) {
      if (sequence === operationsRequestSequence.current) setStatus(error instanceof Error ? error.message : "Operational status could not be loaded.");
    } finally {
      if (sequence === operationsRequestSequence.current) setOperationsLoading(false);
    }
  }

  useEffect(() => {
    void loadOperationalData();
  }, []);
  async function confirmedRequest<T>(expected: string, path: string, options: RequestInit) {
    const typed = await promptCluster({ title: "Confirm sensitive action", message: "This action requires an exact confirmation phrase.", label: "Required confirmation", expectedValue: expected, confirmLabel: "Continue", tone: "danger" }) || "";
    if (typed !== expected) {
      setStatus("Sensitive action cancelled.");
      return null;
    }
    return api<T>(path, {
      ...options,
      headers: {
        ...(options.headers || {}),
        "X-Cluster-Confirmation": expected,
      },
    });
  }
  async function revokeSession(sessionId: string) {
    const result = await confirmedRequest<{ ok: boolean }>("REVOKE SESSION", `/api/admin/sessions/${encodeURIComponent(sessionId)}`, { method: "DELETE" });
    if (!result) return;
    setStatus("Session revoked.");
    await Promise.all([refreshSessions(), refreshDevices(), refreshSecurityPosture()]);
  }
  async function revokeOtherSessions() {
    const result = await confirmedRequest<{ ok: boolean; revoked: number }>("REVOKE OTHER SESSIONS", "/api/me/sessions/revoke-others", { method: "POST" });
    if (!result) return;
    setStatus(`${result.revoked} other session${result.revoked === 1 ? "" : "s"} revoked.`);
    await Promise.all([refreshSessions(), refreshDevices(), refreshSecurityPosture()]);
  }
  async function revokeAdminDevice(device: AdminDeviceRecord) {
    const result = await confirmedRequest<{ ok: boolean; revoked: number }>("REVOKE DEVICE", `/api/admin/devices/${encodeURIComponent(device.userId)}/${encodeURIComponent(device.deviceId)}`, { method: "DELETE" });
    if (!result) return;
    setStatus(`${result.revoked} session${result.revoked === 1 ? "" : "s"} revoked from ${device.label}.`);
    await Promise.all([refreshSessions(), refreshDevices(), refreshSecurityPosture()]);
  }
  async function saveStudioSecurityPolicy() {
    if (!securityPolicy) return;
    const result = await confirmedRequest<{ ok: boolean; policy: StudioSecurityPolicy; revokedSessions: number }>("UPDATE SECURITY POLICY", "/api/admin/security/policy", { method: "PUT", body: JSON.stringify(securityPolicy) });
    if (!result) return;
    setSecurityPolicy(result.policy);
    setStatus(`Security policy updated${result.revokedSessions ? ` · ${result.revokedSessions} noncompliant session${result.revokedSessions === 1 ? "" : "s"} revoked` : ""}.`);
    await Promise.all([refreshSessions(), refreshDevices(), refreshSecurityPosture()]);
  }
  async function rewrapProtectedSecrets() {
    const result = await confirmedRequest<{ ok: boolean; encryptionKeyId?: string | null; securitySecrets?: { mfaSecrets: number; webhookSecrets: number; integrationSecrets: number } }>("REWRAP SECRETS", "/api/admin/security/secrets/rewrap", { method: "POST" });
    if (!result) return;
    setStatus(`Protected secrets rewrapped with ${result.encryptionKeyId || "the active key"}${result.securitySecrets ? ` · ${result.securitySecrets.mfaSecrets} MFA seed${result.securitySecrets.mfaSecrets === 1 ? "" : "s"}, ${result.securitySecrets.webhookSecrets} webhook secret${result.securitySecrets.webhookSecrets === 1 ? "" : "s"}, ${result.securitySecrets.integrationSecrets} integration secret${result.securitySecrets.integrationSecrets === 1 ? "" : "s"}` : ""}.`);
    await refreshSecurityPosture();
  }
  async function createServiceCredential() {
    if (!credentialName.trim()) { setStatus("Name the credential first."); return; }
    const scopes = [...new Set(credentialScopes.split(",").map((value) => value.trim()).filter(Boolean))];
    const result = await api<{ ok: boolean; credential: ServiceCredentialRecord; secret: string }>("/api/admin/security/credentials", { method: "POST", body: JSON.stringify({ name: credentialName.trim(), credentialType, scopes, expiresAt: credentialExpiry ? new Date(credentialExpiry).toISOString() : null }) });
    setCredentialSecret({ name: result.credential.name, value: result.secret });
    setServiceCredentials((current) => [result.credential, ...current.filter((item) => item.id !== result.credential.id)]);
    setCredentialName(""); setCredentialExpiry(""); setStatus("Credential created. Copy the secret now; this value is not returned again.");
    void refreshSecurityPosture();
  }
  async function rotateServiceCredential(credential: ServiceCredentialRecord) {
    const result = await confirmedRequest<{ ok: boolean; credential: ServiceCredentialRecord; secret: string }>("ROTATE CREDENTIAL", `/api/admin/security/credentials/${encodeURIComponent(credential.id)}/rotate`, { method: "POST" });
    if (!result) return;
    setCredentialSecret({ name: result.credential.name, value: result.secret });
    setServiceCredentials((current) => current.map((item) => item.id === result.credential.id ? result.credential : item));
    setStatus("Credential rotated. Copy the replacement secret now."); void refreshSecurityPosture();
  }
  async function revokeServiceCredential(credential: ServiceCredentialRecord) {
    const result = await confirmedRequest<{ ok: boolean }>("REVOKE CREDENTIAL", `/api/admin/security/credentials/${encodeURIComponent(credential.id)}`, { method: "DELETE" });
    if (!result) return; setCredentialSecret(null); setServiceCredentials((current) => current.filter((item) => item.id !== credential.id)); setStatus("Credential revoked."); void refreshSecurityPosture();
  }
  async function createWebhookEndpoint() {
    if (!webhookName.trim() || !webhookUrl.trim()) { setStatus("Name the webhook and enter its destination URL."); return; }
    const eventTypes = [...new Set(webhookEventTypes.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean))];
    try {
      const result = await api<{ ok: boolean; endpoint: WebhookEndpointRecord; signingSecret: string }>("/api/admin/integrations/webhooks", { method: "POST", body: JSON.stringify({ name: webhookName.trim(), url: webhookUrl.trim(), eventTypes, projectId: webhookProjectId.trim() || null, allowPrivateNetwork: webhookAllowPrivate, allowHttpPrivateNetwork: webhookAllowPrivate && webhookAllowHttpPrivate }) });
      setWebhookSecret({ name: result.endpoint.name, value: result.signingSecret });
      setWebhookEndpoints((current) => [result.endpoint, ...current.filter((item) => item.id !== result.endpoint.id)]);
      setWebhookName(""); setWebhookUrl(""); setWebhookProjectId("");
      setStatus("Webhook created. Copy its signing secret now; receivers use it to verify X-Cluster-Signature.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Webhook could not be created."); }
  }
  async function testWebhookEndpoint(endpoint: WebhookEndpointRecord) {
    await api(`/api/admin/integrations/webhooks/${encodeURIComponent(endpoint.id)}/test`, { method: "POST" });
    setStatus(`Queued a signed test delivery for ${endpoint.name}.`); await refreshWebhooks();
  }
  async function rotateWebhookSecret(endpoint: WebhookEndpointRecord) {
    const result = await confirmedRequest<{ ok: boolean; signingSecret: string }>("ROTATE WEBHOOK SECRET", `/api/admin/integrations/webhooks/${encodeURIComponent(endpoint.id)}/rotate-secret`, { method: "POST" });
    if (!result) return; setWebhookSecret({ name: endpoint.name, value: result.signingSecret }); setStatus("Webhook signing secret rotated. Copy the replacement now.");
  }
  async function deleteWebhookEndpoint(endpoint: WebhookEndpointRecord) {
    const result = await confirmedRequest<{ ok: boolean }>("DELETE WEBHOOK", `/api/admin/integrations/webhooks/${encodeURIComponent(endpoint.id)}`, { method: "DELETE" });
    if (!result) return; setWebhookSecret(null); setWebhookEndpoints((current) => current.filter((item) => item.id !== endpoint.id)); setWebhookDeliveries((current) => current.filter((item) => item.endpointId !== endpoint.id)); setStatus("Webhook endpoint deleted and its signing credential revoked.");
  }
  async function retryWebhookDelivery(delivery: WebhookDeliveryRecord) {
    await api(`/api/admin/integrations/webhooks/deliveries/${encodeURIComponent(delivery.id)}/retry`, { method: "POST" });
    setStatus("Webhook delivery requeued."); await refreshWebhooks();
  }
  async function verifyBackup(fileName: string) {
    const result = await api<ServerBackupVerification>(`/api/admin/backups/${encodeURIComponent(fileName)}/verify`, { method: "POST" });
    setStatus(result.ok ? "Backup verification passed." : "Backup verification found a problem.");
    await refreshBackups();
  }
  async function runRestoreDrill(fileName: string) {
    const result = await confirmedRequest<ServerBackupVerification & { note?: string }>("RUN RESTORE DRILL", `/api/admin/backups/${encodeURIComponent(fileName)}/restore-drill`, { method: "POST" });
    if (!result) return;
    setStatus(result.ok ? "Restore drill passed. Live data was not changed." : "Restore drill failed validation.");
    await refreshBackups();
  }
  async function createPreUpgradeCheckpointNow() {
    const result = await confirmedRequest<{ ok: boolean; fileName: string; generationId: string }>("CREATE PRE-UPGRADE CHECKPOINT", "/api/admin/backups/pre-upgrade-checkpoint", { method: "POST" });
    if (!result) return;
    setStatus(`Pre-upgrade checkpoint ${result.fileName} passed verification and restore drill.`);
    await refreshBackups();
  }

  async function deleteServerBackup(fileName: string) {
    const result = await confirmedRequest<{ ok: boolean }>("DELETE BACKUP", `/api/admin/backups/${encodeURIComponent(fileName)}`, { method: "DELETE" });
    if (!result) return;
    setStatus("Backup deleted.");
    await refreshBackups();
  }

  async function runServerBackupNow() {
    setStatus("Saving settings and creating a backup...");
    if (!(await save())) return;
    const result = await api<{
      ok: boolean;
      fileName?: string;
      manifestPath?: string;
      error?: string;
    }>("/api/admin/backups/now", { method: "POST" });
    setStatus(result.ok ? `Backup created: ${result.fileName || result.manifestPath || "manifest"}` : `Backup failed: ${result.error || "unknown error"}`);
    await refreshBackups();
  }
  if (loading) return <SettingsLoadingState label="Loading server configuration" />;
  const configuredExtensionCount = webhookEndpoints.filter((endpoint) => endpoint.enabled).length;
  const changedFields = SERVER_CONFIG_FIELDS.filter((field) => JSON.stringify(settings[field.key]) !== JSON.stringify(savedSettings[field.key]));
  const restartDirtyCount = changedFields.filter((field) => field.restart).length;
  const networkDeploymentPending = networkDeployment?.state === "staged" ||
    (saveError instanceof ApiError && saveError.status === 409 && (saveError.payload as any)?.code === "NETWORK_DEPLOYMENT_PENDING");
  const integrationOwnedKeys = new Set(["discordWebhookUrl", "discordVoiceUrl", "discordMessagePrefix", "discordBotToken", "discordGuildId", "discordForumChannelId", "discordChatChannelId", "discordAdminRoleId"]);
  const serverManagedKeys = (settings.serverManagedSettingKeys?.length ? settings.serverManagedSettingKeys : SERVER_MANAGED_SETTING_KEYS.map(String)).filter((key) => !integrationOwnedKeys.has(String(key)));
  const missingMetadataKeys = serverManagedKeys.filter((key) => !SERVER_CONFIG_FIELDS.some((field) => field.key === key));
  const normalizedSearch = configSearch.trim().toLowerCase();
  const visibleAdvancedFields = SERVER_CONFIG_FIELDS.filter((field) => !normalizedSearch || `${field.label} ${SERVER_CONFIG_HELP[field.key] || ""} ${String(field.key)} ${field.group} ${field.section}`.toLowerCase().includes(normalizedSearch));
  function renderField(field: ServerConfigField) {
    const value = field.key === "serverResourceProfile" ? (settings.serverResourceProfile ?? "automatic") : settings[field.key];
    const changed = JSON.stringify(value) !== JSON.stringify(savedSettings[field.key]);
    const inputId = "server-config-field-" + String(field.key);
    const className = "server-config-field-v238 server-config-compact-field-v11" + (field.wide ? " span-2" : "") + (changed ? " is-dirty" : "");
    const help = SERVER_CONFIG_HELP[field.key] || "Controls this server setting.";
    const status = field.restart
      ? <SettingsStateChip tone={changed ? "warning" : "neutral"} icon="refresh">{changed ? "Restart after save" : "Restart on change"}</SettingsStateChip>
      : changed ? <SettingsStateChip tone="warning" icon="note">Unsaved</SettingsStateChip> : null;
    const header = <span className="server-config-field-header-v11">
      <label htmlFor={inputId}><strong>{field.label}</strong></label>
      <span className="server-config-field-actions-v11">
        {status}
        <ClusterSettingsHelp label={field.label}>{help}<code>Key: {String(field.key)}</code></ClusterSettingsHelp>
      </span>
    </span>;
    if (field.type === "boolean") {
      return <div className={className + " server-config-toggle-v238"} key={String(field.key)}>
        {header}
        <ClusterInput id={inputId} type="checkbox" checked={Boolean(value)} onChange={(event) => patch(field.key, event.target.checked)} />
      </div>;
    }
    const control = field.type === "textarea"
      ? <ClusterTextarea id={inputId} value={String(value ?? "")} placeholder={field.placeholder} onChange={(event) => patch(field.key, event.target.value)} />
      : field.type === "select"
        ? <ClusterNativeSelect id={inputId} value={String(value ?? "")} onChange={(event) => patch(field.key, event.target.value)}>
            {optionsWithCurrent(field.options || [], String(value ?? "")).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </ClusterNativeSelect>
        : <ClusterInput id={inputId} type={field.type === "password" ? "password" : field.type}
            value={value === undefined || value === null ? "" : String(value)} placeholder={field.placeholder}
            min={field.min} max={field.max} step={field.step}
            onChange={(event) => patch(field.key, field.type === "number" ? (event.target.value === "" ? undefined : Number(event.target.value)) : event.target.value)} />;
    return <div className={className} key={String(field.key)}>{header}{control}</div>;
  }
  function renderSectionFields(target: ServerConfigField["section"], excludedKeys: readonly string[] = []) {
    const fields = SERVER_CONFIG_FIELDS.filter((field) => field.section === target && !excludedKeys.includes(String(field.key)));
    const groups = Array.from(new Set(fields.map((field) => field.group)));
    return (
      <div className="server-config-groups-v238">
        {groups.map((group) => (
          <section className="panel server-config-group-v238" key={group}>
            <div className="server-config-group-head-v238">
              <h2>{group}</h2>
              <span>{fields.filter((field) => field.group === group).length}</span>
            </div>
            <div className="server-config-fields-v238">{fields.filter((field) => field.group === group).map(renderField)}</div>
          </section>
        ))}
      </div>
    );
  }
  const sectionLabels: Array<{
    id: ServerConfigSection;
    label: string;
    group: "Runtime" | "Security & Access" | "Data & Recovery" | "Extensions";
    count?: number;
    icon: ClusterIconName;
  }> = [
    { id: "overview", label: "Overview", group: "Runtime", icon: "home" },
    { id: "performance", label: "Performance & resources", group: "Runtime", icon: "settings", count: SERVER_CONFIG_FIELDS.filter((field) => field.section === "performance").length },
    { id: "maintenance", label: "Maintenance", group: "Runtime", icon: "clock", count: SERVER_CONFIG_FIELDS.filter((field) => field.section === "maintenance").length },
    { id: "network", label: "Network", group: "Runtime", icon: "cloud", count: SERVER_CONFIG_FIELDS.filter((field) => field.section === "network").length },
    { id: "domains", label: "Domains & gateways", group: "Runtime", icon: "link" },
    { id: "advanced", label: "All settings", group: "Runtime", icon: "settings", count: serverManagedKeys.length },
    { id: "security", label: "Security", group: "Security & Access", icon: "lock", count: SERVER_CONFIG_FIELDS.filter((field) => field.section === "security").length },
    { id: "sessions", label: "Sessions", group: "Security & Access", icon: "users", count: serverSessions.length },
    { id: "storage", label: "Storage", group: "Data & Recovery", icon: "folder", count: SERVER_CONFIG_FIELDS.filter((field) => field.section === "storage").length },
    { id: "backups", label: "Backups", group: "Data & Recovery", icon: "archive", count: serverBackups.length },
    { id: "integrations", label: "API & webhooks", group: "Extensions", icon: "code", count: configuredExtensionCount },
  ];
  const serverConfigGroups = [
    { id: "overview" as const, label: "Runtime", description: "Server identity, network posture, and lower-level configuration." },
    { id: "security" as const, label: "Security & Access", description: "Security policy, sessions, credentials, and trusted devices." },
    { id: "storage" as const, label: "Data & Recovery", description: "Storage, backups, verification, and recovery readiness." },
    { id: "integrations" as const, label: "Extensions", description: "Private API, webhooks, and server-side extension surfaces." },
  ];
  const serverGroupForSection = (target: ServerConfigSection) => target === "security" || target === "sessions" ? "security" : target === "storage" || target === "backups" ? "storage" : target === "integrations" ? "integrations" : "overview";
  const activeServerGroupId = serverGroupForSection(section);
  const activeServerGroup = serverConfigGroups.find((group) => group.id === activeServerGroupId) || serverConfigGroups[0];
  return (
    <SettingsWorkspaceShell
      className="settings-workspace-v298 server-config-page-v094 server-config-console-v238"
      title="Server Configuration"
      icon="cloud"
      description={`${settings.settingsSource || "config file"} · ${settings.configPath || "cluster.config.json"}`}
      actions={
        <>
          {changedFields.length > 0 && <SettingsStateChip tone="warning" icon="note">{changedFields.length} unsaved{restartDirtyCount ? ` · ${restartDirtyCount} require restart` : ""}</SettingsStateChip>}
          {networkDeployment?.state === "staged" && <SettingsStateChip tone="warning" icon="refresh">Network restart pending</SettingsStateChip>}
          <ClusterButton type="button" variant="secondary" onClick={() => void loadOperationalData()} disabled={operationsLoading}>
            <ClusterIcon name="refresh" />
            <span>{operationsLoading ? "Refreshing" : "Refresh"}</span>
          </ClusterButton>
          {restartDirtyCount > 0 && <ClusterButton type="button" variant="secondary" busy={savingConfig} busyLabel="Saving…" onClick={() => void save(undefined, undefined, true)} disabled={savingConfig || networkDeploymentPending || !changedFields.length}>
            Save &amp; restart
          </ClusterButton>}
          <ClusterButton type="button" variant="primary" busy={savingConfig} busyLabel="Saving…" onClick={() => void save()} disabled={savingConfig || networkDeploymentPending || !changedFields.length}>Save configuration</ClusterButton>
        </>
      }
      status={status}
      navLabel="Server configuration sections"
      activeId={section}
      onChange={selectSection}
      primaryIds={sectionLabels.map((item) => item.id)}
      showGroupHeadings
      items={sectionLabels.map((item) => ({
        id: item.id, label: item.label, group: item.group, icon: item.icon,
        detail: item.id === "network" && networkDeploymentPending ? "Restart" : undefined,
        detailTone: item.id === "network" && networkDeploymentPending ? "warning" as const : "neutral" as const,
      }))}
    >

      {networkDeploymentPending && (
        <section className="panel server-config-rollout-guard-v103" aria-label="Network deployment awaiting managed restart" role="status">
          <div className="server-config-section-status-v103"><h2>Network change awaiting restart</h2><SettingsStateChip tone="warning" icon="refresh">Staged · action needed</SettingsStateChip></div>
          <p>The previous network configuration save was staged successfully. Further settings changes are blocked until the independent Windows supervisor starts Cluster, verifies readiness and settles the rollout. Repeating Save will not clear this lock.</p>
          {networkDeployment?.configMatch === "unexpected" && <p role="alert">The active configuration matches neither staged snapshot. Do not force a new save. Inspect the native Server Manager and recovery logs.</p>}
          <div className="button-row">
            <ClusterButton type="button" variant="secondary" onClick={() => selectSection("network")}>Review network deployment</ClusterButton>
            <ClusterButton type="button" variant="secondary" onClick={() => void refreshNetworkDeployment()}>Refresh rollout state</ClusterButton>
            <ClusterButton type="button" variant="primary" disabled={restartRequestPending || networkDeployment?.configMatch === "unexpected"} busy={restartRequestPending} busyLabel="Authorizing…" onClick={() => void authorizePendingRestart()}>Authorize managed restart</ClusterButton>
          </div>
          <p className="muted tight">On older installations without web-managed restart, use Restart in the native Cluster Server control panel. Keep a local console session available while changing network settings.</p>
        </section>
      )}
      {saveError && !networkDeploymentPending ? <RequestErrorState compact error={saveError} title="Server configuration was not saved" onRetry={serverConfigConflict ? undefined : () => void save()} onReload={serverConfigConflict ? () => void refreshAfterServerConfigConflict() : undefined} reloadLabel="Refresh and review edits" /> : null}

      {changedFields.length > 0 && <ClusterSettingsChangeReview
        label="Review pending server edits"
        changes={changedFields.map((field) => ({
          id: String(field.key), label: field.label,
          // No raw configuration values enter the review UI. Secrets stay off the DOM.
          impact: (NETWORK_REVIEW_FIELDS as readonly string[]).includes(String(field.key)) ? "exposure"
            : field.restart ? "restart" : "protected",
        }))}
      />}
      <section className="studio-settings-context-v15 server-config-context-v15" aria-label={`${activeServerGroup.label} server configuration`}>
        <div className="studio-settings-context-head-v15"><div><p className="eyebrow">{activeServerGroup.label}</p><h2 className="server-config-section-title-v103"><ClusterIcon name={sectionLabels.find((item) => item.id === section)?.icon || "settings"} treatment="duotone" aria-hidden="true" />{sectionLabels.find((item) => item.id === section)?.label || activeServerGroup.label}</h2><p className="muted tight">{activeServerGroup.description}</p></div></div>
      </section>

      {section === "overview" && (
        <div className="server-config-overview-v238">
          <div className="server-config-metrics-v238">
            <ClusterButton unstyled type="button" onClick={() => selectSection("security")}>
              <div className="server-config-stat-head-v103"><ClusterIcon name="lock" aria-hidden="true" /><span>Security</span></div>
              <strong>{securityDiagnostics ? securityDiagnostics.ok ? "Reported OK" : "Needs review" : "Not checked"}</strong>
              <SettingsStateChip tone={!securityDiagnostics ? "neutral" : securityDiagnostics.ok && !(securityDiagnostics.notes?.length) ? "success" : "warning"}>{!securityDiagnostics ? "No diagnostics yet" : `${securityDiagnostics.notes?.length || 0} diagnostic notes`}</SettingsStateChip>
            </ClusterButton>
            <ClusterButton unstyled type="button" onClick={() => selectSection("sessions")}>
              <div className="server-config-stat-head-v103"><ClusterIcon name="users" aria-hidden="true" /><span>Sessions</span></div>
              <strong>{serverSessions.length}</strong>
              <SettingsStateChip tone="neutral" icon="user">{securityDiagnostics?.activeSessions ?? serverSessions.length} reported active</SettingsStateChip>
            </ClusterButton>
            <ClusterButton unstyled type="button" onClick={() => selectSection("backups")}>
              <div className="server-config-stat-head-v103"><ClusterIcon name="archive" aria-hidden="true" /><span>Backups</span></div>
              <strong>{serverBackups.length}</strong>
              <SettingsStateChip tone={securityDiagnostics?.latestBackup?.verification?.ok === true ? "success" : securityDiagnostics?.latestBackup ? "warning" : "neutral"}>{securityDiagnostics?.latestBackup?.verification?.ok === true ? "Latest verified" : securityDiagnostics?.latestBackup ? "Verification needed" : "No backup evidence"}</SettingsStateChip>
            </ClusterButton>
            <ClusterButton unstyled type="button" onClick={() => selectSection("integrations")}>
              <div className="server-config-stat-head-v103"><ClusterIcon name="code" aria-hidden="true" /><span>API &amp; webhooks</span></div>
              <strong>{configuredExtensionCount}</strong>
              <SettingsStateChip tone="neutral" icon="link">Enabled endpoints</SettingsStateChip>
            </ClusterButton>
            <ClusterButton unstyled type="button" onClick={() => selectSection("advanced")}>
              <div className="server-config-stat-head-v103"><ClusterIcon name="settings" aria-hidden="true" /><span>Editable settings</span></div>
              <strong>{serverManagedKeys.length}</strong>
              <SettingsStateChip tone={changedFields.length ? "warning" : "neutral"} icon={changedFields.length ? "note" : "check"}>{changedFields.length ? `${changedFields.length} unsaved changes` : "No draft changes"}</SettingsStateChip>
            </ClusterButton>
            <ClusterButton unstyled type="button" onClick={() => selectSection("network")}>
              <div className="server-config-stat-head-v103"><ClusterIcon name="cloud" aria-hidden="true" /><span>Private API</span></div>
              <strong>{settings.serverPort || 4000}</strong>
              <SettingsStateChip tone={settings.serverHost && !["127.0.0.1", "localhost", "::1"].includes(settings.serverHost) ? "warning" : "neutral"} icon="lock">Configured host: {settings.serverHost || "127.0.0.1"}</SettingsStateChip>
            </ClusterButton>
          </div>

          <div className="server-config-overview-grid-v238">
            <section className="panel server-config-runtime-v238">
              <div className="server-config-group-head-v238">
                <h2>Effective runtime</h2>
                <span>Read only</span>
              </div>
              <dl>
                <div>
                  <dt>Data root</dt>
                  <dd>
                    <code>{settings.dataRoot || "—"}</code>
                  </dd>
                </div>
                <div>
                  <dt>Upload root</dt>
                  <dd>
                    <code>{settings.uploadRoot || "—"}</code>
                  </dd>
                </div>
                <div>
                  <dt>Database URL</dt>
                  <dd>
                    <code>{settings.databaseUrl || "—"}</code>
                  </dd>
                </div>
                <div>
                  <dt>Config file</dt>
                  <dd>
                    <code>{settings.configPath || "—"}</code>
                  </dd>
                </div>
                <div>
                  <dt>Public API</dt>
                  <dd>
                    <code>{settings.publicApiUrl || "—"}</code>
                  </dd>
                </div>
                <div>
                  <dt>Public web</dt>
                  <dd>
                    <code>{settings.publicWebUrl || "—"}</code>
                  </dd>
                </div>
              </dl>
            </section>

            <section className="panel server-config-health-v238">
              <div className="server-config-group-head-v238">
                <h2>Security state</h2>
                <span>{securityDiagnostics?.ok ? "Pass" : "Review"}</span>
              </div>
              <div className="server-config-health-grid-v238">
                <div>
                  <span>Authentication</span>
                  <strong>{securityDiagnostics?.authRequired ? "Required" : "Open"}</strong>
                </div>
                <div>
                  <span>Discord gate</span>
                  <strong>{securityDiagnostics?.discordLinkRequired ? "Required" : "Optional"}</strong>
                </div>
                <div>
                  <span>Secure cookies</span>
                  <strong>{securityDiagnostics?.secureCookies ? "On" : "Off"}</strong>
                </div>
                <div>
                  <span>Rate limit</span>
                  <strong>{securityDiagnostics?.rateLimitEnabled ? "On" : "Off"}</strong>
                </div>
                <div>
                  <span>Origin checks</span>
                  <strong>{securityDiagnostics?.mutationOriginRequired ? "On" : "Off"}</strong>
                </div>
                <div>
                  <span>Security headers</span>
                  <strong>{securityDiagnostics?.securityHeadersEnabled ? "On" : "Off"}</strong>
                </div>
                <div>
                  <span>Encrypted secrets</span>
                  <strong>{securityDiagnostics?.secretsEncryptedAtRest ? "On" : "Off"}</strong>
                </div>
                <div>
                  <span>Audit rows</span>
                  <strong>{securityDiagnostics?.auditRows ?? "—"}</strong>
                </div>
                <div>
                  <span>Live clients</span>
                  <strong>{securityDiagnostics?.collaboration?.streamConnections ?? "—"}</strong>
                </div>
              </div>
            </section>

            <section className="panel server-config-notes-v238">
              <div className="server-config-group-head-v238">
                <h2>Action queue</h2>
                <span>{securityDiagnostics?.notes?.length || 0}</span>
              </div>
              {securityDiagnostics?.notes?.length ? (
                <ul>
                  {securityDiagnostics.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              ) : (
                <ClusterEmptyState compact kind="empty" title="No diagnostic warnings" description="Current server diagnostics are within expected operating limits." />
              )}
              <div className="button-row compact">
                <ClusterButton type="button" variant="secondary" onClick={() => selectSection("security")}>
                  Review security
                </ClusterButton>
                <ClusterButton type="button" variant="quiet" onClick={() => setStatus("Retention is managed in Studio Settings → Privacy & data.")}>
                  Retention policy location
                </ClusterButton>
              </div>
            </section>

            <section className="panel server-config-release-v238">
              <div className="server-config-group-head-v238">
                <h2>Release and collaboration</h2>
                <span>{securityDiagnostics?.qualityGate?.workflowConfigured ? "Configured" : "Check"}</span>
              </div>
              <dl>
                <div>
                  <dt>Verification</dt>
                  <dd>
                    <code>{securityDiagnostics?.qualityGate?.verificationCommand || "npm run verify"}</code>
                  </dd>
                </div>
                <div>
                  <dt>Routes audited</dt>
                  <dd>{securityDiagnostics?.qualityGate?.routeAudit?.routeCount ?? "—"}</dd>
                </div>
                <div>
                  <dt>Audit findings</dt>
                  <dd>{securityDiagnostics?.qualityGate?.routeAudit?.findings ?? "—"}</dd>
                </div>
                <div>
                  <dt>Active rooms</dt>
                  <dd>{securityDiagnostics?.collaboration?.activeRooms ?? "—"}</dd>
                </div>
                <div>
                  <dt>Presence sessions</dt>
                  <dd>{securityDiagnostics?.collaboration?.presenceSessions ?? "—"}</dd>
                </div>
                <div>
                  <dt>Pending broadcasts</dt>
                  <dd>{securityDiagnostics?.collaboration?.pendingBroadcasts ?? "—"}</dd>
                </div>
                <div>
                  <dt>Failed stream writes</dt>
                  <dd>{securityDiagnostics?.collaboration?.failedWriteCount ?? "—"}</dd>
                </div>
                <div>
                  <dt>Retained actions</dt>
                  <dd>{securityDiagnostics?.collaboration?.retainedActions ?? "—"}</dd>
                </div>
                <div>
                  <dt>Transport</dt>
                  <dd>{securityDiagnostics?.collaboration?.transport || "—"}</dd>
                </div>
              </dl>
            </section>
          </div>
        </div>
      )}

      {section === "network" && (
        <>
          <section className="panel server-config-group-v238" aria-label="Web and API port settings">
            <div className="server-config-group-head-v238">
              <div><h2><ClusterIcon name="cloud" aria-hidden="true" /> Ports &amp; listeners</h2>
                <p className="muted tight">The web port serves the browser and proxies requests to the private API port. Both are configurable and require a managed restart to take effect.</p>
              </div>
              <SettingsStateChip tone="neutral" icon="lock">API stays private</SettingsStateChip>
            </div>
            <div className="server-config-fields-v238">
              {SERVER_CONFIG_FIELDS.filter((field) => field.key === "webPort" || field.key === "serverPort").map(renderField)}
            </div>
            <p className="muted tight">For tunnels and reverse proxies, route public HTTPS to the loopback web port. Never route a public hostname to the private API or PostgreSQL port.</p>
          </section>
          <ServerNetworkTopology
            publicWebUrl={String(settings.publicWebUrl || "")}
            publicApiUrl={String(settings.publicApiUrl || "")}
            webHost={String(settings.webHost || "127.0.0.1")}
            webPort={Number(settings.webPort || 3000)}
            apiHost={String(settings.serverHost || "127.0.0.1")}
            apiPort={Number(settings.serverPort || 4000)}
            directTlsConfigured={Boolean(String(settings.webTlsCertFile || "").trim() && String(settings.webTlsKeyFile || "").trim())}
            allowInsecureLanHttp={settings.allowInsecureLanHttp === true}
            deploymentState={networkDeployment?.state}
            hasDraftChanges={changedFields.some((field) => (NETWORK_REVIEW_FIELDS as readonly string[]).includes(String(field.key)))}
          />
          <section className="panel server-config-group-v238" aria-label="Local network listener diagnostics">
            <div className="server-config-group-head-v238">
              <div>
                <h2><ClusterIcon name="check" aria-hidden="true" /> Check local ports</h2>
                <p className="muted tight">Test whether the saved Web and API ports accept local TCP connections. No external URLs are requested and no firewall or service settings are changed.</p>
              </div>
              <ClusterButton type="button" variant="secondary" onClick={() => void checkLocalNetwork()} busy={localNetworkChecking} busyLabel="Checking…" disabled={localNetworkChecking || savingConfig}>Check listeners</ClusterButton>
            </div>
            {localNetworkError && <p role="alert">{localNetworkError}</p>}
            {localNetworkDiagnostics && (
              <div aria-live="polite">
                {([["Web gateway", localNetworkDiagnostics.web], ["Private API", localNetworkDiagnostics.api]] as const).map(([label, result]) => (
                  <p key={label}>
                    <strong>{label}:</strong> {result.configuredHost}:{result.port}{" "}
                    <SettingsStateChip tone={result.status === "tcp_open" ? "info" : result.status === "tcp_closed" ? "warning" : "neutral"}>
                      {result.status === "tcp_open" ? "TCP port accepts connections" : result.status === "tcp_closed" ? "TCP connection failed" : result.status === "not_local" ? "Bind address not assigned to this machine" : "Invalid port"}
                    </SettingsStateChip>
                    {result.probeHost && result.probeHost !== result.configuredHost ? <small> · checked via {result.probeHost}</small> : null}
                  </p>
                ))}
                <p className="muted tight">{localNetworkDiagnostics.note}</p>
                <p className="muted tight">Checked {compactDateTime(localNetworkDiagnostics.checkedAt)}. Public DNS, TLS, remote access and Cloudflare/Tailscale are not tested.</p>
              </div>
            )}
            {changedFields.some((field) => (NETWORK_REVIEW_FIELDS as readonly string[]).includes(String(field.key))) && (
              <p className="muted tight">Unsaved network edits are not checked. Apply and complete the managed restart before testing the new ports.</p>
            )}
          </section>
          <ServerConnectionGuide webPort={Number(settings.webPort || 3000)} busy={savingConfig} onReview={() => void previewNetworkDraft()} onStageOrigin={(origin) => {
            // Stage only public HTTPS routing metadata. Listener and firewall policy
            // remain unchanged; the existing protected Save requires a PIN.
            setSettings((current) => ({ ...current, publicWebUrl: origin, publicApiUrl: origin, sessionSecure: true,
              corsOrigins: Array.from(new Set([...(current.corsOrigins || "").split(/[\n,]+/).map((item) => item.trim()).filter(Boolean), origin])).join(",") }));
            setNetworkReview(null);
            setStatus("HTTPS address staged. Review network changes before saving; external access is not active yet.");
          }} />
          {renderSectionFields("network", ["webPort", "serverPort"])}
          <section className="panel server-config-operations-v238" aria-label="Network deployment status">
            <div className="server-config-group-head-v238"><div><h2><ClusterIcon name="sync" aria-hidden="true" /> Managed network deployment</h2><p className="muted tight">After Save, a staged network change is checked on the next independent Windows startup. Only a matching, unmodified configuration can be rolled back automatically.</p></div><SettingsStateChip tone={networkDeployment?.state === "verified" ? "success" : networkDeployment?.state === "staged" ? "warning" : networkDeployment?.state === "rolled_back" ? "warning" : "neutral"} icon={networkDeployment?.state === "verified" ? "check" : "refresh"}>{networkDeployment?.state === "verified" ? "Local startup verified" : networkDeployment?.state === "staged" ? "Awaiting restart" : networkDeployment?.state === "rolled_back" ? "Rolled back" : "Not staged"}</SettingsStateChip></div>
            {networkDeploymentError ? <p className="muted">Cannot inspect the deployment record: {networkDeploymentError}</p> : null}
            {networkDeployment?.state === "staged" ? <p className="muted">Pending verification. {networkDeployment.advisory} Further protected Server Config saves are held until the rollout is settled.</p> : null}
            {networkDeployment?.state === "verified" ? <p className="muted">Native managed startup confirmed local application readiness. External DNS, TLS, Windows Firewall and client connectivity still require independent verification.</p> : null}
            {networkDeployment?.state === "rolled_back" ? <p className="muted">The previous boot configuration was retained or restored. Inspect the native Windows Service log and the Operations incident timeline.</p> : null}
            {networkDeployment?.configMatch === "unexpected" ? <p className="muted">Configuration differs from both rollout snapshots. Automatic restore is blocked pending administrator inspection.</p> : null}
            <div className="button-row compact"><ClusterButton type="button" variant="secondary" onClick={() => void refreshNetworkDeployment()}>Refresh deployment status</ClusterButton></div>
          </section>
          <section className="panel server-config-group-v238" aria-label="Networking and ports change review">
            <div className="server-config-group-head-v238">
              <div>
                <h2>Networking &amp; Ports: exposure review</h2>
                <p className="muted tight">Review staged listener ports, cookie security, proxy-header trust and public origins before saving. This check changes nothing and never opens Windows Firewall.</p>
              </div>
            </div>
            <div className="button-row">
              <ClusterButton type="button" variant="secondary" busy={networkReviewPending} busyLabel="Reviewing…" disabled={networkReviewPending || savingConfig} onClick={() => void previewNetworkDraft()}>
                <ClusterIcon name="refresh" /> Review network changes
              </ClusterButton>
            </div>
            {networkReviewError && <p role="alert" className="muted">Could not review draft: {networkReviewError}</p>}
            {networkReview && networkReview.fingerprint === JSON.stringify(networkDraft()) && (
              <div aria-live="polite">
                <p><strong>{networkReview.result.ok ? "No blocking configuration issues found" : `${networkReview.result.blockers.length} blocking configuration issue(s)`}</strong> · {networkReview.result.editedKeys.length} edited network fields · {networkReview.result.requiresRestart ? "Restart required" : "No listener restart inferred"}</p>
                <p className="muted tight">Private API: {networkReview.result.exposure.api} · Gateway: {networkReview.result.exposure.gateway} · Firewall/TLS/external reachability: not checked</p>
                {networkReview.result.boundDomainProfiles && <p className="muted tight">Bound domain profiles checked: {networkReview.result.boundDomainProfiles.checked}{networkReview.result.boundDomainProfiles.truncated ? "+ (additional profiles not inspected)" : ""}. Port mismatches: {networkReview.result.boundDomainProfiles.mismatches.length}.</p>}
                {networkReview.result.requiresExposureConfirmation && <p role="status">A separate exposure confirmation will be requested at Save. Only one Security PIN is required.</p>}
                {networkReview.result.blockers.map(issue => <p key={`${issue.code}-${issue.field}`} role="alert"><strong>{issue.field}:</strong> {issue.message}</p>)}
                {networkReview.result.warnings.map(issue => <p key={`${issue.code}-${issue.field}`} className="muted"><strong>{issue.field}:</strong> {issue.message}</p>)}
                <p className="muted tight">{networkReview.result.note}</p>
              </div>
            )}
            <p className="muted tight">PostgreSQL/Garnet, gateway certificates, firewall policy and owning process IDs are checked by their respective native or operations tools. A preview cannot certify them. Only the independent Windows Service can verify or automatically restore a staged rollout after its first failed start. This does not validate external gateway or TLS reachability.</p>
          </section>
        </>
      )}
      {section === "performance" && (
        <>
          <div className="hint-box">
            <strong>Server performance & resources</strong>
            <span>These settings control the existing Windows-hosted Resource Governor. Interactive requests and required job queues remain protected under load. Changes are saved with the Security PIN and take effect only after a managed server restart.</span>
          </div>
          {renderSectionFields("performance")}
          <section className="panel server-config-group-v238" aria-label="Resource governor safety policy">
            <div className="server-config-group-head-v238"><h2>Automatic overload protection</h2></div>
            <p className="muted tight">The governor continuously evaluates CPU, event-loop delay, database pressure and request latency. Busy, saturated and critical states still reduce background admission regardless of profile. The background worker cap cannot increase the server's physical capacity.</p>
            <p className="muted tight">Saved configuration is authoritative. Changing these controls does not start or cancel a job.</p>
          </section>
          <section className="panel server-config-group-v238" aria-label="Resource governor runtime diagnostics">
            <div className="server-config-group-head-v238">
              <div><h2>Active resource governor</h2><p className="muted tight">A single explicit diagnostic read when this section opens, plus manual refresh. No new background polling.</p></div>
              <ClusterButton type="button" variant="secondary" onClick={() => void refreshGovernorRuntime()} disabled={governorRuntimeLoading}>
                {governorRuntimeLoading ? "Checking…" : "Refresh runtime"}
              </ClusterButton>
            </div>
            {governorRuntimeError ? <p role="alert">{governorRuntimeError}</p> : null}
            {governorRuntime ? <div aria-live="polite">
              <p><strong>Observed mode:</strong> <SettingsStateChip tone={governorRuntime.governor.mode === "normal" ? "success" : governorRuntime.governor.mode === "busy" ? "warning" : "danger"}>{governorRuntime.governor.mode}</SettingsStateChip></p>
              <p><strong>Active profile:</strong> {governorRuntime.governor.profile.replaceAll("-", " ")} · saved profile: {String(savedSettings.serverResourceProfile || "automatic").replaceAll("-", " ")}</p>
              <p className="muted tight">
                <strong>Active worker cap:</strong> {governorRuntime.governor.maximumJobConcurrency} · <strong>Active recovery hold:</strong> {governorRuntime.governor.recoveryHoldMs.toLocaleString()} ms
              </p>
              {(savedSettings.serverResourceProfile && savedSettings.serverResourceProfile !== governorRuntime.governor.profile
                || savedSettings.serverResourceWorkerCap != null && savedSettings.serverResourceWorkerCap !== governorRuntime.governor.maximumJobConcurrency
                || savedSettings.serverResourceRecoveryHoldMs != null && savedSettings.serverResourceRecoveryHoldMs !== governorRuntime.governor.recoveryHoldMs)
                && <SettingsStateChip tone="warning" icon="refresh">Saved policy differs from active runtime. Managed server restart required.</SettingsStateChip>}
              <p className="muted tight">Overload scheduling factor before profile adjustments: {Math.round(governorRuntime.governor.backgroundConcurrencyScale * 100)}%. Background work {governorRuntime.governor.allowBackgroundTasks ? "allowed" : "deferred"}; maintenance {governorRuntime.governor.allowMaintenanceTasks ? "allowed" : "deferred"}.</p>
              <p className="muted tight">CPU: {governorRuntime.governor.runtime.cpuPercent.toFixed(1)}% · Event-loop p95: {governorRuntime.governor.runtime.eventLoopP95Ms.toFixed(1)} ms · Database utilization: {Math.round(governorRuntime.governor.runtime.databaseUtilization * 100)}% · Request p95: {governorRuntime.governor.runtime.requestP95Ms.toFixed(1)} ms</p>
              <p className="muted tight">Measured {compactDateTime(governorRuntime.checkedAt)}. These are point-in-time readings, not a live benchmark.</p>
            </div> : !governorRuntimeLoading ? <p className="muted tight">No runtime measurements loaded.</p> : null}
          </section>
        </>
      )}
      {section === "domains" && <ServerDomainsPanel />}
      {section === "maintenance" && (
        <>
          <div className="hint-box"><strong>Scheduled health checks</strong><span>These intervals tune existing server jobs without creating additional polling workers. No automatic update, restart, data deletion, or recovery action is authorized by changing these values. Live cadence changes rearm idle tasks. Active scans remain bounded by the background scheduler.</span></div>
          {renderSectionFields("maintenance")}
          <section className="panel server-config-operations-v238" aria-label="Saved maintenance window preview">
            <div className="server-config-group-head-v238"><div><h2>Planned service windows</h2><p className="muted tight">Preview saved maintenance windows in their configured timezone. Draft changes above take effect only after a protected Save. This calendar never initiates a reboot, update or drain.</p></div></div>
            <ClusterButton type="button" variant="secondary" busy={maintenanceWindowsLoading} busyLabel="Checking…" disabled={maintenanceWindowsLoading} onClick={() => void previewSavedMaintenanceWindows()}>Preview saved windows</ClusterButton>
            {maintenanceWindowsError && <p role="alert">{maintenanceWindowsError}</p>}
            {maintenanceWindows && <div aria-live="polite">
              <p><strong>{maintenanceWindows.enabled ? "Window planning enabled" : "Window planning disabled"}</strong> · {maintenanceWindows.timezone} · {maintenanceWindows.days.join(", ")} at {maintenanceWindows.localStart} · {maintenanceWindows.durationMinutes} minutes</p>
              {maintenanceWindows.windows.map(window => <p key={window.startAt}><strong>{window.active ? "Active window" : "Upcoming window"}:</strong> {compactDateTime(window.startAt)} to {compactDateTime(window.endAt)} (local date {window.localDate})</p>)}
              {maintenanceWindows.enabled && !maintenanceWindows.windows.length && <p role="status">No matching window in the bounded 22-day preview. Review the timezone and daylight-saving transition.</p>}
              <p className="muted tight">{maintenanceWindows.note}</p>
            </div>}
          </section>
          <section className="panel server-config-operations-v238" aria-label="Maintenance readiness preflight">
            <div className="server-config-group-head-v238"><div><h2>Maintenance transition preflight</h2><p className="muted tight">Run a read-only check of database/storage readiness, active scheduled work, in-flight requests and durable jobs before planning service maintenance. This does not initiate a restart or mode change.</p></div></div>
            <div className="button-row compact">
              <label className="field"><span>Proposed operation</span>
                <ClusterNativeSelect value={maintenanceIntent} onChange={event => { setMaintenanceIntent(event.target.value as typeof maintenanceIntent); setMaintenancePreflight(null); }}>
                  <option value="enter-maintenance">Enter maintenance</option>
                  <option value="enter-read-only">Enter read-only</option>
                  <option value="restart">Restart Windows Service</option>
                  <option value="update">Apply server update</option>
                </ClusterNativeSelect>
              </label>
              <ClusterButton type="button" variant="secondary" busy={maintenancePreflightLoading} busyLabel="Checking…" disabled={maintenancePreflightLoading} onClick={() => void previewMaintenance()}>Check maintenance readiness</ClusterButton>
            </div>
            {maintenancePreflightError && <p role="alert">{maintenancePreflightError}</p>}
            {maintenancePreflight && <div aria-live="polite">
              <p><strong>{maintenancePreflight.ok ? "No immediate blockers in the sampled evidence" : `${maintenancePreflight.blockers.length} maintenance blocker(s)`}</strong> · {compactDateTime(maintenancePreflight.checkedAt)}</p>
              {maintenanceIntent === "update" && <p className="muted tight">Update recovery proof: {maintenancePreflight.observed.recovery ? `${maintenancePreflight.observed.recovery.state} · ${maintenancePreflight.observed.recovery.evidenceAt ? compactDateTime(maintenancePreflight.observed.recovery.evidenceAt) : "no evidence timestamp"}` : "Unverified"}</p>}
              <p className="muted tight">Maintenance window: {maintenancePreflight.observed.window ? (maintenancePreflight.observed.window.enabled ? (maintenancePreflight.observed.window.active ? "Active" : "Outside window") : "Not configured") : "Unverified"}{maintenancePreflight.observed.window?.nextStartAt ? ` · Next window ${compactDateTime(maintenancePreflight.observed.window.nextStartAt)}` : ""}</p>
              <p className="muted tight">Current mode: {maintenancePreflight.observed.mode} · Scheduled tasks: {maintenancePreflight.observed.runningTasks ?? "unknown"} · Durable jobs: {maintenancePreflight.observed.runningJobs ?? "unknown"} · Heavy/critical requests: {maintenancePreflight.observed.heavyInFlight ?? "unknown"}/{maintenancePreflight.observed.criticalInFlight ?? "unknown"}</p>
              {maintenancePreflight.blockers.map(item => <p key={item.code} role="alert"><strong>{item.code}:</strong> {item.detail}</p>)}
              {maintenancePreflight.warnings.map(item => <p key={item.code} className="muted"><strong>{item.code}:</strong> {item.detail}</p>)}
              <p className="muted tight">{maintenancePreflight.note}</p>
            </div>}
            <p className="muted tight">A clean preview is not permission to stop services. A future native Windows Service transition must still re-check under a drain lock, checkpoint background work, confirm backup/restore readiness and verify recovery.</p>
          </section>
        </>
      )}
      {section === "security" && (
        <>
          {renderSectionFields("security")}
          {securityPolicy && (
            <section className="panel server-config-operations-v238 studio-security-policy-v495">
              <div className="server-config-group-head-v238"><div><h2>Studio security policy</h2><p className="muted tight">Enforced server-side for MFA, session lifetime, scoped credentials, and operator-managed secret rewrap.</p></div><span>{securityPosture?.healthy ? "Healthy" : "Needs attention"}</span></div>
              <div className="server-config-form-grid-v238">
                <label className="field"><span>MFA requirement</span><ClusterNativeSelect value={securityPolicy.mfaRequirement} onChange={(event) => setSecurityPolicy({ ...securityPolicy, mfaRequirement: event.target.value as StudioSecurityPolicy["mfaRequirement"] })}><option value="optional">Optional</option><option value="admins">Owners + admins</option><option value="all">Everyone</option></ClusterNativeSelect></label>
                <label className="field"><span>Member MFA strength</span><ClusterNativeSelect value={securityPolicy.mfaMinimumStrength} onChange={(event) => setSecurityPolicy({ ...securityPolicy, mfaMinimumStrength: event.target.value as StudioSecurityPolicy["mfaMinimumStrength"] })}><option value="mfa">Any MFA</option><option value="phishing_resistant">Passkey or security key</option><option value="hardware_backed">Hardware security key</option></ClusterNativeSelect></label>
                <label className="field"><span>Owner/admin MFA strength</span><ClusterNativeSelect value={securityPolicy.adminMfaMinimumStrength} onChange={(event) => setSecurityPolicy({ ...securityPolicy, adminMfaMinimumStrength: event.target.value as StudioSecurityPolicy["adminMfaMinimumStrength"] })}><option value="mfa">Any MFA</option><option value="phishing_resistant">Passkey or security key</option><option value="hardware_backed">Hardware security key</option></ClusterNativeSelect></label>
                <label className="field"><span>High-risk verification</span><ClusterNativeSelect value={securityPolicy.highRiskVerificationMinimumStrength} onChange={(event) => setSecurityPolicy({ ...securityPolicy, highRiskVerificationMinimumStrength: event.target.value as StudioSecurityPolicy["highRiskVerificationMinimumStrength"] })}><option value="knowledge">Password or PIN</option><option value="mfa">Any MFA</option><option value="phishing_resistant">Passkey or security key</option><option value="hardware_backed">Hardware security key</option></ClusterNativeSelect></label>
                <label className="field checkbox-row"><ClusterInput type="checkbox" checked={securityPolicy.highRiskRequireDeviceProof} onChange={(event) => setSecurityPolicy({ ...securityPolicy, highRiskRequireDeviceProof: event.target.checked })} /><span>Require cryptographic device proof for high-risk actions</span></label>
                <label className="field"><span>Session lifetime (days)</span><ClusterInput type="number" min={1} max={365} value={securityPolicy.sessionDays} onChange={(event) => setSecurityPolicy({ ...securityPolicy, sessionDays: Math.max(1, Number(event.target.value) || 1) })} /></label>
                <label className="field"><span>Idle timeout (hours)</span><ClusterInput type="number" min={1} max={8760} value={securityPolicy.sessionIdleHours} onChange={(event) => setSecurityPolicy({ ...securityPolicy, sessionIdleHours: Math.max(1, Number(event.target.value) || 1) })} /></label>
                <label className="field"><span>Maximum sessions per user</span><ClusterInput type="number" min={1} max={100} value={securityPolicy.sessionMaxPerUser} onChange={(event) => setSecurityPolicy({ ...securityPolicy, sessionMaxPerUser: Math.max(1, Number(event.target.value) || 1) })} /></label>
                <label className="field checkbox-row"><ClusterInput type="checkbox" checked={securityPolicy.credentialRequireExpiry} onChange={(event) => setSecurityPolicy({ ...securityPolicy, credentialRequireExpiry: event.target.checked })} /><span>Require scoped credential expiry</span></label>
                <label className="field"><span>Credential max lifetime (days)</span><ClusterInput type="number" min={1} max={3650} value={securityPolicy.credentialMaxLifetimeDays} onChange={(event) => setSecurityPolicy({ ...securityPolicy, credentialMaxLifetimeDays: Math.max(1, Number(event.target.value) || 1) })} /></label>
                <label className="field"><span>Credential rotation target (days)</span><ClusterInput type="number" min={1} max={3650} value={securityPolicy.credentialRotationDays} onChange={(event) => setSecurityPolicy({ ...securityPolicy, credentialRotationDays: Math.max(1, Number(event.target.value) || 1) })} /></label>
                <label className="field wide"><span>Allowed credential scopes</span><ClusterTextarea rows={3} value={securityPolicy.credentialAllowedScopes.join(", ")} onChange={(event) => setSecurityPolicy({ ...securityPolicy, credentialAllowedScopes: [...new Set(event.target.value.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean))] })} /></label>
              </div>
              {securityPosture && <div className="hint-box"><strong>Security posture</strong><span>{securityPosture.mfaEnrollmentGaps} MFA enrollment gap{securityPosture.mfaEnrollmentGaps === 1 ? "" : "s"} · {securityPosture.mfaStrengthGaps} factor-strength gap{securityPosture.mfaStrengthGaps === 1 ? "" : "s"} · {securityPosture.requiredSessionsWithoutMfa} noncompliant session{securityPosture.requiredSessionsWithoutMfa === 1 ? "" : "s"} · {securityPosture.verifiedDevices}/{securityPosture.registeredDevices} devices cryptographically bound · {securityPosture.credentialRotationDue} credential rotation{securityPosture.credentialRotationDue === 1 ? "" : "s"} due · {securityPosture.credentialsWithoutExpiry} credential{securityPosture.credentialsWithoutExpiry === 1 ? "" : "s"} without expiry · {securityPosture.credentialScopePolicyViolations} scope-policy violation{securityPosture.credentialScopePolicyViolations === 1 ? "" : "s"} · {securityPosture.credentialLifetimePolicyViolations} max-lifetime violation{securityPosture.credentialLifetimePolicyViolations === 1 ? "" : "s"}</span><span>Encryption key: {securityPosture.encryptionKeyConfigured ? securityPosture.encryptionKeyId || "configured" : "not configured"}{securityPosture.previousEncryptionKeyIds.length ? ` · ${securityPosture.previousEncryptionKeyIds.length} previous key${securityPosture.previousEncryptionKeyIds.length === 1 ? "" : "s"} available for rotation` : ""}</span></div>}
              {securityPosture?.findings?.length ? <div className="security-findings-v504" aria-label="Security findings">{securityPosture.findings.map((finding) => <div key={finding.id} className={`hint-box security-finding-v504 security-finding-${finding.severity}-v504`}><strong>{finding.title}</strong><span>{finding.detail}</span><span><b>Remediation:</b> {finding.remediation}</span></div>)}</div> : null}
              <div className="button-row"><ClusterButton type="button" variant="primary" onClick={() => void saveStudioSecurityPolicy()}>Apply security policy</ClusterButton><ClusterButton type="button" variant="secondary" disabled={!securityPosture?.encryptionKeyConfigured} onClick={() => void rewrapProtectedSecrets()}>Rewrap protected secrets</ClusterButton></div>
            </section>
          )}
          {currentUser.workspaceRole === "owner" && <section className="panel server-config-operations-v238">
            <div className="server-config-group-head-v238"><div><h2>Owner security</h2><p className="muted tight">Owner accounts require a passkey or security key. Save the one-time recovery codes shown during authenticator enrollment. Physical-server recovery remains available to authorized host operators.</p></div></div>
          </section>}
          <section className="panel server-config-operations-v238 service-credentials-v495">
            <div className="server-config-group-head-v238"><div><h2>Scoped credentials</h2><p className="muted tight">Create copy-once API, webhook-signing, or extension credentials. Stored bearer tokens are hashed; signing secrets use Cluster's encrypted storage key.</p></div><span>{serviceCredentials.filter((item) => !item.revokedAt).length} active</span></div>
            <div className="server-config-form-grid-v238">
              <label className="field"><span>Name</span><ClusterInput value={credentialName} onChange={(event) => setCredentialName(event.target.value.slice(0, 120))} placeholder="Build automation" /></label>
              <label className="field"><span>Type</span><ClusterNativeSelect value={credentialType} onChange={(event) => setCredentialType(event.target.value as ServiceCredentialRecord["credentialType"])}><option value="api_token">API token</option><option value="webhook_signing">Webhook signing</option><option value="extension_token">Extension token</option></ClusterNativeSelect></label>
              <label className="field"><span>Scopes</span><ClusterInput value={credentialScopes} onChange={(event) => setCredentialScopes(event.target.value)} placeholder="projects.read, files.read" /></label>
              <label className="field"><span>Expires (optional)</span><ClusterInput type="datetime-local" value={credentialExpiry} onChange={(event) => setCredentialExpiry(event.target.value)} /></label>
            </div>
            <div className="button-row"><ClusterButton type="button" variant="primary" onClick={() => void createServiceCredential()}>Create credential</ClusterButton></div>
            {credentialSecret && <div className="hint-box security-copy-once-v495"><strong>Copy now · {credentialSecret.name}</strong><code>{credentialSecret.value}</code><span>This plaintext value is intentionally shown only in this response.</span><ClusterCopyButton text={credentialSecret.value} size="compact" copiedLabel="Credential copied">Copy</ClusterCopyButton></div>}
            <div className="server-session-list-v238">{serviceCredentials.length ? serviceCredentials.slice(0, 30).map((credential) => <article key={credential.id}><div><strong>{credential.name}{credential.revokedAt ? " · revoked" : ""}</strong><span>{credential.credentialType.replace(/_/g, " ")} · {credential.tokenPrefix || "write-only secret"}{credential.secretFingerprint ? ` · ${credential.secretFingerprint}` : ""}</span><em>{credential.scopes.join(", ") || "No scopes"} · last used {credential.lastUsedAt ? compactDateTime(credential.lastUsedAt) : "never"}{credential.expiresAt ? ` · expires ${compactDateTime(credential.expiresAt)}` : ""}{credential.rotationDue ? " · rotation due" : ""}{credential.scopePolicyCompliant === false ? " · blocked by scope policy" : ""}</em></div>{!credential.revokedAt && <div className="button-row compact"><ClusterButton type="button" size="compact" onClick={() => void rotateServiceCredential(credential)}>Rotate</ClusterButton><ClusterButton type="button" variant="danger" size="compact" onClick={() => void revokeServiceCredential(credential)}>Revoke</ClusterButton></div>}</article>) : <ClusterEmptyState compact kind="first-use" title="No scoped credentials" description="Create a scoped credential when an integration needs server access." />}</div>
          </section>
          <section className="panel server-config-operations-v238 admin-devices-v495">
            <div className="server-config-group-head-v238"><div><h2>Device inventory</h2><p className="muted tight">Aggregated installation identities across active sessions. Device IDs assist revocation and audit; they are not MFA trust tokens.</p></div><span>{serverDevices.length}</span></div>
            <div className="server-session-list-v238">{serverDevices.length ? serverDevices.slice(0, 40).map((device) => <article key={`${device.userId}:${device.deviceId}`}><div><strong>{device.user?.displayName || device.user?.username || device.userId} · {device.label}{device.current ? " · current" : ""}</strong><span>{device.userAgent}</span><em>{device.activeSessionCount} active · seen {compactDateTime(device.lastSeenAt)} · {device.platform || "unknown platform"} · {device.cryptographicallyBound ? `proof verified${device.proofKeyFingerprint ? ` · ${device.proofKeyFingerprint}` : ""}` : "installation ID only"}</em></div><ClusterButton type="button" variant="danger" size="compact" onClick={() => void revokeAdminDevice(device)}>Revoke device</ClusterButton></article>) : <ClusterEmptyState compact kind="empty" title="No registered devices" description="Registered installation devices will appear after users connect to this server." />}</div>
          </section>
          <section className="panel server-config-operations-v238">
            <div className="server-config-group-head-v238">
              <h2>Security operations</h2>
              <span>{securityDiagnostics?.auditRows ?? "—"} audit rows</span>
            </div>
            <div className="button-row">
              <ClusterButton type="button" variant="secondary" onClick={revokeOtherSessions}>
                Revoke my other sessions
              </ClusterButton>
              <ClusterButton type="button" variant="secondary" onClick={() => setStatus("Retention is managed in Studio Settings → Privacy & data.")}>
                Retention policy location
              </ClusterButton>
              <ClusterButton type="button" variant="quiet" onClick={() => void loadOperationalData()}>
                Refresh diagnostics
              </ClusterButton>
            </div>
          </section>
        </>
      )}
      {section === "storage" && (
        <>
          <section className="panel server-config-runtime-v238">
            <div className="server-config-group-head-v238">
              <h2>Effective storage paths</h2>
              <span>Resolved by server</span>
            </div>
            <dl>
              <div>
                <dt>Data root</dt>
                <dd>
                  <code>{settings.dataRoot || "—"}</code>
                </dd>
              </div>
              <div>
                <dt>Upload root</dt>
                <dd>
                  <code>{settings.uploadRoot || "—"}</code>
                </dd>
              </div>
              <div>
                <dt>Database URL</dt>
                <dd>
                  <code>{settings.databaseUrl || "—"}</code>
                </dd>
              </div>
              <div>
                <dt>Config path</dt>
                <dd>
                  <code>{settings.configPath || "—"}</code>
                </dd>
              </div>
            </dl>
          </section>
          {renderSectionFields("storage")}
        </>
      )}
      {section === "backups" && (
        <div className="server-config-contained-v241 server-config-backups-v241">
          <div className="server-config-contained-settings-v241">{renderSectionFields("backups")}</div>
          <section className="panel server-config-operations-v238 server-config-sidecar-v241">
            <div className="server-config-group-head-v238">
              <h2>Backups</h2>
              <span>{serverBackups.length}</span>
            </div>
            <div className="button-row compact server-config-sidecar-actions-v241">
              <ClusterButton type="button" variant="primary" onClick={runServerBackupNow}>
                Run backup
              </ClusterButton>
              <ClusterButton type="button" variant="secondary" onClick={() => void createPreUpgradeCheckpointNow()}>
                Pre-upgrade checkpoint
              </ClusterButton>
              <ClusterButton type="button" variant="secondary" onClick={() => void loadOperationalData()}>
                Refresh
              </ClusterButton>
            </div>
            {recoveryReadiness && <div className={`hint-box recovery-readiness-v495 is-${recoveryReadiness.state}`}><strong>Recovery readiness · {recoveryReadiness.state}</strong><span>{recoveryReadiness.checks.completeSchema ? "schema 3 complete generation" : "incomplete generation"} · verification {recoveryReadiness.checks.verificationPassed ? "passed" : "missing/failed"} · restore drill {recoveryReadiness.checks.restoreDrillPassed ? "passed" : "missing/failed"} · secret key {recoveryReadiness.checks.secretKeyAvailable === false ? "unavailable" : "available"}</span><em>{recoveryReadiness.note}</em></div>}
            <div className="server-backup-list-v238 server-config-contained-list-v241">
              {serverBackups.length ? (
                serverBackups.map((backup) => (
                  <article key={backup.fileName}>
                    <div>
                      <strong>{backup.fileName}</strong>
                      <span>
                        {backup.version} · {backup.reason}
                      </span>
                      <em>
                        {backup.createdAt ? compactDateTime(backup.createdAt) : "Unknown date"} · {backup.verification?.ok === true ? "Verified" : backup.verification?.ok === false ? "Failed" : "Not verified"}
                      </em>
                    </div>
                    <div className="button-row compact">
                      <ClusterButton type="button" size="compact" onClick={() => verifyBackup(backup.fileName)}>
                        Verify
                      </ClusterButton>
                      <ClusterButton type="button" size="compact" onClick={() => runRestoreDrill(backup.fileName)}>
                        Drill
                      </ClusterButton>
                      <ClusterButton type="button" variant="danger" size="compact" onClick={() => deleteServerBackup(backup.fileName)}>
                        Delete
                      </ClusterButton>
                    </div>
                  </article>
                ))
              ) : (
                <ClusterEmptyState compact kind="empty" title="No backups found" description="Completed server backups will appear here with verification details." />
              )}
            </div>
          </section>
        </div>
      )}
      {section === "integrations" && (
        <div className="server-config-groups-v238 server-config-integrations-v241">
          <section className="panel server-config-operations-v238 integration-webhooks-v495">
            <div className="server-config-group-head-v238"><div><h2>Outbound webhooks</h2><p className="muted tight">Signed, durable deliveries use encrypted destinations and retry payloads. HTTPS is required unless private-network HTTP is explicitly enabled.</p></div><span>{webhookEndpoints.filter((endpoint) => endpoint.enabled).length} active</span></div>
            <div className="server-config-form-grid-v238">
              <label className="field"><span>Name</span><ClusterInput value={webhookName} onChange={(event) => setWebhookName(event.target.value.slice(0, 120))} placeholder="Production automation" /></label>
              <label className="field span-2"><span>Destination URL</span><ClusterInput value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} placeholder="https://automation.example.com/cluster" /></label>
              <label className="field span-2"><span>Events</span><ClusterInput value={webhookEventTypes} onChange={(event) => setWebhookEventTypes(event.target.value)} placeholder="activity.recorded, project.*" /></label>
              <label className="field"><span>Project ID (optional)</span><ClusterInput value={webhookProjectId} onChange={(event) => setWebhookProjectId(event.target.value)} placeholder="All projects" /></label>
              <label className="field"><span>Private network</span><ClusterInput type="checkbox" checked={webhookAllowPrivate} onChange={(event) => { setWebhookAllowPrivate(event.target.checked); if (!event.target.checked) setWebhookAllowHttpPrivate(false); }} /></label>
              <label className="field"><span>Allow HTTP on private network</span><ClusterInput type="checkbox" checked={webhookAllowHttpPrivate} disabled={!webhookAllowPrivate} onChange={(event) => setWebhookAllowHttpPrivate(event.target.checked)} /></label>
            </div>
            <div className="button-row"><ClusterButton type="button" variant="primary" onClick={() => void createWebhookEndpoint()}>Create webhook</ClusterButton><span className="muted">Signature: HMAC-SHA256 over timestamp.event-id.raw-body</span></div>
            {webhookSecret && <div className="hint-box security-copy-once-v495"><strong>Copy once · {webhookSecret.name}</strong><code>{webhookSecret.value}</code><span>Store this secret in the receiving service. Cluster will not reveal it again.</span><ClusterCopyButton text={webhookSecret.value} size="compact" copiedLabel="Signing secret copied">Copy</ClusterCopyButton></div>}
            <div className="server-session-list-v238">{webhookEndpoints.length ? webhookEndpoints.map((endpoint) => <article key={endpoint.id}><div><strong>{endpoint.name}{endpoint.enabled ? "" : " · disabled"}</strong><span>{endpoint.urlDisplay}</span><em>{endpoint.eventTypes.join(", ")} · {endpoint.projectId ? `project ${endpoint.projectId}` : "all projects"} · {endpoint.lastSuccessAt ? `last success ${compactDateTime(endpoint.lastSuccessAt)}` : "no successful delivery yet"}{endpoint.consecutiveFailures ? ` · ${endpoint.consecutiveFailures} consecutive failure${endpoint.consecutiveFailures === 1 ? "" : "s"}` : ""}</em></div><div className="button-row compact"><ClusterButton type="button" size="compact" onClick={() => void testWebhookEndpoint(endpoint)}>Test</ClusterButton><ClusterButton type="button" size="compact" onClick={() => void rotateWebhookSecret(endpoint)}>Rotate secret</ClusterButton><ClusterButton type="button" variant="danger" size="compact" onClick={() => void deleteWebhookEndpoint(endpoint)}>Delete</ClusterButton></div></article>) : <ClusterEmptyState compact kind="first-use" title="No outbound webhooks" description="Add a webhook when an external service needs Cluster event delivery." />}</div>
          </section>
          <section className="panel server-config-operations-v238 webhook-deliveries-v495">
            <div className="server-config-group-head-v238"><div><h2>Recent webhook deliveries</h2><p className="muted tight">Retries use the durable background queue and a stable idempotency key per endpoint/event pair.</p></div><span>{webhookDeliveries.length}</span></div>
            <div className="server-session-list-v238">{webhookDeliveries.length ? webhookDeliveries.slice(0, 40).map((delivery) => <article key={delivery.id}><div><strong>{delivery.eventType} · {delivery.status.toLowerCase().replace(/_/g, " ")}</strong><span>Event {delivery.eventId} · attempt {delivery.attempts}{delivery.lastStatusCode ? ` · HTTP ${delivery.lastStatusCode}` : ""}{delivery.latencyMs !== null && delivery.latencyMs !== undefined ? ` · ${delivery.latencyMs} ms` : ""}</span><em>{delivery.lastError || (delivery.deliveredAt ? `Delivered ${compactDateTime(delivery.deliveredAt)}` : `Queued ${compactDateTime(delivery.createdAt)}`)}</em></div>{["RETRYING", "DEAD_LETTER", "CANCELLED"].includes(delivery.status) && <ClusterButton type="button" size="compact" onClick={() => void retryWebhookDelivery(delivery)}>Retry</ClusterButton>}</article>) : <ClusterEmptyState compact kind="empty" title="No webhook deliveries" description="Delivery attempts will appear after a configured webhook receives an event." />}</div>
          </section>
          <section className="panel server-config-operations-v238 public-api-v495">
            <div className="server-config-group-head-v238"><div><h2>Public API</h2><p className="muted tight">Machine clients authenticate with copy-once <code>clu_…</code> bearer credentials. Scopes are enforced per endpoint; browser sessions are never synthesized for API tokens.</p></div><span>v1</span></div>
            <div className="hint-box"><strong>Base path</strong><code>/api/public/v1</code><span>Current scopes include projects.read, files.read, builds.read/builds.write, qa.read, tickets.read, and calendar.read. Create and rotate API tokens in Security → Scoped credentials.</span></div>
          </section>
        </div>
      )}
      {section === "sessions" && (
        <section className="panel server-config-sessions-v238">
          <div className="server-config-group-head-v238">
            <h2>Active sessions</h2>
            <span>{serverSessions.length}</span>
          </div>
          <div className="button-row compact">
            <ClusterButton type="button" variant="secondary" onClick={() => void loadOperationalData()}>
              Refresh
            </ClusterButton>
            <ClusterButton type="button" variant="quiet" onClick={revokeOtherSessions}>
              Revoke my other sessions
            </ClusterButton>
          </div>
          <div className="server-session-list-v238">
            {serverSessions.length ? (
              serverSessions.map((session) => (
                <article key={session.id}>
                  <div>
                    <strong>
                      {session.user?.displayName || session.user?.username || "Unknown user"}
                      {session.current ? " · Current" : ""}
                    </strong>
                    <span>{session.userAgent}</span>
                    <em>
                      {session.ipAddress || "Unknown IP"} · {String(session.authMethod || "password").replace(/-/g, " ")} · seen {compactDateTime(session.lastSeenAt)} · expires {compactDateTime(session.expiresAt)}
                    </em>
                  </div>
                  {!session.current && (
                    <ClusterButton type="button" variant="danger" size="compact" onClick={() => revokeSession(session.id)}>
                      Revoke
                    </ClusterButton>
                  )}
                </article>
              ))
            ) : (
              <ClusterEmptyState compact kind="empty" title="No active sessions" description="No authenticated server sessions are currently active." />
            )}
          </div>
        </section>
      )}
      {section === "advanced" && (
        <div className="server-config-advanced-v238">
          <section className="panel server-config-index-v238">
            <div className="server-config-index-head-v238">
              <div>
                <h2>Complete configuration index</h2>
                <span>
                  {visibleAdvancedFields.length} of {SERVER_CONFIG_FIELDS.length} editable settings
                </span>
              </div>
              <ClusterInput type="search" value={configSearch} onChange={(event) => setConfigSearch(event.target.value)} placeholder="Search label, key, group, or section" />
            </div>
            <div className="server-config-index-grid-v238">{visibleAdvancedFields.map(renderField)}</div>
            {missingMetadataKeys.length > 0 && (
              <div className="server-config-missing-v238">
                <strong>Server keys without an editor</strong>
                {missingMetadataKeys.map((key) => (
                  <code key={key}>{key}</code>
                ))}
              </div>
            )}
          </section>
          <section className="panel server-config-runtime-v238">
            <div className="server-config-group-head-v238">
              <h2>Server-managed keys</h2>
              <span>{serverManagedKeys.length}</span>
            </div>
            <div className="server-config-key-cloud-v238">
              {serverManagedKeys.map((key) => (
                <code key={key}>{key}</code>
              ))}
            </div>
          </section>
        </div>
      )}
    </SettingsWorkspaceShell>
  );
}

