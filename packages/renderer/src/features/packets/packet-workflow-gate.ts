/** In-memory, synchronous admission for mutations that must not overlap.
 *  A successful server write is distinct from any subsequent UI refresh.
 *  Invalidation fences results when the workspace is unmounted or replaced.
 */
export function createPacketWorkflowGate() {
  let pending = false;
  let disposed = false;
  let generation = 0;
  return {
    busy: () => pending,
    invalidate() { disposed = true; generation += 1; pending = false; },
    async run<T>(operation: () => Promise<T>): Promise<
      { status: "committed"; value: T } | { status: "failed"; error: unknown } | { status: "ignored" }
    > {
      if (pending || disposed) return { status: "ignored" };
      pending = true;
      const ticket = generation;
      try {
        const value = await operation();
        return !disposed && ticket === generation ? { status: "committed", value } : { status: "ignored" };
      } catch (error) {
        return !disposed && ticket === generation ? { status: "failed", error } : { status: "ignored" };
      } finally {
        if (!disposed && ticket === generation) pending = false;
      }
    },
  };
}
