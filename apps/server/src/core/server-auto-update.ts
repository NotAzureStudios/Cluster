import { execFile, spawn } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { previewMaintenanceWindows, validMaintenanceTimezone } from "./operations-maintenance-window.js";

const execFileAsync = promisify(execFile);
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export type NativeUpdateStatus = {
  ok: boolean; state: string; available?: boolean; message: string;
  release?: string; sequence?: number; sha256?: string;
  manualReleaseUrl?: string; installSupported: boolean; updatedAt?: string;
};

// The native Windows binary owns publisher-signature verification, staging
// bounds and canonical update-channel configuration. Callers may not supply
// executables, URLs, installer paths or arguments.
export function nativeUpdateBinary(dataRoot: string) {
  if (process.platform !== "win32" || path.basename(dataRoot).toLowerCase() !== "data") return null;
  const root = path.dirname(dataRoot);
  return { root, binary: path.join(root, "bin", "Cluster Server.exe") };
}

export async function readNativeWebUpdate(dataRoot: string, action: "check" | "status" | "install") {
  const native = nativeUpdateBinary(dataRoot);
  if (!native) return null;
  const { stdout } = await execFileAsync(native.binary, ["--root", native.root, "--web-server-update", action],
    { windowsHide: true, timeout: action === "check" ? 16_000 : action === "install" ? 20_000 : 8_000, maxBuffer: 8 * 1024 });
  return JSON.parse(stdout) as NativeUpdateStatus;
}

// One detached native child downloads and verifies the signed installer and
// records its result; status reports progress.
export function startNativeUpdateStage(dataRoot: string) {
  const native = nativeUpdateBinary(dataRoot);
  if (!native) return Promise.resolve(false);
  return new Promise<boolean>((resolve, reject) => {
    const child = spawn(native.binary, ["--root", native.root, "--web-server-update", "stage"], { windowsHide: true, detached: true, stdio: "ignore" });
    child.once("error", reject);
    child.once("spawn", () => { child.unref(); resolve(true); });
  });
}

type AutoUpdateSettings = {
  serverAutoUpdate?: boolean;
  studioTimezone?: string;
  maintenanceWindowEnabled?: boolean;
  maintenanceWindowTimezone?: string;
  maintenanceWindowDaysCsv?: string;
  maintenanceWindowStart?: string;
  maintenanceWindowDurationMinutes?: number;
};

// Installs wait for the maintenance window; without one, nightly 03:00-04:00
// studio time.
export function inServerUpdateWindow(settings: AutoUpdateSettings, now = Date.now()) {
  const policy = settings.maintenanceWindowEnabled ? settings : {
    maintenanceWindowEnabled: true,
    maintenanceWindowTimezone: validMaintenanceTimezone(settings.studioTimezone || "") ? settings.studioTimezone : "America/New_York",
    maintenanceWindowDaysCsv: "Sun, Mon, Tue, Wed, Thu, Fri, Sat",
    maintenanceWindowStart: "03:00",
    maintenanceWindowDurationMinutes: 60,
  };
  return previewMaintenanceWindows(policy, { now, count: 1 }).windows[0]?.active === true;
}

export type ServerAutoUpdateDeps = {
  dataRoot: string;
  readSettings: () => Promise<AutoUpdateSettings>;
  log: { info: (data: object, message: string) => void };
  logSecurityEvent?: (input: { event: string; result: "SUCCESS" | "FAILURE"; reasonCode: string; metadata?: Record<string, unknown> }) => Promise<unknown>;
  now?: () => number;
  // Injected in tests; default to the installed native binary.
  native?: (action: "check" | "status" | "install") => Promise<NativeUpdateStatus | null>;
  stage?: () => Promise<boolean>;
};

// Check the signed main feed, download what's newer, and hand a verified
// installer to the protected update broker inside the window. The broker
// still stops, backs up, installs, verifies and rolls back on failure.
export async function serverAutoUpdateTick(deps: ServerAutoUpdateDeps): Promise<{ nextDelayMs: number }> {
  const settings = await deps.readSettings();
  const native = deps.native ?? ((action) => readNativeWebUpdate(deps.dataRoot, action));
  if (settings.serverAutoUpdate === false || (!deps.native && !nativeUpdateBinary(deps.dataRoot))) return { nextDelayMs: HOUR };
  const now = deps.now?.() ?? Date.now();
  const status = await native("status");
  if (!status) return { nextDelayMs: HOUR };
  if (["staging", "queued", "installing"].includes(status.state)) return { nextDelayMs: 5 * MINUTE };
  // A rolled-back or blocked install waits for an owner to review it.
  if (["blocked", "recovered"].includes(status.state)) return { nextDelayMs: HOUR };
  if (status.state === "failed" && now - Date.parse(status.updatedAt || "") < HOUR) return { nextDelayMs: HOUR };
  if (status.state === "verified") {
    if (!status.installSupported || !inServerUpdateWindow(settings, now)) return { nextDelayMs: 5 * MINUTE };
    const queued = await native("install");
    deps.log.info({ release: queued?.release }, "Automatic Server update queued for installation");
    await deps.logSecurityEvent?.({ event: "server.update.install_requested", result: "SUCCESS", reasonCode: "AUTOMATIC_SERVER_UPDATE", metadata: { release: queued?.release, sequence: queued?.sequence, channel: "main" } });
    return { nextDelayMs: 5 * MINUTE };
  }
  const check = await native("check");
  if (!check?.available) return { nextDelayMs: 30 * MINUTE };
  await (deps.stage ?? (() => startNativeUpdateStage(deps.dataRoot)))();
  deps.log.info({}, "Automatic Server update download started");
  await deps.logSecurityEvent?.({ event: "server.update.stage_requested", result: "SUCCESS", reasonCode: "AUTOMATIC_SERVER_UPDATE", metadata: { channel: "main" } });
  return { nextDelayMs: 5 * MINUTE };
}
