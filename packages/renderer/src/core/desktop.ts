import { inferReviewMediumFromResource, resolveViewableFormatSupport, parseClusterDeepLink, type ViewableResource } from "@cluster/shared";
import { CLUSTER_DESKTOP_BRIDGE_VERSION } from "./desktop-types";
import { navigationHash, parseNavigationRoute } from "./navigation";
import { desktopDeepLinkNavigation } from "../features/workflow/desktop-deep-link-navigation";
import { queueDesktopWorkNavigation, queueDesktopSourceCommit } from "../features/workflow/work-navigation";
import type {
  ClusterDesktopBridge,
  ClusterDesktopCloseBehavior,
  ClusterDesktopHealthResult,
  ClusterDesktopOfflineCacheStatus,
  ClusterDesktopCredentialVaultStatus,
  ClusterWorkstationServiceStatus,
  ClusterLocalWorkspace,
  ClusterLocalRepositoryCandidate,
  ClusterLocalGitStatus,
  ClusterLocalGitDetails,
  ClusterLocalGitDiff,
  ClusterLocalGitMutationAction,
  ClusterLocalGitMutationResult,
  ClusterLocalGitOperation,
  ClusterLocalGitLfsHealth,
  ClusterLocalGitLfsPolicy,
  ClusterLocalSecretScanResult,
  ClusterLocalHardwareCapabilities,
  ClusterLocalTaskOperation,
  ClusterLocalTaskDefinition,
  ClusterDesktopCaptureSource,
  ClusterDesktopCaptureResult,
  ClusterDesktopCollaborationFrame,
  ClusterDesktopPlatform,
  ClusterDesktopRecentServer,
  ClusterDesktopRendererState,
  ClusterDesktopRuntimeStatus,
  ClusterDesktopTransferState,
  ClusterDesktopUpdateState,
  ClusterDesktopFileWatch,
  ClusterDesktopFileWatchEvent,
} from "./desktop-types";

export type {
  ClusterDesktopBridge,
  ClusterDesktopCloseBehavior,
  ClusterDesktopHealthResult,
  ClusterDesktopOfflineCacheStatus,
  ClusterDesktopCredentialVaultStatus,
  ClusterWorkstationServiceStatus,
  ClusterLocalWorkspace,
  ClusterLocalRepositoryCandidate,
  ClusterLocalGitStatus,
  ClusterLocalGitDetails,
  ClusterLocalGitDiff,
  ClusterLocalGitMutationAction,
  ClusterLocalGitMutationResult,
  ClusterLocalGitOperation,
  ClusterLocalGitLfsHealth,
  ClusterLocalGitLfsPolicy,
  ClusterLocalSecretScanResult,
  ClusterLocalTaskDefinition,
  ClusterLocalTaskOperation,
  ClusterLocalHardwareCapabilities,
  ClusterDesktopCaptureSource,
  ClusterDesktopCaptureResult,
  ClusterDesktopCollaborationFrame,
  ClusterDesktopPlatform,
  ClusterDesktopRecentServer,
  ClusterDesktopRendererState,
  ClusterDesktopRuntimeStatus,
  ClusterDesktopTransferState,
  ClusterDesktopUpdateState,
  ClusterDesktopFileWatch,
  ClusterDesktopFileWatchEvent,
} from "./desktop-types";

declare global {
  interface Window {
    clusterDesktop?: ClusterDesktopBridge;
    __clusterDesktopState?: ClusterDesktopRendererState;
    __clusterNativeRequests?: ClusterNativeCapabilityRequest[];
    __clusterNativeDeliver?: (response: ClusterNativeCapabilityResponse) => void;
    __clusterNativeEventDeliver?: (event: ClusterNativeCapabilityEvent) => void;
  }
}


export type ClusterNativeCapability =
  | "runtime.info"
  | "dialog.pickFiles"
  | "dialog.pickDirectory"
  | "dialog.saveFile"
  | "file.open"
  | "file.reveal"
  | "file.preview"
  | "watch.start"
  | "watch.stop"
  | "watch.list"
  | "clipboard.status"
  | "clipboard.readText"
  | "clipboard.writeText"
  | "capture.screen"
  | "session.status"
  | "session.claim"
  | "session.clear"
  | "library.mount.status"
  | "library.mount.start"
  | "library.mount.stop"
  | "library.mount.refresh"
  | "library.mount.clearCache"
  | "shortcut.global.status"
  | "shortcut.global.setEnabled"
  | "navigation.back"
  | "navigation.forward"
  | "workspace.recent"
  | "workstation.status"
  | "workspace.local.list"
  | "workspace.local.create"
  | "workspace.local.remove"
  | "workspace.local.discoverRepositories"
  | "workspace.local.attachRepository"
  | "workspace.local.setRepositoryTrust"
  | "git.local.status"
  | "git.local.details"
  | "git.local.init"
  | "git.local.lfsHealth"
  | "git.local.lfsPolicy"
  | "git.local.diff"
  | "git.local.mutate"
  | "git.local.secretScan"
  | "git.local.clone"
  | "git.local.operation.start"
  | "git.local.operation.list"
  | "git.local.operation.cancel"
  | "task.local.definitions"
  | "task.local.run"
  | "task.local.list"
  | "task.local.cancel"
  | "hardware.local.capabilities"
  | "package.destination.list"
  | "package.destination.choose"
  | "package.destination.remove"
  | "package.auditManaged"
  | "package.previewFiles"
  | "package.syncFiles"
  | "package.replaceFiles"
  | "package.rollbackFiles"
  | "package.transfer.begin"
  | "package.transfer.inspect"
  | "package.transfer.diagnose"
  | "package.transfer.recover"
  | "package.transfer.append"
  | "package.transfer.commit"
  | "package.transfer.bindOffer"
  | "package.kit.begin"
  | "package.kit.chunk"
  | "package.kit.finish"
  | "package.kit.cancel"
  | "package.stageKit"
  | "package.auditKit"
  | "package.deployContent"
  | "package.rollbackContent"
  | "package.previewInstaller"
  | "package.previewUpgrade"
  | "package.upgradeMsi"
  | "package.installMsi"
  | "package.repairMsi"
  | "package.uninstallMsi"
  | "package.msiRepairStatus"
  | "package.msiUninstallStatus"
  | "package.msiUpgradeStatus"
  | "package.msiRollbackReview"
  | "package.msiRollbackStatus"
  | "package.rollbackMsi"
  | "package.msiProfileStatus"
  | "package.msiAttemptStatus"
  | "package.controlTrustStatus"
  | "package.provisionControlTrust"
  | "package.trustStatus"
  | "package.provisionTrust"
  | "package.stageStatus"
  | "transfer.list"
  | "transfer.status"
  | "transfer.claim"
  | "transfer.uploadProjectFile"
  | "transfer.download"
  | "transfer.pause"
  | "transfer.resume"
  | "transfer.retry"
  | "transfer.cancel"
  | "transfer.remove"
  | "transfer.retryAll"
  | "transfer.open"
  | "transfer.reveal"
  | "diagnostics.startup"
  | "diagnostics.preview"
  | "diagnostics.export"
  | "notification.status"
  | "notification.show"
  | "widget.library.status"
  | "widget.library.rescan"
  | "widget.library.open"
  | "widget.library.install"
  | "widget.library.remove"
  | "window.workspace.open"
  | "window.kiosk.status"
  | "window.kiosk.set"
  | "window.appSettings"
  | "window.serverProfiles"
  | "window.reload";

export type ClusterNativeLocalHandle = {
  handle: string;
  name: string;
  kind: "file" | "directory";
  expiresAt: string;
  sizeBytes?: number;
  mimeType?: string;
  writableDestination?: boolean;
};


export type ClusterNativeCapture = ClusterNativeLocalHandle & {
  captureMode: "screen" | "window" | "region";
  screenIndex: number;
  screenName?: string;
  width: number;
  height: number;
  temporary: true;
};

export type ClusterNativeLocalPreview = {
  handle: string;
  name: string;
  kind: "file" | "directory";
  previewKind: "directory" | "image" | "text" | "metadata";
  modifiedAt?: string;
  readOnly?: boolean;
  mimeType?: string;
  sizeBytes?: number;
  extension?: string;
  width?: number;
  height?: number;
  text?: string;
  truncated?: boolean;
};

export type ClusterNativeRuntimeInfo = {
  schema: 3;
  protocolVersion: 3;
  brokerEpoch: string;
  platform: Exclude<ClusterDesktopPlatform, "web">;
  appVersion?: string;
  profileId: string;
  serverUrl: string;
  capabilities: ClusterNativeCapability[];
  opaqueFileHandles: true;
  rawFilesystemPathsExposed: false;
  profileIsolation: true;
  nativeFileWatching: true;
  nativeNavigation: true;
  nativeRecentWorkspaces: true;
  workstationService?: boolean;
  workstationServiceProtocol?: 1;
  workstationOperationEvents?: boolean;
  nativeTransfers: true;
  nativeStartupDiagnostics: true;
  startupPerformance?: { controllerReadyMs?: number; initializeMs?: number; bootstrapStartedMs?: number; serverReadyMs?: number; rendererReadyMs?: number };
  nativeSaveDialogs: true;
  nativeCapture?: boolean;
  nativeCaptureModes?: Array<"screen" | "window" | "region">;
  nativeFilesystemDrop: true;
  sharedRendererParity: true;
  requestProfileBinding: true;
  strictPayloadSchemas: true;
  kioskMode?: boolean;
  customWidgetLibrary?: boolean;
  desktopOnlyAdvantages: string[];
};

type ClusterNativeCapabilityRequest = {
  schema: 1;
  id: string;
  capability: ClusterNativeCapability;
  payload: Record<string, unknown>;
  profileId?: string;
  brokerEpoch?: string;
};

type ClusterNativeCapabilityResponse = {
  schema: 1;
  id: string;
  ok: boolean;
  result?: unknown;
  error?: { code?: string; message?: string };
};

export type ClusterNativeRecentWorkspace = {
  route: string;
  title: string;
  kind: "project" | "board" | "whiteboard";
  resourceId: string;
  lastOpenedAt?: string;
};

export type ClusterNativeTransferQueueStatus = {
  writable: boolean;
  blockedReason: "" | "journal-invalid" | "journal-write-failed" | "owned-by-another-window" | "unavailable";
};

export type ClusterNativeTransfer = {
  id: string;
  direction: "upload" | "download";
  state: "queued" | "running" | "paused" | "verifying" | "committing" | "complete" | "failed" | "cancelled";
  title?: string;
  fileName?: string;
  totalBytes?: number;
  transferredBytes?: number;
  progress?: number;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string;
  resumable?: boolean;
  /** Authoritative native processing stage; separate from byte progress. */
  stage?: "queued" | "running" | "paused" | "verifying" | "committing" | "complete" | "failed" | "cancelled" | "finalizing-file" | "linking-evidence" | "evidence-link-failed" | "evidence-link-paused" | "evidence-link-queued" | "evidence-link-cancelled";
  /** The server Project file has been committed independently of the relationship. */
  fileSaved?: boolean;
  evidenceStatus?: "pending" | "linked" | "paused" | "failed" | "cancelled";
  evidenceTargetKind?: string;
  error?: string | { code?: string; message?: string };
  recoveryNote?: string;
  retryable?: boolean;
  canPause?: boolean;
  ownedByAnotherWindow?: boolean;
  canResume?: boolean;
  canRetry?: boolean;
  canOpen?: boolean;
};

export type ClusterNativeClipboardRead = {
  text: string;
  characters: number;
  truncated: boolean;
  plainTextOnly: true;
};

export type ClusterNativeLibraryMountStatus = {
  platform: Exclude<ClusterDesktopPlatform, "web">;
  provider: string;
  providerDetected: boolean;
  adapterBuilt?: boolean;
  engineReady: boolean;
  running?: boolean;
  authenticated?: boolean;
  refreshing?: boolean;
  featureLabel: string;
  locationLabel: string;
  mountLocation?: string;
  layout?: "unified" | "separate";
  organization?: "servers" | "libraries";
  entryCount?: number;
  serverCount?: number;
  authenticatedServerCount?: number;
  eligibleServerCount?: number;
  mountCount?: number;
  sources?: Array<{
    profileId: string;
    label: string;
    active?: boolean;
    authenticated?: boolean;
    eligible?: boolean;
    mountPolicy?: string;
    mountIsolation?: string;
    sensitiveOfflineCachePolicy?: "disabled" | "protected" | string;
    protectedCache?: { available?: boolean; crypto?: string; chunkBytes?: number; provider?: string; error?: string };
    readOnly?: boolean;
    error?: string;
  }>;
  readOnly?: boolean;
  mountPolicy?: string;
  mountIsolation?: string;
  sensitiveOfflineCachePolicy?: "disabled" | "protected" | string;
  protectedCache?: { available?: boolean; crypto?: string; chunkBytes?: number; provider?: string; error?: string };
  crossServerTransferPolicy?: string;
  lastError?: { code?: string; message?: string };
  defaultLayout: "unified";
  supportedLayouts: Array<"unified" | "separate">;
  supportedOrganization: Array<"servers" | "libraries">;
  note?: string;
};

export type ClusterNativeGlobalShortcutStatus = {
  enabled: boolean;
  registered: boolean;
  supported: boolean;
  provider: string;
  error?: string;
  showCluster: string;
  commandPalette: string;
  quickCreate: string;
  note?: string;
};

export type ClusterNativeKioskStatus = {
  enabled: boolean;
  sessionMode: "signed-in" | "signed-out";
  exitShortcut: string;
  persistent: boolean;
};

export type ClusterNativeWidgetBlock =
  | { type: "text"; text: string }
  | { type: "metric"; label: string; binding: string }
  | { type: "list"; label?: string; binding: string; limit?: number }
  | { type: "clock"; label?: string; format?: "time" | "date" | "datetime" };

export type ClusterNativeWidgetManifest = {
  schema: 1;
  id: string;
  name: string;
  version: string;
  description?: string;
  runtime: "declarative-v1";
  source: "custom";
  defaultSize?: "micro" | "compact" | "standard" | "wide" | "large" | "feature";
  minSize?: "micro" | "compact" | "standard" | "wide" | "large" | "feature";
  permissions?: string[];
  content?: { blocks: ClusterNativeWidgetBlock[] };
  publisher?: string;
  minimumClusterVersion?: string;
  provenance?: { origin: "desktop-library"; installedAt?: string; updatedAt?: string; digest?: string; sourceLabel?: string };
};

export type ClusterNativeWidgetLibraryStatus = {
  available: boolean;
  schema: 1;
  runtime: "declarative-v1";
  installPolicy: "native-folder-import";
  arbitraryCodeAllowed: false;
  clusterVersion: string;
  supportedManifestSchemas: number[];
  supportedPermissions: string[];
  widgetCount: number;
  invalidCount: number;
  invalidWidgets: Array<{ entry: string; reason: string }>;
  lastOperation?: { action: "installed" | "updated" | "reinstalled" | "removed"; id: string; fromVersion?: string; toVersion?: string };
  widgets: ClusterNativeWidgetManifest[];
};

export type ClusterNativeStartupDiagnostics = {
  sessionId: string;
  crashStreak: number;
  safeModeRecommended: boolean;
  version: string;
  platform: string;
  cpuArchitecture: string;
};

export type ClusterNativeDiagnosticPreview = {
  previewId: string;
  sha256: string;
  generatedAt: string;
  expiresAt: string;
  sizeBytes: number;
  mimeType: "application/json";
  text: string;
};

export type ClusterDesktopFilesystemDropEvent = {
  schema: 1;
  event: "filesystem.drop";
  profileId: string;
  items: ClusterNativeLocalHandle[];
};

export type ClusterDesktopTransferEvent = {
  schema: 1;
  event: "transfer.changed";
  profileId: string;
  items: ClusterNativeTransfer[];
  /** Native queue writer posture emitted with the item projection. */
  queueStatus?: ClusterNativeTransferQueueStatus;
};

export type ClusterDesktopWorkstationOperationsEvent = {
  schema: 1;
  event: "workstation.operations.changed";
  profileId?: string;
  operations: ClusterLocalGitOperation[];
};

export type ClusterDesktopPackageStageStatus = { state: "idle" | "verifying" | "staged_not_installed" | "audited_staged_not_installed" | "managed_content_selected" | "audited_managed_content" | "file_update_preview" | "file_update_audit" | "file_update_complete" | "file_update_rolled_back" | "msi_verified_not_executed" | "msi_upgrade_reviewable_not_authorized" | "msi_upgrade_process_exited" | "msi_upgrade_restart_required" | "msi_rollback_process_exited" | "msi_rollback_restart_required" | "msi_process_exited" | "msi_restart_required" | "failed"; operationId?: string; profileId?: string; artifactSha256?: string; packageKey?: string; version?: string; evidence?: "native_helper_self_report"; message?: string; note?: string; msiProduct?: { state: string; productCode: string; expectedVersion: string; reportedVersion?: string; versionMatches: boolean; readOnly: true; osAttested: false; probeComplete: boolean; probeScope: "" | "current_user_and_machine" }; msiUpgrade?: {schema:1; packageKey:string; version:string; artifactSha256:string; productCode:string; state:"reviewable_not_authorized"; readOnly:true; mutationAuthorized:false; osAttested:false; priorReceiptSha256:string; priorMsiPath:string; priorMsiSha256:string; priorProductVersion:string; targetProductVersion:string}; msiIdentity?: { state: string; declaredProductCode: string; declaredProductVersion: string; actualProductCode?: string; actualProductVersion?: string; verified: boolean; readOnly: true; osAttested: false }; filePlan?: {
  missing: number; current: number; managedUpdates: number; untrackedConflicts: number;
  modifiedConflicts: number; foreignOwnershipConflicts?: number; foreignOwnershipExamples?: string[]; overlappingRoots?: number; overlappingRootExamples?: string[]; canUpdateSafely: boolean; pendingRecovery: boolean;
  dependenciesReady?: boolean; dependencyBlocker?: string;
  conflictExamples: Array<{ path: string; action: "conflict_untracked" | "conflict_modified" }>;
} | null; fileAudit?: {
  tracked: number; verified: number; missing: number; modified: number;
  retired: number; retiredVerified: number; retiredMissing: number; retiredModified: number;
  untrackedCurrent: number; untrackedMissing: number; untrackedCollision: number;
  pendingRecovery: boolean; healthy: boolean; trackedArtifactSha256?: string;
  issues: Array<{ path: string; action: "tracked_missing" | "tracked_modified" | "retired_missing" | "retired_modified" | "untracked_collision" }>;
} | null };
export type ClusterDesktopPackageStageEvent = { schema: 1; event: "package.staging.changed"; profileId: string; status: ClusterDesktopPackageStageStatus };
type ClusterNativeCapabilityEvent = ClusterDesktopPackageStageEvent | ClusterDesktopFileWatchEvent | ClusterDesktopFilesystemDropEvent | ClusterDesktopTransferEvent | ClusterDesktopWorkstationOperationsEvent;
const nativeEventListeners = new Set<(event: ClusterDesktopFileWatchEvent) => void>();
const nativeDropListeners = new Set<(event: ClusterDesktopFilesystemDropEvent) => void>();
const nativePackageStageListeners = new Set<(event: ClusterDesktopPackageStageEvent) => void>();
const nativeTransferListeners = new Set<(event: ClusterDesktopTransferEvent) => void>();
const nativeWorkstationOperationListeners = new Set<(event: ClusterDesktopWorkstationOperationsEvent) => void>();

const nativePending = new Map<string, {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: number;
}>();
let nativeTransportInstalled = false;
let nativeBrokerContext: Pick<ClusterNativeRuntimeInfo, "profileId" | "brokerEpoch"> | null = null;
const NATIVE_AUTH_CLEAR_PENDING_KEY = "cluster.native-auth-clear-pending";

function nativeAuthenticationClearPending() {
  if (!desktopHintActive()) return false;
  try { return window.localStorage.getItem(NATIVE_AUTH_CLEAR_PENDING_KEY) === "1"; } catch { return false; }
}

function setNativeAuthenticationClearPending(pending: boolean) {
  if (!desktopHintActive()) return;
  try {
    if (pending) window.localStorage.setItem(NATIVE_AUTH_CLEAR_PENDING_KEY, "1");
    else window.localStorage.removeItem(NATIVE_AUTH_CLEAR_PENDING_KEY);
  } catch { /* A blocked storage API must not make logout itself fail. */ }
}

function desktopHintActive() {
  return typeof window !== "undefined" && new URLSearchParams(window.location.search).get("clusterDesktop") === "1";
}

function nativeRequestId() {
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  const random = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `req-${Date.now().toString(36)}-${random || Math.random().toString(36).slice(2, 18)}`.slice(0, 72);
}

function opaqueHandleToken(handle: string) { return `cluster-handle:${handle}`; }
function handleFromOpaqueToken(token: string) {
  return token.startsWith("cluster-handle:fh-") ? token.slice("cluster-handle:".length) : "";
}

export function installNativeCapabilityTransport() {
  if (!desktopHintActive() || nativeTransportInstalled) return;
  nativeTransportInstalled = true;
  window.__clusterNativeRequests = [];
  window.__clusterNativeDeliver = (response) => {
    if (!response || response.schema !== 1 || typeof response.id !== "string") return;
    const pending = nativePending.get(response.id);
    if (!pending) return;
    nativePending.delete(response.id);
    window.clearTimeout(pending.timeout);
    if (response.ok) pending.resolve(response.result);
    else {
      if (response.error?.code === "PROFILE_CONTEXT_MISMATCH" || response.error?.code === "BROKER_EPOCH_EXPIRED") nativeBrokerContext = null;
      const error = new Error(String(response.error?.message || response.error?.code || "Native capability failed."));
      Object.assign(error, { code: response.error?.code });
      pending.reject(error);
    }
  };
  window.__clusterNativeEventDeliver = (event) => {
    if (!event || event.schema !== 1) return;
    // A delayed native push from the previous server profile must not be
    // displayed as another profile's transfer queue after account switching.
    if (nativeBrokerContext && event.profileId && event.profileId !== nativeBrokerContext.profileId) return;
    if (event.event === "watch.changed") nativeEventListeners.forEach((listener) => listener(event));
    if (event.event === "filesystem.drop") nativeDropListeners.forEach((listener) => listener(event));
    if (event.event === "package.staging.changed") nativePackageStageListeners.forEach((listener) => listener(event));
    if (event.event === "transfer.changed") nativeTransferListeners.forEach((listener) => listener(event));
    if (event.event === "workstation.operations.changed") nativeWorkstationOperationListeners.forEach((listener) => listener(event));
  };

  const platform: Exclude<ClusterDesktopPlatform, "web"> = /Windows/i.test(window.navigator.userAgent) ? "windows"
    : /Macintosh|Mac OS/i.test(window.navigator.userAgent) ? "macos" : "linux";

  // Only expose compatibility shims backed by the narrow allowlisted broker. Raw filesystem
  // paths, process execution, credentials, capture, and generic IPC are intentionally absent.
  window.clusterDesktop = {
    bridgeVersion: CLUSTER_DESKTOP_BRIDGE_VERSION,
    platform,
    serverUrl: window.location.origin,
    requestNotificationPermission: async () => {
      const result = await requestNativeCapability<{ available?: boolean; enabled?: boolean }>("notification.status");
      return Boolean(result?.available && result?.enabled);
    },
    showNotification: async (payload) => {
      const result = await requestNativeCapability<{ shown?: boolean }>("notification.show", payload);
      return Boolean(result?.shown);
    },
    showConnection: async () => { await requestNativeCapability("window.serverProfiles"); },
    reloadApp: async () => { await requestNativeCapability("window.reload"); },
    openWorkspaceWindow: async (route, title) => {
      const result = await requestNativeCapability<{ opened?: boolean }>("window.workspace.open", { route, title: title || "Cluster workspace" });
      return Boolean(result?.opened);
    },
    writeClipboardText: async (text) => {
      const result = await requestNativeCapability<{ written?: boolean }>("clipboard.writeText", { text });
      return Boolean(result?.written);
    },
    navigateBack: async () => { await requestNativeCapability("navigation.back"); },
    navigateForward: async () => { await requestNativeCapability("navigation.forward"); },
    startFileWatch: async (token) => {
      const handle = handleFromOpaqueToken(token) || token;
      return requestNativeCapability<ClusterDesktopFileWatch>("watch.start", { handle });
    },
    stopFileWatch: async (watchId) => {
      const result = await requestNativeCapability<{ stopped?: boolean }>("watch.stop", { watchId });
      return Boolean(result?.stopped);
    },
    listFileWatches: async () => requestNativeCapability<ClusterDesktopFileWatch[]>("watch.list"),
    onFileWatch: (callback) => { nativeEventListeners.add(callback); return () => { nativeEventListeners.delete(callback); }; },
    pickFiles: async (options) => {
      const files = await requestNativeCapability<ClusterNativeLocalHandle[]>("dialog.pickFiles", options || {});
      return (files || []).map((item) => opaqueHandleToken(item.handle));
    },
    pickDirectory: async (options) => {
      const folder = await requestNativeCapability<ClusterNativeLocalHandle | null>("dialog.pickDirectory", options || {});
      return folder ? opaqueHandleToken(folder.handle) : null;
    },
    pickSaveDestination: async (options) => {
      const destination = await requestNativeCapability<ClusterNativeLocalHandle | null>("dialog.saveFile", options || {});
      return destination ? opaqueHandleToken(destination.handle) : null;
    },
    onFilesystemDrop: (callback) => {
      const listener = (event: ClusterDesktopFilesystemDropEvent) => callback(event.items.map((item) => ({ ...item, handle: opaqueHandleToken(item.handle) })));
      nativeDropListeners.add(listener);
      return () => nativeDropListeners.delete(listener);
    },
    revealPath: async (token) => {
      const handle = handleFromOpaqueToken(token);
      if (!handle) return false;
      const result = await requestNativeCapability<{ ok?: boolean }>("file.reveal", { handle });
      return Boolean(result?.ok);
    },
    openPath: async (token) => {
      const handle = handleFromOpaqueToken(token);
      if (!handle) return "Cluster Desktop only opens local items selected through a native picker.";
      const result = await requestNativeCapability<{ ok?: boolean }>("file.open", { handle });
      return result?.ok ? "" : "The operating system could not open that local item.";
    },
  };
}

export async function requestNativeCapability<T = unknown>(capability: ClusterNativeCapability, payload: Record<string, unknown> = {}): Promise<T> {
  if (!desktopHintActive()) throw new Error("Native capabilities require Cluster Desktop.");
  installNativeCapabilityTransport();
  if (capability !== "runtime.info" && !nativeBrokerContext) {
    const runtime = await requestNativeCapability<ClusterNativeRuntimeInfo>("runtime.info");
    if (!runtime?.profileId || !runtime?.brokerEpoch) throw new Error("Native capability context is unavailable.");
    nativeBrokerContext = { profileId: runtime.profileId, brokerEpoch: runtime.brokerEpoch };
  }
  if (capability !== "runtime.info" && capability !== "session.clear" && nativeAuthenticationClearPending()) {
    const cleared = await retryPendingNativeAuthenticationClear();
    if (!cleared) throw new Error("Native session cleanup is pending. Restart Cluster Desktop or sign out again before native capabilities are reused.");
  }
  if (!window.__clusterNativeRequests || window.__clusterNativeRequests.length >= 32 || nativePending.size >= 64)
    throw new Error("Native capability queue is busy. Try again shortly.");

  const id = nativeRequestId();
  const request: ClusterNativeCapabilityRequest = { schema: 1, id, capability, payload };
  if (capability !== "runtime.info" && nativeBrokerContext) {
    request.profileId = nativeBrokerContext.profileId;
    request.brokerEpoch = nativeBrokerContext.brokerEpoch;
  }
  const timeoutMs = capability.startsWith("dialog.") ? 10 * 60_000 : 30_000;
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      nativePending.delete(id);
      reject(new Error("Native capability request timed out."));
    }, timeoutMs);
    nativePending.set(id, { resolve: (value) => resolve(value as T), reject, timeout });
    window.__clusterNativeRequests!.push(request);
  });
}


async function retryPendingNativeAuthenticationClear() {
  if (!nativeAuthenticationClearPending()) return true;
  if (!nativeBrokerContext) return false;
  try {
    const result = await requestNativeCapability<{ cleared?: boolean }>("session.clear");
    const cleared = Boolean(result?.cleared);
    if (cleared) setNativeAuthenticationClearPending(false);
    return cleared;
  } catch {
    return false;
  }
}

export async function clearNativeAuthenticationState() {
  if (!desktopHintActive()) return false;
  // Persist first so a renderer/native crash during the clear cannot silently resurrect a stale cookie jar.
  setNativeAuthenticationClearPending(true);
  try {
    const result = await requestNativeCapability<{ cleared?: boolean }>("session.clear");
    const cleared = Boolean(result?.cleared);
    if (cleared) setNativeAuthenticationClearPending(false);
    return cleared;
  } catch {
    return false;
  }
}

export async function getNativeRuntimeInfo() {
  const runtime = await requestNativeCapability<ClusterNativeRuntimeInfo>("runtime.info");
  nativeBrokerContext = runtime?.profileId && runtime?.brokerEpoch ? { profileId: runtime.profileId, brokerEpoch: runtime.brokerEpoch } : null;
  if (nativeAuthenticationClearPending() && !(await retryPendingNativeAuthenticationClear()))
    throw new Error("Native session cleanup is pending. Cluster will not reuse native authentication until cleanup succeeds.");
  return runtime;
}

export async function pickNativeFiles(options: { title?: string; filters?: Array<{ name: string; extensions: string[] }>; multiple?: boolean } = {}) {
  return requestNativeCapability<ClusterNativeLocalHandle[]>("dialog.pickFiles", options);
}

export async function pickNativeDirectory(options: { title?: string } = {}) {
  return requestNativeCapability<ClusterNativeLocalHandle | null>("dialog.pickDirectory", options);
}

export async function pickNativeSaveDestination(options: { title?: string; suggestedName?: string; filters?: Array<{ name: string; extensions: string[] }> } = {}) {
  return requestNativeCapability<ClusterNativeLocalHandle | null>("dialog.saveFile", options);
}

export function onNativeFilesystemDrop(callback: (event: ClusterDesktopFilesystemDropEvent) => void) {
  nativeDropListeners.add(callback);
  return () => nativeDropListeners.delete(callback);
}

export async function revealNativeHandle(handle: string) {
  const result = await requestNativeCapability<{ ok?: boolean }>("file.reveal", { handle: handleFromOpaqueToken(handle) || handle });
  return Boolean(result?.ok);
}

export async function openNativeHandle(handle: string) {
  const result = await requestNativeCapability<{ ok?: boolean }>("file.open", { handle: handleFromOpaqueToken(handle) || handle });
  return Boolean(result?.ok);
}

export async function previewNativeHandle(handle: string) {
  return requestNativeCapability<ClusterNativeLocalPreview>("file.preview", { handle: handleFromOpaqueToken(handle) || handle });
}

export function mountedHandleViewableResource(preview: ClusterNativeLocalPreview): ViewableResource | null {
  if (!preview || preview.kind !== "file") return null;
  const originalName = String(preview.name || "local-file");
  const mimeType = String(preview.mimeType || "application/octet-stream");
  const medium = inferReviewMediumFromResource(mimeType, originalName);
  if (!medium) return null;
  const support = resolveViewableFormatSupport(medium, mimeType, originalName);
  const opaqueHandle = opaqueHandleToken(preview.handle);
  return {
    source: {
      id: opaqueHandle,
      provider: "mounted_handle",
      medium,
      title: originalName,
      originalName,
      mimeType,
      sizeBytes: Math.max(0, Number(preview.sizeBytes || 0)),
      sourceUrl: null,
      locator: { provider: "mounted_handle", handleId: opaqueHandle, revision: preview.modifiedAt || null },
      support: support.support === "unsupported" ? "unsupported" : "degraded",
      degradationReason: support.support === "unsupported"
        ? support.reason || "No safe viewer path is registered for this local resource."
        : "The Desktop native broker keeps local paths opaque. Import this handle through the verified transfer pipeline before opening full media bytes in the shared viewer.",
    },
    derivatives: [],
    preferredDerivativeId: null,
  };
}

export async function startNativeFileWatch(handle: string) {
  return requestNativeCapability<ClusterDesktopFileWatch>("watch.start", { handle: handleFromOpaqueToken(handle) || handle });
}
export async function stopNativeFileWatch(watchId: string) {
  const result = await requestNativeCapability<{ stopped?: boolean }>("watch.stop", { watchId });
  return Boolean(result?.stopped);
}
export async function listNativeFileWatches() {
  return requestNativeCapability<ClusterDesktopFileWatch[]>("watch.list");
}
export function subscribeNativeFileWatch(listener: (event: ClusterDesktopFileWatchEvent) => void) {
  installNativeCapabilityTransport();
  nativeEventListeners.add(listener);
  return () => { nativeEventListeners.delete(listener); };
}

export async function captureNativeScreen(input: {
  mode?: "screen" | "window" | "region";
  screenIndex?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
} = {}) {
  return requestNativeCapability<ClusterNativeCapture>("capture.screen", input);
}

export async function getNativeClipboardStatus() {
  return requestNativeCapability<{ available?: boolean; writeOnly?: boolean; readText?: boolean; readRequiresConfirmation?: boolean; backgroundRead?: boolean; maxTextCharacters?: number }>("clipboard.status");
}

export async function readNativeClipboardText(purpose = "use clipboard text in Cluster") {
  return requestNativeCapability<ClusterNativeClipboardRead>("clipboard.readText", { purpose });
}

export async function getNativeLibraryMountStatus() {
  return requestNativeCapability<ClusterNativeLibraryMountStatus>("library.mount.status");
}

export async function getNativeSessionStatus() {
  return requestNativeCapability<{ ready: boolean }>("session.status");
}
export async function claimNativeSession(code: string) {
  return requestNativeCapability<{ accepted?: boolean }>("session.claim", { code });
}
export async function startNativeLibraryMount(options: { layout: "unified" | "separate"; organization: "servers" | "libraries"; location?: string }) {
  return requestNativeCapability<ClusterNativeLibraryMountStatus>("library.mount.start", options);
}
export async function stopNativeLibraryMount() {
  return requestNativeCapability<ClusterNativeLibraryMountStatus>("library.mount.stop");
}
export async function refreshNativeLibraryMount() {
  return requestNativeCapability<{ accepted?: boolean }>("library.mount.refresh");
}
export async function clearNativeLibraryMountCache() {
  return requestNativeCapability<{ cleared?: boolean }>("library.mount.clearCache");
}
export async function getNativeGlobalShortcutStatus() {
  return requestNativeCapability<ClusterNativeGlobalShortcutStatus>("shortcut.global.status");
}
export async function setNativeGlobalShortcutsEnabled(enabled: boolean) {
  return requestNativeCapability<ClusterNativeGlobalShortcutStatus>("shortcut.global.setEnabled", { enabled });
}

export async function writeNativeClipboardText(text: string) {
  const result = await requestNativeCapability<{ written?: boolean }>("clipboard.writeText", { text });
  return Boolean(result?.written);
}
export async function nativeNavigateBack() { return requestNativeCapability("navigation.back"); }
export async function nativeNavigateForward() { return requestNativeCapability("navigation.forward"); }
export async function getNativeRecentWorkspaces() { return requestNativeCapability<ClusterNativeRecentWorkspace[]>("workspace.recent"); }
export async function getNativePackageStageStatus() { return requestNativeCapability<ClusterDesktopPackageStageStatus>("package.stageStatus"); }
export type ClusterPackageNativeTarget = { expectedArtifactSha256: string; expectedPackageKey: string; expectedVersion: string };
export async function stageNativePackageKit(target: ClusterPackageNativeTarget, preparedKit = false) {
  return requestNativeCapability<{ accepted: boolean; operationId?: string }>("package.stageKit", { ...target, preparedKit });
}
/** Transports downloaded ZIP bytes, NOT a signing key or filesystem location.
 * Native Qt checks a full-kit SHA-256 before the independently pinned Go verifier
 * can inspect this temporary file. No background installation or auto execution.
 */
export type NativePackageTransferCheckpoint = {
  schema: 2; digest: string; expectedBytes: number; receivedBytes: number;
  prefixSha256: string; state: "receiving" | "committed"; updatedAt: string;
  recoveryAction?: "restored_uncheckpointed_bytes" | "committed_interrupted_rename" | "checkpoint_already_current" | "already_committed" | "reconstructed_streaming_hash_state";
  recoveredBytes?: number;
  offer?: { deploymentId: string; packageId: string; releaseId: string; channel: string; platform: string };
};
/** Native durable archive transport only. No installer grant or filesystem path
 * is exposed to the renderer. Bearer receipt challenges MUST remain volatile.
 * This checkpoint survives Desktop restarts, but restoring a download lease
 * from the server is a separate authenticated step.
 */
export async function inspectNativePackageArchive(artifactSha256: string) {
  return requestNativeCapability<NativePackageTransferCheckpoint>("package.transfer.inspect", { artifactSha256 });
}
export type NativePackageTransferDiagnostic = {
  schema: 1; digest: string; state: string; readOnly: true;
  lockPresent: boolean; checkpointPresent: boolean; pendingPresent: boolean;
  manualReviewRequired: boolean; expectedBytes?: number; publishedBytes?: number; retainedBytes?: number;
};
/** On-demand, read-only local transport evidence. No implicit recovery or lease renewal. */
export async function diagnoseNativePackageArchive(artifactSha256: string) {
  const result = await requestNativeCapability<NativePackageTransferDiagnostic>("package.transfer.diagnose", { artifactSha256 });
  if (result.digest !== artifactSha256 || result.readOnly !== true || !result.state)
    throw new Error("Native Package archive diagnosis returned invalid evidence.");
  return result;
}
/** Operator-confirmed native crash reconciliation. Only a verified transfer
 * checkpoint is repaired; this neither refreshes server authorization nor
 * bypasses the independently signed Package staging verifier.
 */
export async function recoverNativePackageArchive(artifactSha256: string) {
  const result = await requestNativeCapability<NativePackageTransferCheckpoint | { accepted: false }>("package.transfer.recover", { artifactSha256 });
  if ("accepted" in result && result.accepted === false) return result;
  if (result.digest !== artifactSha256 || !result.recoveryAction ||
    !Number.isSafeInteger(result.recoveredBytes) || result.recoveredBytes < 0 ||
    result.receivedBytes > result.expectedBytes) {
    throw new Error("Native transfer recovery evidence was incomplete.");
  }
  return result;
}
export async function bindNativePackageArchiveOffer(artifactSha256: string, offer: NonNullable<NativePackageTransferCheckpoint["offer"]>) {
  const record = await requestNativeCapability<NativePackageTransferCheckpoint>("package.transfer.bindOffer", { artifactSha256, ...offer });
  if (record.digest !== artifactSha256 || !record.offer || Object.keys(offer).some((key) =>
    record.offer![key as keyof typeof offer] !== offer[key as keyof typeof offer]))
    throw new Error("Native transfer offer binding was not retained.");
  return record;
}
/** Stage a committed disk archive without sending ZIP bytes through JS.
 * The native helper still requires the independently provisioned signing pin.
 * This is not authorization to install or activate a Package.
 */
export async function stageRetainedNativePackageArchive(target: ClusterPackageNativeTarget & {
  manifest: { schema: 1; packageKey: string; version: string; platform: string; artifactSha256: string; artifactSize: number; filename: string;
    dependencies?: { packageKey: string; version: string }[];
    installer?: { kind: "windows-msi"; path: string; sha256: string; productCode: string; productVersion: string; scope: "user" } };
  signatureBase64: string; publicKeyPem: string;
}) {
  const result = await requestNativeCapability<{ accepted: boolean; operationId?: string }>("package.transfer.stage", {
    artifactSha256: target.expectedArtifactSha256, packageKey: target.expectedPackageKey,
    version: target.expectedVersion, manifest: target.manifest,
    signatureBase64: target.signatureBase64, publicKeyPem: target.publicKeyPem,
  });
  return result;
}

export async function prepareNativePackageArchive(artifactSha256: string, artifactSize: number) {
  let record: NativePackageTransferCheckpoint;
  try { record = await inspectNativePackageArchive(artifactSha256); }
  catch (cause) {
    if ((cause as { code?: string })?.code !== "PACKAGE_TRANSFER_NOT_FOUND") throw cause;
    record = await beginNativePackageArchive(artifactSha256, artifactSize);
  }
  if (record.digest !== artifactSha256 || record.expectedBytes !== artifactSize
    || record.receivedBytes < 0 || record.receivedBytes > artifactSize)
    throw new Error("Native archive checkpoint does not match the selected signed release.");
  return record;
}
// Native Qt accepts up to 512 KiB canonical archive chunks. The payload
// envelope remains capped independently, avoiding excess process spawns while
// keeping fixed browser-to-Qt allocation and per-request authorization bounds.
const NATIVE_PACKAGE_ARCHIVE_SEGMENT_BYTES = 512 * 1024;
export async function appendNativePackageArchiveSegment(artifactSha256: string, offset: number, chunk: Uint8Array) {
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Invalid native archive offset.");
  let checkpoint: NativePackageTransferCheckpoint | null = null;
  for (let i = 0; i < chunk.length; i += NATIVE_PACKAGE_ARCHIVE_SEGMENT_BYTES) {
    const segment = chunk.subarray(i, Math.min(i + NATIVE_PACKAGE_ARCHIVE_SEGMENT_BYTES, chunk.length));
    let raw = "";
    for (let k = 0; k < segment.length; k += 8192) raw += String.fromCharCode(...segment.subarray(k, k + 8192));
    checkpoint = await requestNativeCapability<NativePackageTransferCheckpoint>("package.transfer.append", {
      artifactSha256, offset: offset + i, chunkBase64: btoa(raw),
    });
    if (checkpoint.digest !== artifactSha256 || checkpoint.receivedBytes !== offset + i + segment.length)
      throw new Error("Native durable archive checkpoint rejected or offset mismatched.");
  }
  return checkpoint;
}
export async function commitNativePackageArchive(artifactSha256: string, expectedBytes: number) {
  const result = await requestNativeCapability<NativePackageTransferCheckpoint>("package.transfer.commit", { artifactSha256 });
  if (result.state !== "committed" || result.digest !== artifactSha256
    || result.prefixSha256 !== artifactSha256 || result.receivedBytes !== expectedBytes)
    throw new Error("Native Package archive failed verified commit.");
  return result;
}

export async function persistPackageArchiveToNative(bytes: Uint8Array, artifactSha256: string, progress?: (n: number) => void) {
  if (!/^[0-9a-f]{64}$/.test(artifactSha256) || bytes.byteLength < 1 || bytes.byteLength > 32 * 1024 * 1024)
    throw new Error("Invalid verified Package archive transport identity or size.");
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
    .map((n) => n.toString(16).padStart(2, "0")).join("");
  if (digest !== artifactSha256) throw new Error("Package archive digest mismatch before native handoff.");
  let checkpoint: NativePackageTransferCheckpoint;
  try {
    checkpoint = await inspectNativePackageArchive(digest);
    if (checkpoint.expectedBytes !== bytes.byteLength) throw new Error("Existing native checkpoint length mismatch.");
  } catch (cause) {
    if ((cause as { code?: string })?.code !== "PACKAGE_TRANSFER_NOT_FOUND") throw cause;
    checkpoint = await beginNativePackageArchive(digest, bytes.byteLength);
  }
  if (checkpoint.state === "committed") {
    if (checkpoint.receivedBytes !== bytes.byteLength || checkpoint.prefixSha256 !== digest)
      throw new Error("Native committed archive evidence mismatch.");
    progress?.(bytes.byteLength);
    return checkpoint;
  }
  // Verify checkpoint prefix on the renderer side too. Native independently
  // hashes all persistent bytes; neither side trusts a reported offset alone.
  const prefix = bytes.subarray(0, checkpoint.receivedBytes);
  const prefixDigest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", prefix)))
    .map((n) => n.toString(16).padStart(2, "0")).join("");
  if (prefixDigest !== checkpoint.prefixSha256) throw new Error("Existing native checkpoint prefix mismatch.");
  for (let offset = checkpoint.receivedBytes; offset < bytes.length; offset += NATIVE_PACKAGE_ARCHIVE_SEGMENT_BYTES) {
    const chunk = bytes.subarray(offset, Math.min(offset + NATIVE_PACKAGE_ARCHIVE_SEGMENT_BYTES, bytes.length));
    // Encode in bounded chunks: String.fromCharCode(...large buffers) overflows.
    let raw = "";
    for (let pos = 0; pos < chunk.length; pos += 8192)
      raw += String.fromCharCode(...chunk.subarray(pos, pos + 8192));
    checkpoint = await requestNativeCapability<NativePackageTransferCheckpoint>("package.transfer.append", {
      artifactSha256: digest, offset, chunkBase64: btoa(raw),
    });
    if (checkpoint.receivedBytes !== offset + chunk.length || checkpoint.digest !== digest)
      throw new Error("Native transfer checkpoint offset mismatch.");
    progress?.(checkpoint.receivedBytes);
  }
  const committed = await requestNativeCapability<NativePackageTransferCheckpoint>("package.transfer.commit", { artifactSha256: digest });
  if (committed.state !== "committed" || committed.receivedBytes !== bytes.length || committed.prefixSha256 !== digest)
    throw new Error("Native transfer commit proof mismatch.");
  return committed;
}
/** Start explicitly; a missing or corrupt checkpoint cannot be guessed by retry. */
export async function beginNativePackageArchive(artifactSha256: string, artifactSize: number) {
  if (!/^[0-9a-f]{64}$/.test(artifactSha256) || !Number.isSafeInteger(artifactSize)
    || artifactSize < 1 || artifactSize > 32 * 1024 * 1024)
    throw new Error("Invalid native archive transport parameters.");
  return requestNativeCapability<NativePackageTransferCheckpoint>("package.transfer.begin", { artifactSha256, artifactSize });
}

export async function transferDownloadedPackageKitToNative(kit: Blob, target: ClusterPackageNativeTarget) {
  const bytes = new Uint8Array(await kit.arrayBuffer());
  if (bytes.length < 1 || bytes.length > 4 * 1024 * 1024 + 64 * 1024)
    throw new Error("Prepared Package kit exceeds the native handoff limit.");
  const kitSha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
    .map((value) => value.toString(16).padStart(2, "0")).join("");
  const started = await requestNativeCapability<{ accepted: boolean; transferId: string }>("package.kit.begin", {
    ...target, kitSha256, kitSizeBytes: bytes.length,
  });
  if (!started.accepted || !started.transferId) throw new Error("Native staging-kit handoff was rejected.");
  try {
    const chunkSize = 48 * 1024;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
      // Bound each WebChannel request below Qt's transfer-only 80 KiB limit.
      const chunkBase64 = btoa(String.fromCharCode(...chunk));
      const result = await requestNativeCapability<{ receivedBytes: number }>("package.kit.chunk", {
        transferId: started.transferId, offset, chunkBase64,
      });
      if (result.receivedBytes !== offset + chunk.length) throw new Error("Native transfer offset mismatch.");
    }
    const finished = await requestNativeCapability<{ accepted: boolean; kitSha256: string }>("package.kit.finish", {
      transferId: started.transferId,
    });
    if (!finished.accepted || finished.kitSha256 !== kitSha256) throw new Error("Native kit checksum mismatch.");
    return { kitSha256, bytesTransferred: bytes.length };
  } catch (cause) {
    await requestNativeCapability("package.kit.cancel", { transferId: started.transferId }).catch(() => undefined);
    throw cause;
  }
}
export type ClusterNativePackageTrustStatus = { configured: boolean; fingerprint: string; profileId: string; authority: "user_profile_local_pin_not_machine_attested" };
export async function getNativePackageTrustStatus() {
  return requestNativeCapability<ClusterNativePackageTrustStatus>("package.trustStatus");
}
export async function provisionNativePackageTrust() {
  return requestNativeCapability<{ accepted: boolean; configured?: boolean; fingerprint?: string; unchanged?: boolean }>("package.provisionTrust");
}
export async function auditNativePackageKit(target: { expectedArtifactSha256: string; expectedPackageKey: string; expectedVersion: string }) {
  return requestNativeCapability<{ accepted: boolean; operationId?: string }>("package.auditKit", target);
}
export async function auditNativeManagedPackage(target: { expectedArtifactSha256: string; expectedPackageKey: string; expectedVersion: string }) {
  return requestNativeCapability<{ accepted: boolean; operationId?: string }>("package.auditManaged", target);
}
// Native Qt alone selects and persists destination paths, scoped to the active
// server profile. Web code passes Package keys, never arbitrary local paths.
export type ClusterNativePackageDestination = { packageKey: string; path: string; available: boolean;
  reportedArtifactSha256?: string; reportedVersion?: string; lastUpdateAt?: string };
export async function getNativePackageDestinations() {
  return requestNativeCapability<{ profileId: string; destinations: ClusterNativePackageDestination[] }>("package.destination.list");
}
export async function chooseNativePackageDestination(packageKey: string) {
  return requestNativeCapability<{ accepted: boolean; packageKey?: string; path?: string; available?: boolean }>("package.destination.choose", { packageKey });
}
export async function forgetNativePackageDestination(packageKey: string) {
  return requestNativeCapability<{ accepted: boolean; removed?: boolean }>("package.destination.remove", { packageKey });
}
// Native Qt uses a saved mapping where available; otherwise it opens a native
// directory picker. Never accept destination paths or overwrite permissions from renderer input.
export async function runNativePackageFileUpdate(target: { expectedArtifactSha256: string; expectedPackageKey: string; expectedVersion: string }, operation: "preview" | "audit" | "sync" | "replace" | "rollback", preparedKit = false) {
  const capability = operation === "preview" ? "package.previewFiles" : operation === "audit" ? "package.auditFiles" : operation === "rollback" ? "package.rollbackFiles" : operation === "replace" ? "package.replaceFiles" : "package.syncFiles";
  return requestNativeCapability<{ accepted: boolean; operationId?: string }>(capability, { ...target, preparedKit });
}
export type ClusterPackageDeploymentGrant = {
  schema: 1; payloadBase64url: string; signatureBase64url: string;
  publicKeyPem: string; controlKeyFingerprint: string; expiresAt: number;
};
export async function getNativePackageControlTrustStatus() {
  return requestNativeCapability<ClusterNativePackageTrustStatus>("package.controlTrustStatus");
}
export async function provisionNativePackageControlTrust() {
  return requestNativeCapability<{ accepted: boolean; configured?: boolean; fingerprint?: string; unchanged?: boolean }>("package.provisionControlTrust");
}
export async function runAuthorizedNativePackageContent(target: {
  expectedArtifactSha256: string; expectedPackageKey: string; expectedVersion: string;
  grant: ClusterPackageDeploymentGrant;
}, operation: "deploy" | "rollback") {
  return requestNativeCapability<{ accepted: boolean; operationId?: string }>(
    operation === "rollback" ? "package.rollbackContent" : "package.deployContent", target);
}
export type ClusterNativeMSIRegistrationSample = {
  state: "os_query_unavailable" | "not_registered_for_user" | "advertised_not_verified" | "registered_version_unavailable" |
    "registered_version_match" | "registered_version_mismatch" | "registration_incomplete_or_unknown";
  productCode: string; expectedVersion: string; reportedVersion?: string; versionMatches: boolean;
  readOnly: true; osAttested: false; probeComplete: boolean; probeScope: "" | "current_user_and_machine";
};
export type ClusterNativeMSIAttemptStatus = {
  schema: 1; packageKey: string; state: string; hasReceipt: boolean; lockPresent: boolean; admissionLockPresent: boolean;
  manualReviewRequired: boolean; retryAuthorized: false; readOnly: true; osAttested: false;
  recoveryAssessment?: string; requiresRebootReview?: boolean; stagedArtifactState?: string; stagedArtifactVerified?: false;
  receiptSha256?: string;
  registrationDrift?: "no_post_exit_baseline" | "registration_comparison_unavailable" | "registration_unchanged_since_exit" | "registration_changed_since_exit";
  registrationTransition?: "historical_receipt_no_transition_evidence" | "prelaunch_recorded_outcome_unknown" |
    "matching_registration_observed_after_attempt" | "no_registration_observed_after_attempt" |
    "conflicting_registration_observed_after_attempt" | "post_exit_registration_unavailable";
  bootObservation?: { state: "os_uptime_unavailable" | "reboot_indicated_unverified" | "same_boot_indicated_unverified" | "boot_relation_ambiguous";
    readOnly: true; osAttested: false; rebootConfirmed: false; anchorRecorded: boolean;
    observedAt?: string; uptimeMilliseconds?: number; estimatedBootAt?: string };
  product?: { state: string; productCode: string; expectedVersion: string; reportedVersion?: string; versionMatches: boolean; readOnly: true; osAttested: false; probeComplete: boolean; probeScope: "" | "current_user_and_machine" };
  attempt?: { packageKey: string; version: string; artifactSha256: string; msiSha256: string; productCode: string; productVersion: string;
    msiPath?: string; state: string; startedAt: string; launchCommittedAt?: string; finishedAt?: string; exitCode?: number; osAttested: false;
    bootAnchor?: { observedAt: string; uptimeMilliseconds: number };
    preLaunchRegistration?: ClusterNativeMSIRegistrationSample;
    postExitRegistration?: ClusterNativeMSIRegistrationSample;
    dependencies?: { packageKey: string; version: string; productCode: string; productVersion: string; receiptSha256: string }[] };
};
export type ClusterNativeMSILifecyclePlan = {
  schema: 1; packageKey: string; operation: "upgrade" | "repair" | "uninstall";
  state: "blocked" | "requires_operator_review"; readOnly: true; osAttested: false; mutationAuthorized: false;
  recordedReceiptSha256?: string; knownDependents: string[]; blockers: string[]; warnings: string[];
};
export type ClusterNativeMSIProfileStatus = {
  schema: 1; state: "no_recorded_msi_attempts" | "msi_profile_manual_review";
  readOnly: true; osAttested: false; retryAuthorized: false; complete: true;
  manualReviewRequired: boolean; admissionLockPresent: boolean;
  records: ClusterNativeMSIAttemptStatus[];
  lifecycleMutationAuthorized: false;
  lifecyclePlans: ClusterNativeMSILifecyclePlan[];
  lifecycleRecords: (ClusterNativeMSIRepairStatus | ClusterNativeMSIUninstallStatus | ClusterNativeMSIUpgradeStatus | ClusterNativeMSIRollbackStatus)[];
  dependencyEdges: { dependentPackageKey: string; dependencyPackageKey: string; dependencyVersion: string;
    dependencyReceiptSha256: string; recordedDependencyPresent: boolean; recordedReceiptMatches: boolean }[];
};
export async function inspectNativeMSIProfile() {
  return requestNativeCapability<ClusterNativeMSIProfileStatus>("package.msiProfileStatus", {});
}
export async function inspectNativeMSIAttempt(packageKey: string) {
  return requestNativeCapability<ClusterNativeMSIAttemptStatus>("package.msiAttemptStatus", { packageKey });
}
export type ClusterNativeMSIRepairStatus = {
  schema: 1; packageKey: string;
  state: "no_recorded_repair" | "repair_prepared_not_launched" | "repair_started_outcome_unknown" |
    "repair_failed_or_outcome_unknown" | "repair_exit_zero_not_os_attested" | "repair_restart_required_not_os_attested";
  hasReceipt: boolean; readOnly: true; osAttested: false; retryAuthorized: false;
  manualReviewRequired: boolean; receiptSha256?: string;
  receipt?: { schema: 1; operation: "repair"; packageKey: string; version: string;
    artifactSha256: string; msiSha256: string; productCode: string; productVersion: string;
    priorReceiptSha256: string; state: string; startedAt: string; launchCommittedAt?: string;
    finishedAt?: string; exitCode?: number; osAttested: false };
};
export async function inspectNativeMSIRepair(packageKey: string) {
  return requestNativeCapability<ClusterNativeMSIRepairStatus>("package.msiRepairStatus", { packageKey });
}
export type ClusterNativeMSIUninstallStatus = Omit<ClusterNativeMSIRepairStatus,"state"|"receipt"> & {
  state: "no_recorded_uninstall" | "uninstall_prepared_not_launched" | "uninstall_started_outcome_unknown" |
    "uninstall_failed_or_outcome_unknown" | "uninstall_exit_zero_not_os_attested" | "uninstall_restart_required_not_os_attested";
  receipt?: Omit<NonNullable<ClusterNativeMSIRepairStatus["receipt"]>,"operation"> & {operation:"uninstall"};
};
export type ClusterNativeMSIUpgradeStatus = Omit<ClusterNativeMSIRepairStatus,"state"|"receipt"> & {
  state: "no_recorded_upgrade" | "upgrade_prepared_not_launched" | "upgrade_started_outcome_unknown" |
    "upgrade_failed_or_outcome_unknown" | "upgrade_exit_zero_not_os_attested" | "upgrade_restart_required_not_os_attested";
  receipt?: Omit<NonNullable<ClusterNativeMSIRepairStatus["receipt"]>,"operation"> & {
    operation:"upgrade"; priorMsiSha256: string; priorProductVersion: string; msiPath?: string;
  };
  upgradeRecovery?: {state: "upgrade_registration_unavailable" | "upgrade_target_registered_not_health_attested" | "upgrade_predecessor_remains_registered" | "upgrade_unexpected_version_registered" | "upgrade_product_not_registered" | "upgrade_registration_ambiguous"; readOnly: true; osAttested: false; rollbackAuthorized: false; registration: {state: string; productCode: string; expectedVersion: string; reportedVersion?: string; versionMatches: boolean; readOnly: true; osAttested: false; probeComplete: boolean; probeScope: string}};
};
export type ClusterNativeMSIRollbackStatus = Omit<ClusterNativeMSIRepairStatus,"state"|"receipt"> & {
  state: "no_recorded_msi-rollback" | "msi-rollback_prepared_not_launched" | "msi-rollback_started_outcome_unknown" |
    "msi-rollback_failed_or_outcome_unknown" | "msi-rollback_exit_zero_not_os_attested" | "msi-rollback_restart_required_not_os_attested";
  receipt?: Omit<NonNullable<ClusterNativeMSIRepairStatus["receipt"]>,"operation"> & {
    operation: "msi-rollback"; priorMsiSha256: string; priorProductVersion: string; msiPath: string;
    upgradeJournalSha256: string; successorMsiSha256: string;
  };
  rollbackRecovery?: {state: string; readOnly: true; osAttested: false; rollbackConfirmed: false;
    registration: {state: string; productCode: string; expectedVersion: string; reportedVersion?: string;
      versionMatches: boolean; readOnly: true; osAttested: false; probeComplete: boolean; probeScope: string}};
};
export async function inspectNativeMSIRollbackStatus(packageKey: string) {
  return requestNativeCapability<ClusterNativeMSIRollbackStatus>("package.msiRollbackStatus",{packageKey});
}
export type ClusterNativeMSIRollbackReview = {
  schema: 1; packageKey: string; state: "blocked" | "reviewable_not_authorized";
  readOnly: true; osAttested: false; mutationAuthorized: false; rollbackAuthorized: false;
  priorReceiptSha256: string; upgradeJournalSha256: string;
  predecessorMsiSha256: string; successorMsiSha256: string;
  predecessorProductVersion: string; successorProductVersion: string;
  knownDependents: string[]; settledDependents: string[]; outstandingDependents: string[]; recoveryOrder: string[]; blockers: string[]; warnings: string[];
};
export type ClusterNativeMSIIncidentWorklist = {
  schema: 1; state: "empty" | "review_required" | "manual_recovery_required";
  readOnly: true; complete: true; osAttested: false; mutationAuthorized: false; retryAuthorized: false;
  admissionLockPresent: boolean; manualRecoveryCount: number; reviewCount: number; observationCount: number;
  items: Array<{caseId: string; packageKey: string; operation: "install" | "repair" | "uninstall" | "upgrade" | "msi-rollback";
    state: string; receiptSha256: string; priorReceiptSha256: string; predecessorRecorded: boolean;
    predecessorMatches: boolean; registrationState: string; severity: "review" | "manual_recovery" | "observation";
    recoveryAction: "review_unattested_installation" | "investigate_install_attempt_no_replay" |
      "manual_lifecycle_review_no_replay" | "investigate_missing_or_changed_predecessor";
    readOnly: true; retryAuthorized: false; mutationAuthorized: false; osAttested: false}>;
};
export async function inspectNativeMSIIncidentWorklist() {
  return requestNativeCapability<ClusterNativeMSIIncidentWorklist>("package.msiIncidentWorklist", {});
}
export type ClusterNativeMSIRollbackCascade = {
  schema: 1; packageKey: string; state: "blocked" | "independent_dispositions_required";
  readOnly: true; osAttested: false; mutationAuthorized: false; automaticExecution: false;
  priorReceiptSha256: string; upgradeJournalSha256: string;
  recoveryOrder: string[]; blockers: string[]; warnings: string[];
  manualRecoveryRequired: boolean; manualReviewPackages: string[]; nextReviewablePackageKey: string;
  steps: Array<{index: number; packageKey: string; operation: "uninstall" | "msi-rollback";
    state: "blocked" | "awaiting_prior_dispositions" | "independent_operator_review_required" | "observed_uninstall_registration_absent";
    recordedReceiptSha256: string; waitingFor: string[]; blockers: string[];
    separateAuthorizationRequired: true; mutationAuthorized: false; dispositionObserved: boolean;
    lifecycleJournalSha256: string; lifecycleJournalState: string;
    recoveryAction: "preserve_completed_disposition" | "manual_recovery_no_replay" | "resolve_evidence_blocker" | "request_independent_authorization" | "wait_for_independent_dispositions"}>;
};
export async function inspectNativeMSIRollbackCascade(packageKey: string) {
  return requestNativeCapability<ClusterNativeMSIRollbackCascade>("package.msiRollbackCascade", {packageKey});
}
export async function inspectNativeMSIRollbackReview(packageKey: string) {
  return requestNativeCapability<ClusterNativeMSIRollbackReview>("package.msiRollbackReview", {packageKey});
}
export async function inspectNativeMSIUpgrade(packageKey: string) {
  return requestNativeCapability<ClusterNativeMSIUpgradeStatus>("package.msiUpgradeStatus",{packageKey});
}
export async function runNativeSupervisedMSIUpgrade(target: {
  expectedArtifactSha256: string; expectedPackageKey: string; expectedVersion: string;
  grant: ClusterPackageDeploymentGrant;
}) {
  return requestNativeCapability<{ accepted: boolean; operationId?: string }>("package.upgradeMsi",target);
}
export async function runNativeSupervisedMSIRollback(target: {
  expectedArtifactSha256: string; expectedPackageKey: string; expectedVersion: string;
  grant: ClusterPackageDeploymentGrant;
}) {
  return requestNativeCapability<{ accepted: boolean; operationId?: string }>("package.rollbackMsi",target);
}
export async function inspectNativeMSIUninstall(packageKey: string) {
  return requestNativeCapability<ClusterNativeMSIUninstallStatus>("package.msiUninstallStatus",{packageKey});
}
export async function runNativeSupervisedMSIUninstall(target: {
  expectedArtifactSha256: string; expectedPackageKey: string; expectedVersion: string;
  grant: ClusterPackageDeploymentGrant;
}) {
  return requestNativeCapability<{accepted:boolean;operationId?:string}>("package.uninstallMsi",target);
}
export async function runNativeSupervisedMSIRepair(target: {
  expectedArtifactSha256: string; expectedPackageKey: string; expectedVersion: string;
  grant: ClusterPackageDeploymentGrant;
}) {
  return requestNativeCapability<{ accepted: boolean; operationId?: string }>("package.repairMsi", target);
}
// Upgrade preflight is intentionally read-only and never accepts signed control grants.
export async function inspectNativeMSIUpgradeReadiness(target: {
  expectedArtifactSha256: string; expectedPackageKey: string; expectedVersion: string;
  priorReceiptSha256: string; preparedKit?: boolean;
}) {
  if (!/^[a-f0-9]{64}$/.test(target.priorReceiptSha256)) throw new Error("Invalid predecessor MSI receipt identity.");
  return requestNativeCapability<{ accepted: boolean; operationId?: string }>("package.previewUpgrade", target);
}
export async function runNativeSupervisedMSI(target: {
  expectedArtifactSha256: string; expectedPackageKey: string; expectedVersion: string;
  grant?: ClusterPackageDeploymentGrant;
}, operation: "preview" | "install") {
  return requestNativeCapability<{ accepted: boolean; operationId?: string }>(
    operation === "install" ? "package.installMsi" : "package.previewInstaller", target);
}
export function subscribeNativePackageStaging(listener: (event: ClusterDesktopPackageStageEvent) => void) {
  installNativeCapabilityTransport();
  nativePackageStageListeners.add(listener);
  return () => { nativePackageStageListeners.delete(listener); };
}
export async function getNativeTransfers() { return requestNativeCapability<ClusterNativeTransfer[]>("transfer.list"); }
export async function getNativeTransferQueueStatus() { return requestNativeCapability<ClusterNativeTransferQueueStatus>("transfer.status"); }
export async function claimNativeTransferQueue() { return requestNativeCapability<ClusterNativeTransferQueueStatus>("transfer.claim"); }
export async function uploadNativeProjectFile(handle: string, input: { projectId: string; title: string; originalName: string; mimeType?: string; category?: string; assetRole?: string; status?: string; tags?: string[]; versionGroupId?: string | null; versionNumber?: number; versionLabel?: string | null; derivedFromId?: string | null; proxyOfId?: string | null; exportOfId?: string | null; evidenceForKind?: "card" | "ticket" | "build" | "qa" | "whiteboard"; evidenceForId?: string; evidenceForLabel?: string; evidenceRelationship?: "references" | "evidence_for" | "informs" | "produced_by" }) {
  return requestNativeCapability<{ accepted: boolean; transferId: string }>("transfer.uploadProjectFile", { handle, ...input });
}
export async function downloadNativeResource(input: { url: string; fileName: string; checksumSha256?: string | null }) {
  return requestNativeCapability<{ accepted: boolean; transferId: string }>("transfer.download", {
    url: String(input.url || ""),
    fileName: String(input.fileName || "download"),
    checksumSha256: input.checksumSha256 || "",
  });
}
export async function pauseNativeTransfer(transferId: string) { return requestNativeCapability("transfer.pause", { transferId }); }
export async function resumeNativeTransfer(transferId: string) { return requestNativeCapability("transfer.resume", { transferId }); }
export async function retryNativeTransfer(transferId: string) { return requestNativeCapability("transfer.retry", { transferId }); }
export async function cancelNativeTransfer(transferId: string) { return requestNativeCapability("transfer.cancel", { transferId }); }
export async function removeNativeTransfer(transferId: string) { return requestNativeCapability("transfer.remove", { transferId }); }
export async function retryAllNativeTransfers() { return requestNativeCapability("transfer.retryAll"); }
export async function openNativeTransferResult(transferId: string) { return requestNativeCapability("transfer.open", { transferId }); }
export async function revealNativeTransferResult(transferId: string) { return requestNativeCapability("transfer.reveal", { transferId }); }
export async function getNativeStartupDiagnostics() { return requestNativeCapability<ClusterNativeStartupDiagnostics>("diagnostics.startup"); }
export async function prepareNativeDiagnosticsPreview() { return requestNativeCapability<ClusterNativeDiagnosticPreview>("diagnostics.preview"); }
export async function exportNativeDiagnosticsPreview(input: { previewId: string; sha256: string; destinationHandle: string }) {
  return requestNativeCapability<{ written: boolean; sha256: string; sizeBytes: number }>("diagnostics.export", input);
}
export function subscribeNativeTransfers(listener: (event: ClusterDesktopTransferEvent) => void) {
  installNativeCapabilityTransport();
  nativeTransferListeners.add(listener);
  return () => { nativeTransferListeners.delete(listener); };
}

export async function getNativeWidgetLibraryStatus() { return requestNativeCapability<ClusterNativeWidgetLibraryStatus>("widget.library.status"); }
export async function rescanNativeWidgetLibrary() { return requestNativeCapability<ClusterNativeWidgetLibraryStatus>("widget.library.rescan"); }
export async function openNativeWidgetLibrary() { return requestNativeCapability<{ opened?: boolean }>("widget.library.open"); }
export async function installNativeWidget(handle: string) { return requestNativeCapability<ClusterNativeWidgetLibraryStatus>("widget.library.install", { handle }); }
export async function removeNativeWidget(id: string) { return requestNativeCapability<ClusterNativeWidgetLibraryStatus>("widget.library.remove", { id }); }
export async function getNativeKioskStatus() { return requestNativeCapability<ClusterNativeKioskStatus>("window.kiosk.status"); }
export async function setNativeKioskMode(enabled: boolean, sessionMode?: "signed-in" | "signed-out") { return requestNativeCapability<ClusterNativeKioskStatus>("window.kiosk.set", { enabled, ...(sessionMode ? { sessionMode } : {}) }); }

export async function openNativeAppSettings() { return requestNativeCapability("window.appSettings"); }
export async function openNativeServerProfiles() { return requestNativeCapability("window.serverProfiles"); }
export async function reloadNativeRenderer() { return requestNativeCapability("window.reload"); }

export type ClusterRuntimeInfo = {
  kind: "desktop" | "web";
  platform: ClusterDesktopPlatform;
  appVersion?: string;
  nativeNotifications: boolean;
  startupControl: boolean;
  connectionControl: boolean;
  serverUrl?: string;
};

export function getClusterRuntimeInfo(): ClusterRuntimeInfo {
  installNativeCapabilityTransport();
  const bridge = typeof window !== "undefined" ? window.clusterDesktop : undefined;
  const desktopHint = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("clusterDesktop") === "1";
  const hintedPlatform: ClusterDesktopPlatform = !desktopHint ? "web"
    : /Windows/i.test(window.navigator.userAgent) ? "windows"
    : /Macintosh|Mac OS/i.test(window.navigator.userAgent) ? "macos"
    : "linux";
  return {
    kind: bridge || desktopHint ? "desktop" : "web",
    platform: bridge?.platform || hintedPlatform,
    appVersion: bridge?.appVersion,
    nativeNotifications: Boolean(bridge?.requestNotificationPermission && bridge?.showNotification),
    startupControl: Boolean(bridge?.setLaunchAtStartup),
    connectionControl: Boolean(bridge?.showConnection || (bridge?.testServerConnection && bridge?.connectServer)),
    serverUrl: bridge?.serverUrl,
  };
}

export function initializeDesktopRuntime() {
  const runtime = getClusterRuntimeInfo();
  document.documentElement.dataset.runtime = runtime.kind;
  document.documentElement.dataset.platform = runtime.platform;
  return runtime;
}

export async function setDesktopBadge(count: number) {
  try {
    await window.clusterDesktop?.setBadgeCount?.(Math.max(0, Math.floor(count)));
  } catch {
    // Native integration failures do not block the renderer.
  }
}

export async function requestDesktopNotificationPermission() {
  installNativeCapabilityTransport();
  if (window.clusterDesktop?.requestNotificationPermission) {
    return window.clusterDesktop.requestNotificationPermission();
  }
  if (typeof Notification === "undefined") return false;
  return (await Notification.requestPermission()) === "granted";
}

export async function showDesktopNotification(payload: { title: string; body?: string; route?: string; tag?: string; priority?: "normal" | "medium" | "high" | "critical" }) {
  installNativeCapabilityTransport();
  const title = payload.title.trim().slice(0, 120);
  if (!title) return false;
  if (window.clusterDesktop?.showNotification) {
    return window.clusterDesktop.showNotification({
      title,
      body: payload.body?.trim().slice(0, 320),
      route: payload.route,
      tag: payload.tag?.trim().slice(0, 128),
      priority: payload.priority,
    });
  }
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return false;
  new Notification(title, { body: payload.body?.trim().slice(0, 320), tag: payload.tag?.trim().slice(0, 128) });
  return true;
}

export async function getDesktopServerUrl() {
  return window.clusterDesktop?.getServerUrl?.() || window.clusterDesktop?.serverUrl || "";
}

export async function testDesktopServerConnection(url?: string) {
  if (!window.clusterDesktop?.testServerConnection) {
    return { ok: false, url: url || "", message: "Server connection controls are available in the desktop app." } satisfies ClusterDesktopHealthResult;
  }
  return window.clusterDesktop.testServerConnection(url);
}

export async function connectDesktopServer(url: string) {
  if (!window.clusterDesktop?.connectServer) {
    return { ok: false, url, message: "Server connection controls are available in the desktop app." } satisfies ClusterDesktopHealthResult;
  }
  return window.clusterDesktop.connectServer(url);
}

export async function getDesktopRuntimeStatus() {
  return window.clusterDesktop?.getRuntimeStatus?.();
}

export async function getDesktopOfflineCacheStatus() {
  return window.clusterDesktop?.getOfflineCacheStatus?.();
}

export async function applyDesktopPreferences(preferences: {
  desktopLaunchAtStartup?: boolean;
  desktopMinimizeToTray?: boolean;
  desktopCloseBehavior?: ClusterDesktopCloseBehavior;
  desktopOpenExternalLinksInBrowser?: boolean;
}) {
  const bridge = window.clusterDesktop;
  if (!bridge) return;
  try {
    if (preferences.desktopLaunchAtStartup !== undefined) await bridge.setLaunchAtStartup?.(preferences.desktopLaunchAtStartup);
    if (preferences.desktopMinimizeToTray !== undefined) await bridge.setMinimizeToTray?.(preferences.desktopMinimizeToTray);
    if (preferences.desktopCloseBehavior) await bridge.setCloseBehavior?.(preferences.desktopCloseBehavior);
    if (preferences.desktopOpenExternalLinksInBrowser !== undefined) await bridge.setOpenExternalLinksInBrowser?.(preferences.desktopOpenExternalLinksInBrowser);
  } catch {
    // Account preferences remain saved if an operating-system control is unavailable.
  }
}


export async function getDesktopUpdateState() {
  return window.clusterDesktop?.getUpdateState?.();
}

export async function checkDesktopUpdates() {
  return window.clusterDesktop?.checkForUpdates?.();
}

export async function downloadDesktopUpdate() {
  return window.clusterDesktop?.downloadUpdate?.();
}

export async function installDesktopUpdate() {
  return window.clusterDesktop?.installUpdate?.();
}

export async function rollbackDesktopUpdate() {
  return window.clusterDesktop?.rollbackUpdate?.();
}

export async function configureDesktopUpdates(preferences: { feedUrl?: string; autoCheck?: boolean }) {
  return window.clusterDesktop?.setUpdatePreferences?.(preferences);
}

export async function pickDesktopFiles(options?: { title?: string; filters?: Array<{ name: string; extensions: string[] }>; multiple?: boolean }) {
  return window.clusterDesktop?.pickFiles?.(options) || [];
}

export async function pickDesktopDirectory(options?: { title?: string }) {
  return window.clusterDesktop?.pickDirectory?.(options) || null;
}

export async function revealDesktopPath(filePath: string) {
  return window.clusterDesktop?.revealPath?.(filePath) || false;
}

export async function openDesktopPath(filePath: string) {
  return window.clusterDesktop?.openPath?.(filePath) || "Desktop file controls are unavailable.";
}

export async function openDesktopWorkspaceWindow(route: string, title?: string) {
  return window.clusterDesktop?.openWorkspaceWindow?.(route, title) || false;
}

export async function startDesktopDownload(input: { url: string; fileName?: string; label?: string }) {
  return window.clusterDesktop?.startDownload?.(input);
}

export async function listDesktopTransfers() {
  return window.clusterDesktop?.listTransfers?.() || [];
}

export async function startDesktopUpload(input: { url?: string; filePath?: string; label?: string } = {}) {
  return window.clusterDesktop?.startUpload?.(input);
}
export async function pauseDesktopTransfer(id: string) { return window.clusterDesktop?.pauseTransfer?.(id); }
export async function resumeDesktopTransfer(id: string) { return window.clusterDesktop?.resumeTransfer?.(id); }
export async function cancelDesktopTransfer(id: string) { return window.clusterDesktop?.cancelTransfer?.(id); }
export async function retryDesktopTransfer(id: string) { return window.clusterDesktop?.retryTransfer?.(id); }
export async function getDesktopCredentialVaultStatus() { return window.clusterDesktop?.getCredentialVaultStatus?.(); }
export async function listDesktopCredentialKeys() { return window.clusterDesktop?.listCredentialKeys?.() || []; }
export async function setDesktopCredential(key: string, value: string) { return window.clusterDesktop?.setCredential?.(key, value) || false; }
export async function deleteDesktopCredential(key: string) { return window.clusterDesktop?.deleteCredential?.(key) || false; }
export async function getNativeWorkstationStatus() {
  return requestNativeCapability<ClusterWorkstationServiceStatus>("workstation.status");
}
export async function listNativeLocalWorkspaces() {
  const result = await requestNativeCapability<{ workspaces: ClusterLocalWorkspace[] }>("workspace.local.list");
  return result.workspaces || [];
}
export async function createNativeLocalWorkspace(input: { handle: string; name?: string; projectIds?: string[] }) {
  const result = await requestNativeCapability<{ workspace: ClusterLocalWorkspace }>("workspace.local.create", { ...input, handle: handleFromOpaqueToken(input.handle) || input.handle });
  return result.workspace;
}
export async function removeNativeLocalWorkspace(workspaceId: string) {
  return requestNativeCapability<{ removed: boolean }>("workspace.local.remove", { workspaceId });
}
export async function discoverNativeRepositories(workspaceId: string, maxDepth = 4) {
  return requestNativeCapability<{ repositories: ClusterLocalRepositoryCandidate[]; expiresInSeconds: number }>("workspace.local.discoverRepositories", { workspaceId, maxDepth });
}
export async function attachNativeRepository(workspaceId: string, candidateId: string) {
  const result = await requestNativeCapability<{ workspace: ClusterLocalWorkspace }>("workspace.local.attachRepository", { workspaceId, candidateId });
  return result.workspace;
}
export async function setNativeLocalRepositoryTrust(workspaceId: string, repositoryId: string, trusted: boolean) {
  const result = await requestNativeCapability<{ workspace: ClusterLocalWorkspace }>("workspace.local.setRepositoryTrust", { workspaceId, repositoryId, trusted });
  return result.workspace;
}
export async function initializeNativeLocalGit(workspaceId: string) {
  const result = await requestNativeCapability<{ initialized: boolean; workspace: ClusterLocalWorkspace }>("git.local.init", { workspaceId });
  return result;
}
export async function getNativeLocalGitStatus(workspaceId: string, repositoryId: string) {
  return requestNativeCapability<ClusterLocalGitStatus>("git.local.status", { workspaceId, repositoryId });
}
export async function getNativeLocalGitDetails(workspaceId: string, repositoryId: string) {
  return requestNativeCapability<ClusterLocalGitDetails>("git.local.details", { workspaceId, repositoryId });
}
export async function getNativeLocalGitLfsHealth(workspaceId: string, repositoryId: string) {
  return requestNativeCapability<ClusterLocalGitLfsHealth>("git.local.lfsHealth", { workspaceId, repositoryId });
}
export async function getNativeLocalGitLfsPolicy(workspaceId: string, repositoryId: string) {
  return requestNativeCapability<ClusterLocalGitLfsPolicy>("git.local.lfsPolicy", { workspaceId, repositoryId });
}
export async function scanNativeLocalGitSecrets(workspaceId: string, repositoryId: string, scope: "staged" | "outgoing") {
  const result = await requestNativeCapability<{ scan: ClusterLocalSecretScanResult }>("git.local.secretScan", { workspaceId, repositoryId, scope });
  return result.scan;
}

export async function getNativeLocalGitDiff(workspaceId: string, repositoryId: string, relativePath: string, staged = false) {
  return requestNativeCapability<ClusterLocalGitDiff>("git.local.diff", { workspaceId, repositoryId, relativePath, staged });
}
export async function mutateNativeLocalGit(
  workspaceId: string,
  repositoryId: string,
  action: ClusterLocalGitMutationAction,
  input: { relativePath?: string; message?: string; name?: string; upstream?: string; pattern?: string; target?: string; remote?: string; url?: string; nextName?: string; stashRef?: string; hunkId?: string; confirmed?: boolean } = {},
) {
  return requestNativeCapability<ClusterLocalGitMutationResult>("git.local.mutate", { workspaceId, repositoryId, action, ...input });
}
export async function cloneNativeLocalRepository(workspaceId: string, remote: string, destinationName: string, strategy: "full" | "current" | "lightweight" = "current") {
  const result = await requestNativeCapability<{ operation: ClusterLocalGitOperation }>("git.local.clone", { workspaceId, remote, destinationName, strategy });
  return result.operation;
}
export async function startNativeLocalGitOperation(workspaceId: string, repositoryId: string, action: "fetch" | "pull" | "push" | "lfs.fetch.current" | "lfs.fetch.recent" | "lfs.checkout" | "lfs.locks" | "lfs.lock" | "lfs.unlock", relativePath?: string) {
  const result = await requestNativeCapability<{ operation: ClusterLocalGitOperation }>("git.local.operation.start", { workspaceId, repositoryId, action, relativePath });
  return result.operation;
}
export async function listNativeLocalGitOperations() {
  const result = await requestNativeCapability<{ operations: ClusterLocalGitOperation[] }>("git.local.operation.list");
  return result.operations || [];
}
export async function cancelNativeLocalGitOperation(operationId: string) {
  const result = await requestNativeCapability<{ cancelled: boolean }>("git.local.operation.cancel", { operationId });
  return Boolean(result.cancelled);
}
export function subscribeNativeLocalGitOperations(listener: (event: ClusterDesktopWorkstationOperationsEvent) => void) {
  installNativeCapabilityTransport();
  nativeWorkstationOperationListeners.add(listener);
  return () => { nativeWorkstationOperationListeners.delete(listener); };
}
export async function getNativeLocalHardwareCapabilities() {
  return requestNativeCapability<ClusterLocalHardwareCapabilities>("hardware.local.capabilities");
}
export async function listNativeLocalTaskDefinitions(workspaceId: string, repositoryId: string) {
  const result = await requestNativeCapability<{ definitions: ClusterLocalTaskDefinition[] }>("task.local.definitions", { workspaceId, repositoryId });
  return result.definitions || [];
}
export async function runNativeLocalTask(workspaceId: string, repositoryId: string, taskId: string) {
  const result = await requestNativeCapability<{ operation: ClusterLocalTaskOperation }>("task.local.run", { workspaceId, repositoryId, taskId });
  return result.operation;
}
export async function listNativeLocalTaskOperations() {
  const result = await requestNativeCapability<{ operations: ClusterLocalTaskOperation[] }>("task.local.list");
  return result.operations || [];
}
export async function cancelNativeLocalTaskOperation(operationId: string) {
  const result = await requestNativeCapability<{ cancelled: boolean }>("task.local.cancel", { operationId });
  return Boolean(result.cancelled);
}
export async function getDesktopCaptureSources(options?: { includeScreens?: boolean; includeWindows?: boolean }) { return window.clusterDesktop?.getCaptureSources?.(options) || []; }
export async function captureDesktopScreenshot(input?: { sourceId?: string; fileName?: string }) { return window.clusterDesktop?.captureScreenshot?.(input); }
export async function saveDesktopCapture(input: { bytes: ArrayBuffer; mimeType: string; fileName?: string }) { return window.clusterDesktop?.saveCapture?.(input); }
export async function subscribeDesktopCollaboration(input: { tool: "board" | "whiteboard"; resourceId: string; clientId: string }) { return window.clusterDesktop?.subscribeCollaboration?.(input); }
export async function unsubscribeDesktopCollaboration(subscriptionId: string) { return window.clusterDesktop?.unsubscribeCollaboration?.(subscriptionId); }

// Resource links must never be interpreted as renderer route hashes: a URI
// like cluster://ticket/abc identifies a record, not an "abc" route section.
export function installDesktopDeepLinkRouting() {
  const bridge = window.clusterDesktop;
  const onDeepLink = (value: string) => {
    const resource = desktopDeepLinkNavigation(value);
    if (resource) {
      queueDesktopWorkNavigation(resource);
      return;
    }
    const special = parseClusterDeepLink(value);
    if (special?.type === "source_commit") {
      queueDesktopSourceCommit({ repositoryId: special.repositoryId, revision: special.revision });
      return;
    }
    // Preserve the older explicit navigation-only shell protocol. Unknown or
    // invalid resource URIs deliberately do nothing, not a dashboard redirect.
    try {
      const parsed = new URL(value);
      if (parsed.protocol !== "cluster:" || parsed.hostname !== "open" || parsed.search || parsed.hash || parsed.username || parsed.password || parsed.port) return;
      const path = parsed.pathname.replace(/^\/+/, "");
      if (!path || path.includes("%") || path.includes("//")) return;
      const navigation = parseNavigationRoute(path);
      if (!navigation) return;
      window.history.pushState(navigation, "", `${window.location.pathname}${window.location.search}${navigationHash(navigation)}`);
      window.dispatchEvent(new PopStateEvent("popstate", { state: navigation }));
    } catch { /* An untrusted shell link must not crash renderer initialization. */ }
  };
  const onNativeLink = (event: Event) => {
    const value = (event as CustomEvent<unknown>).detail;
    if (typeof value === "string") onDeepLink(value);
  };
  window.addEventListener("cluster:desktop-deep-link", onNativeLink);
  const unsubscribe = bridge?.onDeepLink?.(onDeepLink);
  return () => {
    window.removeEventListener("cluster:desktop-deep-link", onNativeLink);
    unsubscribe?.();
  };
}
