import { libraryMimeGroup, libraryPreviewKind, parseLibraryMetadata } from "../../core/library.js";
import { libraryGovernanceView } from "./library-governance.js";

export function parseYouTubeLink(value: string | null | undefined) {
  if (!value) return { videoId: null as string | null, playlistId: null as string | null };
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    let videoId: string | null = null;
    let playlistId: string | null = url.searchParams.get("list");
    if (host === "youtu.be") videoId = url.pathname.split("/").filter(Boolean)[0] || null;
    else if (host.endsWith("youtube.com")) {
      if (url.pathname === "/watch") videoId = url.searchParams.get("v");
      else if (url.pathname.startsWith("/shorts/") || url.pathname.startsWith("/embed/")) videoId = url.pathname.split("/").filter(Boolean)[1] || null;
      else if (url.pathname === "/playlist") playlistId = url.searchParams.get("list");
    }
    const clean = (id: string | null) => id && /^[A-Za-z0-9_-]{6,80}$/.test(id) ? id : null;
    return { videoId: clean(videoId), playlistId: clean(playlistId) };
  } catch {
    return { videoId: null as string | null, playlistId: null as string | null };
  }
}

export function parseModelBundle(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, 128).flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const candidate = entry as Record<string, unknown>;
      const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
      const name = typeof candidate.name === "string" ? candidate.name.trim().slice(0, 500) : "";
      if (!id || !name) return [];
      const extension = typeof candidate.extension === "string" ? candidate.extension.trim().slice(0, 24) : null;
      const mimeType = typeof candidate.mimeType === "string" ? candidate.mimeType.trim().slice(0, 200) : null;
      return [{ id, name, extension, mimeType, fileUrl: `/api/library/${id}/file` }];
    });
  } catch {
    return [];
  }
}

export function parseJsonArray(value?: string | null) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function createLibraryItemSerializer(serializeUserLite: (user: any) => any) {
  return function serializeLibraryItem(item: any, detail = false) {
    const previewKind = libraryPreviewKind(item);
    const parsedMetadata = parseLibraryMetadata(item.metadata);
    const modelBundle = previewKind === "model" ? parseModelBundle(parsedMetadata.modelBundle) : [];
    const youtube = parseYouTubeLink(item.externalUrl);
    const youtubeId = typeof parsedMetadata.youtubeId === "string" ? parsedMetadata.youtubeId : youtube.videoId;
    const youtubePlaylistId = typeof parsedMetadata.youtubePlaylistId === "string" ? parsedMetadata.youtubePlaylistId : youtube.playlistId;
    const base = {
      id: item.id,
      projectId: item.projectId,
      ownerId: item.ownerId,
      reviewerId: item.reviewerId,
      parentId: item.parentId,
      creatorId: item.creatorId || null,
      uploaderId: item.uploaderId || null,
      lastEditorId: item.lastEditorId || null,
      generatedForUserId: item.generatedForUserId || null,
      title: item.title,
      type: item.type,
      status: item.status,
      priority: item.priority,
      tags: parseJsonArray(item.tags),
      externalUrl: item.externalUrl,
      pinned: Boolean(item.pinned),
      versionLabel: item.versionLabel,
      reviewDueAt: item.reviewDueAt,
      approvedAt: item.approvedAt,
      visibility: item.visibility,
      classification: item.classification,
      lifecycleState: item.lifecycleState,
      retentionPolicyKey: item.retentionPolicyKey || null,
      retentionUntil: item.retentionUntil || null,
      legalHold: Boolean(item.legalHold),
      deletedAt: item.deletedAt || null,
      deletedById: item.deletedById || null,
      integrityState: item.integrityState || (item.checksumSha256 ? "verified" : "unverified"),
      integrityCheckedAt: item.integrityCheckedAt || null,
      originKind: item.originKind,
      originRef: item.originRef || null,
      generatedByKind: item.generatedByKind || null,
      generatedById: item.generatedById || null,
      lifecycleNotes: item.lifecycleNotes,
      fileName: item.fileName,
      originalName: item.originalName,
      mimeType: item.mimeType,
      mimeGroup: libraryMimeGroup(item.mimeType, item.extension),
      sizeBytes: item.sizeBytes,
      checksumSha256: item.checksumSha256,
      extension: item.extension,
      source: item.source,
      revision: item.revision,
      fileModifiedAt: item.fileModifiedAt,
      manualOrder: item.manualOrder ?? null,
      previewKind,
      hasFile: Boolean(item.fileName),
      fileUrl: item.fileName ? `/api/library/${item.id}/file` : null,
      modelPreviewUrl: item.fileName && String(item.extension || "").toLowerCase() === "blend" ? `/api/library/${item.id}/model-preview` : null,
      modelThumbnailUrl: previewKind === "model" ? `/api/library/${item.id}/model-thumbnail` : null,
      downloadUrl: item.fileName ? `/api/library/${item.id}/file?download=1` : null,
      snippet: String(item.body || item.previewText || "").trim().slice(0, 280),
      childCount: Number(item._count?.children || 0),
      versionCount: Number(item._count?.versions || 0),
      backlinkCount: Number(item._count?.backlinks || 0),
      favoriteCount: Number(item._count?.favorites || 0),
      permissionCount: Array.isArray(item.folderPermissions) ? item.folderPermissions.length : 0,
      folderColor: item.type === "folder" && typeof parsedMetadata.folderColor === "string" ? parsedMetadata.folderColor : null,
      folderIcon: item.type === "folder" && typeof parsedMetadata.folderIcon === "string" ? parsedMetadata.folderIcon : null,
      modelBundle,
      youtubeId,
      youtubePlaylistId,
      youtubeThumbnailUrl: youtubeId ? `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg` : null,
      youtubeEmbedUrl: item.type === "youtube-playlist" && youtubePlaylistId
        ? `https://www.youtube-nocookie.com/embed/videoseries?list=${youtubePlaylistId}`
        : youtubeId ? `https://www.youtube-nocookie.com/embed/${youtubeId}` : null,
      project: item.project ? { id: item.project.id, name: item.project.name, description: item.project.description } : null,
      owner: item.owner ? serializeUserLite(item.owner) : null,
      reviewer: item.reviewer ? serializeUserLite(item.reviewer) : null,
      parent: item.parent || null,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    };
    if (!detail) return base;
    return {
      ...base,
      body: item.body,
      previewText: item.previewText,
      metadata: parsedMetadata,
      governance: libraryGovernanceView(item),
      changelog: parseJsonArray(item.changelog)
    };
  };
}
