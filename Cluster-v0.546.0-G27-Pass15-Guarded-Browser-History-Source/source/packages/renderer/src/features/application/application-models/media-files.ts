import type { ReviewLocator, ReviewMedium, ViewableResource } from "@cluster/shared";
import type { User } from "./identity";

export type VideoPool = "raw" | "edited" | "final";

export type VideoStatus = "intake" | "editing" | "review" | "changes" | "approved" | "published" | "archived";

export type VideoNoteStatus = "open" | "resolved";

export type VideoNoteCategory = "edit" | "audio" | "graphics" | "caption" | "color" | "gameplay" | "approval";

export type VideoPriority = "low" | "medium" | "high" | "urgent";

export type VideoAnnotation = { x?: number; y?: number; width?: number; height?: number; shape?: "box" | "circle" | "arrow" | "freehand" | "text"; text?: string; points?: Array<{ x: number; y: number }> };

export type ReviewComment = {
  id: string;
  reviewAssetId: string;
  body: string;
  locator: ReviewLocator;
  status?: VideoNoteStatus | string;
  category?: VideoNoteCategory | string;
  priority?: VideoPriority | string;
  assigneeId?: string | null;
  parentCommentId?: string | null;
  threadRootId?: string | null;
  mentionedUserIds?: string[];
  resolvedAt?: string | null;
  resolvedById?: string | null;
  carriedFromCommentId?: string | null;
  carriedFromAssetId?: string | null;
  workEntityType?: "ticket" | "card" | string | null;
  workEntityId?: string | null;
  createdAt: string;
  updatedAt?: string;
  user?: User | null;
};

export type ReviewAsset = {
  id: string;
  projectId: string;
  medium: ReviewMedium;
  title: string;
  description?: string | null;
  pool: VideoPool | string;
  status?: VideoStatus | string;
  versionLabel?: string | null;
  versionGroupId?: string | null;
  versionNumber?: number;
  reviewRound?: string | null;
  assetKind?: "source" | "proxy" | "review" | "master" | "reference" | string;
  proxyOfId?: string | null;
  derivedFromId?: string | null;
  supersededById?: string | null;
  processingState?: "idle" | "queued" | "processing" | "ready" | "failed" | string;
  platform?: string | null;
  dueDate?: string | null;
  reviewerId?: string | null;
  approvalState?: "pending" | "approved" | "changes" | "superseded" | string;
  approvedAt?: string | null;
  approvedById?: string | null;
  creatorId?: string | null;
  ownerId?: string | null;
  lastModifiedById?: string | null;
  frameRate?: number | null;
  width?: number | null;
  height?: number | null;
  codec?: string | null;
  metadata?: Record<string, unknown>;
  metadataProvenance?: Record<string, unknown>;
  originalName: string;
  checksumSha256?: string | null;
  mimeType: string;
  sizeBytes: number;
  durationSeconds?: number | null;
  uploadedById?: string | null;
  uploadedAt: string;
  fileCreatedAt?: string | null;
  capturedAt?: string | null;
  modifiedAt?: string | null;
  versionUploadedAt: string;
  createdAt: string;
  updatedAt: string;
  comments: ReviewComment[];
};

export type ReviewSensitiveMetadataPayload = { assetId: string; sensitiveMetadata: Record<string, unknown> };
export type ReviewAssetSessionPayload = { asset: ReviewAsset; capabilities: Record<string, boolean>; resource: ViewableResource };

export type ProjectFile = {
  id: string;
  projectId: string;
  title: string;
  description?: string | null;
  category: string;
  assetRole?: "source" | "derived" | "proxy" | "export" | "reference" | "deliverable" | string;
  status?: "active" | "review" | "approved" | "superseded" | "archived" | string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  versionGroupId?: string | null;
  versionNumber?: number;
  versionLabel?: string | null;
  derivedFromId?: string | null;
  proxyOfId?: string | null;
  exportOfId?: string | null;
  supersededById?: string | null;
  duplicateOfId?: string | null;
  checksumSha256?: string | null;
  archived?: boolean;
  revision?: number;
  lock?: { ownerId: string; ownerName?: string | null; expiresAt: string | null } | null;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  updatedAt: string;
};

export type VideoProductionRecordKind = "episode" | "sequence" | "scene" | "shot" | "take" | "review_session" | "deliverable" | "media_job";
export type VideoProductionRecord = { id: string; projectId: string; kind: VideoProductionRecordKind | string; title: string; description?: string | null; status: string; priority?: string; ownerId?: string | null; parentId?: string | null; category?: string | null; startDate?: string | null; dueDate?: string | null; progress?: number; payload?: Record<string, unknown>; createdAt: string; updatedAt: string; revision?: number };
export type MediaProcessingWorker = { id: string; hostname: string; status: string; online: boolean; desiredState?: "active" | "drain" | "maintenance" | string; concurrency: number; activeJobs: number; capabilities: string[]; labels?: string[]; accelerationProfiles?: string[]; selectedAcceleration?: string; storageTopology?: string; storageFingerprint?: string | null; ffmpegVersion?: string | null; ffprobeVersion?: string | null; toolVersions?: Record<string, unknown>; resourceBudgets?: Record<string, unknown>; startedAt: string; lastSeenAt: string };
export type MediaProcessingArtifact = { id: string; reviewAssetId: string; kind: string; variantKey: string; mimeType: string; sizeBytes: number; checksumSha256: string; sourceChecksumSha256?: string | null; generatedByJobId?: string | null; metadataPolicy?: string; toolchain?: Record<string, unknown>; metadata?: Record<string, unknown>; generatedAt?: string; updatedAt: string; url: string };
export type MediaProcessingPolicy = { medium: ReviewMedium; assetRole: string; enabled: boolean; jobs: string[]; accelerationPreference: string; retentionDays?: number | null; source: "studio" | "default" | string };
export type ProjectMediaPayload = { reviewAssets: ReviewAsset[]; files: ProjectFile[]; production?: { records: VideoProductionRecord[]; summary: { units: number; reviewSessions: number; deliverables: number; openNotes: number; pendingApprovals: number } }; mediaProcessing?: { workers: MediaProcessingWorker[]; artifacts: MediaProcessingArtifact[]; queue: { queued: number; processing: number; failed: number; complete: number }; policies?: MediaProcessingPolicy[]; storage?: { assetBytes: number; artifactBytes: number; usedBytes: number; projectLimitBytes: number; cacheLimitBytes: number; resourceBudgets?: Record<string, unknown>; topology?: string; fingerprint?: string; mismatchedWorkerIds?: string[] } } };
