/** Hardware path for single video poster frames. No database or driver dependencies here. */
export type ThumbnailMode = "cuda" | "software";

export function videoThumbnailCommand(sourcePath: string, outputPath: string, seekSeconds: number, mode: ThumbnailMode): string[] {
  const seek = seekSeconds > 0 ? ["-ss", String(seekSeconds)] : [];
  if (mode === "cuda") return ["-y", "-hwaccel", "cuda", "-hwaccel_output_format", "cuda", ...seek, "-i", sourcePath,
    "-frames:v", "1", "-vf", "scale_cuda=w='min(1280,iw)':h=-2:format=nv12,hwdownload,format=nv12,format=yuv420p",
    "-map_metadata", "-1", "-q:v", "3", outputPath];
  return ["-y", ...seek, "-i", sourcePath, "-frames:v", "1", "-vf", "scale='min(1280,iw)':-2",
    "-map_metadata", "-1", "-q:v", "3", outputPath];
}

/** Hardware probe only tests the FFmpeg build. Source codec and installed driver
 * compatibility must still be verified by actual execution with software fallback.
 */
export function supportsCudaThumbnail(hwaccels: string, filters: string): boolean {
  return /\bcuda\b/.test(hwaccels) && /\bscale_cuda\b/.test(filters);
}

export async function renderVideoThumbnail(input: {
  sourcePath: string;
  outputPath: string;
  seekSeconds: number;
  mode: ThumbnailMode;
  run: (args: string[]) => Promise<unknown>;
  removePartial: () => Promise<unknown>;
  cancelled: () => Promise<boolean>;
  onFallback?: (reason: string) => void;
}): Promise<{ acceleration: ThumbnailMode; fellBack: boolean }> {
  if (await input.cancelled()) throw new Error("MEDIA_JOB_CANCELLED: thumbnail was cancelled.");
  if (input.mode === "cuda") {
    try {
      await input.run(videoThumbnailCommand(input.sourcePath, input.outputPath, input.seekSeconds, "cuda"));
      return { acceleration: "cuda", fellBack: false };
    } catch (error) {
      if (await input.cancelled()) throw error;
      // Failed GPU decoders can leave partial output; never publish a corrupt JPEG.
      await input.removePartial();
      input.onFallback?.(String(error instanceof Error ? error.message : error).slice(0, 300));
    }
  }
  if (await input.cancelled()) throw new Error("MEDIA_JOB_CANCELLED: thumbnail was cancelled.");
  try {
    await input.run(videoThumbnailCommand(input.sourcePath, input.outputPath, input.seekSeconds, "software"));
  } catch (error) {
    // CPU failures/cancellation should not leave a corrupt file that can be reused.
    await input.removePartial();
    throw error;
  }
  return { acceleration: "software", fellBack: input.mode === "cuda" };
}
