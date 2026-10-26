import type { ReviewComparisonMode, ReviewComparisonPreferences, ReviewComparisonSide, ReviewMedium } from "@cluster/shared";
import { readPreferenceStorage, writePreferenceStorage } from "../../core/privacy-consent";

export type ReviewComparisonSnapshot = ReviewComparisonPreferences & {
  enabled: boolean;
  medium: ReviewMedium;
};

type Listener = () => void;

const MODES: Record<ReviewMedium, readonly ReviewComparisonMode[]> = {
  video: ["side", "wipe", "reference", "difference"],
  audio: ["ab", "side"],
  image: ["side", "overlay", "wipe", "difference", "blink"],
  pdf: ["side"],
  "3d": ["side"],
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));
}

function preferenceKey(userId: string | null | undefined, medium: ReviewMedium) {
  return `cluster.viewer.comparison.v1:${userId || "anonymous"}:${medium}`;
}

function defaultPreferences(medium: ReviewMedium): ReviewComparisonPreferences {
  return {
    version: 1,
    mode: MODES[medium][0] || "side",
    amount: 50,
    activeSide: "primary",
    syncPlayback: medium === "video" || medium === "audio",
    syncCamera: medium === "3d",
    blinkIntervalMs: 650,
  };
}

function loadPreferences(userId: string | null | undefined, medium: ReviewMedium): ReviewComparisonPreferences {
  const fallback = defaultPreferences(medium);
  const raw = readPreferenceStorage(preferenceKey(userId, medium));
  if (!raw) return fallback;
  try {
    const value = JSON.parse(raw) as Partial<ReviewComparisonPreferences>;
    const mode = MODES[medium].includes(value.mode as ReviewComparisonMode) ? value.mode as ReviewComparisonMode : fallback.mode;
    const activeSide: ReviewComparisonSide = value.activeSide === "secondary" ? "secondary" : "primary";
    return {
      version: 1,
      mode,
      amount: clamp(Number(value.amount), 10, 90),
      activeSide,
      syncPlayback: typeof value.syncPlayback === "boolean" ? value.syncPlayback : fallback.syncPlayback,
      syncCamera: typeof value.syncCamera === "boolean" ? value.syncCamera : fallback.syncCamera,
      blinkIntervalMs: clamp(Number(value.blinkIntervalMs), 200, 3000),
    };
  } catch {
    return fallback;
  }
}

export function comparisonModesForMedium(medium: ReviewMedium) { return MODES[medium]; }

export class ReviewComparisonSession {
  private listeners = new Set<Listener>();
  private snapshot: ReviewComparisonSnapshot;
  private readonly userId: string | null | undefined;

  constructor(medium: ReviewMedium, userId?: string | null, enabled = false) {
    this.userId = userId;
    this.snapshot = { ...loadPreferences(userId, medium), enabled, medium };
  }

  getSnapshot = () => this.snapshot;
  subscribe = (listener: Listener) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };

  private commit(patch: Partial<ReviewComparisonSnapshot>, persist = true) {
    const next = { ...this.snapshot, ...patch };
    if (!MODES[next.medium].includes(next.mode)) next.mode = MODES[next.medium][0] || "side";
    next.amount = clamp(next.amount, 10, 90);
    next.blinkIntervalMs = clamp(next.blinkIntervalMs, 200, 3000);
    this.snapshot = next;
    if (persist) {
      const { enabled: _enabled, medium: _medium, ...preferences } = next;
      writePreferenceStorage(preferenceKey(this.userId, next.medium), JSON.stringify(preferences));
    }
    for (const listener of this.listeners) listener();
  }

  setEnabled(enabled: boolean) { if (enabled !== this.snapshot.enabled) this.commit({ enabled }, false); }
  setMode(mode: ReviewComparisonMode) { if (MODES[this.snapshot.medium].includes(mode)) this.commit({ mode }); }
  setAmount(amount: number) { this.commit({ amount }); }
  setActiveSide(activeSide: ReviewComparisonSide) { this.commit({ activeSide }); }
  toggleActiveSide() { this.commit({ activeSide: this.snapshot.activeSide === "primary" ? "secondary" : "primary" }); }
  setSyncPlayback(syncPlayback: boolean) { this.commit({ syncPlayback }); }
  setSyncCamera(syncCamera: boolean) { this.commit({ syncCamera }); }
  setBlinkIntervalMs(blinkIntervalMs: number) { this.commit({ blinkIntervalMs }); }
}
