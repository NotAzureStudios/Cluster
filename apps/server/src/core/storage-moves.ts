// Move a storage location (Library, Projects, ...) to another folder or drive
// while the Server keeps running:
//   1. copy everything to the new folder (the Server still uses the old one)
//   2. copy anything that changed meanwhile, point the config at the new
//      folder and ask the native supervisor to restart
//   3. after the restart, copy anything written during the switch, then
//      delete the old folder
// The state file lets step 3 run after the restart and survive crashes.
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

export const MOVABLE_STORAGE = {
  library: { label: "Library", key: "libraryRootOverride" },
  projects: { label: "Projects", key: "projectsRootOverride" },
  users: { label: "User data", key: "usersRootOverride" },
  uploads: { label: "Uploads", key: "uploadRootOverride" },
  backups: { label: "Backups", key: "backupsRootOverride" },
  exports: { label: "Exports", key: "exportsRootOverride" },
  branding: { label: "Branding", key: "brandingRootOverride" },
} as const;
export type MovableStorageDomain = keyof typeof MOVABLE_STORAGE;

export type StorageMoveState = {
  domain: MovableStorageDomain;
  from: string;
  to: string;
  phase: "copying" | "switching" | "finishing" | "done" | "failed";
  totalBytes: number;
  copiedBytes: number;
  totalFiles: number;
  copiedFiles: number;
  error?: string;
  startedAt: string;
  updatedAt: string;
};

const samePath = (a: string, b: string) => process.platform === "win32" ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b);
const contains = (parent: string, child: string) => {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
};

async function* walk(root: string, relative = ""): AsyncGenerator<{ relative: string; size: number; mtimeMs: number }> {
  let entries;
  try { entries = await fs.readdir(path.join(root, relative), { withFileTypes: true }); } catch (error: any) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    const rel = path.join(relative, entry.name);
    if (entry.isDirectory()) yield* walk(root, rel);
    else if (entry.isFile()) {
      const stat = await fs.stat(path.join(root, rel)).catch(() => null);
      if (stat) yield { relative: rel, size: stat.size, mtimeMs: stat.mtimeMs };
    }
  }
}

export async function directoryUsage(root: string) {
  let bytes = 0;
  let files = 0;
  for await (const file of walk(root)) { bytes += file.size; files += 1; }
  return { bytes, files };
}

// Sizes are slow to compute for a big Library; cache them and refresh in the
// background so the settings page never waits on a full scan.
const usageCache = new Map<string, { bytes: number; files: number; at: number; pending?: Promise<void> }>();
export function cachedDirectoryUsage(root: string, maxAgeMs = 10 * 60_000) {
  const key = path.resolve(root);
  const cached = usageCache.get(key);
  if (!cached || (Date.now() - cached.at > maxAgeMs && !cached.pending)) {
    const entry = cached || { bytes: -1, files: -1, at: 0 };
    entry.pending = directoryUsage(key).then((usage) => { Object.assign(entry, usage, { at: Date.now() }); })
      .catch(() => undefined).finally(() => { entry.pending = undefined; });
    usageCache.set(key, entry);
  }
  const current = usageCache.get(key)!;
  return current.at ? { bytes: current.bytes, files: current.files, measuredAt: new Date(current.at).toISOString() } : null;
}

export async function driveSpace(target: string) {
  // The folder may not exist yet; measure the nearest existing parent.
  let probe = path.resolve(target);
  for (;;) {
    try {
      const stats = await fs.statfs(probe);
      const block = Number(stats.bsize || 0);
      return { totalBytes: Number(stats.blocks) * block, freeBytes: Number(stats.bavail) * block };
    } catch {
      const parent = path.dirname(probe);
      if (parent === probe) return null;
      probe = parent;
    }
  }
}

// Copies files missing from the target or changed since the last pass.
async function syncTree(from: string, to: string, onFile?: (size: number) => Promise<void> | void) {
  for await (const file of walk(from)) {
    const source = path.join(from, file.relative);
    const target = path.join(to, file.relative);
    const existing = await fs.stat(target).catch(() => null);
    if (existing && existing.size === file.size && existing.mtimeMs >= file.mtimeMs) { await onFile?.(file.size); continue; }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target);
    const mtime = new Date(file.mtimeMs);
    await fs.utimes(target, mtime, mtime).catch(() => undefined);
    await onFile?.(file.size);
  }
}

async function verifyCopy(from: string, to: string) {
  for await (const file of walk(from)) {
    const copy = await fs.stat(path.join(to, file.relative)).catch(() => null);
    if (!copy || copy.size !== file.size) throw new Error(`Copy check failed for ${file.relative}`);
  }
}

export function createStorageMoves(input: {
  stateFile: string;
  currentPath: (domain: MovableStorageDomain) => string;
  allPaths: () => string[];
  pointConfigAt: (domain: MovableStorageDomain, target: string) => Promise<void>;
  requestRestart: () => Promise<void>;
  log: { info: (data: object, message: string) => void; error: (data: object, message: string) => void };
}) {
  let running: Promise<void> | null = null;

  async function read(): Promise<StorageMoveState | null> {
    try { return JSON.parse(await fs.readFile(input.stateFile, "utf8")); } catch { return null; }
  }
  async function write(state: StorageMoveState) {
    state.updatedAt = new Date().toISOString();
    await fs.mkdir(path.dirname(input.stateFile), { recursive: true });
    const temporary = `${input.stateFile}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(state));
    await fs.rename(temporary, input.stateFile);
  }
  function track(state: StorageMoveState) {
    let lastWrite = 0;
    return async (size: number) => {
      state.copiedBytes += size;
      state.copiedFiles += 1;
      if (Date.now() - lastWrite > 1000) { lastWrite = Date.now(); await write(state); }
    };
  }
  async function fail(state: StorageMoveState, error: unknown) {
    state.phase = "failed";
    state.error = error instanceof Error ? error.message : String(error);
    await write(state);
    input.log.error({ domain: state.domain, error: state.error }, "Storage move failed");
  }

  async function validate(domain: MovableStorageDomain, rawTarget: string) {
    if (!(domain in MOVABLE_STORAGE)) throw new Error("That storage location can't be moved.");
    const target = rawTarget.trim();
    if (!path.isAbsolute(target)) throw new Error("Enter a full folder path, like D:\\Cluster\\Library.");
    const from = input.currentPath(domain);
    if (samePath(from, target)) throw new Error(`${MOVABLE_STORAGE[domain].label} is already stored there.`);
    for (const other of input.allPaths()) {
      if (samePath(other, from)) continue;
      if (contains(other, target) || contains(target, other)) throw new Error(`That folder overlaps another Cluster location (${other}).`);
    }
    if (contains(from, target)) throw new Error("The new folder can't be inside the current one.");
    const entries = await fs.readdir(target).catch((error: any) => { if (error?.code === "ENOENT") return []; throw error; });
    if (entries.length) throw new Error("The new folder must be empty.");
    await fs.mkdir(target, { recursive: true });
    const probe = path.join(target, `.cluster-write-test-${process.pid}`);
    await fs.writeFile(probe, "ok");
    await fs.rm(probe, { force: true });
    const usage = await directoryUsage(from);
    const space = await driveSpace(target);
    if (space && space.freeBytes < usage.bytes * 1.05 + 256 * 1024 * 1024) {
      throw new Error(`Not enough free space: needs ${Math.ceil(usage.bytes / 1024 ** 3)} GB, ${Math.floor(space.freeBytes / 1024 ** 3)} GB free.`);
    }
    return { from, target, usage };
  }

  async function start(domain: MovableStorageDomain, rawTarget: string) {
    const current = await read();
    if (running || (current && ["copying", "switching", "finishing"].includes(current.phase))) throw new Error("Another storage move is already running.");
    const { from, target, usage } = await validate(domain, rawTarget);
    const now = new Date().toISOString();
    const state: StorageMoveState = { domain, from, to: target, phase: "copying", totalBytes: usage.bytes, copiedBytes: 0, totalFiles: usage.files, copiedFiles: 0, startedAt: now, updatedAt: now };
    await write(state);
    input.log.info({ domain, from, to: target, bytes: usage.bytes }, "Storage move started");
    running = (async () => {
      try {
        await syncTree(from, target, track(state));
        await syncTree(from, target);
        await verifyCopy(from, target);
        state.phase = "switching";
        await write(state);
        await input.pointConfigAt(domain, target);
        await input.requestRestart();
      } catch (error) {
        await fail(state, error);
      }
    })().finally(() => { running = null; });
    return state;
  }

  // Runs on every boot (and periodically): finishes a move once the Server
  // is running on the new folder.
  async function resume() {
    const state = await read();
    if (!state || state.phase !== "switching" && state.phase !== "finishing" || running) return;
    if (!samePath(input.currentPath(state.domain), state.to)) return; // restart hasn't happened yet
    running = (async () => {
      try {
        state.phase = "finishing";
        await write(state);
        await syncTree(state.from, state.to);
        await verifyCopy(state.from, state.to);
        await fs.rm(state.from, { recursive: true, force: true });
        state.phase = "done";
        await write(state);
        input.log.info({ domain: state.domain, to: state.to }, "Storage move finished; old folder removed");
      } catch (error) {
        await fail(state, error);
      }
    })().finally(() => { running = null; });
  }

  async function dismiss() {
    const state = await read();
    if (state && (state.phase === "done" || state.phase === "failed")) await fs.rm(input.stateFile, { force: true });
  }

  return { start, resume, read, dismiss };
}

// Used by the restart route and storage moves: ask the native supervisor to
// drain and restart the Server.
export async function requestNativeRestart(runtimeDir: string, configFile: string, requestId: string) {
  const { createHash } = await import("node:crypto");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(configFile)) hash.update(chunk);
  const body = JSON.stringify({ schema: 1, action: "restart", requestId, createdAt: new Date().toISOString(), configSha256: hash.digest("hex") });
  await fs.mkdir(runtimeDir, { recursive: true, mode: 0o700 });
  const handle = await fs.open(path.join(runtimeDir, "cluster-restart-request.json"), "wx", 0o600);
  try { await handle.writeFile(body, "utf8"); await handle.sync(); } finally { await handle.close(); }
}
