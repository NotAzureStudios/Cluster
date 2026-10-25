import type { CommandSearchPayload, CommandSearchResult } from "../application/application-models";

/**
 * Search hits are permission-filtered snapshots, never reusable view grants.
 * Reopen by requerying the server, requiring the same canonical identity,
 * and using the fresh current location. A missing or duplicate hit fails closed.
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
  // Record identity is stable; placement is not. A fresh, permission-filtered
  // search may return the same Card/Board/record in a different Project or
  // tab. Always navigate from that *new* result, never the historical hit.
  // Activities have no guaranteed canonical resource to reauthorize, so keep
  // their original location fixed instead.
  if (current.kind === "activity") {
    if ((current.projectId || "") !== (selected.projectId || "")) return null;
  } else {
    if (!selected.resource?.kind || !selected.resource?.id || !current.resource?.kind || !current.resource?.id) return null;
    if (selected.resource.kind !== current.resource.kind || selected.resource.id !== current.resource.id) return null;
    // A Card result must still refer to that exact Card, even if its Board
    // and Project have changed since the user saw the first search response.
    if (current.kind === "card" && current.cardId && current.cardId !== current.id) return null;
  }
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
