export function normalizedVideoFrameRate(value: unknown, fallback = 30) {
  const rate = Number(value);
  if (!Number.isFinite(rate) || rate <= 0) return fallback;
  return Math.max(1, Math.min(240, rate));
}

export function videoFrameNumber(seconds: number, frameRate: number) {
  const fps = normalizedVideoFrameRate(frameRate);
  const time = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  return Math.max(0, Math.floor(time * fps + 0.000001));
}

export function formatVideoTimecode(seconds: number, frameRate: number) {
  const fps = normalizedVideoFrameRate(frameRate);
  const nominalFps = Math.max(1, Math.round(fps));
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const wholeSeconds = Math.floor(safe % 60);
  const frame = Math.min(nominalFps - 1, Math.floor((safe - Math.floor(safe)) * fps + 0.000001));
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}:${String(frame).padStart(2, "0")}`;
}

export function parseVideoTimecode(value: string, frameRate: number) {
  const fps = normalizedVideoFrameRate(frameRate);
  const text = String(value || "").trim();
  if (!text) return null;
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const seconds = Number(text);
    return Number.isFinite(seconds) ? Math.max(0, seconds) : null;
  }
  const parts = text.split(":");
  if (parts.length < 2 || parts.length > 4 || parts.some((part) => !/^\d+$/.test(part))) return null;
  const values = parts.map(Number);
  if (values.some((part) => !Number.isFinite(part))) return null;
  if (parts.length === 4) {
    const [hours, minutes, seconds, frames] = values;
    if (minutes >= 60 || seconds >= 60 || frames >= Math.max(1, Math.ceil(fps))) return null;
    return hours * 3600 + minutes * 60 + seconds + frames / fps;
  }
  let seconds = 0;
  for (const part of values) seconds = seconds * 60 + part;
  return seconds;
}
