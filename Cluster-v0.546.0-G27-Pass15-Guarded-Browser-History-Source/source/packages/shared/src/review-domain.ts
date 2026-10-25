export const REVIEW_MEDIA = ["video", "audio", "image", "pdf", "3d"] as const;
export type ReviewMedium = typeof REVIEW_MEDIA[number];

export type NormalizedPoint = { x: number; y: number };
export type NormalizedRegion = { x: number; y: number; width: number; height: number };
export type ReviewAnnotationShape = "box" | "circle" | "arrow" | "freehand" | "text";
export type ReviewScreenAnnotation = NormalizedRegion & {
  shape?: ReviewAnnotationShape;
  text?: string;
  points?: NormalizedPoint[];
};

export type MediaTimeLocator = {
  type: "media_time";
  timeSeconds: number;
  endTimeSeconds?: number | null;
  frameNumber?: number | null;
  presentedFrame?: number | null;
  sourceVersionId?: string | null;
  sourceArtifactId?: string | null;
  audioTrackId?: string | null;
  annotation?: ReviewScreenAnnotation | null;
};
export type AudioRegionLocator = {
  type: "audio_region";
  timeSeconds: number;
  endTimeSeconds?: number | null;
  trackId?: string | null;
  stemId?: string | null;
};
export type ImageRegionLocator = {
  type: "image_region";
  region?: NormalizedRegion | null;
  point?: NormalizedPoint | null;
  path?: NormalizedPoint[] | null;
  pixel?: { x: number; y: number; rgba?: [number, number, number, number?] } | null;
};
export type PdfRegionLocator = {
  type: "pdf_region";
  page: number;
  region?: NormalizedRegion | null;
  selectedTextRef?: string | null;
};
export type SpatialLocator = {
  type: "spatial";
  objectId?: string | null;
  meshId?: string | null;
  worldPosition: [number, number, number];
  surfaceNormal?: [number, number, number] | null;
  camera?: Record<string, unknown> | null;
  visibility?: Record<string, boolean> | null;
  animationId?: string | null;
  animationTimeSeconds?: number | null;
};
export type ReviewLocator = MediaTimeLocator | AudioRegionLocator | ImageRegionLocator | PdfRegionLocator | SpatialLocator;

export const REVIEW_ASSET_CAPABILITIES = [
  "viewAsset", "viewBasicMetadata", "viewSensitiveMetadata", "viewReviewHistory",
  "comment", "annotate", "resolve", "approve", "manageVersions", "downloadOriginal",
  "exportDerivative", "chooseMetadataPreservationPolicy", "print", "copyText", "copyImage",
  "generateDerivatives", "accessDiagnostics",
] as const;
export type ReviewAssetCapability = typeof REVIEW_ASSET_CAPABILITIES[number];
export type ReviewAssetCapabilities = Partial<Record<ReviewAssetCapability, boolean>>;

export const METADATA_EXPORT_POLICIES = ["preserve", "safe_share", "strip_all", "custom"] as const;
export type MetadataExportPolicy = typeof METADATA_EXPORT_POLICIES[number];

export type ReviewTimestampSemantics = {
  assetCreatedAt: string;
  uploadedAt: string;
  fileCreatedAt?: string | null;
  capturedAt?: string | null;
  modifiedAt?: string | null;
  versionUploadedAt: string;
  derivativeGeneratedAt?: string | null;
  approvedAt?: string | null;
};

export const REVIEW_METADATA_LAYERS = [
  "identity_provenance",
  "production",
  "review_context",
  "sensitive",
  "derived",
] as const;
export type ReviewMetadataLayer = typeof REVIEW_METADATA_LAYERS[number];

export const SENSITIVE_METADATA_CATEGORIES = [
  "location",
  "device_identifier",
  "private_author",
  "filesystem_path",
  "document_private_field",
  "editing_history",
] as const;
export type SensitiveMetadataCategory = typeof SENSITIVE_METADATA_CATEGORIES[number];


export const REVIEW_COMPARISON_MODES = ["off", "side", "wipe", "overlay", "difference", "blink", "reference", "ab"] as const;
export type ReviewComparisonMode = typeof REVIEW_COMPARISON_MODES[number];
export type ReviewComparisonSide = "primary" | "secondary";

export type ReviewComparisonPreferences = {
  version: 1;
  mode: ReviewComparisonMode;
  amount: number;
  activeSide: ReviewComparisonSide;
  syncPlayback: boolean;
  syncCamera: boolean;
  blinkIntervalMs: number;
};

export type ReviewPortableUser = {
  id: string | null;
  username?: string | null;
  displayName?: string | null;
};

export type ReviewPortableComment = {
  id: string;
  assetId: string;
  parentCommentId?: string | null;
  threadRootId?: string | null;
  author: ReviewPortableUser | null;
  mentionedUserIds: string[];
  assigneeId?: string | null;
  status: string;
  category: string;
  priority: string;
  body: string;
  locator: ReviewLocator;
  createdAt: string;
  updatedAt?: string | null;
  resolvedAt?: string | null;
  resolvedById?: string | null;
};

export type ReviewPortableAsset = {
  id: string;
  projectId: string;
  medium: ReviewMedium;
  title: string;
  originalName: string;
  versionGroupId: string;
  versionNumber: number;
  versionLabel?: string | null;
  reviewRound?: string | null;
  status: string;
  approvalState: string;
  uploadedBy: ReviewPortableUser | null;
  reviewer: ReviewPortableUser | null;
  approvedBy: ReviewPortableUser | null;
  checksumSha256?: string | null;
  createdAt: string;
  updatedAt?: string | null;
  uploadedAt: string;
  versionUploadedAt: string;
  approvedAt?: string | null;
  preview: { mimeType: string; sizeBytes: number; width?: number | null; height?: number | null; durationSeconds?: number | null };
  comments: ReviewPortableComment[];
};

export type ReviewPortableReportV1 = {
  schema: "cluster.review-report";
  version: 1;
  generatedAt: string;
  projectId: string;
  versionFamilyId: string;
  scope: "asset" | "family";
  summary: { assets: number; comments: number; unresolved: number; resolved: number; approvals: number };
  assets: ReviewPortableAsset[];
};
