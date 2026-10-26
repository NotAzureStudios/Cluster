export type Project = { id: string; name: string; archived?: boolean };
export type User = { id: string; username: string; displayName?: string | null; isAdmin?: boolean };
export type LibraryMetadata = Record<string, string | number | boolean | null>;

export type LibraryModelBundleEntry = {
  id: string;
  name: string;
  extension?: string | null;
  mimeType?: string | null;
  fileUrl?: string | null;
};

export type LibraryItem = {
  id: string;
  projectId?: string | null;
  ownerId?: string | null;
  reviewerId?: string | null;
  parentId?: string | null;
  creatorId?: string | null;
  uploaderId?: string | null;
  lastEditorId?: string | null;
  generatedForUserId?: string | null;
  title: string;
  body?: string | null;
  type: string;
  status: string;
  priority: string;
  tags: string[];
  externalUrl?: string | null;
  pinned?: boolean;
  versionLabel?: string | null;
  reviewDueAt?: string | null;
  approvedAt?: string | null;
  visibility?: string | null;
  classification?: "public" | "internal" | "confidential" | "restricted" | string | null;
  lifecycleState?: "active" | "in-review" | "approved" | "deprecated" | "trashed" | string | null;
  reviewState?: "draft" | "in-review" | "approved" | "changes-requested" | "archived" | string | null;
  retentionPolicyKey?: string | null;
  retentionUntil?: string | null;
  legalHold?: boolean;
  deletedAt?: string | null;
  deletedById?: string | null;
  integrityState?: string | null;
  integrityCheckedAt?: string | null;
  originKind?: string | null;
  originRef?: string | null;
  generatedByKind?: string | null;
  generatedById?: string | null;
  lifecycleNotes?: string | null;
  fileName?: string | null;
  originalName?: string | null;
  mimeType?: string | null;
  mimeGroup?: string;
  sizeBytes?: number | null;
  checksumSha256?: string | null;
  extension?: string | null;
  source?: string | null;
  revision?: number;
  fileModifiedAt?: string | null;
  manualOrder?: number | null;
  previewKind: string;
  previewText?: string | null;
  hasFile: boolean;
  fileUrl?: string | null;
  modelPreviewUrl?: string | null;
  modelThumbnailUrl?: string | null;
  downloadUrl?: string | null;
  snippet?: string;
  childCount?: number;
  versionCount?: number;
  backlinkCount?: number;
  favoriteCount?: number;
  permissionCount?: number;
  metadata?: LibraryMetadata;
  governance?: {
    identity: { resourceKind: "library"; resourceId: string };
    creatorId?: string | null; uploaderId?: string | null; lastEditorId?: string | null; generatedForUserId?: string | null;
    classification?: string; lifecycleState?: string; retentionPolicyKey?: string | null; retentionUntil?: string | null; legalHold?: boolean;
    deletedAt?: string | null; deletedById?: string | null; integrityState?: string; integrityCheckedAt?: string | null;
    origin?: { kind?: string | null; ref?: string | null; generatedByKind?: string | null; generatedById?: string | null };
  };
  folderColor?: string | null;
  folderIcon?: string | null;
  modelBundle?: LibraryModelBundleEntry[];
  youtubeId?: string | null;
  youtubePlaylistId?: string | null;
  youtubeThumbnailUrl?: string | null;
  youtubeEmbedUrl?: string | null;
  changelog?: Array<{ at: string; by?: string | null; from?: string | null; to?: string | null; note?: string | null }>;
  project?: { id: string; name: string } | null;
  owner?: User | null;
  reviewer?: User | null;
  parent?: { id: string; title: string; parentId?: string | null } | null;
  path?: Array<{ id: string; title: string }>;
  createdAt: string;
  updatedAt: string;
};

export type LibraryFacets = {
  total: number;
  pinned: number;
  projectLinked: number;
  byType: Record<string, number>;
  byStatus: Record<string, number>;
  byMimeGroup: Record<string, number>;
};

export type LibraryWorkspace = {
  items: LibraryItem[];
  folders?: LibraryItem[];
  treeFiles?: LibraryItem[];
  pinnedItems?: LibraryItem[];
  favoriteIds?: string[];
  path?: Array<{ id: string; title: string }>;
  facets?: LibraryFacets;
  storage?: { root: string };
  pagination: { cursor: string | null; hasMore: boolean; limit: number; loaded: number };
};

export type LayoutMode = "grid" | "compact-grid" | "list" | "details";
export type LibrarySearchScope = "folder" | "descendants" | "project" | "library";
export type LibraryGroupMode = "none" | "type" | "project" | "review";
export type InspectorTab = "preview" | "description" | "references" | "activity" | "lifecycle";

export type LibraryFilters = {
  projectId: string;
  ownerId: string;
  type: string;
  status: string;
  mimeGroup: string;
  visibility: string;
  modified: string;
  tag: string;
  pinned: "all" | "yes" | "no";
  sort: string;
};

export const EMPTY_FACETS: LibraryFacets = {
  total: 0,
  pinned: 0,
  projectLinked: 0,
  byType: {},
  byStatus: {},
  byMimeGroup: {}
};
export type LibraryCollection = {
  id: string; ownerId: string; projectId?: string | null; name: string; description?: string | null; kind: "manual" | "smart"; query?: Record<string, unknown>; archived?: boolean; revision: number; itemCount?: number; accessRole?: "owner" | "editor" | "viewer"; createdAt: string; updatedAt: string;
};

export type LibraryOperation = {
  id: string; type: string; status: "queued" | "running" | "succeeded" | "failed" | "dead-letter" | "cancelled" | string; progress: number; progressMessage?: string | null; lastError?: string | null; result?: Record<string, unknown> | null; createdAt?: string; updatedAt?: string;
};
export type LibraryTransferFinalizeResponse = { ok: true; operation: LibraryOperation; receipt?: { transferAccepted?: boolean; transferComplete?: boolean; derivativesComplete?: boolean; operationId?: string } };
export type LibraryTransferOperationResponse = { ok: true; operation: LibraryOperation };

export type LibraryDerivative = {
  id: string; itemId: string; kind: string; variantKey: string; currentVersion?: boolean; available?: boolean; availabilityReason?: string | null; sourceChecksumSha256?: string | null; contentChecksumSha256?: string | null; status: string; mimeType?: string | null; sizeBytes?: number | null; metadata?: Record<string, unknown>; builtAt?: string | null; invalidatedAt?: string | null; updatedAt?: string; fileUrl?: string | null;
};
export type LibraryAssetLock = {
  id: string; itemId: string; ownerId: string; state: string; active: boolean; sourceKind?: string | null; sourceRef?: string | null; acquiredAt?: string | null; expiresAt?: string | null; releasedAt?: string | null; forceReleased?: boolean; reason?: string | null; revision?: number; deviceBound?: boolean; ownedByCurrentDevice?: boolean;
};
export type LibraryReviewPayload = {
  ok: true; review: { state: "draft" | "in-review" | "approved" | "changes-requested" | "archived" | string; reviewerId?: string | null; reviewDueAt?: string | null; approvedAt?: string | null; watched: boolean; watcherCount: number; openAnnotations: number; lock?: LibraryAssetLock | null; };
};
export type LibraryDerivativesPayload = { ok: true; sourceChecksumSha256?: string | null; derivatives: LibraryDerivative[] };

