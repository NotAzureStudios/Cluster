/**
 * A server mutation (or accepted offline command) has already crossed its
 * commit boundary. A failed local cleanup or follow-up GET cannot undo it.
 * Return a warning instead of throwing into the mutation's failure handler.
 */
export async function reconcileAfterCommit(followUp: () => Promise<unknown>): Promise<string | null> {
  try {
    await followUp();
    return null;
  } catch (error) {
    // Cross-realm errors (Desktop embedded views, plugin contexts) may not
    // satisfy instanceof Error even when they carry a normal message.
    const message = error && typeof error === "object" && "message" in error
      && typeof error.message === "string" ? error.message.trim() : "";
    return message || "The follow-up operation did not complete.";
  }
}
