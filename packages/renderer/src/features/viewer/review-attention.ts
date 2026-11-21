/* Where a timed review needs attention: open notes on the timeline, toned by
   priority, with next/previous navigation. Shared by the video and audio
   viewers so both timelines read the same way. */

export type ReviewAttentionTone = "danger" | "warning" | "accent" | "muted";

export type ReviewAttentionComment = {
  id: string;
  body?: string | null;
  status?: string | null;
  priority?: string | null;
  category?: string | null;
  parentCommentId?: string | null;
};

export function isOpenReviewComment(comment: ReviewAttentionComment) {
  return !["resolved", "done", "closed", "wont_fix"].includes(String(comment.status || "open"));
}

export function reviewAttentionTone(comment: ReviewAttentionComment): ReviewAttentionTone {
  if (!isOpenReviewComment(comment)) return "muted";
  const priority = String(comment.priority || "medium");
  if (priority === "urgent" || priority === "high" || priority === "critical") return "danger";
  if (priority === "medium") return "warning";
  return "accent";
}

/** Top-level notes only; replies sit on their thread's marker. */
export function reviewThreadRoots<T extends ReviewAttentionComment>(comments: readonly T[]) {
  return comments.filter((comment) => !comment.parentCommentId);
}

/** The next (or previous) open note time relative to `current`, wrapping. */
export function nextReviewAttention(times: readonly number[], current: number, direction: 1 | -1) {
  const sorted = [...new Set(times)].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const epsilon = 0.05;
  if (direction > 0) return sorted.find((time) => time > current + epsilon) ?? sorted[0];
  return [...sorted].reverse().find((time) => time < current - epsilon) ?? sorted[sorted.length - 1];
}
