import { parseNavigationRoute, serializeNavigationRoute, type AppNavigationState } from "../../core/navigation";

export const MAX_WORKSPACE_FAVORITES = 24;

/** Store canonical route IDs, never cached names or resource payloads. Access
 * and resource placement are rechecked on every activation, just like Recent. */
export function canonicalWorkspaceFavorite(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 420) return null;
  const route = parseNavigationRoute(value);
  if (!route) return null;
  if (route.route === "project" && !route.context.projectId) return null;
  if (route.route === "board" && !route.context.boardId) return null;
  if (route.route === "whiteboard" && !route.context.whiteboardId) return null;
  return serializeNavigationRoute(route);
}

export function normalizeWorkspaceFavorites(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const routes: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const route = canonicalWorkspaceFavorite(item);
    if (!route || seen.has(route)) continue;
    seen.add(route);
    routes.push(route);
    if (routes.length >= MAX_WORKSPACE_FAVORITES) break;
  }
  return routes;
}

export function toggleWorkspaceFavorite(value: unknown, route: AppNavigationState): string[] {
  const normalized = serializeNavigationRoute(route);
  const previous = normalizeWorkspaceFavorites(value);
  return previous.includes(normalized)
    ? previous.filter((item) => item !== normalized)
    : normalizeWorkspaceFavorites([normalized, ...previous]);
}

/** Remove a saved route even after access was revoked. No authorized resource
 * reader or remembered private title is needed for user-owned list cleanup. */
export function removeWorkspaceFavorite(value: unknown, route: string): string[] {
  const target = canonicalWorkspaceFavorite(route);
  return normalizeWorkspaceFavorites(value).filter((saved) => saved !== target);
}

/** Reorder only canonical entries. Caller passes an existing route identifier,
 * not an array offset that could refer to a different account's list. */
export function moveWorkspaceFavorite(value: unknown, route: string, direction: -1 | 1): string[] {
  const entries = normalizeWorkspaceFavorites(value);
  const target = canonicalWorkspaceFavorite(route);
  if (!target || (direction !== -1 && direction !== 1)) return entries;
  const index = entries.indexOf(target);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= entries.length) return entries;
  [entries[index], entries[nextIndex]] = [entries[nextIndex], entries[index]];
  return entries;
}
