/** Local, bounded transfer telemetry derived exclusively from native broker push snapshots.
 * No timers, network requests or artificial throughput estimates. Browser handoffs
 * cannot report actual disk/network transfer bytes and are deliberately excluded.
 */
export type TransferRatePoint = { at: number; upBps: number; downBps: number };
export type TransferByteSnapshot = {
  id: string;
  direction: "upload" | "download";
  state: string;
  totalBytes?: number | null;
  transferredBytes?: number | null;
};
type SeenBytes = { bytes: number; direction: "upload" | "download" };
export type TransferTelemetry = {
  at: number;
  windowStarted: number;
  windowUp: number;
  windowDown: number;
  windowPerItem: Record<string, number>;
  seen: Record<string, SeenBytes>;
  points: TransferRatePoint[];
  upBps: number | null;
  downBps: number | null;
  perItemBps: Record<string, number>;
};
export const EMPTY_TRANSFER_TELEMETRY: TransferTelemetry = {
  at: 0, windowStarted: 0, windowUp: 0, windowDown: 0,
  seen: {}, points: [], windowPerItem: {}, upBps: null, downBps: null, perItemBps: {},
};
const MAX_SAMPLES = 90;
const MIN_WINDOW_MS = 750;
const MAX_RATE_GAP_MS = 15_000;
const LIVE_STATES = new Set(["running"]);

export function appendTransferTelemetry(
  previous: TransferTelemetry,
  transfers: readonly TransferByteSnapshot[],
  at: number,
): TransferTelemetry {
  if (!Number.isFinite(at) || at <= 0 || (previous.at > 0 && at <= previous.at)) return previous;
  const seen: Record<string, SeenBytes> = {};
  const perItemBytes: Record<string, number> = { ...previous.windowPerItem };
  const dt = previous.at ? at - previous.at : 0;
  const measurable = dt > 0 && dt <= MAX_RATE_GAP_MS;
  let up = 0;
  let down = 0;
  for (const transfer of transfers) {
    if (!transfer.id) continue;
    const bytes = Number(transfer.transferredBytes);
    if (!Number.isSafeInteger(bytes) || bytes < 0) continue;
    const capped = Number.isSafeInteger(transfer.totalBytes) && Number(transfer.totalBytes) > 0
      ? Math.min(bytes, Number(transfer.totalBytes)) : bytes;
    seen[transfer.id] = { bytes: capped, direction: transfer.direction };
    const old = previous.seen[transfer.id];
    // New jobs, resets, completed jobs and pauses cannot manufacture speed.
    if (!old || !measurable || !LIVE_STATES.has(transfer.state) || old.direction !== transfer.direction) continue;
    const delta = capped - old.bytes;
    if (delta <= 0) continue;
    if (transfer.direction === "upload") up += delta;
    else down += delta;
    perItemBytes[transfer.id] = (perItemBytes[transfer.id] || 0) + delta;
  }
  // A replaced transfer queue represents another session; never carry its graph.
  const overlap = transfers.some((item) => previous.seen[item.id]);
  const points = overlap || Object.keys(previous.seen).length === 0 ? previous.points : [];
  const windowPerItem = overlap ? perItemBytes : {};
  const start = !previous.windowStarted || !overlap ? at : previous.windowStarted;
  const windowUp = (overlap ? previous.windowUp : 0) + up;
  const windowDown = (overlap ? previous.windowDown : 0) + down;
  const windowMs = at - start;
  if (windowMs < MIN_WINDOW_MS) {
    return { ...previous, at, seen, windowStarted: start, windowUp, windowDown, windowPerItem, points,
      upBps: overlap ? previous.upBps : null, downBps: overlap ? previous.downBps : null,
      perItemBps: overlap ? previous.perItemBps : {} };
  }
  // Suppress stale / delayed recovery snapshots: a long sleep is not a download.
  const recent = windowMs <= MAX_RATE_GAP_MS;
  const upBps = recent ? windowUp * 1000 / windowMs : null;
  const downBps = recent ? windowDown * 1000 / windowMs : null;
  const sample: TransferRatePoint = { at, upBps: upBps ?? 0, downBps: downBps ?? 0 };
  const perItemBps: Record<string, number> = {};
  if (recent) for (const [id, bytes] of Object.entries(windowPerItem)) {
    if (bytes > 0 && seen[id]) perItemBps[id] = bytes * 1000 / windowMs;
  }
  return {
    at, seen, windowStarted: at, windowUp: 0, windowDown: 0, windowPerItem: {},
    points: [...points.slice(-(MAX_SAMPLES - 1)), sample],
    upBps, downBps, perItemBps,
  };
}

export function transferEtaSeconds(total: number | undefined, done: number | undefined, bytesPerSecond: number | undefined): number | null {
  if (!Number.isFinite(total) || !Number.isFinite(done) || !Number.isFinite(bytesPerSecond)) return null;
  if (Number(total) <= 0 || Number(done) < 0 || Number(done) >= Number(total) || Number(bytesPerSecond) <= 0) return null;
  const seconds = Math.ceil((Number(total) - Number(done)) / Number(bytesPerSecond));
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

export function transferEtaLabel(seconds: number | null): string {
  if (seconds === null) return "Time unknown";
  if (seconds < 60) return `${seconds}s remaining`;
  if (seconds < 3600) return `${Math.ceil(seconds / 60)}m remaining`;
  const totalMinutes = Math.ceil(seconds / 60);
  return `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m remaining`;
}
