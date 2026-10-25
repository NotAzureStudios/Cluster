import type { ClusterWorkNavigationTarget } from "./work-navigation-types";

/**
 * Card IDs do not embed their owning Board. Resolve the exact current Board
 * only from the server's per-Card authorized read before touching UI state.
 * A historical Board ID is a hint and may be stale after moving the Card.
 */
export type AuthorizedCardRead = {
  id?: string;
  list?: {
    board?: { id?: string; projectId?: string | null } | null;
  } | null;
} | null;

export async function resolveAuthorizedCardNavigation(
  target: ClusterWorkNavigationTarget,
  input: {
    read: (cardId: string) => Promise<AuthorizedCardRead>;
    isCurrent: () => boolean;
  },
): Promise<ClusterWorkNavigationTarget | null> {
  if (!input.isCurrent()) return null;
  if (target.screen !== "board" || target.inspectScope !== "card") return null;
  const cardId = target.inspectId;
  const isIdentifier = (value: unknown): value is string =>
    typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(value);
  if (!isIdentifier(cardId)) return null;
  try {
    const card = await input.read(cardId);
    if (!input.isCurrent() || !card || card.id !== cardId) return null;
    const board = card.list?.board;
    if (!isIdentifier(board?.id)) return null;
    if (board.projectId != null && !isIdentifier(board.projectId)) return null;
    return {
      ...target,
      boardId: board.id,
      projectId: board.projectId || null,
    };
  } catch {
    return null;
  }
}
