import { DEFAULT_RESOURCE_BUDGETS, type StoryboardFrame, type StoryboardManifest, type ViewableResource, type ViewableResourceDerivative } from "@cluster/shared";
import { absoluteViewerResourceUrl } from "./viewer-resource-loader";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function boundedNumber(value: unknown, minimum: number, maximum: number) {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
}

export type VideoStoryboard = {
  derivative: ViewableResourceDerivative;
  manifest: StoryboardManifest;
  url: string;
};

export function resolveVideoStoryboard(resource: ViewableResource): VideoStoryboard | null {
  const derivative = resource.derivatives.find((item) => item.kind === "storyboard" && item.url) || null;
  if (!derivative?.url) return null;
  const metadata = record(derivative.metadata);
  const raw = record(metadata?.manifest);
  if (!raw || Number(raw.version) !== 1 || !Array.isArray(raw.frames)) return null;
  const durationSeconds = boundedNumber(raw.durationSeconds, 0, 7 * 24 * 3600);
  const columns = boundedNumber(raw.columns, 1, 64);
  const rows = boundedNumber(raw.rows, 1, 64);
  const frameWidth = boundedNumber(raw.frameWidth, 1, 4096);
  const frameHeight = boundedNumber(raw.frameHeight, 1, 4096);
  if (durationSeconds == null || columns == null || rows == null || frameWidth == null || frameHeight == null) return null;
  const frames: StoryboardFrame[] = raw.frames.slice(0, DEFAULT_RESOURCE_BUDGETS.maxStoryboardFrames).map((value, index) => {
    const frame = record(value) || {};
    return {
      index: boundedNumber(frame.index, 0, DEFAULT_RESOURCE_BUDGETS.maxStoryboardFrames * 2) ?? index,
      timeSeconds: boundedNumber(frame.timeSeconds, 0, Math.max(durationSeconds, 0.001)) ?? 0,
      x: boundedNumber(frame.x, 0, 1_000_000) ?? 0,
      y: boundedNumber(frame.y, 0, 1_000_000) ?? 0,
      width: boundedNumber(frame.width, 1, 4096) ?? frameWidth,
      height: boundedNumber(frame.height, 1, 4096) ?? frameHeight,
    };
  });
  if (!frames.length) return null;
  const manifest: StoryboardManifest = {
    version: 1,
    durationSeconds,
    imageMimeType: typeof raw.imageMimeType === "string" ? raw.imageMimeType.slice(0, 120) : "image/jpeg",
    columns,
    rows,
    frameWidth,
    frameHeight,
    padding: boundedNumber(raw.padding, 0, 128) ?? 0,
    margin: boundedNumber(raw.margin, 0, 128) ?? 0,
    sheetWidth: boundedNumber(raw.sheetWidth, frameWidth, 1_000_000) ?? columns * frameWidth,
    sheetHeight: boundedNumber(raw.sheetHeight, frameHeight, 1_000_000) ?? rows * frameHeight,
    frames,
  };
  return { derivative, manifest, url: absoluteViewerResourceUrl(derivative.url) };
}

export function videoStoryboardFrameAt(storyboard: VideoStoryboard | null, seconds: number) {
  if (!storyboard?.manifest.frames.length) return null;
  const target = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  let closest = storyboard.manifest.frames[0];
  let distance = Math.abs(closest.timeSeconds - target);
  for (const frame of storyboard.manifest.frames) {
    const nextDistance = Math.abs(frame.timeSeconds - target);
    if (nextDistance < distance) { closest = frame; distance = nextDistance; }
  }
  return closest;
}
