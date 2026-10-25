import type { ReviewLocator, ReviewPortableAsset, ReviewPortableComment, ReviewPortableReportV1, ReviewPortableUser } from "@cluster/shared";

function parseObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string").slice(0, 64);
  try {
    const parsed = JSON.parse(String(value || "[]"));
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string").slice(0, 64) : [];
  } catch { return []; }
}

function iso(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function user(value: any): ReviewPortableUser | null {
  if (!value?.id) return null;
  return {
    id: String(value.id),
    username: value.username ? String(value.username) : undefined,
    displayName: value.displayName ? String(value.displayName) : undefined,
  };
}

function locator(value: unknown): ReviewLocator {
  const parsed = parseObject(value);
  return parsed as ReviewLocator;
}

function portableComment(comment: any): ReviewPortableComment {
  return {
    id: String(comment.id),
    assetId: String(comment.reviewAssetId),
    parentCommentId: comment.parentCommentId ? String(comment.parentCommentId) : null,
    threadRootId: comment.threadRootId ? String(comment.threadRootId) : null,
    author: user(comment.user),
    mentionedUserIds: parseStringArray(comment.mentionedUserIds),
    assigneeId: comment.assigneeId ? String(comment.assigneeId) : null,
    status: String(comment.status || "open"),
    category: String(comment.category || "edit"),
    priority: String(comment.priority || "medium"),
    body: String(comment.body || ""),
    locator: locator(comment.locator),
    createdAt: iso(comment.createdAt) || new Date(0).toISOString(),
    updatedAt: iso(comment.updatedAt),
    resolvedAt: iso(comment.resolvedAt),
    resolvedById: comment.resolvedById ? String(comment.resolvedById) : null,
  };
}

function portableAsset(asset: any): ReviewPortableAsset {
  return {
    id: String(asset.id),
    projectId: String(asset.projectId),
    medium: asset.medium,
    title: String(asset.title || asset.originalName || "Review asset"),
    originalName: String(asset.originalName || asset.title || "asset"),
    versionGroupId: String(asset.versionGroupId || asset.id),
    versionNumber: Number(asset.versionNumber || 1),
    versionLabel: asset.versionLabel ? String(asset.versionLabel) : null,
    reviewRound: asset.reviewRound ? String(asset.reviewRound) : null,
    status: String(asset.status || "review"),
    approvalState: String(asset.approvalState || "pending"),
    uploadedBy: user(asset.uploadedBy),
    reviewer: user(asset.reviewer),
    approvedBy: user(asset.approvedBy),
    checksumSha256: asset.checksumSha256 ? String(asset.checksumSha256) : null,
    createdAt: iso(asset.createdAt) || iso(asset.uploadedAt) || new Date(0).toISOString(),
    updatedAt: iso(asset.updatedAt),
    uploadedAt: iso(asset.uploadedAt) || new Date(0).toISOString(),
    versionUploadedAt: iso(asset.versionUploadedAt) || iso(asset.uploadedAt) || new Date(0).toISOString(),
    approvedAt: iso(asset.approvedAt),
    preview: { mimeType: String(asset.mimeType || "application/octet-stream"), sizeBytes: Math.max(0, Number(asset.sizeBytes || 0)), width: asset.width == null ? null : Number(asset.width), height: asset.height == null ? null : Number(asset.height), durationSeconds: asset.durationSeconds == null ? null : Number(asset.durationSeconds) },
    comments: (asset.comments || []).map(portableComment),
  };
}

export function buildReviewPortableReport(input: { assets: any[]; anchor: any; scope: "asset" | "family"; generatedAt?: Date }): ReviewPortableReportV1 {
  const assets = input.assets.map(portableAsset).sort((a, b) => a.versionNumber - b.versionNumber || a.uploadedAt.localeCompare(b.uploadedAt));
  const comments = assets.flatMap((asset) => asset.comments);
  return {
    schema: "cluster.review-report",
    version: 1,
    generatedAt: (input.generatedAt || new Date()).toISOString(),
    projectId: String(input.anchor.projectId),
    versionFamilyId: String(input.anchor.versionGroupId || input.anchor.id),
    scope: input.scope,
    summary: {
      assets: assets.length,
      comments: comments.length,
      unresolved: comments.filter((comment) => comment.status !== "resolved").length,
      resolved: comments.filter((comment) => comment.status === "resolved").length,
      approvals: assets.filter((asset) => asset.approvalState === "approved").length,
    },
    assets,
  };
}

function locatorLabel(locator: ReviewLocator) {
  if (!locator || typeof locator !== "object") return "Unlocated";
  switch (locator.type) {
    case "media_time": return `${Number(locator.timeSeconds || 0).toFixed(3)}s${locator.frameNumber != null ? ` · frame ${locator.frameNumber}` : ""}`;
    case "audio_region": return `${Number(locator.timeSeconds || 0).toFixed(3)}s${locator.endTimeSeconds != null ? `–${Number(locator.endTimeSeconds).toFixed(3)}s` : ""}`;
    case "image_region": return locator.region ? `image region ${Math.round(locator.region.x * 100)}%, ${Math.round(locator.region.y * 100)}%` : "image point";
    case "pdf_region": return `page ${locator.page}`;
    case "spatial": return `${locator.objectId || locator.meshId || "3D point"} @ ${locator.worldPosition.map((entry) => Number(entry).toFixed(3)).join(", ")}`;
    default: return "Located note";
  }
}

export function renderReviewPortableReportText(report: ReviewPortableReportV1) {
  const lines: string[] = [
    "Cluster Review Report",
    `Generated: ${report.generatedAt}`,
    `Project: ${report.projectId}`,
    `Version family: ${report.versionFamilyId}`,
    `Scope: ${report.scope}`,
    `Assets: ${report.summary.assets} · Notes: ${report.summary.comments} · Open: ${report.summary.unresolved} · Resolved: ${report.summary.resolved} · Approved versions: ${report.summary.approvals}`,
    "",
  ];
  for (const asset of report.assets) {
    lines.push(`${asset.title} · ${asset.versionLabel || `v${asset.versionNumber}`} · ${asset.medium} · ${asset.status} · ${asset.approvalState}`);
    const uploader = asset.uploadedBy?.displayName || asset.uploadedBy?.username || asset.uploadedBy?.id || "Unknown user";
    const reviewer = asset.reviewer?.displayName || asset.reviewer?.username || asset.reviewer?.id || "Unassigned";
    const approver = asset.approvedBy?.displayName || asset.approvedBy?.username || asset.approvedBy?.id || "—";
    lines.push(`Uploaded: ${asset.versionUploadedAt} by ${uploader} · Reviewer: ${reviewer} · Approver: ${approver}`);
    lines.push(`Preview: ${asset.preview.mimeType} · ${asset.preview.sizeBytes} bytes${asset.preview.width && asset.preview.height ? ` · ${asset.preview.width}×${asset.preview.height}` : ""}${asset.preview.durationSeconds != null ? ` · ${asset.preview.durationSeconds.toFixed(3)}s` : ""}`);
    if (!asset.comments.length) lines.push("  No review notes.");
    for (const comment of asset.comments) {
      const author = comment.author?.displayName || comment.author?.username || comment.author?.id || "Unknown user";
      const thread = comment.parentCommentId ? "reply" : "note";
      lines.push(`  [${comment.status}] ${thread} ${comment.id} · ${locatorLabel(comment.locator)} · ${author} · ${comment.createdAt}`);
      lines.push(`    ${comment.body.replace(/\s+/g, " ").trim()}`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}
