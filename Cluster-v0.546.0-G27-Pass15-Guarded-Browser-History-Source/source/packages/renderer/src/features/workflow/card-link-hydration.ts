import type { ClusterWorkNavigationTarget } from "./work-navigation-types";

/**
 * Browser links are not authenticated at URL parse time. Extract only the
 * bounded Card identity; the owning application must ask the Card API for
 * current authorized Board/project placement before activating any inspector.
 */
export function cardInspectorFromSearch(search: string): string | null {
  const inspect = new URLSearchParams(search).get("inspect") || "";
  if (!inspect.startsWith("card:")) return null;
  const id = inspect.slice("card:".length);
  return /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/.test(id) ? id : null;
}

export function pendingCardBrowserLink(input: {
  screen: string;
  search: string;
  projectId?: string | null;
  boardId?: string | null;
}): ClusterWorkNavigationTarget | null {
  if (input.screen !== "board") return null;
  const id = cardInspectorFromSearch(input.search);
  if (!id) return null;
  return {
    screen: "board",
    projectId: input.projectId || null,
    boardId: input.boardId || null,
    inspectScope: "card",
    inspectId: id,
  };
}
