/** Bounded stable thread pagination. The cursor only describes ordering, never grants access. */
export type CommentPagePosition = { at: Date; id: string; pinned?: boolean };
export type CommentPageMode = "roots" | "replies";

export function decodeCommentCursor(raw: unknown, mode: CommentPageMode): CommentPagePosition | null {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string" || raw.length > 512 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error("COMMENT_CURSOR_INVALID");
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (parsed?.v !== 1 || parsed?.mode !== mode || typeof parsed?.id !== "string" || !parsed.id || parsed.id.length > 200) throw new Error("bad cursor");
    if (mode === "roots" && typeof parsed.pinned !== "boolean") throw new Error("bad pinned cursor");
    const at = new Date(parsed.at);
    if (typeof parsed.at !== "string" || !Number.isFinite(at.getTime()) || at.toISOString() !== parsed.at) throw new Error("bad timestamp");
    return { at, id: parsed.id, ...(mode === "roots" ? { pinned: parsed.pinned } : {}) };
  } catch { throw new Error("COMMENT_CURSOR_INVALID"); }
}
export function encodeCommentCursor(row: { createdAt: Date | string; id: string; pinned?: boolean }, mode: CommentPageMode): string {
  const at = new Date(row.createdAt).toISOString();
  return Buffer.from(JSON.stringify({ v: 1, mode, at, id: row.id, ...(mode === "roots" ? { pinned: Boolean(row.pinned) } : {}) }), "utf8").toString("base64url");
}
export function commentCursorWhere(cursor: CommentPagePosition | null, mode: CommentPageMode) {
  if (!cursor) return {};
  const chronological = { OR: [
    { createdAt: { [mode === "roots" ? "lt" : "gt"]: cursor.at } },
    { createdAt: cursor.at, id: { [mode === "roots" ? "lt" : "gt"]: cursor.id } },
  ] };
  if (mode === "replies") return chronological;
  return cursor.pinned
    ? { OR: [{ pinned: false }, { pinned: true, ...chronological }] }
    : { pinned: false, ...chronological };
}
export function commentPage<T extends { id: string; createdAt: Date | string; pinned?: boolean }>(rows: T[], limit: number, mode: CommentPageMode) {
  const items = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  return { items, hasMore, nextCursor: hasMore && items.length ? encodeCommentCursor(items[items.length - 1], mode) : null };
}
