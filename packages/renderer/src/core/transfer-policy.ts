import { getOfflineScopeIdentity } from "./offline-storage";

/** Per-account browser transfer tuning. Native Qt queues keep their own durable admission policy. */
export type TransferPolicy = Readonly<{
  concurrentDiskDownloads: number;
  maxDownloadMiBPerSecond: number;
  maxRetries: number;
  priority: "interactive" | "normal" | "background";
}>;
const DEFAULT: TransferPolicy = Object.freeze({ concurrentDiskDownloads: 2, maxDownloadMiBPerSecond: 0, maxRetries: 3, priority: "normal" });
const listeners = new Set<() => void>();
const STORAGE_PREFIX = "cluster-browser-transfer-policy-v1:";
let cachedScope = "";
let snapshot: TransferPolicy = DEFAULT;
const allowedPriorities = new Set(["interactive","normal","background"]);
const numberInRange = (value: unknown, min: number, max: number, fallback: number) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Math.trunc(Number(value)))) : fallback;
function normalize(input: Partial<TransferPolicy>): TransferPolicy {
  return {
    concurrentDiskDownloads: numberInRange(input.concurrentDiskDownloads, 1, 3, DEFAULT.concurrentDiskDownloads),
    maxDownloadMiBPerSecond: numberInRange(input.maxDownloadMiBPerSecond, 0, 250, DEFAULT.maxDownloadMiBPerSecond),
    maxRetries: numberInRange(input.maxRetries, 0, 5, DEFAULT.maxRetries),
    priority: allowedPriorities.has(String(input.priority)) ? input.priority! : DEFAULT.priority,
  };
}
export function getTransferPolicy() {
  const scope = getOfflineScopeIdentity().scope;
  if (scope !== cachedScope) {
    cachedScope = scope;
    try {
      const saved = typeof window !== "undefined" ? window.localStorage?.getItem(STORAGE_PREFIX + scope) : null;
      snapshot = saved ? normalize(JSON.parse(saved)) : DEFAULT;
    } catch { snapshot = DEFAULT; }
  }
  return snapshot;
}
export function setTransferPolicy(update: Partial<TransferPolicy>) {
  const scope = getOfflineScopeIdentity().scope;
  const next = normalize({ ...getTransferPolicy(), ...update });
  snapshot = next;
  try { if (typeof window !== "undefined") window.localStorage?.setItem(STORAGE_PREFIX + scope, JSON.stringify(next)); } catch { /* Private mode */ }
  for (const fn of listeners) fn();
  return next;
}
export function subscribeTransferPolicy(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** FIFO within priority. A pending request owns no network stream and no file writer. */
export class TransferAdmissionQueue {
  private running = 0;
  private queue: Array<{ priority: number; resolve: (release: () => void) => void; reject: (error: Error) => void; signal?: AbortSignal; abort?: () => void }> = [];
  private max = 2;

  setLimit(value: number) {
    this.max = numberInRange(value, 1, 3, 2);
    this.pump();
  }
  getSnapshot() { return { running: this.running, waiting: this.queue.length, limit: this.max }; }
  acquire(priority: TransferPolicy["priority"], signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(new DOMException("Transfer cancelled.", "AbortError"));
    return new Promise((resolve, reject) => {
      const weight = priority === "interactive" ? 2 : priority === "normal" ? 1 : 0;
      const entry: (typeof this.queue)[number] = { priority: weight, resolve, reject, signal };
      entry.abort = () => {
        const index = this.queue.indexOf(entry);
        if (index < 0) return;
        this.queue.splice(index, 1);
        signal?.removeEventListener("abort", entry.abort!);
        reject(new DOMException("Transfer cancelled.", "AbortError"));
      };
      signal?.addEventListener("abort", entry.abort, { once: true });
      const insertion = this.queue.findIndex((item) => item.priority < weight);
      if (insertion >= 0) this.queue.splice(insertion, 0, entry);
      else this.queue.push(entry);
      this.pump();
    });
  }
  private pump() {
    while (this.running < this.max && this.queue.length) {
      const item = this.queue.shift()!;
      item.signal?.removeEventListener("abort", item.abort!);
      if (item.signal?.aborted) {
        item.reject(new DOMException("Transfer cancelled.", "AbortError"));
        continue;
      }
      this.running++;
      let released = false;
      item.resolve(() => {
        if (released) return;
        released = true;
        this.running--;
        this.pump();
      });
    }
  }
}
export const browserDiskTransferQueue = new TransferAdmissionQueue();
