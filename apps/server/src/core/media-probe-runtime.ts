import { spawn } from "node:child_process";
import path from "node:path";

/** Small, bounded command capture for ffprobe and FFmpeg capability probes.
 * A requested kill is not completion: all pipe handles must close before
 * a caller is allowed to release or replace the tool's source files.
 */
export async function captureMediaCommand(command: string, args: string[], timeoutMs = 8_000, maximumCaptureBytes = 2 * 1024 * 1024): Promise<string> {
  if (!Number.isSafeInteger(maximumCaptureBytes) || maximumCaptureBytes < 1 || maximumCaptureBytes > 16 * 1024 * 1024) {
    throw new Error("MEDIA_PROBE_CAPTURE_LIMIT_INVALID: capture limit is invalid.");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5 * 60_000) {
    throw new Error("MEDIA_PROBE_TIMEOUT_INVALID: timeout is invalid.");
  }
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const output: Buffer[] = [];
    const errors: Buffer[] = [];
    let outputBytes = 0;
    let errorBytes = 0;
    let timedOut = false;
    let overflow = false;
    let spawnError: Error | null = null;
    let settled = false;
    const stop = () => {
      if (!settled) { try { child.kill("SIGKILL"); } catch { /* close owns settlement */ } }
    };
    const timeout = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    const capture = (chunk: Buffer, chunks: Buffer[], size: number) => {
      if (settled || overflow) return size;
      const allowed = Math.max(0, maximumCaptureBytes - size);
      if (chunk.length > allowed) {
        overflow = true;
        stop();
      }
      if (allowed) chunks.push(chunk.subarray(0, allowed));
      return size + Math.min(chunk.length, allowed);
    };
    child.stdout?.on("data", (chunk: Buffer) => { outputBytes = capture(chunk, output, outputBytes); });
    child.stderr?.on("data", (chunk: Buffer) => { errorBytes = capture(chunk, errors, errorBytes); });
    child.on("error", (error) => { spawnError = error; });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (timedOut) return reject(new Error(`${path.basename(command)} timed out.`));
      if (overflow) return reject(new Error("MEDIA_PROBE_CAPTURE_OVERFLOW: tool output exceeded its bounded capture limit."));
      if (spawnError) return reject(spawnError);
      const stdout = Buffer.concat(output, outputBytes).toString("utf8").trim();
      const stderr = Buffer.concat(errors, errorBytes).toString("utf8").trim();
      if (code !== 0) return reject(new Error(stderr || `${path.basename(command)} exited with code ${code ?? "unknown"}${signal ? ` (${signal})` : ""}.`));
      resolve(stdout || stderr);
    });
  });
}
