export const CLUSTER_DESKTOP_BRIDGE_VERSION = 4 as const;
export const CLUSTER_DESKTOP_API_ORIGIN = "cluster-api://server";
export const CLUSTER_DESKTOP_RENDERER_ORIGIN = "cluster-app://app";

export const DESKTOP_IPC = {
  openExternal: "desktop:open-external",
  setBadge: "desktop:set-badge",
  notificationPermission: "desktop:notification-permission",
  showNotification: "desktop:show-notification",
  getLaunchAtStartup: "desktop:get-launch-at-startup",
  setLaunchAtStartup: "desktop:set-launch-at-startup",
  setMinimizeToTray: "desktop:set-minimize-to-tray",
  setCloseBehavior: "desktop:set-close-behavior",
  setExternalLinks: "desktop:set-external-links",
  getServerUrl: "desktop:get-server-url",
  getRecentServers: "desktop:get-recent-servers",
  getShowServerAddresses: "desktop:get-show-server-addresses",
  setShowServerAddresses: "desktop:set-show-server-addresses",
  renameServer: "desktop:rename-server",
  forgetServer: "desktop:forget-server",
  testServer: "desktop:test-server",
  connectServer: "desktop:connect-server",
  showConnection: "desktop:show-connection",
  reloadApp: "desktop:reload-app",
  getRuntimeStatus: "desktop:get-runtime-status",
  pickFiles: "desktop:pick-files",
  pickDirectory: "desktop:pick-directory",
  revealPath: "desktop:reveal-path",
  openPath: "desktop:open-path",
  openWorkspaceWindow: "desktop:open-workspace-window",
  startDownload: "desktop:start-download",
  listTransfers: "desktop:list-transfers",
  pauseTransfer: "desktop:pause-transfer",
  resumeTransfer: "desktop:resume-transfer",
  cancelTransfer: "desktop:cancel-transfer",
  retryTransfer: "desktop:retry-transfer",
  startUpload: "desktop:start-upload",
  credentialVaultStatus: "desktop:credential-vault-status",
  credentialVaultList: "desktop:credential-vault-list",
  credentialVaultSet: "desktop:credential-vault-set",
  credentialVaultDelete: "desktop:credential-vault-delete",
  collaborationSubscribe: "desktop:collaboration-subscribe",
  collaborationUnsubscribe: "desktop:collaboration-unsubscribe",
  collaborationEvent: "desktop:collaboration-event",
  captureSources: "desktop:capture-sources",
  captureScreenshot: "desktop:capture-screenshot",
  saveCapture: "desktop:save-capture",
  transferState: "desktop:transfer-state",
  serverStatus: "desktop:server-status",
  offlineCacheGet: "desktop:offline-cache-get",
  offlineCacheList: "desktop:offline-cache-list",
  offlineCachePut: "desktop:offline-cache-put",
  offlineCacheRemove: "desktop:offline-cache-remove",
  offlineCacheRemoveMany: "desktop:offline-cache-remove-many",
  offlineCacheClearScope: "desktop:offline-cache-clear-scope",
  offlineCacheStatus: "desktop:offline-cache-status",
  offlineCacheChanged: "desktop:offline-cache-changed",
  deepLink: "desktop:deep-link",
  updateState: "desktop:update-state",
} as const;

export type ClusterDesktopPlatform = "windows" | "macos" | "linux" | "web";
export type ClusterDesktopCloseBehavior = "ask" | "minimize" | "quit";
export type ClusterDesktopNotificationDelivery = "native" | "in-app" | "both";
export type ClusterDesktopUpdatePhase = "idle" | "checking" | "available" | "downloading" | "ready" | "applying" | "awaiting-health" | "healthy" | "failed" | "rollback-ready" | "rolling-back";

export type ClusterDesktopUpdateState = {
  schemaVersion: 1;
  phase: ClusterDesktopUpdatePhase;
  currentVersion: string;
  targetVersion?: string;
  previousVersion?: string;
  downloadedBytes?: number;
  updatedAt: string;
  error?: string;
  artifactPath?: string;
  rollbackInstallerPath?: string;
  recoveryRequired?: boolean;
  updateFeedConfigured?: boolean;
};

export type ClusterDesktopHealthResult = {
  ok: boolean;
  url: string;
  message: string;
  version?: string;
  runtime?: string;
  latencyMs?: number;
  contractVersion?: string;
  compatible?: boolean;
  healthEndpoint?: string;
  studioName?: string;
  workspaceName?: string;
  setupComplete?: boolean;
  capabilities?: string[];
};

export type ClusterDesktopRecentServer = {
  url: string;
  lastConnectedAt: string;
  lastSeenAt?: string;
  version?: string;
  label?: string;
  studioName?: string;
  workspaceName?: string;
  lastLatencyMs?: number;
  capabilities?: string[];
};


export type ClusterDesktopOfflineArea = "responses" | "mutations" | "drafts" | "meta";
export type ClusterDesktopOfflineRecord = Record<string, unknown> & {
  key?: string;
  id?: string;
  scope?: string;
  updatedAt?: number;
  cachedAt?: number;
  expiresAt?: number;
};
export type ClusterDesktopOfflineCacheStatus = {
  schemaVersion: number;
  serverKey: string;
  records: Record<ClusterDesktopOfflineArea, number>;
  sizeBytes: number;
  durable: boolean;
  engine: "native" | "indexeddb";
};

export type ClusterDesktopTransferState = {
  id: string;
  direction: "download" | "upload";
  state: "queued" | "running" | "paused" | "verifying" | "complete" | "failed" | "cancelled";
  label: string;
  filePath?: string;
  sourceUrl?: string;
  uploadSessionId?: string;
  transferredBytes: number;
  totalBytes?: number;
  checksumSha256?: string;
  expectedChecksumSha256?: string;
  resumable?: boolean;
  canPause?: boolean;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
};

export type ClusterDesktopCredentialVaultStatus = {
  available: boolean;
  secure: boolean;
  backend: "os-vault" | "basic-text" | "unavailable";
  entries: number;
};

export type ClusterWorkstationServiceStatus = {
  schema: 1;
  protocol: 1;
  version: string;
  pid: number;
  startedAt: string;
  backgroundIndependent: true;
  authenticatedLocalIpc: true;
  rawPathExposure: false;
  sessionLeaseCount?: number;
  capabilities: string[];
};

export type ClusterLocalWorkspace = {
  id: string;
  name: string;
  rootName: string;
  projectRefs: Array<{ profileId: string; projectId: string }>;
  repositories: Array<{ id: string; name: string; relativePath: string; trust: "untrusted" | "trusted"; addedAt: string }>;
  createdAt: string;
  updatedAt: string;
};

export type ClusterLocalRepositoryCandidate = {
  candidateId: string;
  name: string;
  relativePath: string;
};

export type ClusterLocalGitStatus = {
  available: true;
  version: string;
  branch: string;
  detached: boolean;
  upstream?: string;
  ahead: number;
  behind: number;
  changedFiles: number;
  clean: boolean;
  remotes: string[];
};


export type ClusterLocalGitDetails = {
  branches: Array<{ name: string; current: boolean; upstream?: string }>;
  tags: string[];
  upstreams: string[];
  history: Array<{ sha: string; shortSha: string; author: string; authoredAt: string; subject: string }>;
  graph: Array<{ sha: string; shortSha: string; parents: string[]; refs: string[]; author: string; authoredAt: string; subject: string }>;
  changes: Array<{ state: string; relativePath: string }>;
  conflicts: string[];
  diffStat: string;
  stashes: Array<{ ref: string; sha: string; subject: string }>;
  remotes: Array<{ name: string; url: string }>;
  recovery: { operation: "none" | "merge" | "rebase" | "cherry-pick" | "revert"; inProgress: boolean; conflictCount: number; canContinue: boolean; canAbort: boolean };
  signing: { commitSigningEnabled: boolean; tagSigningEnabled: boolean; signingKeyConfigured: boolean; headStatus: string; headKey?: string; headSigner?: string };
  layout: { worktreeCount: number; worktreeBranches: string[]; submodules: Array<{ state: string; sha: string; relativePath: string }>; sparseCheckout: boolean; sparsePatterns: string[]; partialClone: boolean; partialCloneRemote?: string };
  policy: { ignorePatterns: string[]; attributeRules: Array<{ pattern: string; attributes: string }>; ignoreFileSafe: boolean; attributesFileSafe: boolean };
};

export type ClusterLocalGitDiff = {
  relativePath: string;
  staged: boolean;
  patch: string;
  truncated: boolean;
  hunks: Array<{ id: string; header: string; oldStart: number; oldLines: number; newStart: number; newLines: number }>;
};

export type ClusterLocalGitMutationAction =
  | "stage" | "unstage" | "hunk.stage" | "hunk.unstage" | "discard"
  | "commit" | "amend"
  | "branch.create" | "branch.checkout" | "branch.delete"
  | "tag.create" | "tag.delete"
  | "upstream.set" | "upstream.unset"
  | "ignore.add" | "ignore.remove" | "attributes.text" | "attributes.binary" | "attributes.remove"
  | "lfs.track" | "lfs.untrack" | "lfs.track-lockable" | "lfs.prune.dry-run" | "lfs.prune"
  | "stash.push" | "stash.apply" | "stash.pop" | "stash.drop"
  | "merge.start" | "merge.continue" | "merge.abort"
  | "rebase.start" | "rebase.continue" | "rebase.abort"
  | "cherry-pick.start" | "cherry-pick.continue" | "cherry-pick.abort"
  | "revert.start" | "revert.continue" | "revert.abort"
  | "reset.soft" | "reset.mixed" | "reset.hard"
  | "remote.add" | "remote.remove" | "remote.rename" | "remote.set-url";

export type ClusterLocalGitMutationResult = {
  ok: true;
  action: ClusterLocalGitMutationAction;
  message?: string;
  status: ClusterLocalGitStatus;
  details: ClusterLocalGitDetails;
};

export type ClusterLocalGitOperation = {
  schema: 1 | 2;
  id: string;
  kind: "git.clone" | "git.fetch" | "git.pull" | "git.push" | "git.lfs.fetch.current" | "git.lfs.fetch.recent" | "git.lfs.checkout" | "git.lfs.locks" | "git.lfs.lock" | "git.lfs.unlock";
  state: "queued" | "running" | "cancelling" | "succeeded" | "partial" | "failed" | "cancelled";
  stage: string;
  workspaceId: string;
  repositoryId: string;
  targetLabel?: string;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  message?: string;
  percent?: number;
  current?: number;
  total?: number;
  logs: string[];
  type: string;
  queue: "workstation";
  status: "queued" | "running" | "succeeded" | "failed" | "dead-letter" | "cancelled";
  trace: { correlationId: string; causationId?: string | null; requestId?: string | null };
  priority: number;
  costUnits: number;
  progress: number;
  progressMessage?: string | null;
  attempts: number;
  maxAttempts: number;
  runAfter: string;
  cancelRequestedAt?: string | null;
  lastError?: string | null;
  createdAt: string;
  finishedAt?: string | null;
  result?: {
    lfsLocks?: Array<{ id: string; path: string; lockedAt?: string; owner?: string; ownership?: "ours" | "theirs" | "unknown" }>;
    lfsLock?: { id: string; path: string; lockedAt?: string; owner?: string; ownership?: "ours" | "theirs" | "unknown" };
    lfsUnlock?: { id?: string; path?: string; unlocked: boolean; reason?: string };
    ownershipVerified?: boolean;
    cloneStrategy?: "full" | "current" | "lightweight";
    lfsHydrationDeferred?: boolean;
    diskAvailableBytesAtStart?: number;
  };
};

export type ClusterLocalSecretScanFinding = {
  severity: "block" | "warning";
  rule: string;
  path: string;
  line: number;
  message: string;
};

export type ClusterLocalSecretScanResult = {
  schema: 1;
  scope: "staged" | "outgoing";
  ok: boolean;
  blocked: boolean;
  blockCount: number;
  warningCount: number;
  findingCount: number;
  scannedAddedLines: number;
  scannedBytes: number;
  commitsScanned: number;
  findings: ClusterLocalSecretScanFinding[];
};

export type ClusterLocalTaskDefinition = {
  id: string;
  label: string;
  workingDirectory: string;
  argumentCount: number;
  environmentCount: number;
  timeoutSeconds: number;
  manifestSha256: string;
};

export type ClusterLocalTaskOperation = {
  schema: 1;
  id: string;
  kind: "task.local";
  state: "queued" | "running" | "cancelling" | "succeeded" | "failed" | "cancelled";
  stage: string;
  workspaceId: string;
  repositoryId: string;
  taskId: string;
  targetLabel: string;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  message?: string;
  logs: string[];
  type: "local.task";
  queue: "workstation";
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  trace: { correlationId: string; causationId?: string | null; requestId?: string | null };
  priority: number;
  costUnits: number;
  progress: number;
  progressMessage?: string | null;
  attempts: number;
  maxAttempts: number;
  runAfter: string;
  cancelRequestedAt?: string | null;
  lastError?: string | null;
  createdAt: string;
  finishedAt?: string | null;
  timeoutSeconds: number;
  manifestSha256: string;
};

export type ClusterLocalHardwareCapabilities = {
  schema: 1;
  architecture: string;
  buildArchitecture: string;
  kernelType: string;
  kernelVersion: string;
  productType: string;
  logicalCpuCount: number;
  localTaskExecution: true;
  gpuEnumeration: false;
  processEnumeration: false;
  stableIdentifiers: false;
};

export type ClusterLocalGitLfsHealth = {
  installed: boolean;
  healthy: boolean;
  version?: string;
  endpointConfigured?: boolean;
  localMediaConfigured?: boolean;
  trackedObjects?: number;
  cacheObjectFiles?: number;
  cacheBytes?: number;
  cacheScanTruncated?: boolean;
  fsckHealthy?: boolean;
  objectFsckHealthy?: boolean;
  pointerFsckHealthy?: boolean;
  diskAvailableBytes?: number;
  diskTotalBytes?: number;
  message?: string;
};

export type ClusterLocalGitLfsPolicy = {
  installed: boolean;
  version?: string;
  patterns: string[];
  lockablePatterns: string[];
  largeFiles: Array<{ relativePath: string; sizeBytes: number; lfsTracked: boolean }>;
  largeFileThresholdBytes: number;
  message?: string;
};

export type ClusterDesktopCaptureSource = { id: string; name: string; kind: "screen" | "window"; thumbnailDataUrl?: string };
export type ClusterDesktopCaptureResult = { ok: boolean; filePath?: string; sizeBytes?: number; message?: string };
export type ClusterDesktopCollaborationFrame = { subscriptionId: string; event: string; data: string; receivedAt: number };


export type ClusterDesktopFileWatch = {
  watchId: string;
  kind: "file" | "directory";
  exists?: boolean;
  changedAt?: string;
  changeSeq?: number;
  backgroundIndependent?: boolean;
};

export type ClusterDesktopFileWatchEvent = {
  schema: 1;
  event: "watch.changed";
  watchId: string;
  kind: "file" | "directory";
  changedAt: string;
  exists: boolean;
};

export type ClusterDesktopRendererState = {
  schema: 2;
  unreadNotifications: number;
  activeScreen: string;
  activeRoute?: string;
  activeInspector?: string;
  serverLabel: string;
  userLabel: string;
  presenceLabel?: string;
  activeProjectId?: string;
  activeProjectName?: string;
};

export type ClusterDesktopRuntimeStatus = {
  kind: "desktop";
  platform: Exclude<ClusterDesktopPlatform, "web">;
  appVersion?: string;
  localRendererOrigin: string;
  apiTransportOrigin: string;
  serverUrl: string;
  recentServers?: ClusterDesktopRecentServer[];
  showServerAddresses?: boolean;
  server: ClusterDesktopHealthResult;
  launchAtStartup: boolean;
  minimizeToTray: boolean;
  closeBehavior: ClusterDesktopCloseBehavior;
  openExternalLinksInBrowser: boolean;
  offlineLaunch: boolean;
  nativeFileDialogs: boolean;
  nativeTransfers: boolean;
  multiWindow: boolean;
  durableOfflineCache: boolean;
  credentialVault: ClusterDesktopCredentialVaultStatus;
  workstationService?: ClusterWorkstationServiceStatus;
  nativeCollaborationStreaming: boolean;
  nativeCapture: boolean;
  offlineCache?: ClusterDesktopOfflineCacheStatus;
  managedByNativeHost?: boolean;
  update?: ClusterDesktopUpdateState;
  updateFeedConfigured?: boolean;
  autoCheckForUpdates?: boolean;
  updateFeedUrl?: string;
};

export type ClusterDesktopBridge = {
  bridgeVersion: typeof CLUSTER_DESKTOP_BRIDGE_VERSION;
  platform: Exclude<ClusterDesktopPlatform, "web">;
  appVersion?: string;
  apiUrl?: string;
  serverUrl?: string;
  openExternal?: (url: string) => Promise<void> | void;
  setBadgeCount?: (count: number) => Promise<void> | void;
  requestNotificationPermission?: () => Promise<boolean>;
  showNotification?: (payload: { title: string; body?: string; route?: string; tag?: string; priority?: "normal" | "medium" | "high" | "critical" }) => Promise<boolean>;
  getLaunchAtStartup?: () => Promise<boolean>;
  setLaunchAtStartup?: (enabled: boolean) => Promise<void>;
  setMinimizeToTray?: (enabled: boolean) => Promise<void>;
  setCloseBehavior?: (behavior: ClusterDesktopCloseBehavior) => Promise<void>;
  setOpenExternalLinksInBrowser?: (enabled: boolean) => Promise<void>;
  getServerUrl?: () => Promise<string>;
  getRecentServers?: () => Promise<ClusterDesktopRecentServer[]>;
  getShowServerAddresses?: () => Promise<boolean>;
  setShowServerAddresses?: (enabled: boolean) => Promise<boolean>;
  renameRecentServer?: (url: string, label: string) => Promise<ClusterDesktopRecentServer[]>;
  forgetRecentServer?: (url: string) => Promise<ClusterDesktopRecentServer[]>;
  testServerConnection?: (url?: string) => Promise<ClusterDesktopHealthResult>;
  connectServer?: (url: string) => Promise<ClusterDesktopHealthResult>;
  showConnection?: () => Promise<void>;
  reloadApp?: () => Promise<void>;
  navigateBack?: () => Promise<void>;
  navigateForward?: () => Promise<void>;
  writeClipboardText?: (text: string) => Promise<boolean>;
  startFileWatch?: (handleToken: string) => Promise<ClusterDesktopFileWatch>;
  stopFileWatch?: (watchId: string) => Promise<boolean>;
  listFileWatches?: () => Promise<ClusterDesktopFileWatch[]>;
  pickFiles?: (options?: { title?: string; filters?: Array<{ name: string; extensions: string[] }>; multiple?: boolean }) => Promise<string[]>;
  pickDirectory?: (options?: { title?: string }) => Promise<string | null>;
  pickSaveDestination?: (options?: { title?: string; suggestedName?: string; filters?: Array<{ name: string; extensions: string[] }> }) => Promise<string | null>;
  onFilesystemDrop?: (callback: (items: Array<{ handle: string; name: string; kind: "file" | "directory"; expiresAt: string; sizeBytes?: number; mimeType?: string; writableDestination?: boolean }>) => void) => () => void;
  revealPath?: (filePath: string) => Promise<boolean>;
  openPath?: (filePath: string) => Promise<string>;
  openWorkspaceWindow?: (route: string, title?: string) => Promise<boolean>;
  startDownload?: (input: { url: string; fileName?: string; label?: string; expectedChecksumSha256?: string }) => Promise<ClusterDesktopTransferState>;
  startUpload?: (input: { url?: string; filePath?: string; label?: string }) => Promise<ClusterDesktopTransferState>;
  listTransfers?: () => Promise<ClusterDesktopTransferState[]>;
  pauseTransfer?: (id: string) => Promise<ClusterDesktopTransferState>;
  resumeTransfer?: (id: string) => Promise<ClusterDesktopTransferState>;
  cancelTransfer?: (id: string) => Promise<ClusterDesktopTransferState>;
  retryTransfer?: (id: string) => Promise<ClusterDesktopTransferState>;
  getCredentialVaultStatus?: () => Promise<ClusterDesktopCredentialVaultStatus>;
  listCredentialKeys?: () => Promise<string[]>;
  setCredential?: (key: string, value: string) => Promise<boolean>;
  deleteCredential?: (key: string) => Promise<boolean>;
  subscribeCollaboration?: (input: { tool: "board" | "whiteboard"; resourceId: string; clientId: string }) => Promise<string>;
  unsubscribeCollaboration?: (subscriptionId: string) => Promise<void>;
  getCaptureSources?: (options?: { includeScreens?: boolean; includeWindows?: boolean }) => Promise<ClusterDesktopCaptureSource[]>;
  captureScreenshot?: (input?: { sourceId?: string; fileName?: string }) => Promise<ClusterDesktopCaptureResult>;
  saveCapture?: (input: { bytes: ArrayBuffer; mimeType: string; fileName?: string }) => Promise<ClusterDesktopCaptureResult>;
  offlineCacheGet?: (area: ClusterDesktopOfflineArea, key: string) => Promise<ClusterDesktopOfflineRecord | null>;
  offlineCacheList?: (area: ClusterDesktopOfflineArea, scope: string) => Promise<ClusterDesktopOfflineRecord[]>;
  offlineCachePut?: (area: ClusterDesktopOfflineArea, record: unknown) => Promise<ClusterDesktopOfflineRecord>;
  offlineCacheRemove?: (area: ClusterDesktopOfflineArea, key: string) => Promise<void>;
  offlineCacheRemoveMany?: (area: ClusterDesktopOfflineArea, keys: string[]) => Promise<void>;
  offlineCacheClearScope?: (scope: string) => Promise<void>;
  getOfflineCacheStatus?: () => Promise<ClusterDesktopOfflineCacheStatus>;
  getUpdateState?: () => Promise<ClusterDesktopUpdateState | undefined>;
  checkForUpdates?: () => Promise<unknown>;
  downloadUpdate?: () => Promise<ClusterDesktopUpdateState | undefined>;
  installUpdate?: () => Promise<ClusterDesktopUpdateState | undefined>;
  rollbackUpdate?: () => Promise<ClusterDesktopUpdateState | undefined>;
  discardUpdate?: () => Promise<ClusterDesktopUpdateState | undefined>;
  retryUpdateRecovery?: () => Promise<ClusterDesktopUpdateState | undefined>;
  dismissUpdateRecovery?: () => Promise<ClusterDesktopUpdateState | undefined>;
  closeWindow?: () => Promise<void>;
  setUpdatePreferences?: (preferences: { feedUrl?: string; autoCheck?: boolean }) => Promise<ClusterDesktopUpdateState | undefined>;
  getRuntimeStatus?: () => Promise<ClusterDesktopRuntimeStatus>;
  onUpdateState?: (callback: (state: ClusterDesktopUpdateState) => void) => () => void;
  onDeepLink?: (callback: (url: string) => void) => () => void;
  onTransferState?: (callback: (state: ClusterDesktopTransferState) => void) => () => void;
  onCollaborationFrame?: (callback: (frame: ClusterDesktopCollaborationFrame) => void) => () => void;
  onServerStatus?: (callback: (state: ClusterDesktopHealthResult) => void) => () => void;
  onOfflineCacheChanged?: (callback: (event: { area: ClusterDesktopOfflineArea | "all" }) => void) => () => void;
  onFileWatch?: (callback: (event: ClusterDesktopFileWatchEvent) => void) => () => void;
};
