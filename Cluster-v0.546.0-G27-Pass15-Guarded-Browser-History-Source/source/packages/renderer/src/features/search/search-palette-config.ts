import { CLUSTER_REMOTE_SEARCH_SCOPE_IDS, CLUSTER_SEARCH_SCOPE_IDS, CLUSTER_SEARCH_SCOPE_MANIFEST } from "@cluster/shared";
import type { CommandSearchResultKind } from "../application/application-models";
import type { SearchScope } from "./search-ranking";

export const REMOTE_SEARCH_SCOPES = new Set<SearchScope>(CLUSTER_REMOTE_SEARCH_SCOPE_IDS);

export const SEARCH_SCOPE_OPTIONS: Array<{ value: SearchScope; label: string }> = CLUSTER_SEARCH_SCOPE_IDS
  .filter((scope) => CLUSTER_SEARCH_SCOPE_MANIFEST[scope].showInScopeRail)
  .map((scope) => ({ value: scope, label: CLUSTER_SEARCH_SCOPE_MANIFEST[scope].label }));

export function searchScopeMatches(scope: SearchScope, kind: CommandSearchResultKind | "action" | "page") {
  if (scope === "all") return true;
  const definition = CLUSTER_SEARCH_SCOPE_MANIFEST[scope];
  const expectedKind = "resultKind" in definition ? definition.resultKind : scope;
  return kind === expectedKind;
}
