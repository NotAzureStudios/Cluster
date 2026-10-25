/**
 * Native supervisor journal reader. The Go Host/Launcher remains sole writer;
 * the API reads allowlisted, tiny immutable records after database recovery.
 * Never accept arbitrary messages or paths from files as application data.
 */
import * as fs from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import * as path from "node:path";

export const NATIVE_EVENT_DEFINITIONS = {
  gateway_bind_failed: { severity: "critical", message: "Cluster's web listener could not start. Inspect the local native server logs.", category: "gateway", type: "failed" },
  gateway_serve_failed: { severity: "critical", message: "Cluster's web listener stopped unexpectedly. Inspect the local native server logs.", category: "gateway", type: "failed" },
  api_start_failed: { severity: "critical", message: "The Cluster API process failed to start. Inspect the local native server logs.", category: "api-process", type: "failed" },
  api_readiness_failed: { severity: "critical", message: "The Cluster API did not become ready. Inspect the local native server logs.", category: "api-process", type: "failed" },
  api_process_exited: { severity: "warning", message: "The Cluster API process exited unexpectedly. Native recovery is being attempted.", category: "api-process", type: "failed" },
  api_recovered: { severity: "info", message: "The Cluster API recovered after a supervised restart.", category: "api-process", type: "recovered" },
  api_recovery_exhausted: { severity: "critical", message: "The Cluster API could not be recovered within its configured restart limit.", category: "api-process", type: "failed" },
  api_runtime_readiness_lost: { severity: "critical", message: "The Cluster API is running but dependency readiness has failed repeatedly (database/storage/saturation).", category: "api-dependencies", type: "failed" },
  api_runtime_readiness_restored: { severity: "info", message: "The Cluster API dependency readiness has recovered.", category: "api-dependencies", type: "recovered" },
  launcher_startup_failed: { severity: "critical", message: "The native Cluster launcher could not finish starting the server.", category: "native-host", type: "failed" },
  host_readiness_timeout: { severity: "critical", message: "The native Cluster host failed to report readiness before its watchdog expired.", category: "native-host", type: "failed" },
  host_unexpected_exit: { severity: "critical", message: "The native Cluster host terminated unexpectedly.", category: "native-host", type: "failed" },
  network_rollback_restored: { severity: "warning", message: "The Cluster Windows Service restored the previous network configuration after failed startup. Review the staged change.", category: "network-deployment", type: "failed" },
  network_rollback_blocked: { severity: "critical", message: "The Cluster Windows Service could not safely restore a staged network change. Inspect the protected deployment record and service logs.", category: "network-deployment", type: "failed" },
} as const;
export type NativeCode = keyof typeof NATIVE_EVENT_DEFINITIONS;
export type NativeEvent = { version: 1; id: string; code: NativeCode; severity: string; message: string; occurredAt: string };
export const nativeEventKey = (category: string) => `cluster:native:${category}`;
// PostgreSQL DateTime stores milliseconds while Go emits nanoseconds. Keep
// this UTC ordinal for strict cross-restart event ordering even when multiple
// failure/recovery records happen inside one millisecond.
export function nativeEventOrdinal(stamp: string): string {
  return stamp.replace(/(\.\d+)?Z$/, (_, fraction = "") =>
    `.${fraction.slice(1).padEnd(9, "0")}Z`);
}
const MAX_JOURNAL_ENTRIES = 800;
const MAX_EVENT_BYTES = 4096;
const NAME_PATTERN = /^\d{8}T\d{6}\.\d{9}Z-[a-f0-9]{32}\.(?:pending|sent)$/;
const ID_PATTERN = /^[a-f0-9]{32}$/;
const TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

export function validateNativeJournalEvent(raw: unknown, now = new Date()): NativeEvent | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const data = raw as Record<string, unknown>;
  const keys = Object.keys(data).sort();
  if (keys.join(",") !== "code,id,message,occurredAt,severity,version") return null;
  const definition = typeof data.code === "string" ? NATIVE_EVENT_DEFINITIONS[data.code as NativeCode] : undefined;
  if (!definition || data.version !== 1 || typeof data.id !== "string" || !ID_PATTERN.test(data.id) ||
      data.severity !== definition.severity || data.message !== definition.message ||
      typeof data.occurredAt !== "string" || !TIME_PATTERN.test(data.occurredAt)) return null;
  const date = new Date(data.occurredAt);
  if (!Number.isFinite(date.getTime()) || date.getTime() < Date.UTC(2020, 0, 1) || date.getTime() > now.getTime() + 5 * 60_000) return null;
  return data as unknown as NativeEvent;
}

export type NativeJournalRead = { events: NativeEvent[]; invalid: number; missing: boolean; saturated: boolean };
export async function readNativeJournal(workspaceRoot: string, now = new Date()): Promise<NativeJournalRead> {
  const empty = { events: [], invalid: 0, missing: true, saturated: false } as NativeJournalRead;
  // Root comes only from the server's validated boot workspace, never HTTP input.
  const dir = path.join(workspaceRoot, "data", "system", "operations", "native-alerts");
  let entries: import("node:fs").Dirent[];
  try { entries = await fs.readdir(dir, { withFileTypes: true }); }
  catch (error: any) { if (error?.code === "ENOENT") return empty; throw error; }
  const filenames = entries.filter((entry) => entry.isFile() && NAME_PATTERN.test(entry.name)).map((entry) => entry.name).sort();
  const result: NativeJournalRead = { events: [], invalid: 0, missing: false, saturated: filenames.length > MAX_JOURNAL_ENTRIES };
  if (result.saturated) throw new Error("NATIVE_JOURNAL_ENTRY_LIMIT_EXCEEDED");
  for (const name of filenames) {
    const filenameId = name.match(/-([a-f0-9]{32})\./)?.[1];
    let handle: import("node:fs/promises").FileHandle | undefined;
    try {
      handle = await fs.open(path.join(dir, name), fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0));
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_EVENT_BYTES) { result.invalid++; continue; }
      const buffer = Buffer.alloc(stat.size);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      if (bytesRead !== buffer.length) { result.invalid++; continue; }
      const record = validateNativeJournalEvent(JSON.parse(buffer.toString("utf8")), now);
      if (!record || record.id !== filenameId) { result.invalid++; continue; }
      result.events.push(record);
    } catch (error: any) {
      // Atomic rename from pending -> sending -> sent is expected during reads.
      if (error?.code === "ENOENT") continue;
      if (["EACCES", "EPERM"].includes(error?.code)) throw new Error("NATIVE_JOURNAL_READ_DENIED");
      result.invalid++;
    } finally { await handle?.close(); }
  }
  // A historical event with an older filename may have been delivered later.
  // Reconcile in event-time order so a known recovery does not precede its failure.
  result.events.sort((a, b) => {
    const x = new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime();
    if (x) return x;
    // Preserve nanosecond ordering from Go's RFC3339Nano when milliseconds tie.
    return nativeEventOrdinal(a.occurredAt).localeCompare(nativeEventOrdinal(b.occurredAt)) || a.id.localeCompare(b.id);
  });
  return result;
}
