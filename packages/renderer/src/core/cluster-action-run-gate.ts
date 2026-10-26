/**
 * Shareable single-flight primitive. Identical pending actions share the same
 * outcome instead of producing a second request. Distinct actions are not
 * serialized, and failed attempts can be deliberately retried afterwards.
 */
export function createClusterActionRunGate() {
  const pending = new Map<string, Promise<unknown>>();
  return {
    has: (key: string) => pending.has(key),
    run<T>(key: string, action: () => Promise<T> | T): Promise<T> {
      if (!key.trim()) return Promise.reject(new Error("Action key is required."));
      const existing = pending.get(key);
      if (existing) return existing as Promise<T>;
      const task = Promise.resolve().then(action);
      pending.set(key, task);
      void task.finally(() => { if (pending.get(key) === task) pending.delete(key); }).catch(() => undefined);
      return task;
    },
  };
}
