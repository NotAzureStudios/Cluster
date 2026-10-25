/** Canonical version admission for Library derivatives.
 * Derivative bytes are not standalone share grants: both source authorization
 * and the current file checksum must be valid for every discovery and read.
 */
const CHECKSUM_SHA256 = /^[a-f0-9]{64}$/i;

export function libraryDerivativeMatchesSource(item: any, derivative: any): boolean {
  const current = String(item?.checksumSha256 || "");
  const source = String(derivative?.sourceChecksumSha256 || "");
  return item?.type === "file"
    && item?.lifecycleState !== "destroyed"
    && Boolean(item?.fileName)
    && CHECKSUM_SHA256.test(current)
    && CHECKSUM_SHA256.test(source)
    && current.toLowerCase() === source.toLowerCase();
}

export function libraryDerivativeIsDeliverable(item: any, derivative: any): boolean {
  return libraryDerivativeMatchesSource(item, derivative)
    && derivative?.status === "ready"
    && !derivative?.invalidatedAt
    && Boolean(derivative?.storagePath);
}

export function libraryDerivativeClientState(item: any, derivative: any) {
  const currentVersion = libraryDerivativeMatchesSource(item, derivative);
  const available = libraryDerivativeIsDeliverable(item, derivative);
  return {
    currentVersion,
    available,
    status: currentVersion ? String(derivative?.status || "unknown") : "stale",
    availabilityReason: !currentVersion ? "source-version-changed"
      : derivative?.invalidatedAt ? "invalidated"
      : derivative?.status !== "ready" ? "not-ready"
      : !derivative?.storagePath ? "bytes-unavailable"
      : null,
  };
}
