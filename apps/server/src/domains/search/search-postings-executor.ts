import { Worker } from "node:worker_threads";
import { availableParallelism } from "node:os";
import { performance } from "node:perf_hooks";
import { appendSearchPostings, buildPostings } from "./search-index-builder.js";
import type { SearchIndexItem } from "./search-index-types.js";

type PostingMap = Map<string, Set<number>>;
type PendingTask = {
  id: number;
  worker: Worker;
  resolve: (value: PostingMap) => void;
  reject: (reason: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

const MAX_TRANSFER_CHARS = 4_000_000;
const MAX_WORKER_ROWS = 20_000;
const MAX_WORKER_RUNTIME_MS = 45_000;
const IDLE_WORKER_MS = 20_000;
const WORKER_RECOVERY_MS = 30_000;

let worker: Worker | null = null;
let pending: PendingTask | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
let nextTaskId = 0;
let workerDisabledUntil = 0;
const measurements = { workerStarts: 0, workerBuilds: 0, cooperativeBuilds: 0, workerFailures: 0 };

function clearIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
}
function markWorkerFailure(instance: Worker) {
  if (worker !== instance) return;
  worker = null;
  workerDisabledUntil = Date.now() + WORKER_RECOVERY_MS;
  clearIdleTimer();
  measurements.workerFailures++;
  const active = pending;
  if (active && active.worker === instance) {
    pending = null;
    clearTimeout(active.timeout);
    active.reject(new Error("Search posting worker unavailable."));
  }
  void instance.terminate().catch(() => undefined);
}

function idleWorker(instance: Worker) {
  instance.unref();
  clearIdleTimer();
  idleTimer = setTimeout(() => {
    if (worker !== instance || pending) return;
    worker = null;
    void instance.terminate().catch(() => undefined);
  }, IDLE_WORKER_MS);
  idleTimer.unref?.();
}

function ensureWorker() {
  if (worker) return worker;
  if (Date.now() < workerDisabledUntil) throw new Error("Search posting worker cooling down.");
  const instance = new Worker(new URL("./search-postings-worker.js", import.meta.url), {
    resourceLimits: { maxOldGenerationSizeMb: 128 },
  });
  worker = instance;
  measurements.workerStarts++;
  instance.on("message", (result: { id?: number; postings?: unknown; error?: string }) => {
    const active = pending;
    if (!active || active.worker !== instance || result?.id !== active.id) return;
    pending = null;
    clearTimeout(active.timeout);
    if (result.error || !(result.postings instanceof Map)) {
      markWorkerFailure(instance);
      active.reject(new Error("Invalid Search posting worker result."));
      return;
    }
    measurements.workerBuilds++;
    active.resolve(result.postings as PostingMap);
    idleWorker(instance);
  });
  instance.on("error", () => markWorkerFailure(instance));
  instance.on("exit", () => markWorkerFailure(instance));
  idleWorker(instance);
  return instance;
}

function runWorker(tokenRows: string[][]): Promise<PostingMap> {
  if (pending) return Promise.reject(new Error("Search posting worker busy."));
  const instance = ensureWorker();
  clearIdleTimer();
  instance.ref();
  return new Promise<PostingMap>((resolve, reject) => {
    const id = ++nextTaskId;
    const timeout = setTimeout(() => markWorkerFailure(instance), MAX_WORKER_RUNTIME_MS);
    pending = { id, worker: instance, resolve, reject, timeout };
    try { instance.postMessage({ id, tokenRows }); }
    catch { markWorkerFailure(instance); }
  });
}

/** On resource denial, errors, or opt-out: build in short event-loop slices.
 * No transfer of raw data, no extra service and no large synchronous burst.
 */
async function cooperativePostings(items: SearchIndexItem[]): Promise<PostingMap> {
  measurements.cooperativeBuilds++;
  const postings: PostingMap = new Map();
  let sliceStarted = performance.now();
  for (let index = 0; index < items.length; index++) {
    appendSearchPostings(postings, items[index].tokens, index);
    if (performance.now() - sliceStarted >= 5) {
      await new Promise<void>((resolve) => setImmediate(resolve));
      sliceStarted = performance.now();
    }
  }
  return postings;
}

function eligibleTokenRows(items: SearchIndexItem[]) {
  if (items.length > MAX_WORKER_ROWS) return null;
  let characters = 0;
  const rows: string[][] = [];
  for (const item of items) {
    const tokens = item.tokens;
    if (!Array.isArray(tokens)) return null;
    for (const token of tokens) {
      if (typeof token !== "string") return null;
      characters += token.length;
      if (characters > MAX_TRANSFER_CHARS) return null;
    }
    rows.push(tokens);
  }
  return rows;
}

/** Single lazily started, reused CPU worker for sufficiently large search
 * posting lists. Never create one thread per HTTP request. */
export async function buildSearchPostings(items: SearchIndexItem[]): Promise<PostingMap> {
  const workerSetting = String(process.env.CLUSTER_SEARCH_POSTINGS_WORKER || "auto").trim().toLowerCase();
  const thresholdSetting = Number(process.env.CLUSTER_SEARCH_POSTINGS_WORKER_THRESHOLD);
  const threshold = Number.isFinite(thresholdSetting) && thresholdSetting > 0
    ? Math.max(256, Math.min(20_000, Math.round(thresholdSetting)))
    : workerSetting === "on" ? 256 : 4_096;
  if (items.length < 256) return buildPostings(items);
  // On small CPU allocations, automatic thread creation competes with the
  // interactive API; explicit opt-in remains available for hardware testing.
  const enoughCores = workerSetting === "on" || availableParallelism() >= 4;
  if (workerSetting !== "off" && enoughCores && items.length >= threshold && !pending && Date.now() >= workerDisabledUntil) {
    const rows = eligibleTokenRows(items);
    if (rows) {
      try { return await runWorker(rows); }
      catch { /* Workers are optional; preserve index correctness on any failure. */ }
    }
  }
  return cooperativePostings(items);
}

/** Bounded operational counters only; never collect indexed titles or tokens. */
export function searchPostingExecutorDiagnostics() {
  return { ...measurements, workerActive: Boolean(worker), workerBusy: Boolean(pending) };
}

/** Explicit cleanup for tests and graceful server shutdown integrations. */
export async function stopSearchPostingWorker() {
  const instance = worker;
  worker = null;
  clearIdleTimer();
  if (instance) {
    const active = pending;
    pending = null;
    if (active && active.worker === instance) {
      clearTimeout(active.timeout);
      active.reject(new Error("Search posting worker stopped."));
    }
    await instance.terminate();
  }
}
