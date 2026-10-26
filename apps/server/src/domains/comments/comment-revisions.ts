/** Canonical optimistic concurrency primitives for shared EntityComment records. */
export type CommentWriteStore = {
  entityComment: {
    updateMany: (args: { where: { id: string; revision: number }; data: Record<string, unknown> }) => Promise<{ count: number }>;
    deleteMany: (args: { where: { id: string; revision: number } }) => Promise<{ count: number }>;
  };
};

export async function updateCommentAtRevision(store: CommentWriteStore, id: string, expectedRevision: number, data: Record<string, unknown>) {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) return false;
  const changed = await store.entityComment.updateMany({
    where: { id, revision: expectedRevision },
    data: { ...data, revision: { increment: 1 } },
  });
  return changed.count === 1;
}

export async function deleteCommentAtRevision(store: CommentWriteStore, id: string, expectedRevision: number) {
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) return false;
  const deleted = await store.entityComment.deleteMany({ where: { id, revision: expectedRevision } });
  return deleted.count === 1;
}

export function nextCommentReactions(previous: Record<string, string[]>, reaction: string, userId: string, active: boolean): Record<string, string[]> {
  if (!reaction || ["__proto__", "prototype", "constructor"].includes(reaction)) throw new Error("Invalid reaction key");
  // Null-prototype dictionaries prevent inherited keys from becoming a user list.
  const next: Record<string, string[]> = Object.assign(Object.create(null), previous);
  const users = new Set(Array.isArray(next[reaction]) ? next[reaction].map(String) : []);
  if (active) users.add(userId); else users.delete(userId);
  if (users.size) next[reaction] = [...users].sort(); else delete next[reaction];
  return next;
}
