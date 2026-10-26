export type AccessibilityNudge = { dx: number; dy: number };

export function nextEnabledIndex(disabled: readonly boolean[], current: number, direction: 1 | -1) {
  const enabled = disabled.map((value, index) => value ? -1 : index).filter((index) => index >= 0);
  if (!enabled.length) return -1;
  const currentPosition = enabled.indexOf(current);
  const position = currentPosition >= 0 ? currentPosition : direction > 0 ? -1 : 0;
  return enabled[(position + direction + enabled.length) % enabled.length];
}

export function keyboardNudge(key: string, coarse = false): AccessibilityNudge | null {
  const step = coarse ? 10 : 1;
  if (key === "ArrowLeft") return { dx: -step, dy: 0 };
  if (key === "ArrowRight") return { dx: step, dy: 0 };
  if (key === "ArrowUp") return { dx: 0, dy: -step };
  if (key === "ArrowDown") return { dx: 0, dy: step };
  return null;
}

export function accessibleDocumentTitle(label: string, product = "Cluster") {
  const normalized = label.trim() || "Workspace";
  return `${normalized} · ${product}`;
}

export function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.closest("[contenteditable='true']")) return true;
  const control = target.closest("input, textarea, select, [role='textbox'], [role='combobox']");
  return control instanceof HTMLElement && !control.hasAttribute("disabled");
}

export function shouldHandleGlobalNavigationShortcut(event: KeyboardEvent) {
  if (event.defaultPrevented || event.isComposing) return false;
  return !isEditableTarget(event.target);
}
