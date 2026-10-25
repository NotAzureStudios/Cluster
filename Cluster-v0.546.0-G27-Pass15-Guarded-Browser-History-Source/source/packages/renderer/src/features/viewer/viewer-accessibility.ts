import { readAccessibilitySystemPreferences } from "../../core/accessibility-preferences";
import type { ViewerCommandContext, ViewerCommandDefinition } from "./viewer-contracts";
import type { ViewerCommandRegistry } from "./viewer-command-registry";

export type ViewerAccessibilitySnapshot = {
  reducedMotion: boolean;
  highContrast: boolean;
  reducedTransparency: boolean;
  inputModality: "keyboard" | "pointer" | "unknown";
  textScale: string;
  statusPalette: string;
};

export function viewerAccessibilitySnapshot(): ViewerAccessibilitySnapshot {
  const system = readAccessibilitySystemPreferences();
  const root = typeof document !== "undefined" ? document.documentElement : null;
  return {
    reducedMotion: root?.dataset.motion === "reduced" || root?.dataset.motion === "none" || system.reducedMotion,
    highContrast: root?.dataset.highContrast === "true" || system.highContrast,
    reducedTransparency: root?.dataset.reduceTransparency === "true" || system.reducedTransparency,
    inputModality: root?.dataset.inputModality === "keyboard" ? "keyboard" : root?.dataset.inputModality === "pointer" ? "pointer" : "unknown",
    textScale: root?.dataset.textScale || "default",
    statusPalette: root?.dataset.statusPalette || "default",
  };
}

export function viewerShortcutText(shortcut: string) {
  return shortcut.split("+").map((part) => {
    const key = part.trim().toLowerCase();
    if (key === "ctrl") return "Control";
    if (key === "alt") return "Alt";
    if (key === "shift") return "Shift";
    if (key === "meta") return "Meta";
    if (key === "space") return "Space";
    if (key === "arrowleft") return "ArrowLeft";
    if (key === "arrowright") return "ArrowRight";
    if (key === "arrowup") return "ArrowUp";
    if (key === "arrowdown") return "ArrowDown";
    if (key === "escape") return "Escape";
    return part.length === 1 ? part.toUpperCase() : part;
  }).join("+");
}

export function viewerAriaKeyShortcuts(registry: ViewerCommandRegistry, context: ViewerCommandContext) {
  return [...new Set(registry.list(context).flatMap((command) => command.shortcut ? [viewerShortcutText(command.shortcut)] : []))].join(" ");
}

export function viewerShortcutCommands(registry: ViewerCommandRegistry, context: ViewerCommandContext): ViewerCommandDefinition[] {
  return registry.list(context).filter((command) => Boolean(command.shortcut));
}
