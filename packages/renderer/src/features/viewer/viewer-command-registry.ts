import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import type { ViewerCommandConflict, ViewerCommandContext, ViewerCommandDefinition } from "./viewer-contracts";

function normalizedShortcut(value: string) {
  return value
    .split("+")
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean)
    .map((part) => part === "control" ? "ctrl" : part === "option" ? "alt" : part === "command" ? "meta" : part)
    .sort((a, b) => {
      const order = ["ctrl", "alt", "shift", "meta"];
      const ai = order.indexOf(a);
      const bi = order.indexOf(b);
      if (ai >= 0 || bi >= 0) return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
      return a.localeCompare(b);
    })
    .join("+");
}

function eventShortcut(event: KeyboardEvent | ReactKeyboardEvent) {
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("ctrl");
  if (event.altKey) parts.push("alt");
  if (event.shiftKey) parts.push("shift");
  if (event.metaKey) parts.push("meta");
  const raw = String(event.key || "").toLowerCase();
  const key = raw === " " ? "space" : raw === "esc" ? "escape" : raw;
  if (!["control", "ctrl", "alt", "shift", "meta"].includes(key)) parts.push(key);
  return normalizedShortcut(parts.join("+"));
}

function editableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || Boolean(target.closest("[contenteditable='true']"));
}

function commandVisible(command: ViewerCommandDefinition, context: ViewerCommandContext) {
  if (command.requiredCapability && !context.capabilities[command.requiredCapability]) return false;
  return command.visible ? command.visible(context) : true;
}

function commandEnabled(command: ViewerCommandDefinition, context: ViewerCommandContext) {
  return commandVisible(command, context) && (command.enabled ? command.enabled(context) : true);
}

export class ViewerCommandRegistry {
  private commands = new Map<string, ViewerCommandDefinition>();
  /** One viewer intent at a time, regardless of toolbar, overflow or shortcut origin. */
  private executing = false;

  register(command: ViewerCommandDefinition) {
    if (!command.id.trim()) throw new Error("Viewer commands require a stable id.");
    if (this.commands.has(command.id)) throw new Error(`Viewer command already registered: ${command.id}`);
    this.commands.set(command.id, command);
    return () => this.commands.delete(command.id);
  }

  replace(commands: readonly ViewerCommandDefinition[]) {
    const ids = new Set<string>();
    for (const command of commands) {
      if (!command.id.trim() || ids.has(command.id)) throw new Error(`Viewer command id is invalid or duplicated: ${command.id}`);
      ids.add(command.id);
    }
    this.commands = new Map(commands.map((command) => [command.id, command]));
  }

  list(context: ViewerCommandContext) {
    return [...this.commands.values()]
      .filter((command) => commandVisible(command, context))
      .sort((a, b) => (a.priority ?? 50) - (b.priority ?? 50) || a.label.localeCompare(b.label));
  }

  conflicts(context: ViewerCommandContext): ViewerCommandConflict[] {
    const byShortcut = new Map<string, string[]>();
    for (const command of this.list(context)) {
      if (!command.shortcut) continue;
      const shortcut = normalizedShortcut(command.shortcut);
      if (!shortcut) continue;
      const bucket = byShortcut.get(shortcut) || [];
      bucket.push(command.id);
      byShortcut.set(shortcut, bucket);
    }
    return [...byShortcut.entries()]
      .filter(([, commandIds]) => commandIds.length > 1)
      .map(([shortcut, commandIds]) => ({ shortcut, commandIds }));
  }

  async execute(id: string, context: ViewerCommandContext) {
    const command = this.commands.get(id);
    if (!command || !commandEnabled(command, context) || this.executing) return false;
    this.executing = true;
    try {
      await command.run(context);
      return true;
    } finally {
      this.executing = false;
    }
  }

  async handleKeyDown(event: KeyboardEvent | ReactKeyboardEvent, context: ViewerCommandContext) {
    const shortcut = eventShortcut(event);
    if (!shortcut) return false;
    const matches = this.list(context)
      .filter((command) => command.shortcut && normalizedShortcut(command.shortcut) === shortcut)
      .filter((command) => command.allowInEditable || !editableTarget(event.target))
      .filter((command) => commandEnabled(command, context));
    if (!matches.length) return false;
    const winner = matches[0];
    event.preventDefault();
    event.stopPropagation();
    return this.execute(winner.id, context);
  }
}

export function createViewerCommandRegistry(commands: readonly ViewerCommandDefinition[] = []) {
  const registry = new ViewerCommandRegistry();
  registry.replace(commands);
  return registry;
}
