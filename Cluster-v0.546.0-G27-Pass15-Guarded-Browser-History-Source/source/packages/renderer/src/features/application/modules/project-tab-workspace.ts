import { CLUSTER_WORK_PROJECT_TAB_QUERY_KEY } from "../../workflow/work-navigation";


export function nextOpenProjectTabs(current: string[], projectId: string, pinnedIds: string[], maxTabs: number) {
  const next = [...current.filter((id) => id !== projectId), projectId];
  if (next.length <= maxTabs) return next;
  const pinned = new Set(pinnedIds);
  const removableIndex = next.findIndex((id) => id !== projectId && !pinned.has(id));
  if (removableIndex >= 0) next.splice(removableIndex, 1);
  return next.slice(-maxTabs);
}

export function clearProjectSwitchRouteContext() {
  const url = new URL(window.location.href);
  url.searchParams.delete(CLUSTER_WORK_PROJECT_TAB_QUERY_KEY);
  url.searchParams.delete("inspect");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

const INSPECT_SCOPES_BY_SCREEN: Readonly<Record<string, ReadonlySet<string>>> = Object.freeze({
  people: new Set(["person"]),
  project: new Set(["build-artifact", "release", "qa-plan", "qa-session", "project-control", "project-asset", "review-asset"]),
  board: new Set(["card"]),
  tickets: new Set(["ticket"]),
  timeline: new Set(["timeline-item"]),
  calendar: new Set(["calendar-event", "meeting"]),
  scheduler: new Set(["schedule-block"]),
  library: new Set(["library-item"]),
  sourceControl: new Set(["source-repository", "source-commit"]),
  // These inspector identities belong to their own settings surfaces. A
  // cross-workspace navigation must not discard a target before it mounts.
  settings: new Set(["studio-form", "form-submission"]),
  studioSettings: new Set(["studio-form", "form-submission", "studio-application", "studio-announcement", "studio-announcement-new", "studio-announcement-list"]),
});

export function clearIncompatibleRouteContext(nextScreen: string) {
  const url = new URL(window.location.href);
  const rawInspect = String(url.searchParams.get("inspect") || "");
  const separator = rawInspect.indexOf(":");
  const scope = separator > 0 ? rawInspect.slice(0, separator) : "";
  if (rawInspect && !INSPECT_SCOPES_BY_SCREEN[nextScreen]?.has(scope)) url.searchParams.delete("inspect");
  if (nextScreen !== "project") url.searchParams.delete(CLUSTER_WORK_PROJECT_TAB_QUERY_KEY);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}
