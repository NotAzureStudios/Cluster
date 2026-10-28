/** Explicit choices always override the responsive Auto preference on a persistent sidebar. */
export type SidebarPresentationMode = "auto" | "expanded" | "compact";
export function resolveSidebarCollapsed(mode: SidebarPresentationMode, persistentNavigation: boolean, compactNavigation: boolean): boolean {
  return persistentNavigation && (mode === "compact" || (mode === "auto" && compactNavigation));
}
/** One click must always invert the visible state, including after an Auto layout. */
export function nextSidebarMode(collapsed: boolean): SidebarPresentationMode {
  return collapsed ? "expanded" : "compact";
}
