import { useEffect, useMemo } from "react";

export type ClusterShortcutDefinition = {
  id: string;
  label: string;
  shortcut: string;
  group?: string;
  priority?: number;
  allowInEditable?: boolean;
  enabled?: boolean;
  handler: (event: KeyboardEvent) => void | Promise<void>;
};

export type ClusterShortcutConflict = { shortcut: string; ids: string[] };

export function normalizeClusterShortcut(shortcut?: string | null) {
  const raw = String(shortcut || "").trim().toLowerCase().replace(/\s+/g, "");
  if (!raw) return "";
  const parts = raw.split("+").filter(Boolean);
  const key = parts.at(-1) || "";
  const modifiers = new Set(parts.slice(0, -1).map((part) => part === "control" ? "ctrl" : part === "command" || part === "cmd" ? "meta" : part === "option" ? "alt" : part));
  const ordered = ["ctrl", "meta", "alt", "shift"].filter((part) => modifiers.has(part));
  return [...ordered, key].join("+");
}

export function clusterShortcutMatches(event: KeyboardEvent, shortcut?: string | null) {
  const normalized = normalizeClusterShortcut(shortcut);
  if (!normalized) return false;
  const parts = normalized.split("+");
  const key = parts.at(-1) || "";
  const ctrl = parts.includes("ctrl");
  const meta = parts.includes("meta");
  const alt = parts.includes("alt");
  const shift = parts.includes("shift");
  return event.ctrlKey === ctrl && event.metaKey === meta && event.altKey === alt && event.shiftKey === shift && event.key.toLowerCase() === key;
}

export function clusterShortcutConflicts(definitions: readonly ClusterShortcutDefinition[]): ClusterShortcutConflict[] {
  const byShortcut = new Map<string, string[]>();
  for (const definition of definitions) {
    if (definition.enabled === false) continue;
    const shortcut = normalizeClusterShortcut(definition.shortcut);
    if (!shortcut) continue;
    byShortcut.set(shortcut, [...(byShortcut.get(shortcut) || []), definition.id]);
  }
  return [...byShortcut.entries()].filter(([, ids]) => ids.length > 1).map(([shortcut, ids]) => ({ shortcut, ids }));
}

function editableTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  return Boolean(element && (element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.tagName === "SELECT" || element.isContentEditable));
}

export function useClusterShortcuts(definitions: readonly ClusterShortcutDefinition[]) {
  const conflicts = useMemo(() => clusterShortcutConflicts(definitions), [definitions]);
  useEffect(() => {
    const active = definitions.filter((definition) => definition.enabled !== false && normalizeClusterShortcut(definition.shortcut)).sort((left, right) => (right.priority || 0) - (left.priority || 0));
    if (conflicts.length && typeof console !== "undefined") console.warn("Cluster shortcut collision", conflicts);
    const onKeyDown = (event: KeyboardEvent) => {
      const editable = editableTarget(event.target);
      const matching = active.find((definition) => (!editable || definition.allowInEditable) && clusterShortcutMatches(event, definition.shortcut));
      if (!matching) return;
      event.preventDefault();
      void matching.handler(event);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [conflicts, definitions]);
  return conflicts;
}
