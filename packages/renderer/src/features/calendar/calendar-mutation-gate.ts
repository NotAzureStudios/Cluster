/** A single Calendar editor intent may perform only one server mutation at a time. */
export function createCalendarMutationGate() {
  let active = false;
  let generation = 0;
  let disposed = false;
  return {
    busy: () => active,
    invalidate() { generation += 1; disposed = true; active = false; },
    async run<T>(request: () => Promise<T>, onCommitted: (result: T) => void,
      onFailure: (error: unknown) => void, onBusy: (busy: boolean) => void): Promise<boolean> {
      if (active || disposed) return false;
      active = true;
      const ticket = generation;
      onBusy(true);
      let result: T;
      try {
        result = await request();
      } catch (error) {
        if (!disposed && ticket === generation) onFailure(error);
        return false;
      } finally {
        // This finally also runs on success before the onCommitted callback.
        if (!disposed && ticket === generation) {
          active = false;
          onBusy(false);
        }
      }
      if (disposed || ticket !== generation) return false;
      // Presentation failures must not be misreported as failed server writes.
      try { onCommitted(result); } catch (error) { onFailure(new Error("Changes saved, but Calendar could not refresh. Reopen the event to verify the result.")); }
      return true;
    },
  };
}
