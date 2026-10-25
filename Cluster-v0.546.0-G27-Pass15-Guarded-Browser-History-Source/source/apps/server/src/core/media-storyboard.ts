import type { StoryboardManifest } from "@cluster/shared";

export function storyboardManifest(durationSeconds: number, columns: number, rows: number, frameWidth: number, frameHeight: number, frameCount: number, padding = 2, margin = 2): StoryboardManifest {
  return {
    version: 1,
    durationSeconds,
    imageMimeType: "image/jpeg",
    columns,
    rows,
    frameWidth,
    frameHeight,
    padding,
    margin,
    sheetWidth: margin * 2 + columns * frameWidth + Math.max(0, columns - 1) * padding,
    sheetHeight: margin * 2 + rows * frameHeight + Math.max(0, rows - 1) * padding,
    frames: Array.from({ length: frameCount }, (_, index) => ({
      index,
      timeSeconds: Number((durationSeconds * index / Math.max(1, frameCount - 1)).toFixed(4)),
      x: margin + (index % columns) * (frameWidth + padding),
      y: margin + Math.floor(index / columns) * (frameHeight + padding),
      width: frameWidth,
      height: frameHeight,
    })),
  };
}
