/**
 * Recovery for code chunks that no longer exist on the server.
 *
 * Each build gives chunks new hashed filenames. A tab opened before a Server
 * update still references the old names, so opening a not-yet-loaded screen
 * fails. React.lazy remembers the rejected import, so retrying in place can
 * never succeed; only loading the new build helps. We reload once, guarded so
 * a genuinely broken deployment cannot cause a reload loop.
 */

const RELOAD_MARK_KEY = "cluster-stale-chunk-reload-at";
const RELOAD_GUARD_MS = 60_000;

const CHUNK_ERROR_PATTERN = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|ChunkLoadError|is not a valid JavaScript MIME type/i;

export function isStaleChunkError(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? "");
  return CHUNK_ERROR_PATTERN.test(message);
}

/** Reloads the page unless we already did so recently. Returns whether it reloaded. */
export function reloadForStaleChunk(now = Date.now()): boolean {
  if (typeof window === "undefined") return false;
  try {
    const last = Number(window.sessionStorage.getItem(RELOAD_MARK_KEY) || 0);
    if (Number.isFinite(last) && now - last >= 0 && now - last < RELOAD_GUARD_MS) return false;
    window.sessionStorage.setItem(RELOAD_MARK_KEY, String(now));
  } catch {
    // Without storage we cannot guard against a loop; leave recovery to the user.
    return false;
  }
  window.location.reload();
  return true;
}

let installed = false;

/** Vite reports failed preloads and failed dynamic imports through this event. */
export function installStaleChunkRecovery() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("vite:preloadError", () => {
    // Do not preventDefault: if we reload, the page is replaced anyway; if the
    // guard declines, the error must still reach the feature boundary.
    reloadForStaleChunk();
  });
}
