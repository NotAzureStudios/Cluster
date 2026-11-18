/**
 * Per-viewer interface preferences: theme, sidebar state, viewer settings,
 * column layouts, whiteboard autosave.
 *
 * This replaces the consent-gated storage that came before it. Every write
 * used to be silently dropped unless the viewer had accepted a cookie-style
 * consent banner, so on an internal tool where nobody had any reason to accept
 * one, the app simply forgot every preference. There is no third party here
 * and no tracking: these keys never leave the browser they are written in.
 *
 * Storage can still fail — a private window, blocked site data, a full quota —
 * so every call is guarded and a failed read behaves as "no preference saved".
 */

/**
 * Keys that are safe to clear when someone asks for a clean slate. Anything
 * not matched here is left alone, so a stray cluster-* key belonging to
 * another feature is never swept up.
 */
const OPTIONAL_PREFERENCE_PATTERNS = [
  /^cluster-theme-mode$/,
  /^cluster\.sidebar\.collapsed$/,
  /^cluster-media-/,
  /^cluster-search-usage-/,
  /^cluster-whiteboard-autosave$/,
];

export function readPreferenceStorage(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writePreferenceStorage(key: string, value: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removePreferenceStorage(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* nothing to remove if storage is unavailable */
  }
}

export function clearOptionalPreferenceStorage(): void {
  if (typeof window === "undefined") return;
  try {
    const keys: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (key && OPTIONAL_PREFERENCE_PATTERNS.some((pattern) => pattern.test(key))) keys.push(key);
    }
    for (const key of keys) window.localStorage.removeItem(key);
  } catch {
    /* nothing to clear if storage is unavailable */
  }
}
