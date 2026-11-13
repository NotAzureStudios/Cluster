import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type MediaWorkerSupervisorState = "disabled" | "stopped" | "starting" | "running" | "restarting" | "error";
export type MediaWorkerSupervisorStatus = {
  state: MediaWorkerSupervisorState;
  managed: boolean;
  pid: number | null;
  since: string | null;
  restarts: number;
  message: string | null;
};

/** Message the worker understands as "drain active jobs, then exit". */
export const MEDIA_WORKER_SHUTDOWN_MESSAGE = "cluster:media-worker:shutdown";

const SHUTDOWN_GRACE_MS = 15_000;
const STABLE_RUN_MS = 60_000;

/**
 * Runs the standalone media worker as a supervised child of the API server.
 *
 * Media jobs (thumbnails, previews, waveforms, storyboards, encodes) are only
 * claimed from the `media.*` queues by `workers/media-worker`. Packaged Windows
 * installs start only the API server, so without this supervisor those jobs
 * queue forever and Operations raises the `media:no-workers` critical alert.
 *
 * Set CLUSTER_MEDIA_WORKER_MANAGED=off when media workers are run separately
 * (for example on a dedicated GPU machine).
 */
export function createMediaWorkerSupervisor(input: {
  log: { info: (obj: unknown, msg: string) => void; warn: (obj: unknown, msg: string) => void };
  env?: NodeJS.ProcessEnv;
}) {
  const env = input.env ?? process.env;
  const managed = String(env.CLUSTER_MEDIA_WORKER_MANAGED ?? "on").trim().toLowerCase() !== "off";
  const location = path.dirname(fileURLToPath(import.meta.url));
  // Built server: dist/app/this.js -> dist/workers/media-worker.js.
  // Development (tsx): src/app/this.ts -> src/workers/media-worker.ts.
  const entryCandidates = [
    path.resolve(location, "../workers/media-worker.js"),
    path.resolve(location, "../workers/media-worker.ts"),
  ];

  let child: ChildProcess | null = null;
  let wanted = false;
  let closing = false;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;
  let restarts = 0;
  let startedAt = 0;
  let state: MediaWorkerSupervisorState = managed ? "stopped" : "disabled";
  let since: string | null = null;
  let message: string | null = managed ? null : "Media worker is managed outside this server (CLUSTER_MEDIA_WORKER_MANAGED=off).";

  const clearRetry = () => { if (retry) clearTimeout(retry); retry = null; };

  function status(): MediaWorkerSupervisorStatus {
    return { state, managed, pid: child?.pid ?? null, since, restarts, message };
  }

  function launch() {
    if (!managed || !wanted || closing || child) return status();
    const script = entryCandidates.find(existsSync);
    if (!script) {
      state = "error";
      message = "The media worker is missing from this server installation.";
      input.log.warn({ entryCandidates }, "media worker entry not found; media jobs will not be processed");
      return status();
    }
    // A .ts entry only exists in development, where the parent runs under tsx
    // and its loader flags are in execArgv. Built installs run plain .js.
    const execArgv = script.endsWith(".ts") ? process.execArgv : [];
    const spawned = spawn(process.execPath, [...execArgv, script], {
      cwd: process.cwd(),
      env: { ...env, CLUSTER_MEDIA_WORKER_SUPERVISED: "1" },
      windowsHide: true,
      // IPC lets the worker drain gracefully on Windows, where kill() cannot
      // deliver SIGTERM, and lets it exit if this server disappears.
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    child = spawned;
    startedAt = Date.now();
    state = "starting";
    since = new Date().toISOString();
    message = null;

    const forward = (level: "info" | "warn") => (buffer: Buffer) => {
      if (spawned !== child) return;
      if (state === "starting") state = "running";
      for (const line of String(buffer).split(/\r?\n/)) {
        const text = line.trim();
        if (text) input.log[level]({ source: "media-worker", pid: spawned.pid }, text.slice(0, 2_000));
      }
    };
    spawned.stdout?.on("data", forward("info"));
    spawned.stderr?.on("data", forward("warn"));
    spawned.on("spawn", () => { if (spawned === child) input.log.info({ pid: spawned.pid }, "media worker started"); });
    spawned.on("error", (error) => {
      if (spawned !== child) return;
      state = "error";
      message = "The media worker process could not start.";
      input.log.warn({ error }, "media worker failed to start");
    });
    spawned.on("exit", (code, signal) => {
      if (spawned !== child) return;
      child = null;
      if (!wanted || closing) { state = "stopped"; return; }
      // Reset the backoff after a run long enough to count as healthy.
      if (Date.now() - startedAt >= STABLE_RUN_MS) failures = 0;
      const delay = Math.min(300_000, 2_000 * (2 ** Math.min(failures++, 7)));
      restarts += 1;
      state = "restarting";
      message = `Media worker exited (${signal ? `signal ${signal}` : `code ${code}`}); restarting in ${Math.round(delay / 1000)}s.`;
      input.log.warn({ code, signal, delay }, "media worker exited; scheduling restart");
      retry = setTimeout(() => { retry = null; launch(); }, delay);
      retry.unref?.();
    });
    return status();
  }

  function start() {
    wanted = true;
    return launch();
  }

  async function close() {
    closing = true;
    wanted = false;
    clearRetry();
    const running = child;
    if (!running || running.exitCode !== null) { child = null; state = managed ? "stopped" : "disabled"; return; }
    const exited = new Promise<void>((resolve) => running.once("exit", () => resolve()));
    try {
      if (running.connected) running.send({ type: MEDIA_WORKER_SHUTDOWN_MESSAGE });
      else running.kill("SIGTERM");
    } catch {
      running.kill("SIGTERM");
    }
    const timer = setTimeout(() => { if (running.exitCode === null) running.kill("SIGKILL"); }, SHUTDOWN_GRACE_MS);
    timer.unref?.();
    await exited;
    clearTimeout(timer);
    if (child === running) child = null;
    state = "stopped";
  }

  return { status, start, close };
}
