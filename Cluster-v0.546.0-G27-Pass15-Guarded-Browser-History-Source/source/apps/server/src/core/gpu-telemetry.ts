import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";

/** Advisory, host-level device telemetry. Never use it for authorization or liveness. */
export type GpuDevice = {
  id: string;
  name: string;
  vendor: "nvidia" | "amd" | "intel" | "other";
  driver: string | null;
  utilizationPercent: number | null;
  memoryUtilizationPercent: number | null;
  memoryTotalMiB: number | null;
  memoryUsedMiB: number | null;
  temperatureC: number | null;
  powerWatts: number | null;
};
export type GpuSnapshot = {
  status: "available" | "partial" | "unavailable" | "stale";
  provider: "nvidia-smi" | "linux-drm" | "windows-cim" | "none";
  sampledAt: string | null;
  devices: GpuDevice[];
  metricsSupported: boolean;
};

function metric(value: string, max: number): number | null {
  const text = String(value || "").trim();
  if (!text || /^(?:n\/a|not supported|\[not supported\]|-)$/i.test(text)) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= max ? parsed : null;
}
function csvLine(line: string): string[] {
  const output: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]!;
    if (char === '"' && quoted && line[i + 1] === '"') { current += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { output.push(current.trim()); current = ""; }
    else current += char;
  }
  output.push(current.trim());
  return output;
}

export function parseNvidiaSmi(csv: string): GpuDevice[] {
  return String(csv || "").split(/\r?\n/).filter(Boolean).slice(0, 32).flatMap((line) => {
    const [index, uuid, name, driver, utilization, memoryUtilization, total, used, temperature, power] = csvLine(line);
    if (!index || !name || !/^\d+$/.test(index)) return [];
    const totalMiB = metric(total || "", 16_777_216);
    const usedMiB = metric(used || "", 16_777_216);
    return [{
      id: (uuid && /^GPU-[a-z0-9-]{8,}$/i.test(uuid) ? uuid : `nvidia-${index}`).slice(0, 96),
      name: name.slice(0, 160), vendor: "nvidia" as const, driver: driver?.slice(0, 80) || null,
      utilizationPercent: metric(utilization || "", 100),
      memoryUtilizationPercent: metric(memoryUtilization || "", 100),
      memoryTotalMiB: totalMiB,
      memoryUsedMiB: totalMiB != null && usedMiB != null ? Math.min(usedMiB, totalMiB) : usedMiB,
      temperatureC: metric(temperature || "", 150), powerWatts: metric(power || "", 2500),
    }];
  });
}

export type GpuCommandRunner = (command: string, args: string[], timeoutMs: number) => Promise<string>;
export async function runGpuCommand(command: string, args: string[], timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(Buffer.concat(chunks).toString("utf8"));
    };
    const timer = setTimeout(() => { child.kill(); finish(new Error("GPU probe timeout")); }, timeoutMs);
    timer.unref?.();
    child.stdout?.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 64 * 1024) { child.kill(); finish(new Error("GPU probe output exceeded limit")); }
      else chunks.push(chunk);
    });
    child.on("error", (error) => finish(error));
    child.on("close", (code) => finish(code === 0 ? undefined : new Error("GPU probe unavailable")));
  });
}

async function linuxDrmDevices(): Promise<GpuDevice[]> {
  const root = "/sys/class/drm";
  const entries = await readdir(root).catch(() => []);
  const result: GpuDevice[] = [];
  for (const entry of entries.filter((item) => /^card\d+$/.test(item)).slice(0, 32)) {
    const base = `${root}/${entry}/device`;
    const vendor = (await readFile(`${base}/vendor`, "utf8").catch(() => "")).trim().toLowerCase();
    const type: GpuDevice["vendor"] = vendor === "0x10de" ? "nvidia" : vendor === "0x1002" ? "amd" : vendor === "0x8086" ? "intel" : "other";
    if (!vendor) continue;
    const device = (await readFile(`${base}/device`, "utf8").catch(() => "")).trim();
    result.push({ id: `${entry}-${vendor}-${device}`.slice(0, 96), name: `${type.toUpperCase()} device ${device || entry}`, vendor: type, driver: null,
      utilizationPercent: null, memoryUtilizationPercent: null, memoryTotalMiB: null, memoryUsedMiB: null, temperatureC: null, powerWatts: null });
  }
  return result;
}

async function windowsCimDevices(run: GpuCommandRunner): Promise<GpuDevice[]> {
  const command = "Get-CimInstance Win32_VideoController | Select-Object Name,AdapterCompatibility,DriverVersion,PNPDeviceID | ConvertTo-Json -Compress";
  const text = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], 2_500);
  const parsed: unknown = JSON.parse(text);
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows.slice(0, 16).flatMap((row, index) => {
    if (!row || typeof row !== "object") return [];
    const record = row as Record<string, unknown>;
    const name = String(record.Name || "").slice(0, 160);
    if (!name) return [];
    const vendorText = `${name} ${record.AdapterCompatibility || ""}`.toLowerCase();
    const vendor: GpuDevice["vendor"] = /nvidia/.test(vendorText) ? "nvidia" : /amd|radeon|advanced micro/.test(vendorText) ? "amd" : /intel/.test(vendorText) ? "intel" : "other";
    return [{ id: `windows-${index}`, name, vendor, driver: String(record.DriverVersion || "").slice(0, 80) || null,
      utilizationPercent: null, memoryUtilizationPercent: null, memoryTotalMiB: null, memoryUsedMiB: null, temperatureC: null, powerWatts: null }];
  });
}

export class GpuTelemetry {
  private value: GpuSnapshot = { status: "unavailable", provider: "none", sampledAt: null, devices: [], metricsSupported: false };
  private nextAt = 0;
  private pending: Promise<GpuSnapshot> | null = null;
  private readonly options: { runner?: GpuCommandRunner; platform?: string; ttlMs?: number };
  constructor(options: { runner?: GpuCommandRunner; platform?: string; ttlMs?: number } = {}) { this.options = options; }
  snapshot(): GpuSnapshot {
    if (this.value.sampledAt && Date.now() - Date.parse(this.value.sampledAt) > 120_000) return { ...this.value, status: "stale" };
    return { ...this.value, devices: this.value.devices.map((device) => ({ ...device })) };
  }
  async sample(): Promise<GpuSnapshot> {
    if (this.pending) return this.pending;
    if (Date.now() < this.nextAt) return this.snapshot();
    this.pending = this.read().then((snapshot) => {
      this.value = snapshot;
      this.nextAt = Date.now() + Math.max(5_000, this.options.ttlMs ?? (snapshot.status === "unavailable" ? 60_000 : 20_000));
      return this.snapshot();
    }).finally(() => { this.pending = null; });
    return this.pending;
  }
  private async read(): Promise<GpuSnapshot> {
    const run = this.options.runner || runGpuCommand;
    const platform = this.options.platform || process.platform;
    let provider: GpuSnapshot["provider"] = "none";
    let devices: GpuDevice[] = [];
    try {
      const output = await run("nvidia-smi", ["--query-gpu=index,uuid,name,driver_version,utilization.gpu,utilization.memory,memory.total,memory.used,temperature.gpu,power.draw", "--format=csv,noheader,nounits"], 2_500);
      devices = parseNvidiaSmi(output);
      if (devices.length) provider = "nvidia-smi";
    } catch { /* NVIDIA tooling is optional. */ }
    // An unavailable sensor is not a zero-utilization GPU. Enumerate device identity only.
    if (platform === "linux") {
      const enumerated = await linuxDrmDevices();
      if (!devices.length && enumerated.length) { devices = enumerated; provider = "linux-drm"; }
      else if (devices.length) {
        for (const extra of enumerated.filter((item) => item.vendor !== "nvidia")) devices.push(extra);
      }
    } else if (platform === "win32" && !devices.length) {
      try { devices = await windowsCimDevices(run); if (devices.length) provider = "windows-cim"; } catch { /* Windows CIM can be unavailable. */ }
    }
    const metricsSupported = devices.some((device) => device.utilizationPercent != null || device.memoryUsedMiB != null);
    return { status: devices.length ? (metricsSupported ? "available" : "partial") : "unavailable", provider, sampledAt: new Date().toISOString(), devices, metricsSupported };
  }
}

/** Do not start CUDA work simply because the FFmpeg binary lists CUDA filters.
 * CUDA must also correspond to an enumerated NVIDIA device on this host.
 */
export function hasCudaDevice(snapshot: GpuSnapshot): boolean {
  return snapshot.status !== "unavailable" && snapshot.status !== "stale" && snapshot.devices.some((device) => device.vendor === "nvidia");
}

/** High GPU pressure should only influence optional accelerated jobs, never HTTP or PostgreSQL admission. */
export function chooseGpuEncodeAdmission(snapshot: GpuSnapshot, profile: string, options: { reserveMiB?: number; busyPercent?: number } = {}) {
  if (profile === "software") return { profile: "software" as const, reason: "software-requested" };
  if (profile !== "nvenc") return { profile: "accelerated" as const, reason: "hardware-encoder-selected" };
  const devices = snapshot.status === "available" ? snapshot.devices.filter((device) => device.vendor === "nvidia") : [];
  if (!devices.length) return { profile: "accelerated" as const, reason: "gpu-metrics-unknown" }; // FFmpeg retains its tested CPU fallback.
  const reserveMiB = Math.max(128, options.reserveMiB ?? 512);
  const busyPercent = Math.min(100, Math.max(50, options.busyPercent ?? 94));
  const eligible = devices.some((device) => (device.utilizationPercent == null || device.utilizationPercent < busyPercent)
    && (device.memoryTotalMiB == null || device.memoryUsedMiB == null || device.memoryTotalMiB - device.memoryUsedMiB >= reserveMiB));
  return eligible ? { profile: "accelerated" as const, reason: "gpu-capacity-available" } : { profile: "software" as const, reason: "gpu-pressure" };
}

/**
 * Adaptive GPU media capacity. This is a conservative *admission* estimate, not a
 * CUDA-core benchmark. The FFmpeg capability probe still decides which codecs
 * can run on hardware. Missing sensors never mean an idle GPU.
 */
export function computeGpuMediaBudget(
  snapshot: GpuSnapshot,
  profile: string,
  options: { maxJobs?: number; memoryPerJobMiB?: number; reservePercent?: number; busyPercent?: number; thermalCeilingC?: number } = {},
) {
  const maxJobs = Math.max(1, Math.min(16, Math.floor(options.maxJobs ?? 4)));
  if (profile === "software") return { limit: 0, reason: "software-only", deviceId: null as string | null };
  const vendor = profile === "nvenc" ? "nvidia" : profile === "amf" ? "amd" : profile === "qsv" ? "intel" : null;
  // Keep the same cross-worker quota identity when sensor samples become
  // stale. Otherwise "unidentified" and UUID pools could overlap capacity.
  if (snapshot.status === "stale") return { limit: 1, reason: "stale-sensor-conservative", deviceId: snapshot.devices.find((device) => !vendor || device.vendor === vendor)?.id ?? null };
  // FFmpeg is not passed an explicit device selector by the current job
  // executor. It therefore uses its default matching adapter. Budget only the
  // first matching card; choosing the least-busy second card here would count
  // capacity on a board FFmpeg might never use.
  const devices = snapshot.devices.filter((d) => !vendor || d.vendor === vendor).slice(0, 1);
  const candidates = devices.map((device) => {
    const utilization = device.utilizationPercent;
    const total = device.memoryTotalMiB;
    const used = device.memoryUsedMiB;
    const reserve = total == null ? null : Math.max(256, Math.ceil(total * (options.reservePercent ?? 0.15)));
    const free = total == null || used == null || reserve == null ? null : Math.max(0, total - used - reserve);
    const unit = Math.max(256, options.memoryPerJobMiB ?? Math.min(2048, Math.max(512, Math.round((total ?? 2048) * 0.3))));
    const memoryCapacity = free == null ? 1 : Math.floor(free / unit);
    const deviceTier = total == null ? 1 : Math.max(1, Math.ceil(total / 4096));
    const capacity = Math.min(memoryCapacity, deviceTier);
    const pressure = utilization == null ? 1 : utilization >= (options.busyPercent ?? 92) ? 0 : utilization >= 75 ? 0.5 : 1;
    const ceiling = Math.max(65, Math.min(105, options.thermalCeilingC ?? 88));
    const thermal = device.temperatureC == null ? 1 : device.temperatureC >= ceiling ? 0 : device.temperatureC >= ceiling - 8 ? 0.5 : 1;
    return { deviceId: device.id, limit: Math.min(maxJobs, Math.floor(capacity * pressure * thermal)) };
  });
  const best = candidates[0];
  if (!best) return { limit: 1, reason: "metrics-unavailable-fallback", deviceId: null as string | null };
  return { limit: best.limit, reason: best.limit ? "capacity-available" : "gpu-pressure", deviceId: best.deviceId };
}

/** Fair concurrency gate; capacity changes never interrupt work already running. */
export class GpuEncodeLimiter {
  private running = 0;
  private readonly waiting: Array<{ grant: () => void; cancel: () => void }> = [];
  limit: number;
  constructor(limit = 1) { this.limit = Math.max(1, Math.floor(limit)); }
  setLimit(limit: number) { this.limit = Math.max(1, Math.floor(limit)); this.pump(); }
  private pump() {
    while (this.running < this.limit && this.waiting.length) {
      const entry = this.waiting.shift()!;
      this.running += 1; // Reserve the slot before waking the waiter.
      entry.grant();
    }
  }
  snapshot() { return { active: this.running, waiting: this.waiting.length, limit: this.limit }; }
  async run<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) throw new Error("GPU encode cancelled before admission");
    if (this.running < this.limit && !this.waiting.length) this.running += 1;
    else await new Promise<void>((resolve, reject) => {
      const entry = {
        grant: () => { signal?.removeEventListener("abort", entry.cancel); resolve(); },
        cancel: () => {
          const index = this.waiting.indexOf(entry);
          if (index >= 0) this.waiting.splice(index, 1);
          reject(new Error("GPU encode cancelled while queued"));
        },
      };
      signal?.addEventListener("abort", entry.cancel, { once: true });
      this.waiting.push(entry);
    });
    try {
      if (signal?.aborted) throw new Error("GPU encode cancelled before admission");
      return await work();
    } finally { this.running -= 1; this.pump(); }
  }
}
