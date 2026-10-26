import type { Readable } from "node:stream";

export type StorageTier = "hot" | "standard" | "archive" | "cache" | "temporary" | "external";
export type StoragePurpose = "source" | "proxy" | "derivative" | "preview" | "upload" | "export" | "backup" | "external";

export type StorageLocator = {
  provider: string;
  tier: StorageTier;
  key: string;
};

export type StorageObjectStat = {
  size: number;
  modifiedAt: Date;
  checksumSha256?: string | null;
  // Opaque read-only S3 object-version evidence if bucket versioning is active.
  // NEVER infer conditional-mutation, immutability or deletion authority.
  providerVersionId?: string | null;
};

export type StorageProviderCapabilities = {
  streamingReads: true;
  rangeReads: true;
  streamingWrites: boolean;
  sharedAcrossNodes: boolean;
  objectStorage: boolean;
  multipartUploads: boolean;
};

export type StorageReadRange = { start: number; end: number };

export type StorageMultipartPart = {
  partNumber: number;
  etag: string;
  sizeBytes: number;
};

export type StorageMultipartSession = {
  uploadId: string;
};

/** Bounded, read-only evidence, never a lease or permission to dispose bytes. */
export type StorageMultipartInspection = {
  state: "active" | "not_found";
  observedParts: number;
  observedBytes: number;
  truncated: boolean;
};

export type StorageBrowserUploadCapability = {
  state: "ready" | "misconfigured" | "unverified" | "unsupported";
  origin: string | null;
  detail: string;
  allowsPut: boolean | null;
  exposesEtag: boolean | null;
  allowsContentType: boolean | null;
  checkedAt: Date;
};

export interface StorageProvider {
  readonly id: string;
  readonly kind: string;
  readonly durable: boolean;
  readonly sharedAcrossNodes: boolean;
  readonly capabilities: StorageProviderCapabilities;
  putFile(key: string, sourcePath: string, options?: { signal?: AbortSignal }): Promise<StorageObjectStat>;
  putStream(key: string, stream: Readable, input: { size: number; checksumSha256?: string | null; signal?: AbortSignal }): Promise<StorageObjectStat>;
  materializeToFile?(key: string, targetPath: string, input?: { signal?: AbortSignal }): Promise<StorageObjectStat & { method?: "hardlink" | "copy" }>;
  copyObject?(sourceKey: string, targetKey: string, input?: { checksumSha256?: string | null; signal?: AbortSignal }): Promise<StorageObjectStat>;
  createMultipartUpload?(key: string, input?: { contentType?: string | null; signal?: AbortSignal }): Promise<StorageMultipartSession>;
  createMultipartPartUploadUrl?(key: string, uploadId: string, partNumber: number, expiresSeconds: number): Promise<{ url: string; expiresAt: Date }>;
  completeMultipartUpload?(key: string, uploadId: string, parts: StorageMultipartPart[], input?: { checksumSha256?: string | null; signal?: AbortSignal }): Promise<StorageObjectStat>;
  abortMultipartUpload?(key: string, uploadId: string): Promise<void>;
  inspectMultipartUpload?(key: string, uploadId: string): Promise<StorageMultipartInspection>;
  browserUploadCapability?(origin: string | null): Promise<StorageBrowserUploadCapability>;
  openRead(key: string, range?: StorageReadRange): Promise<Readable>;
  stat(key: string): Promise<StorageObjectStat>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
  health(): Promise<{ ok: boolean; detail?: string; freeBytes?: number | null }>;
}

export type StoragePlacementInput = {
  purpose: StoragePurpose;
  sizeBytes?: number;
  regenerable?: boolean;
  archived?: boolean;
  activeProject?: boolean;
};
