import type { ProjectWorkspaceTabId } from "./project-workspace-registry";

/** Project tabs live in a shared SPA URL. Bind the tab to a Project ID so a
 * different project never inherits the previous project's section. */
export const PROJECT_TAB_QUERY_KEY = "projectTab";
export const PROJECT_TAB_OWNER_QUERY_KEY = "projectTabProject";

export function projectTabFromUrl(
  url: string | null | undefined,
  projectId: string | null | undefined,
  allowed: ReadonlySet<ProjectWorkspaceTabId>,
): ProjectWorkspaceTabId | null {
  if (!url || !projectId) return null;
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.searchParams.get(PROJECT_TAB_OWNER_QUERY_KEY) !== projectId) return null;
  const raw = parsed.searchParams.get(PROJECT_TAB_QUERY_KEY);
  return raw && allowed.has(raw as ProjectWorkspaceTabId) ? raw as ProjectWorkspaceTabId : null;
}

export function projectTabForWorkspace(
  url: string | null | undefined,
  projectId: string | null | undefined,
  lastTab: unknown,
  allowed: ReadonlySet<ProjectWorkspaceTabId>,
): ProjectWorkspaceTabId {
  const linked = projectTabFromUrl(url, projectId, allowed);
  if (linked) return linked;
  return typeof lastTab === "string" && allowed.has(lastTab as ProjectWorkspaceTabId)
    ? lastTab as ProjectWorkspaceTabId
    : "overview";
}

export function projectTabLocation(
  url: string,
  projectId: string,
  tab: ProjectWorkspaceTabId,
): string {
  const parsed = new URL(url);
  parsed.searchParams.set(PROJECT_TAB_QUERY_KEY, tab);
  parsed.searchParams.set(PROJECT_TAB_OWNER_QUERY_KEY, projectId);
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

/** Avoid a history entry for a URL already pointing at this exact tab/project. */
export function needsProjectTabLocation(
  url: string,
  projectId: string,
  tab: ProjectWorkspaceTabId,
  allowed: ReadonlySet<ProjectWorkspaceTabId>,
): boolean {
  return projectTabFromUrl(url, projectId, allowed) !== tab;
}
