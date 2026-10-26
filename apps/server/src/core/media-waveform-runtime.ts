import { spawn } from "node:child_process";
import type { WaveformData } from "@cluster/shared";
import type { MediaCancellationCheck } from "./media-process-runtime.js";

/**
 * Extract bounded PCM peaks. Only a successfully closed FFmpeg process with a
 * verified cancellation state may produce a durable waveform. In particular,
 * killing a child does not itself release the media job's storage/GPU lease.
 */
export async function extractWaveformData(input: {
  ffmpegPath: string;
  sourcePath: string;
  durationSeconds: number | null;
  cancellationRequested: MediaCancellationCheck;
  maxWaveformBins: number;
  timeoutMs?: number;
}): Promise<WaveformData> {
  const sampleRateHz = 8_000;
  const maxBins = input.maxWaveformBins;
  if (!Number.isSafeInteger(maxBins) || maxBins < 1 || maxBins > 250_000) {
    throw new Error("MEDIA_WAVEFORM_BUDGET_INVALID: maximum waveform bins is invalid.");
  }
  const duration = input.durationSeconds && Number.isFinite(input.durationSeconds) && input.durationSeconds > 0
    ? input.durationSeconds : null;
  const targetBins = Math.min(maxBins, Math.max(256, Math.ceil(Math.max(1, duration || 60) * 20)));
  const samplesPerBin = Math.max(1, Math.ceil(Math.max(1, duration || targetBins / 20) * sampleRateHz / targetBins));
  const signal = input.cancellationRequested.signal;
  if (signal?.aborted || await input.cancellationRequested()) {
    throw new Error("MEDIA_JOB_CANCELLED: waveform processing was cancelled before launch.");
  }
  return new Promise<WaveformData>((resolve, reject) => {
    const child = spawn(input.ffmpegPath, ["-v", "error", "-i", input.sourcePath, "-map", "0:a:0", "-ac", "1", "-ar", String(sampleRateHz), "-f", "s16le", "pipe:1"], {
      windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    });
    const peaks: number[] = [];
    let binPeak = 0;
    let binCount = 0;
    let totalSamples = 0;
    let sumSquares = 0;
    let globalPeak = 0;
    let pendingByte: number | null = null;
    let stderr = "";
    let settled = false;
    let stopping = false;
    let timedOut = false;
    let overflow = false;
    let processError: Error | null = null;
    let cancellationError: unknown = null;
    let killTimer: ReturnType<typeof setTimeout> | null = null;
    let checkingCancellation = false;

    const terminate = () => {
      if (settled) return;
      if (!stopping) {
        stopping = true;
        try { child.kill("SIGTERM"); } catch { /* Close/error owns settlement. */ }
      }
      if (!killTimer) {
        killTimer = setTimeout(() => {
          if (!settled) { try { child.kill("SIGKILL"); } catch { /* Close/error owns settlement. */ } }
        }, 5_000);
        killTimer.unref?.();
      }
    };
    const cancelTimer = signal ? null : setInterval(() => {
      if (checkingCancellation || settled || stopping) return;
      checkingCancellation = true;
      void input.cancellationRequested().then((cancelled) => {
        if (cancelled) terminate();
      }).catch((error) => {
        cancellationError = error;
        terminate();
      }).finally(() => { checkingCancellation = false; });
    }, 1_000);
    cancelTimer?.unref?.();
    signal?.addEventListener("abort", terminate, { once: true });
    // An abort can race the initial database check and signal subscription.
    if (signal?.aborted) terminate();
    const timeout = setTimeout(() => { timedOut = true; terminate(); }, input.timeoutMs ?? 10 * 60_000);
    const cleanup = () => {
      clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      if (cancelTimer) clearInterval(cancelTimer);
      signal?.removeEventListener("abort", terminate);
    };
    const finishBin = () => {
      if (!binCount) return;
      if (peaks.length >= maxBins) { overflow = true; terminate(); return; }
      peaks.push(Number(binPeak.toFixed(6)));
      binPeak = 0;
      binCount = 0;
    };
    const sample = (value: number) => {
      const normalized = Math.abs(value / 32768);
      binPeak = Math.max(binPeak, normalized);
      globalPeak = Math.max(globalPeak, normalized);
      sumSquares += normalized * normalized;
      binCount += 1;
      totalSamples += 1;
      if (binCount >= samplesPerBin) finishBin();
    };
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-4_000);
    });
    child.stdout?.on("data", (chunk: Buffer) => {
      if (settled || stopping) return;
      let offset = 0;
      if (pendingByte !== null && chunk.length) {
        sample((pendingByte | (chunk[0] << 8)) << 16 >> 16);
        pendingByte = null;
        offset = 1;
      }
      for (; offset + 1 < chunk.length && !stopping; offset += 2) sample(chunk.readInt16LE(offset));
      if (!stopping && offset < chunk.length) pendingByte = chunk[offset];
    });
    // Node guarantees 'close' after both an 'error' and the stdio handles
    // closing. Never return to the caller (or release a lease) on 'error'.
    child.on("error", (error) => { processError = error; });
    child.on("close", async (code, exitSignal) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (timedOut) return reject(new Error("MEDIA_WAVEFORM_TIMEOUT: waveform extraction exceeded its time budget."));
      if (overflow) return reject(new Error("MEDIA_WAVEFORM_BIN_LIMIT: decoded audio exceeded its bounded waveform budget."));
      if (cancellationError) return reject(cancellationError);
      try {
        if (signal?.aborted || await input.cancellationRequested()) return reject(new Error("MEDIA_JOB_CANCELLED: waveform processing was cancelled."));
      } catch (error) { return reject(error); }
      if (stopping) return reject(new Error("MEDIA_JOB_CANCELLED: waveform process was terminated."));
      if (processError) return reject(processError);
      // Even a partially decodable stream is not a published successful asset.
      if (code !== 0) return reject(new Error(stderr.trim() || `ffmpeg waveform extraction exited with code ${code ?? "unknown"}${exitSignal ? ` (${exitSignal})` : ""}.`));
      if (pendingByte !== null) return reject(new Error("MEDIA_WAVEFORM_PCM_INVALID: decoded PCM ended mid-sample."));
      finishBin();
      if (overflow) return reject(new Error("MEDIA_WAVEFORM_BIN_LIMIT: decoded audio exceeded its bounded waveform budget."));
      if (!totalSamples) return reject(new Error("MEDIA_WAVEFORM_EMPTY: decoder produced no audio samples."));
      const actualDuration = duration || totalSamples / sampleRateHz;
      resolve({ version: 1, durationSeconds: Number(actualDuration || 0), sampleRateHz,
        binsPerSecond: actualDuration ? Number((peaks.length / actualDuration).toFixed(4)) : 0,
        channels: [{ id: "mix", label: "Mix", samples: peaks,
          peak: Number(globalPeak.toFixed(6)), rms: totalSamples ? Number(Math.sqrt(sumSquares / totalSamples).toFixed(6)) : 0 }] });
    });
  });
}
