/** A background Board revalidation must not replace an already-visible
 * Board with a full-page loading state. Opening a different ID remains a
 * blocking load until that exact Board is authorized and available. */
export function boardNeedsBlockingLoading(
  requestedId: string | null,
  loadedId: string | null,
  loading: boolean,
  errorId: string | null,
): boolean {
  return Boolean(requestedId && (loading || (loadedId !== requestedId && errorId !== requestedId)));
}
