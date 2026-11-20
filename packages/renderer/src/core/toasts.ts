import type { ClusterIconName } from "../components/ClusterIcon";

/* One toast store for the whole app. Anything — a live notification, the
   result of an action — calls showToast(); ClusterToasts renders the stack.
   Toasts are transient: the Inbox keeps the record. */

export type ClusterToastTone = "info" | "success" | "warning" | "danger";
export type ClusterToast = {
  id: string;
  tone: ClusterToastTone;
  title: string;
  message?: string;
  /** Small line above the title, e.g. a category or project. */
  label?: string;
  icon?: ClusterIconName;
  /** Milliseconds on screen; 0 keeps it until dismissed. */
  duration?: number;
  /** Clicking the toast body. */
  onOpen?: () => void;
  action?: { label: string; onSelect: () => void };
};

export type ClusterToastPosition = "top-right" | "top-left" | "bottom-right" | "bottom-left";
const TOAST_POSITIONS: ClusterToastPosition[] = ["top-right", "top-left", "bottom-right", "bottom-left"];
let position: ClusterToastPosition = "top-right";
const positionListeners = new Set<(position: ClusterToastPosition) => void>();

/** Which corner the stack sits in; set from the user's preference. */
export function setToastPosition(next: string | null | undefined) {
  const value = TOAST_POSITIONS.includes(next as ClusterToastPosition) ? next as ClusterToastPosition : "top-right";
  if (value === position) return;
  position = value;
  for (const listener of positionListeners) listener(position);
}
export function subscribeToastPosition(listener: (position: ClusterToastPosition) => void): () => void {
  positionListeners.add(listener);
  listener(position);
  return () => { positionListeners.delete(listener); };
}

type Listener = (toasts: ClusterToast[]) => void;
const MAX_TOASTS = 5;
let toasts: ClusterToast[] = [];
const listeners = new Set<Listener>();
let sequence = 0;

function emit() { for (const listener of listeners) listener(toasts); }

export function showToast(input: Omit<ClusterToast, "id"> & { id?: string }): string {
  const id = input.id || `toast-${Date.now().toString(36)}-${(sequence += 1)}`;
  const next: ClusterToast = { duration: input.tone === "danger" ? 10_000 : input.tone === "warning" ? 8_000 : 5_000, ...input, id };
  toasts = [next, ...toasts.filter((toast) => toast.id !== id)].slice(0, MAX_TOASTS);
  emit();
  return id;
}

export function dismissToast(id: string) {
  const next = toasts.filter((toast) => toast.id !== id);
  if (next.length === toasts.length) return;
  toasts = next;
  emit();
}

export function clearToasts() { if (toasts.length) { toasts = []; emit(); } }

export function subscribeToasts(listener: Listener): () => void {
  listeners.add(listener);
  listener(toasts);
  return () => { listeners.delete(listener); };
}
