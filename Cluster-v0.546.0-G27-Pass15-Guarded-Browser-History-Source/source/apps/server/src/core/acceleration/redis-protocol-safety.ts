/** Validate Redis/Garnet scripting results before trusting distributed
 * authorization-sensitive rate limiting. A malformed reply MUST use the
 * authoritative PostgreSQL fallback instead of granting capacity.
 */
export function validatedRateLimitReply(reply: unknown, cost: number, ttlMs: number): { count: number; remainingTtl: number } | null {
  if (!Array.isArray(reply) || reply.length !== 2) return null;
  // RESP clients may decode Lua integers as numbers, bigints or numeric strings.
  // Reject floats, negative values, unsafe integers, or missing key expiry.
  const [rawCount, rawTtl] = reply;
  if (!["number", "string", "bigint"].includes(typeof rawCount)
      || !["number", "string", "bigint"].includes(typeof rawTtl)) return null;
  const count = Number(rawCount);
  const remainingTtl = Number(rawTtl);
  if (!Number.isSafeInteger(count) || !Number.isSafeInteger(remainingTtl)
      || count < cost || remainingTtl <= 0 || remainingTtl > ttlMs) return null;
  return { count, remainingTtl };
}

/** User-facing telemetry must not include raw Redis transport/server error
 * messages: redis:// credentials and query tokens sometimes appear in them.
 */
export function classifyRedisFailure(error: unknown): string {
  const input = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  const message = input.toLowerCase().slice(0, 8_192);
  if (/noauth|wrongpass|authentication|auth failed|invalid username|invalid password|acl|permission denied/.test(message)) return "REDIS_AUTH_FAILURE";
  if (/timeout|timed out|etimedout/.test(message)) return "REDIS_TIMEOUT";
  if (/econnrefused|connection refused|enotfound|ehostunreach|enetunreach|socket closed|connection closed|econnreset/.test(message)) return "REDIS_UNREACHABLE";
  if (/unknown command|unsupported command|unknown redis command|lacks required commands|script.*disabled|lua.*disabled/.test(message)) return "REDIS_UNSUPPORTED_COMMAND";
  if (/invalid rate-limit reply|malformed.*reply/.test(message)) return "REDIS_INVALID_REPLY";
  return "REDIS_BACKEND_FAILURE";
}
