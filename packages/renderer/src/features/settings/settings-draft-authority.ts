/** Local recovery drafts are not authoritative over a newer server revision. */
export type DraftRecoveryAuthority = "none" | "matching" | "older-or-unverified";

export function decideDraftRecovery(
  exists: boolean,
  baseline: string | null | undefined,
  authoritative: string,
): DraftRecoveryAuthority {
  if (!exists) return "none";
  // Old drafts without a recorded origin must not become silently trusted.
  return typeof baseline === "string" && baseline.length > 0 && baseline === authoritative
    ? "matching" : "older-or-unverified";
}

/** Stable digest of raw Studio Settings, not of local UI defaults.
 * Prefer a cryptographic digest over storing another copy of privileged settings
 * inside the draft. Where WebCrypto is unavailable, fail closed: manual review.
 */
export async function studioSettingsDraftBaseline(value: unknown): Promise<string | null> {
  function ordered(item: unknown): unknown {
    if (Array.isArray(item)) return item.map(ordered);
    if (item && typeof item === "object") {
      return Object.fromEntries(Object.entries(item as Record<string, unknown>)
        .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
        .map(([key, child]) => [key, ordered(child)]));
    }
    return item;
  }
  if (typeof crypto === "undefined" || !crypto.subtle) return null;
  try {
    const bytes = new TextEncoder().encode(JSON.stringify(ordered(value ?? {})));
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return `sha256:${Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("")}`;
  } catch {
    return null; // Missing implementation or transient crypto failure is unverified.
  }
}
