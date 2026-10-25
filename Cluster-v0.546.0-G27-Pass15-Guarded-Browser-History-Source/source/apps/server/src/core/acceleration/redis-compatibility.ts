import { randomUUID } from "node:crypto";

/** Exact Redis protocol primitives used by Cluster's current acceleration
 * runtime, tested only against the already-configured backend. No URL input,
 * no user keys, no secret-bearing error messages, no persistent data changes.
 */
export type RedisCompatibilityClient = {
  ping(): Promise<string>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: Record<string, unknown>): Promise<unknown>;
  del(key: string | string[]): Promise<number>;
  publish(channel: string, message: string): Promise<number>;
  sendCommand(args: string[]): Promise<unknown>;
  duplicate(): RedisCompatibilitySubscriber;
};
export type RedisCompatibilitySubscriber = {
  connect(): Promise<unknown>;
  subscribe(channel: string, callback: (message: string) => void): Promise<unknown>;
  unsubscribe(channel: string): Promise<unknown>;
  quit(): Promise<unknown>;
  disconnect?(): void;
};
export type RedisCompatibilityResult = {
  checkedAt: string;
  backend: "configured-redis";
  status: "passed" | "failed";
  steps: Array<{ command: "PING" | "SET_GET_PTTL" | "SET_NX_PX" | "EVAL_LEASE" | "EVAL_RATE_LIMIT" | "PUBSUB"; ok: boolean; code: string }>;
  note: string;
};
const TTL = 12_000;
const PER_CHECK_TIMEOUT_MS = 1_500;
async function bounded<T>(run: () => Promise<T>, timeoutMs = PER_CHECK_TIMEOUT_MS): Promise<T> {
  let handle: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        handle = setTimeout(() => reject(new Error("PROBE_TIMEOUT")), timeoutMs);
        handle.unref?.();
      }),
    ]);
  } finally { if (handle) clearTimeout(handle); }
}

const LEASE_SCRIPT = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";
const RATE_SCRIPT = "local current = redis.call('INCRBY', KEYS[1], ARGV[1]); if current == tonumber(ARGV[1]) then redis.call('PEXPIRE', KEYS[1], ARGV[2]); end; local remain = redis.call('PTTL', KEYS[1]); return {current, remain}";

export async function runRedisProtocolCompatibility(input: {
  command: RedisCompatibilityClient;
  prefix: string;
  nonce?: string;
  now?: () => number;
}): Promise<RedisCompatibilityResult> {
  // Namespace is fixed and bounded even if the existing Cluster Redis prefix
  // contains punctuation; a check can never operate on studio/domain keys.
  const nonce = input.nonce && /^[a-z0-9_-]{8,64}$/i.test(input.nonce) ? input.nonce : randomUUID().replaceAll("-", "");
  const base = `${String(input.prefix || "cluster").replace(/[^a-z0-9:_-]/gi, "-").slice(0,80)}:selftest:v1:${nonce}`;
  const cacheKey = `${base}:cache`, nxKey = `${base}:nx`, leaseKey = `${base}:lease`, rateKey = `${base}:rate`, channel = `${base}:pubsub`;
  const cleanup = [cacheKey,nxKey,leaseKey,rateKey];
  const steps: RedisCompatibilityResult["steps"] = [];
  const step = async (command: RedisCompatibilityResult["steps"][number]["command"], run: () => Promise<boolean>) => {
    let ok = false;
    try { ok = (await bounded(run)) === true; }
    catch { /* intentionally redact transport/server exceptions */ }
    steps.push({command,ok,code:ok?"SUPPORTED":"FAILED_OR_TIMED_OUT"});
  };
  try {
    await step("PING",async () => (await input.command.ping()).toUpperCase() === "PONG");
    await step("SET_GET_PTTL", async () => {
      if (String(await input.command.set(cacheKey,nonce,{PX:TTL})).toUpperCase()!=="OK") return false;
      if (await input.command.get(cacheKey)!==nonce) return false;
      const ttl = Number(await input.command.sendCommand(["PTTL",cacheKey]));
      return Number.isInteger(ttl) && ttl > 0 && ttl <= TTL;
    });
    await step("SET_NX_PX",async () => {
      if (String(await input.command.set(nxKey,nonce,{NX:true,PX:TTL})).toUpperCase()!=="OK") return false;
      const repeat = await input.command.set(nxKey,nonce,{NX:true,PX:TTL});
      return repeat === null || repeat === undefined;
    });
    await step("EVAL_LEASE",async () => {
      if (String(await input.command.set(leaseKey,nonce,{NX:true,PX:TTL})).toUpperCase()!=="OK") return false;
      const wrong = Number(await input.command.sendCommand(["EVAL",LEASE_SCRIPT,"1",leaseKey,"different"]));
      const original = await input.command.get(leaseKey);
      const right = Number(await input.command.sendCommand(["EVAL",LEASE_SCRIPT,"1",leaseKey,nonce]));
      return wrong===0 && original===nonce && right===1 && await input.command.get(leaseKey)===null;
    });
    await step("EVAL_RATE_LIMIT",async () => {
      const first = await input.command.sendCommand(["EVAL",RATE_SCRIPT,"1",rateKey,"1",String(TTL)]);
      const second = await input.command.sendCommand(["EVAL",RATE_SCRIPT,"1",rateKey,"1",String(TTL)]);
      if (!Array.isArray(first)||!Array.isArray(second)) return false;
      return Number(first[0])===1 && Number(second[0])===2 && Number(first[1])>0 && Number(second[1])>0;
    });
    await step("PUBSUB",async () => {
      const subscriber = input.command.duplicate();
      try {
        await bounded(()=>subscriber.connect());
        let delivery: ((message: string) => void) | null = null;
        const received = new Promise<string>(resolve => { delivery = resolve; });
        await bounded(()=>subscriber.subscribe(channel,message=>{ delivery?.(message); }));
        await bounded(()=>input.command.publish(channel,nonce));
        return (await bounded(()=>received,1000))===nonce;
      } finally {
        // A blocked subscriber must not delay the endpoint indefinitely.
        await bounded(()=>subscriber.unsubscribe(channel),500).catch(()=>undefined);
        await bounded(()=>subscriber.quit(),500).catch(()=>{ try{subscriber.disconnect?.();}catch{} });
      }
    });
  } finally {
    // All keys expire by themselves. DEL is best-effort to reduce transient
    // cache footprint, never a reason to mark a successful command unsupported.
    await bounded(()=>input.command.del(cleanup),750).catch(()=>undefined);
  }
  return {
    checkedAt:new Date(input.now?.() ?? Date.now()).toISOString(),
    backend:"configured-redis",
    status:steps.length===6 && steps.every(item=>item.ok)?"passed":"failed",
    steps,
    note:"Configured Redis-compatible command probe only. Does not identify Garnet specifically, prove persistence, network security, failover, or Windows production compatibility.",
  };
}
