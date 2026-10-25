export type MediaSummaryRecord = { kind?: string | null; status?: string | null };
export type MediaSummaryVideo = { approvalState?: string | null; comments?: Array<{ status?: string | null }> | null };

export function summarizeProjectMediaPayload(records: readonly MediaSummaryRecord[], videos: readonly MediaSummaryVideo[]) {
  const production = { units: 0, reviewSessions: 0, deliverables: 0, openNotes: 0, pendingApprovals: 0 };
  const queue = { queued: 0, processing: 0, failed: 0, complete: 0 };

  for (const record of records) {
    const kind = String(record.kind || "");
    const status = String(record.status || "");
    if (kind === "review_session") production.reviewSessions += 1;
    else if (kind === "deliverable") production.deliverables += 1;
    else if (kind === "media_job") {
      if (status === "queued") queue.queued += 1;
      else if (status === "processing" || status === "retrying") queue.processing += 1;
      else if (status === "failed") queue.failed += 1;
      else if (status === "complete") queue.complete += 1;
    } else production.units += 1;
  }

  for (const video of videos) {
    if (!["approved", "superseded"].includes(String(video.approvalState || "pending"))) production.pendingApprovals += 1;
    for (const comment of video.comments || []) if (comment.status !== "resolved") production.openNotes += 1;
  }

  return { production, queue };
}
