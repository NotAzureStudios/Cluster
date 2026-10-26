import path from "node:path";
import { spawn } from "node:child_process";

export type MediaCancellationCheck = (() => Promise<boolean>) & { signal?: AbortSignal };

/**
 * The caller may release its media/GPU lease only after this promise settles.
 * In particular, a timeout must not settle merely because kill() was sent:
 * Windows process termination is asynchronous and the encoder may still own
 * its output file or hardware session until the OS reports child close.
 */
export async function runMediaProcess(input: {
  command: string;
  args: string[];
  cancellationRequested: MediaCancellationCheck;
  onProgress?: (fraction: number) => Promise<void>;
  durationSeconds?: number | null;
  timeoutMs?: number;
  /** Physical UUID only. Never accept a request-supplied CUDA index or env map. */
  nvidiaGpuUuid?: string;
}) {
  if (input.nvidiaGpuUuid && !/^GPU-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.nvidiaGpuUuid)) {
    throw new Error("MEDIA_GPU_DEVICE_INVALID: Only verified NVIDIA GPU UUIDs are accepted for subprocess affinity.");
  }
  if (input.cancellationRequested.signal?.aborted) {
    throw new Error("MEDIA_JOB_CANCELLED: media processing was cancelled before launch.");
  }
  // A failed async cancel check must never be interpreted as permission to
  // publish an artifact, particularly during a database outage.
  if (await input.cancellationRequested()) {
    throw new Error("MEDIA_JOB_CANCELLED: media processing was cancelled before launch.");
  }
  return new Promise<{ stderr: string }>((resolve, reject) => {
    const child = spawn(input.command, input.args, {
      windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
      // Constrain CUDA device enumeration for this child alone, never mutate
      // process.env (parallel CPU work and other GPUs must remain independent).
      ...(input.nvidiaGpuUuid ? { env: { ...process.env, CUDA_VISIBLE_DEVICES: input.nvidiaGpuUuid } } : {}),
    });
    let stderr = "";
    let stdoutRemainder = "";
    let settled = false;
    let stopping = false;
    let timedOut = false;
    let malformedProgress = false;
    let progressFailure: unknown = null;
    let spawnError: Error | null = null;
    let progressWriting = false;
    let progressPromise: Promise<void> | null = null;
    let lastProgress = -1;
    let lastProgressAt = 0;
    let cancellationKillTimer: ReturnType<typeof setTimeout> | null = null;

    const terminate = () => {
      if (settled) return;
      if (!stopping) {
        stopping = true;
        try { child.kill("SIGTERM"); } catch { /* close/error remains authoritative */ }
      }
      if (!cancellationKillTimer) {
        cancellationKillTimer = setTimeout(() => {
          if (!settled) { try { child.kill("SIGKILL"); } catch { /* close/error remains authoritative */ } }
        }, 5_000);
        cancellationKillTimer.unref?.();
      }
    };
    const cancellationSignal = input.cancellationRequested.signal;
    cancellationSignal?.addEventListener("abort", terminate, { once: true });
    // Abort can occur between the pre-launch check and listener registration.
    if (cancellationSignal?.aborted) terminate();
    const cancellationTimer = cancellationSignal ? null : setInterval(() => {
      void input.cancellationRequested().then((cancelled) => {
        if (cancelled) terminate();
      }).catch((error) => { progressFailure = error; terminate(); });
    }, 2_500);
    cancellationTimer?.unref?.();
    const timeout = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      terminate();
    }, input.timeoutMs ?? 6 * 60 * 60 * 1000);

    const cleanup = () => {
      clearTimeout(timeout);
      if (cancellationTimer) clearInterval(cancellationTimer);
      if (cancellationKillTimer) clearTimeout(cancellationKillTimer);
      cancellationSignal?.removeEventListener("abort", terminate);
    };

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-32_000);
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      if (settled || stopping) return;
      stdoutRemainder += chunk.toString("utf8");
      // FFmpeg progress is line-oriented. Missing delimiters must not allow a
      // malicious/broken media subprocess to retain unlimited worker RAM.
      if (stdoutRemainder.length > 64 * 1024) {
        malformedProgress = true;
        stdoutRemainder = "";
        terminate();
        return;
      }
      const lines = stdoutRemainder.split(/\r?\n/);
      stdoutRemainder = lines.pop() || "";
      for (const line of lines) {
        const [key, value] = line.split("=", 2);
        if ((key === "out_time_us" || key === "out_time_ms") && input.durationSeconds && input.onProgress) {
          const microseconds = Number(value);
          if (!Number.isFinite(microseconds) || microseconds < 0) continue;
          const fraction = Math.max(0, Math.min(1, microseconds / 1_000_000 / input.durationSeconds));
          const step = Math.floor(fraction * 100);
          const now = Date.now();
          if (!progressWriting && step >= lastProgress + 2 && (lastProgressAt === 0 || now - lastProgressAt >= 750 || step >= 99)) {
            lastProgress = step;
            lastProgressAt = now;
            progressWriting = true;
            progressPromise = Promise.resolve().then(() => input.onProgress!(fraction)).catch((error) => {
              progressFailure = error;
              terminate();
            }).finally(() => { progressWriting = false; });
          }
        }
      }
    });
    // A spawn error precedes close; the child/stderr handles still own the
    // process lifecycle. Keep leases held until Node emits close.
    child.on("error", (error) => { spawnError = error; });
    child.on("close", async (code, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (progressPromise) await progressPromise;
      if (timedOut) return reject(new Error(`${path.basename(input.command)} exceeded the media job timeout.`));
      if (malformedProgress) return reject(new Error("MEDIA_PROCESS_PROGRESS_OVERFLOW: FFmpeg progress exceeded its bounded buffer."));
      if (progressFailure) return reject(progressFailure);
      if (spawnError) return reject(spawnError);
      // Query again at the publication boundary. Failure to read the durable
      // cancellation state is an error, not evidence that cancellation is false.
      try {
        if (cancellationSignal?.aborted || await input.cancellationRequested()) {
          reject(new Error("MEDIA_JOB_CANCELLED: media processing was cancelled."));
          return;
        }
      } catch (error) { reject(error); return; }
      if (stopping) return reject(new Error("MEDIA_JOB_CANCELLED: media process was terminated."));
      if (code !== 0) {
        reject(new Error((stderr.trim() || `${path.basename(input.command)} exited with code ${code ?? "unknown"}${signal ? ` (${signal})` : ""}.`).slice(-4000)));
        return;
      }
      resolve({ stderr });
    });
  });
}
