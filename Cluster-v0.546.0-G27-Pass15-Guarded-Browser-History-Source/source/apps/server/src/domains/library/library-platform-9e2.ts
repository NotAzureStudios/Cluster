import { createHash } from "node:crypto";
import path from "node:path";
import { LIBRARY_DATA_FIELDS, type ClusterDataQuery } from "@cluster/shared";
import { normalizeClusterDataQuery } from "../../core/data-query.js";
import { compilePrismaDataFilterGroup, createPrismaSemanticAdapters } from "../../core/prisma-semantic-query.js";
import { libraryMimeFilter } from "./library-media-filters.js";

export const LIBRARY_TRANSFER_CONFLICT_POLICIES = ["reject", "rename", "version", "reuse-identical"] as const;
export type LibraryTransferConflictPolicy = (typeof LIBRARY_TRANSFER_CONFLICT_POLICIES)[number];

export const LIBRARY_REVIEW_STATES = ["draft", "in-review", "approved", "changes-requested", "archived"] as const;
export type LibraryReviewState = (typeof LIBRARY_REVIEW_STATES)[number];

export const LIBRARY_DERIVATIVE_KINDS = [
  "metadata",
  "thumbnail",
  "poster-frame",
  "waveform",
  "album-art",
  "pdf-preview",
  "text-preview",
  "model-thumbnail",
  "model-metadata",
  "archive-manifest",
] as const;
export type LibraryDerivativeKind = (typeof LIBRARY_DERIVATIVE_KINDS)[number];

function cleanExtension(value: unknown) {
  return String(value || "").trim().toLowerCase().replace(/^\./, "").slice(0, 32);
}

export function libraryDerivativePlan(item: { type?: string | null; mimeType?: string | null; extension?: string | null }) {
  if (String(item.type || "") !== "file") return [] as LibraryDerivativeKind[];
  const mime = String(item.mimeType || "").toLowerCase();
  const extension = cleanExtension(item.extension);
  const kinds = new Set<LibraryDerivativeKind>(["metadata"]);
  if (mime.startsWith("image/")) kinds.add("thumbnail");
  if (mime.startsWith("video/")) { kinds.add("thumbnail"); kinds.add("poster-frame"); }
  if (mime.startsWith("audio/")) { kinds.add("waveform"); kinds.add("album-art"); }
  if (mime === "application/pdf" || extension === "pdf") { kinds.add("pdf-preview"); kinds.add("text-preview"); }
  if (mime.startsWith("text/") || ["txt", "md", "csv", "json", "xml", "yaml", "yml", "ini", "log"].includes(extension)) kinds.add("text-preview");
  if (["blend", "fbx", "obj", "gltf", "glb", "dae", "3ds", "stl", "ply"].includes(extension) || mime.startsWith("model/")) {
    kinds.add("model-thumbnail");
    kinds.add("model-metadata");
  }
  if (["zip", "tar", "tgz", "gz", "7z", "rar"].includes(extension) || /(?:zip|tar|gzip|x-7z|rar)/.test(mime)) kinds.add("archive-manifest");
  return [...kinds];
}

export function libraryDerivativeIdentity(input: { itemId: string; sourceChecksumSha256: string; kind: string; variantKey?: string | null }) {
  const variantKey = String(input.variantKey || "default").trim() || "default";
  const digest = createHash("sha256").update(`${input.itemId}\n${input.sourceChecksumSha256}\n${input.kind}\n${variantKey}`).digest("hex");
  return `libder_${digest.slice(0, 32)}`;
}

export function sanitizeLibraryRelativePath(value: unknown) {
  const raw = String(value || "").replaceAll("\\", "/").trim();
  if (!raw) return { directories: [] as string[], fileName: "" };
  const pieces = raw.split("/").filter(Boolean);
  if (pieces.some((part) => part === "." || part === "..")) throw Object.assign(new Error("Relative Library upload paths cannot traverse parent folders."), { code: "LIBRARY_RELATIVE_PATH_INVALID", statusCode: 400 });
  const cleaned = pieces.map((part) => part.replace(/[\u0000-\u001f<>:"|?*]/g, "_").replace(/[. ]+$/g, "").slice(0, 240)).filter(Boolean);
  return { directories: cleaned.slice(0, -1), fileName: cleaned.at(-1) || "" };
}

/** A separate canonical scope keeps recursive folder traversal out of the generic filter language. */
export function librarySmartCollectionFolderScope(value: unknown): { mode: "descendants"; folderId: string } | null {
  if (!value || typeof value !== "object" || !Object.prototype.hasOwnProperty.call(value, "folderScope")) return null;
  const scope = (value as Record<string, unknown>).folderScope;
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) throw new Error("Invalid Smart Collection folder scope.");
  const { mode, folderId } = scope as Record<string, unknown>;
  if (mode !== "descendants" || typeof folderId !== "string" || folderId.length < 1 || folderId.length > 240 || !folderId.trim()) {
    throw new Error("Recursive Smart Collection scope requires a valid folder ID.");
  }
  return { mode: "descendants", folderId };
}

export function librarySmartCollectionQuery(value: unknown) {
  const normalized = normalizeClusterDataQuery((value || {}) as ClusterDataQuery, { fields: LIBRARY_DATA_FIELDS, defaultLimit: 250, maxLimit: 1000 });
  const folderScope = librarySmartCollectionFolderScope(value);
  return { ...normalized, ...(folderScope ? { folderScope } : {}) } as typeof normalized & { folderScope?: { mode: "descendants"; folderId: string } };
}

/** Traverse bounded folder branches; fail closed rather than broadening a too-large scope. */
export async function librarySmartCollectionDescendantFolders(
  rootId: string,
  loadChildren: (parentIds: string[], limit: number) => Promise<Array<{ id: string }>>,
  maxFolders = 5000,
): Promise<string[]> {
  const seen = new Set([rootId]);
  let frontier = [rootId];
  for (let depth = 0; frontier.length; depth++) {
    if (depth >= 64) throw new Error("Smart Collection folder scope is too deep.");
    const next: string[] = [];
    for (let start = 0; start < frontier.length; start += 100) {
      const children = await loadChildren(frontier.slice(start, start + 100), maxFolders - seen.size + 1);
      for (const child of children) {
        if (seen.has(child.id)) continue;
        seen.add(child.id);
        if (seen.size > maxFolders) throw new Error("Smart Collection folder scope exceeds the safe folder limit.");
        next.push(child.id);
      }
    }
    frontier = next;
  }
  return [...seen];
}

/** Relative time filters are evaluated when a collection is opened, not when saved. */
export function librarySmartCollectionRelativeDays(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^last-(1|7|30|365)-days$/.exec(value);
  return match ? Number(match[1]) : null;
}

export function librarySmartCollectionWhere(value: unknown, now = new Date()) {
  const query = librarySmartCollectionQuery(value);
  const adapters = createPrismaSemanticAdapters(LIBRARY_DATA_FIELDS, {
    mimeGroup: {
      condition: (condition) => {
        if (condition.operator !== "equals" || typeof condition.value !== "string") return null;
        const clause = libraryMimeFilter(condition.value);
        if (!clause) return null;
        return "OR" in clause ? clause : "extension" in clause ? clause : { mimeType: clause };
      },
    },
    updatedAt: {
      condition: (condition) => {
        const days = librarySmartCollectionRelativeDays(condition.value);
        if (days === null) return null;
        if (condition.operator !== "greater_or_equal") throw new Error("Relative Library dates must use greater_or_equal.");
        return { updatedAt: { gte: new Date(now.getTime() - days * 86_400_000) } };
      },
    },
    title: { prismaField: "title" },
    projectId: { prismaField: "projectId" },
    ownerId: { prismaField: "ownerId" },
    creatorId: { prismaField: "creatorId" },
    sizeBytes: { prismaField: "sizeBytes" },
  });
  const filters = compilePrismaDataFilterGroup(query.filters, adapters);
  const search = query.search
    ? { OR: [
        { title: { contains: query.search, mode: "insensitive" } },
        { originalName: { contains: query.search, mode: "insensitive" } },
        { tags: { contains: query.search, mode: "insensitive" } },
        { mimeType: { contains: query.search, mode: "insensitive" } },
      ] }
    : null;
  const terms = [{ lifecycleState: { not: "destroyed" } }, ...(filters ? [filters] : []), ...(search ? [search] : [])];
  return { query, where: terms.length === 1 ? terms[0] : { AND: terms } };
}

export function librarySmartCollectionOrderBy(value: unknown) {
  const query = librarySmartCollectionQuery(value);
  const sortable = new Set(["id", "title", "type", "projectId", "ownerId", "creatorId", "mimeType", "extension", "status", "reviewState", "lifecycleState", "classification", "integrityState", "source", "sizeBytes", "createdAt", "updatedAt", "manualOrder"]);
  const orderBy = (query.sorts || []).flatMap((sort) => sortable.has(sort.fieldId) ? [{ [sort.fieldId]: sort.direction }] : []);
  return orderBy.length ? orderBy : [{ updatedAt: "desc" as const }, { id: "desc" as const }];
}

export function libraryLockIsActive(lock: any, now = new Date()) {
  if (!lock || String(lock.state || "") !== "active") return false;
  if (!lock.expiresAt) return true;
  return new Date(lock.expiresAt).getTime() > now.getTime();
}

export function libraryLockConflict(lock: any, actorId: string, now = new Date()) {
  if (!libraryLockIsActive(lock, now)) return null;
  if (String(lock.ownerId) === String(actorId)) return null;
  return {
    code: "LIBRARY_LOCK_CONFLICT",
    ownerId: String(lock.ownerId),
    acquiredAt: lock.acquiredAt ? new Date(lock.acquiredAt).toISOString() : null,
    expiresAt: lock.expiresAt ? new Date(lock.expiresAt).toISOString() : null,
    sourceKind: lock.sourceKind || null,
    sourceRef: lock.sourceRef || null,
  };
}

export function derivativeCachePath(root: string, input: { itemId: string; sourceChecksumSha256: string; kind: string; extension: string }) {
  const safeKind = String(input.kind).replace(/[^a-z0-9_-]/gi, "-").slice(0, 80);
  const safeExt = String(input.extension).replace(/[^a-z0-9]/gi, "").slice(0, 16) || "bin";
  return path.join(root, "library-derivatives", input.itemId, input.sourceChecksumSha256.slice(0, 16), `${safeKind}.${safeExt}`);
}
