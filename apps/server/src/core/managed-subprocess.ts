import { spawn } from "node:child_process";
import path from "node:path";

/**
 * Bounded custody for short-lived external tools. The promise never settles
 * on kill()/abort/error alone: 'close' is the release boundary for callers
 * that manage database, derivative and restore files around the child.
 * This is not a substitute for Windows Job Objects/process-tree supervision.
 */
export async function runManagedSubprocess(input: {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs: number;
  maxOutputBytes: number;
  captureStdout?: boolean;
  captureStderr?: boolean;
}): Promise<{ stdout: string; stderr: string }> {
  if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1 || input.timeoutMs > 60 * 60_000) {
    throw new Error("MANAGED_PROCESS_TIMEOUT_INVALID: subprocess time limit is invalid.");
  }
  if (!Number.isSafeInteger(input.maxOutputBytes) || input.maxOutputBytes < 1 || input.maxOutputBytes > 16 * 1024 * 1024) {
    throw new Error("MANAGED_PROCESS_CAPTURE_INVALID: subprocess capture limit is invalid.");
  }
  const name = path.basename(input.command);
  if (input.signal?.aborted) throw input.signal.reason instanceof Error ? input.signal.reason : new Error(`${name} was cancelled.`);
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const captureOut = input.captureStdout !== false;
    const captureErr = input.captureStderr !== false;
    const child = spawn(input.command, input.args, {
      env: input.env, windowsHide: true,
      stdio: ["ignore", captureOut ? "pipe" : "ignore", captureErr ? "pipe" : "ignore"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let totalBytes = 0;
    let timedOut = false;
    let overflow = false;
    let stopping = false;
    let settled = false;
    let spawnError: Error | null = null;
    let killTimer: ReturnType<typeof setTimeout> | null = null;
    const terminate = (hard = false) => {
      if (settled) return;
      if (!stopping || hard) {
        stopping = true;
        try { child.kill(hard ? "SIGKILL" : "SIGTERM"); } catch { /* close owns settlement */ }
      }
      if (!hard && !killTimer) {
        killTimer = setTimeout(() => {
          if (!settled) { try { child.kill("SIGKILL"); } catch { /* close owns settlement */ } }
        }, 5_000);
        killTimer.unref?.();
      }
    };
    const onAbort = () => terminate();
    input.signal?.addEventListener("abort", onAbort, { once: true });
    if (input.signal?.aborted) terminate();
    const timer = setTimeout(() => { timedOut = true; terminate(true); }, input.timeoutMs);
    const take = (chunk: Buffer, into: Buffer[]) => {
      if (settled || overflow) return;
      const allowed = Math.max(0, input.maxOutputBytes - totalBytes);
      if (chunk.length > allowed) { overflow = true; terminate(true); }
      if (allowed) into.push(chunk.subarray(0, allowed));
      totalBytes += Math.min(allowed, chunk.length);
    };
    child.stdout?.on("data", (chunk: Buffer) => take(chunk, stdout));
    child.stderr?.on("data", (chunk: Buffer) => take(chunk, stderr));
    child.on("error", (error) => { spawnError = error; });
    child.on("close", (code, exitSignal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      input.signal?.removeEventListener("abort", onAbort);
      if (timedOut) return reject(new Error(`${name} exceeded the ${input.timeoutMs} ms subprocess timeout.`));
      if (overflow) return reject(new Error(`${name} produced more than ${input.maxOutputBytes} bytes of subprocess output.`));
      if (input.signal?.aborted) return reject(input.signal.reason instanceof Error ? input.signal.reason : new Error(`${name} was cancelled.`));
      if (spawnError) return reject(spawnError);
      if (stopping) return reject(new Error(`${name} was terminated.`));
      const out = Buffer.concat(stdout).toString("utf8");
      const err = Buffer.concat(stderr).toString("utf8");
      if (code !== 0) return reject(new Error(err.trim().slice(0, 2000) || `${name} failed with exit code ${code ?? "unknown"}${exitSignal ? ` (${exitSignal})` : ""}.`));
      resolve({ stdout: out, stderr: err });
    });
  });
}
