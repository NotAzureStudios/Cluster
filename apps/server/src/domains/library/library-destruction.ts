/**
 * Retired destructive primitive. Kept as an explicit fail-closed boundary for
 * code that was compiled against the previous API. The legacy operation
 * cascaded revisions and attachments while retaining file bytes and is NOT a
 * valid storage-disposition protocol. New callers must use library-disposition.
 */
export async function prepareLibraryDestruction(..._args: unknown[]) {
  return { error: { code: "LIBRARY_DISPOSITION_REVIEW_REQUIRED",
    message: "Immediate Library destruction is disabled. Create a governed disposition request." } };
}
