export type CursorPosition = {
  at: Date;
  id: string;
};

export type CursorPage<T> = {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
};

export function encodeCursor(position: { at: Date | string; id: string }) {
  const at = position.at instanceof Date ? position.at : new Date(position.at);
  if (!Number.isFinite(at.getTime())) throw new Error("Cannot encode an invalid cursor timestamp.");
  return Buffer.from(JSON.stringify({ v: 1, at: at.toISOString(), id: String(position.id) }), "utf8").toString("base64url");
}

export function decodeCursor(value?: string | null): CursorPosition | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    if (Number(parsed?.v) !== 1) return null;
    const at = new Date(String(parsed?.at || ""));
    const id = String(parsed?.id || "");
    if (!Number.isFinite(at.getTime()) || !id) return null;
    return { at, id };
  } catch {
    return null;
  }
}

export function cursorWhere(
  cursor: CursorPosition | null,
  field: string,
  direction: "asc" | "desc" = "desc",
) {
  if (!cursor) return undefined;
  const comparison = direction === "desc" ? "lt" : "gt";
  return {
    OR: [
      { [field]: { [comparison]: cursor.at } },
      { AND: [{ [field]: cursor.at }, { id: { [comparison]: cursor.id } }] },
    ],
  };
}

export function buildCursorPage<T extends Record<string, any>>(
  records: T[],
  limit: number,
  field: string,
): CursorPage<T> {
  const hasMore = records.length > limit;
  const items = hasMore ? records.slice(0, limit) : records;
  const last = items.at(-1);
  return {
    items,
    hasMore,
    nextCursor: hasMore && last ? encodeCursor({ at: last[field], id: String(last.id) }) : null,
  };
}
