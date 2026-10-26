/** Cross-window, acknowledgement-after-delivery native notification gating.
 *
 * Read/perform/write all run under one exclusive lock where Web Locks is
 * supported. Never mark a token seen when permission is denied or the native
 * bridge rejects it. The first recovery poll primes historical IDs without
 * displaying old notifications. When locks are unavailable, the caller gets
 * the same best-effort, single-window behavior as other native transports.
 */
export async function deliverNativeNotificationTokens(input: {
  tokens: string[];
  primeIfMissing: boolean;
  read: () => string[] | null;
  write: (tokens: string[]) => void;
  deliver: (tokens: string[]) => Promise<boolean>;
  exclusive?: (work: () => Promise<string[]>) => Promise<string[]>;
}): Promise<string[]> {
  const work = async () => {
    const previous = input.read();
    const existing = previous || [];
    const seen = new Set(existing);
    const fresh = [...new Set(input.tokens.filter((token) => token && !seen.has(token) &&
      !(token.endsWith(":0") && seen.has(token.slice(0, -2)))))];
    if (previous === null && input.primeIfMissing) {
      input.write([...new Set([...existing, ...input.tokens])]);
      return [];
    }
    if (!fresh.length) return [];
    // Native permission failure, window teardown, and rejected bridge calls
    // must leave these tokens eligible for a later recovery poll.
    let delivered = false;
    try { delivered = await input.deliver(fresh) === true; }
    catch { return []; }
    if (!delivered) return [];
    input.write([...new Set([...existing, ...fresh])]);
    return fresh;
  };
  if (input.exclusive) {
    try { return await input.exclusive(work); }
    catch { /* Some hosts expose a nonfunctional Web Locks implementation. */ }
  }
  return work();
}
