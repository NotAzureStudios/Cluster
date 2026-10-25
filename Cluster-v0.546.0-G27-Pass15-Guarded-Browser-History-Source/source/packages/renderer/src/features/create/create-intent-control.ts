/**
 * One human Create intent, one submission. This is deliberately independent of
 * React state: a second click / Ctrl+Enter in the same frame must be rejected.
 * HTTP idempotency receipts provide the durable server-side half of the contract.
 */
export function createClusterCreateIntentControl(makeKey: () => string = () => crypto.randomUUID()) {
  let inFlight = false;
  let committed = false;
  const requestKeys = new Map<string, string>();
  return {
    begin() {
      if (inFlight || committed) return false;
      inFlight = true;
      return true;
    },
    get inFlight() { return inFlight; },
    get committed() { return committed; },
    commit() { committed = true; },
    finish() { inFlight = false; },
    /** Reuse the key for an identical request after a timeout or connection loss. */
    requestKey(method: string, path: string, body: string) {
      const signature = JSON.stringify([method.toUpperCase(), path, body]);
      let key = requestKeys.get(signature);
      if (!key) {
        key = `create-${makeKey()}`;
        requestKeys.set(signature, key);
      }
      return key;
    },
    /** Only call for an explicitly new intent, never for an uncertain retry. */
    reset() {
      if (inFlight) return false;
      committed = false;
      requestKeys.clear();
      return true;
    },
  };
}
