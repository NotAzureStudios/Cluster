import path from "node:path";
import { spawn } from "node:child_process";

export type MediaCancellationCheck = (() => Promise<boolean>) & { signal?: AbortSignal };

export async function runMediaProcess(input: {
  command: string;
  args: string[];
  cancellationRequested: MediaCancellationCheck;
  onProgress?: (fraction: number) => Promise<void>;
  durationSeconds?: number | null;
  timeoutMs?: number;
}) {
  return new Promise<{ stderr: string }>((resolve, reject) => {
    const child = spawn(input.command, input.args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    let stdoutRemainder = "";
    let settled = false;
    let lastProgress = -1;
    let lastProgressAt = 0;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`${path.basename(input.command)} exceeded the media job timeout.`));
    }, input.timeoutMs ?? 6 * 60 * 60 * 1000);

    let cancellationKillTimer: ReturnType<typeof setTimeout> | null = null;
    const terminateForCancellation = () => {
      if (settled) return;
      child.kill("SIGTERM");
      if (!cancellationKillTimer) {
        cancellationKillTimer = setTimeout(() => {
          if (!settled) child.kill("SIGKILL");
        }, 5_000);
        cancellationKillTimer.unref?.();
      }
    };
    const cancellationSignal = input.cancellationRequested.signal;
    cancellationSignal?.addEventListener("abort", terminateForCancellation, { once: true });
    const cancellationTimer = cancellationSignal ? null : setInterval(() => {
      void input.cancellationRequested().then((cancelled) => {
        if (cancelled) terminateForCancellation();
      }).catch(() => undefined);
    }, 2_500);
    cancellationTimer?.unref?.();

    const cleanup = () => {
      clearTimeout(timeout);
      if (cancellationTimer) clearInterval(cancellationTimer);
      if (cancellationKillTimer) clearTimeout(cancellationKillTimer);
      cancellationSignal?.removeEventListener("abort", terminateForCancellation);
    };

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-32_000);
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutRemainder += chunk.toString("utf8");
      const lines = stdoutRemainder.split(/\r?\n/);
      stdoutRemainder = lines.pop() || "";
      for (const line of lines) {
        const [key, value] = line.split("=", 2);
        if ((key === "out_time_us" || key === "out_time_ms") && input.durationSeconds && input.onProgress) {
          const microseconds = Number(value);
          const fraction = Math.max(0, Math.min(1, microseconds / 1_000_000 / input.durationSeconds));
          const step = Math.floor(fraction * 100);
          const now = Date.now();
          if (step >= lastProgress + 2 && (lastProgressAt === 0 || now - lastProgressAt >= 750 || step >= 99)) {
            lastProgress = step;
            lastProgressAt = now;
            void input.onProgress(fraction);
          }
        }
      }
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    });
    child.on("close", async (code, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        if (await input.cancellationRequested()) {
          reject(new Error("MEDIA_JOB_CANCELLED: media processing was cancelled."));
          return;
        }
      } catch {}
      if (code !== 0) {
        reject(new Error((stderr.trim() || `${path.basename(input.command)} exited with code ${code ?? "unknown"}${signal ? ` (${signal})` : ""}.`).slice(-4000)));
        return;
      }
      resolve({ stderr });
    });
  });
}
