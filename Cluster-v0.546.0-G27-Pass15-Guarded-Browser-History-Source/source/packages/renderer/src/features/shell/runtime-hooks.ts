import { useEffect, useMemo, type RefObject } from "react";
import { api } from "../../core/api";
import { recordPerformanceMetric } from "../../core/performance";
import { useVisibleRefresh } from "../../core/visible-refresh";
import { useClusterShortcuts, type ClusterShortcutDefinition } from "../../components/cluster-shortcuts";

const SCROLL_STORAGE_PREFIX = "cluster-route-scroll:";

export function useUserHeartbeat(userId?: string | null) {
  const sendHeartbeat = () => userId
    ? api("/api/me/heartbeat", { method: "POST" }).catch(() => undefined)
    : undefined;
  useEffect(() => { if (userId) void sendHeartbeat(); }, [userId]);
  useVisibleRefresh(sendHeartbeat, { enabled: Boolean(userId), intervalMs: 5 * 60 * 1000, requireOnline: true });
}

export function useRouteScrollRestoration(
  containerRef: RefObject<HTMLElement | null>,
  routeKey: string,
) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const storageKey = `${SCROLL_STORAGE_PREFIX}${routeKey}`;
    const stored = Number(window.sessionStorage.getItem(storageKey) || "0");
    const frame = window.requestAnimationFrame(() => {
      container.focus({ preventScroll: true });
      container.scrollTo({ top: Number.isFinite(stored) ? stored : 0, behavior: "auto" });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.sessionStorage.setItem(storageKey, String(container.scrollTop));
    };
  }, [containerRef, routeKey]);
}


export function useRoutePerformance(routeKey: string) {
  useEffect(() => {
    const startedAt = performance.now();
    let secondFrame = 0;
    const markName = `cluster-route-start:${routeKey}`;
    performance.mark(markName);
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const durationMs = performance.now() - startedAt;
        recordPerformanceMetric({
          name: `route ${routeKey}`,
          category: "navigation",
          durationMs,
          startedAt: Date.now() - durationMs,
          detail: { route: routeKey },
        });
        performance.clearMarks(markName);
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      if (secondFrame) window.cancelAnimationFrame(secondFrame);
      performance.clearMarks(markName);
    };
  }, [routeKey]);
}

export function useShellKeyboardShortcuts(input: {
  commandHotkey?: string;
  toggleCommand: () => void;
  closeCommand: () => void;
  closeSidebar: () => void;
  openShortcutHelp?: () => void;
  openPinnedTool?: (index: number) => void;
}) {
  const definitions = useMemo<ClusterShortcutDefinition[]>(() => {
    const shortcuts: ClusterShortcutDefinition[] = [
      { id: "shell.command-palette", label: "Open Search / Commands", shortcut: input.commandHotkey || "Ctrl+K", group: "Navigation", priority: 100, allowInEditable: true, handler: () => input.toggleCommand() },
      { id: "shell.shortcut-help", label: "Show keyboard shortcuts", shortcut: "Ctrl+/", group: "Navigation", priority: 90, handler: () => input.openShortcutHelp?.() },
      { id: "shell.escape", label: "Close the active command surface or sidebar", shortcut: "Escape", group: "Navigation", priority: 200, allowInEditable: true, handler: () => { input.closeCommand(); input.closeSidebar(); } },
    ];
    for (let index = 0; index < 9; index += 1) shortcuts.push({ id: `shell.pinned-tool-${index + 1}`, label: `Open pinned tool ${index + 1}`, shortcut: `Alt+${index + 1}`, group: "Navigation", priority: 50, handler: () => input.openPinnedTool?.(index) });
    return shortcuts;
  }, [input.commandHotkey, input.toggleCommand, input.closeCommand, input.closeSidebar, input.openShortcutHelp, input.openPinnedTool]);
  const conflicts = useClusterShortcuts(definitions);
  return { definitions, conflicts };
}
