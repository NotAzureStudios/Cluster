import type {
  MediaProcessingPolicy,
  MediaProcessingWorker,
  ProjectMediaPayload,
  ReviewAsset,
  ReviewComment,
  VideoProductionRecord,
} from "../application/application-models";

function sortComments(comments: ReviewComment[]) {
  return [...comments].sort((a, b) => Number(a.locator.type === "media_time" ? a.locator.timeSeconds : 0) - Number(b.locator.type === "media_time" ? b.locator.timeSeconds : 0) || a.createdAt.localeCompare(b.createdAt));
}

function recomputeProductionSummary(media: ProjectMediaPayload): ProjectMediaPayload {
  const records = media.production?.records || [];
  const production = media.production || records.length
    ? {
        records,
        summary: { units: 0, reviewSessions: 0, deliverables: 0, openNotes: 0, pendingApprovals: 0 },
      }
    : undefined;
  const mediaProcessing = media.mediaProcessing;
  if (!production && !mediaProcessing) return media;

  let openNotes = 0;
  let pendingApprovals = 0;
  for (const video of media.reviewAssets) {
    if (!["approved", "superseded"].includes(video.approvalState || "pending")) pendingApprovals += 1;
    for (const comment of video.comments || []) if ((comment.status || "open") !== "resolved") openNotes += 1;
  }

  let units = 0;
  let reviewSessions = 0;
  let deliverables = 0;
  let queued = 0;
  let processing = 0;
  let failed = 0;
  let complete = 0;
  for (const record of records) {
    if (record.kind === "review_session") reviewSessions += 1;
    else if (record.kind === "deliverable") deliverables += 1;
    else if (record.kind === "media_job") {
      if (record.status === "queued") queued += 1;
      else if (["processing", "retrying"].includes(record.status)) processing += 1;
      else if (record.status === "failed") failed += 1;
      else if (record.status === "complete") complete += 1;
    } else units += 1;
  }

  const nextProduction = production ? {
    ...production,
    summary: { units, reviewSessions, deliverables, openNotes, pendingApprovals },
  } : undefined;
  const nextMediaProcessing = mediaProcessing ? {
    ...mediaProcessing,
    queue: { queued, processing, failed, complete },
  } : undefined;
  return { ...media, production: nextProduction, mediaProcessing: nextMediaProcessing };
}

export function upsertProjectVideoAsset(media: ProjectMediaPayload, asset: ReviewAsset) {
  const index = media.reviewAssets.findIndex((video) => video.id === asset.id);
  const videos = index >= 0
    ? media.reviewAssets.map((video, position) => position === index ? asset : video)
    : [asset, ...media.reviewAssets];
  return recomputeProductionSummary({ ...media, reviewAssets: videos });
}

export function removeProjectVideoAsset(media: ProjectMediaPayload, assetId: string) {
  return recomputeProductionSummary({ ...media, reviewAssets: media.reviewAssets.filter((video) => video.id !== assetId) });
}

export function upsertProjectVideoComment(media: ProjectMediaPayload, assetId: string, comment: ReviewComment) {
  const videos = media.reviewAssets.map((video) => {
    if (video.id !== assetId) return video;
    const existing = video.comments || [];
    const comments = existing.some((item) => item.id === comment.id)
      ? existing.map((item) => item.id === comment.id ? comment : item)
      : [...existing, comment];
    return { ...video, comments: sortComments(comments), updatedAt: comment.createdAt || video.updatedAt };
  });
  return recomputeProductionSummary({ ...media, reviewAssets: videos });
}

export function patchProjectVideoComment(media: ProjectMediaPayload, commentId: string, patch: Partial<ReviewComment>) {
  const videos = media.reviewAssets.map((video) => {
    if (!(video.comments || []).some((comment) => comment.id === commentId)) return video;
    return { ...video, comments: sortComments((video.comments || []).map((comment) => comment.id === commentId ? { ...comment, ...patch } : comment)) };
  });
  return recomputeProductionSummary({ ...media, reviewAssets: videos });
}

export function upsertProjectProductionRecord(media: ProjectMediaPayload, record: VideoProductionRecord, remove = false) {
  const existing = media.production?.records || [];
  const records = remove
    ? existing.filter((item) => item.id !== record.id)
    : existing.some((item) => item.id === record.id)
      ? existing.map((item) => item.id === record.id ? record : item)
      : [...existing, record];
  return recomputeProductionSummary({
    ...media,
    production: {
      records,
      summary: media.production?.summary || { units: 0, reviewSessions: 0, deliverables: 0, openNotes: 0, pendingApprovals: 0 },
    },
  });
}

export function patchProjectMediaWorker(media: ProjectMediaPayload, workerId: string, patch: Partial<MediaProcessingWorker>) {
  if (!media.mediaProcessing) return media;
  return {
    ...media,
    mediaProcessing: {
      ...media.mediaProcessing,
      workers: media.mediaProcessing.workers.map((worker) => worker.id === workerId ? { ...worker, ...patch } : worker),
    },
  };
}

export function upsertProjectMediaPolicy(media: ProjectMediaPayload, policy: MediaProcessingPolicy) {
  if (!media.mediaProcessing) return media;
  const policies = media.mediaProcessing.policies || [];
  const index = policies.findIndex((item) => item.medium === policy.medium && item.assetRole === policy.assetRole);
  return {
    ...media,
    mediaProcessing: {
      ...media.mediaProcessing,
      policies: index >= 0 ? policies.map((item, position) => position === index ? policy : item) : [...policies, policy],
    },
  };
}

export function patchProjectMediaJob(media: ProjectMediaPayload, recordId: string, status: string) {
  const record = media.production?.records.find((item) => item.id === recordId);
  if (!record) return media;
  return upsertProjectProductionRecord(media, { ...record, status, updatedAt: new Date().toISOString() });
}

export function patchProjectVideoProcessingState(media: ProjectMediaPayload, assetId: string, processingState: string) {
  const asset = media.reviewAssets.find((video) => video.id === assetId);
  if (!asset) return media;
  return upsertProjectVideoAsset(media, { ...asset, processingState, updatedAt: new Date().toISOString() });
}
