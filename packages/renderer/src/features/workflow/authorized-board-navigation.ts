import type { ClusterWorkNavigationTarget } from "./work-navigation-types";

/** A direct Board link is a locator, not proof of current access or placement. */
export type AuthorizedBoardRead = { id?: string; projectId?: string | null } | null;

export async function resolveAuthorizedBoardNavigation(
  target: ClusterWorkNavigationTarget,
  input: { read: (boardId: string) => Promise<AuthorizedBoardRead>; isCurrent: () => boolean },
): Promise<ClusterWorkNavigationTarget | null> {
  if (!input.isCurrent() || target.screen !== "board" || target.inspectScope === "card") return null;
  const boardId = target.boardId;
  if (typeof boardId !== "string" || !boardId.trim() || boardId.length > 200) return null;
  try {
    const board = await input.read(boardId);
    if (!input.isCurrent() || !board || board.id !== boardId) return null;
    // Missing placement is not the same as a verified standalone Board.
    if (!Object.prototype.hasOwnProperty.call(board, "projectId")) return null;
    if (board.projectId != null && (typeof board.projectId !== "string" || !board.projectId.trim() || board.projectId.length > 200)) return null;
    return { ...target, projectId: board.projectId || null, boardId: board.id };
  } catch {
    return null;
  }
}
