import type { CommandSearchPayload, CommandSearchResult } from "../application/application-models";

/**
 * Search hits are permission-filtered snapshots, never reusable view grants.
 * Reopen by requerying the server, and only accept the same canonical location.
 * A missing hit (including a ranking-cap eviction) fails closed.
 */
export function freshSearchActivationMatch(
  selected: CommandSearchResult,
  response: CommandSearchPayload,
  expression: string,
  scope: string,
): CommandSearchResult | null {
  if (!response || response.meta?.query !== expression || response.meta?.scope !== scope || !Array.isArray(response.results)) return null;
  if (!selected || !selected.id || !selected.kind || !Array.isArray(response.results)) return null;
  const candidates = response.results.filter((entry) => entry?.kind === selected.kind && entry?.id === selected.id);
  if (candidates.length !== 1) return null;
  const current = candidates[0];
  const location = (entry: CommandSearchResult) => [
    entry.projectId || "", entry.boardId || "", entry.cardId || "", entry.whiteboardId || "",
    entry.projectTab || "", entry.resource?.kind || "", entry.resource?.id || "",
    entry.resource?.projectId || "",
  ];
  const originalLocation = location(selected);
  const currentLocation = location(current);
  if (originalLocation.some((value, index) => value !== currentLocation[index])) return null;
  // The caller must navigate from `current`, not the previously rendered hit.
  if (current.kind !== "activity" && (!current.resource?.id || !current.resource?.kind)) return null;
  return current;
}

/** Execute only after fresh authorization and a still-current UI/session context. */
export async function reauthorizeSearchActivation(input: {
  selected: CommandSearchResult;
  expression: string;
  scope: string;
  isCurrent: () => boolean;
  load: () => Promise<CommandSearchPayload>;
  navigate: (fresh: CommandSearchResult) => void | boolean | Promise<void | boolean>;
}): Promise<boolean> {
  if (!input.isCurrent()) return false;
  try {
    const response = await input.load();
    if (!input.isCurrent()) return false;
    const fresh = freshSearchActivationMatch(input.selected, response, input.expression, input.scope);
    if (!fresh) return false;
    return await input.navigate(fresh) !== false;
  } catch {
    return false;
  }
}
