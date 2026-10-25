export type TimedMediaPhase = "idle" | "loading" | "ready" | "playing" | "paused" | "seeking" | "waiting" | "stalled" | "ended" | "error";

export type TimedRange = { start: number; end: number };

export type TimedMediaSnapshot = {
  phase: TimedMediaPhase;
  currentTime: number;
  duration: number;
  playbackRate: number;
  volume: number;
  muted: boolean;
  ended: boolean;
  seeking: boolean;
  readyState: number;
  networkState: number;
  buffered: TimedRange[];
  seekable: TimedRange[];
  errorCode: number | null;
  errorMessage: string | null;
  embeddedTrackControl: "supported" | "metadata_only";
  activeEmbeddedTrackIndex: number | null;
  videoFrameControl: "not_video" | "supported" | "fallback";
  presentedFrame: number | null;
  presentedMediaTime: number | null;
  totalVideoFrames: number | null;
  droppedVideoFrames: number | null;
};

export type TimedClockAdapter = {
  duration: number;
  currentTime: number;
  playbackRate: number;
  paused: boolean;
  play: () => void | Promise<void>;
  pause: () => void;
  seek: (seconds: number) => void;
  setPlaybackRate?: (rate: number) => void;
};

export type TimedMediaFollowerOptions = {
  id: string;
  element: HTMLMediaElement;
  enabled?: boolean;
  muted?: boolean;
  gain?: number;
};

type Follower = {
  id: string;
  element: HTMLMediaElement;
  enabled: boolean;
  muted: boolean;
  gain: number;
};

type Listener = (snapshot: TimedMediaSnapshot) => void;
type VideoFrameMetadataLike = { mediaTime?: number; presentedFrames?: number };
type VideoPlaybackQualityLike = { totalVideoFrames?: number; droppedVideoFrames?: number };
type VideoFrameElement = HTMLVideoElement & {
  requestVideoFrameCallback?: (callback: (now: number, metadata: VideoFrameMetadataLike) => void) => number;
  cancelVideoFrameCallback?: (id: number) => void;
  getVideoPlaybackQuality?: () => VideoPlaybackQualityLike;
};

function ranges(value: TimeRanges | null | undefined): TimedRange[] {
  if (!value) return [];
  const result: TimedRange[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const start = Number(value.start(index));
    const end = Number(value.end(index));
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) result.push({ start, end });
  }
  return result;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));
}

function mediaErrorMessage(element: HTMLMediaElement) {
  const error = element.error;
  if (!error) return null;
  if (error.code === 1) return "Playback was aborted.";
  if (error.code === 2) return "A network error interrupted playback.";
  if (error.code === 3) return "The media could not be decoded.";
  if (error.code === 4) return "The media source or codec is not supported.";
  return "The media element reported a playback error.";
}

function videoElement(value: HTMLMediaElement | null): VideoFrameElement | null {
  if (!value || typeof HTMLVideoElement === "undefined" || !(value instanceof HTMLVideoElement)) return null;
  return value as VideoFrameElement;
}

function videoQuality(element: VideoFrameElement | null) {
  if (!element?.getVideoPlaybackQuality) return { totalVideoFrames: null, droppedVideoFrames: null };
  try {
    const quality = element.getVideoPlaybackQuality();
    const totalVideoFrames = Number(quality?.totalVideoFrames);
    const droppedVideoFrames = Number(quality?.droppedVideoFrames);
    return {
      totalVideoFrames: Number.isFinite(totalVideoFrames) ? totalVideoFrames : null,
      droppedVideoFrames: Number.isFinite(droppedVideoFrames) ? droppedVideoFrames : null,
    };
  } catch {
    return { totalVideoFrames: null, droppedVideoFrames: null };
  }
}

function initialSnapshot(): TimedMediaSnapshot {
  return {
    phase: "idle",
    currentTime: 0,
    duration: 0,
    playbackRate: 1,
    volume: 1,
    muted: false,
    ended: false,
    seeking: false,
    readyState: 0,
    networkState: 0,
    buffered: [],
    seekable: [],
    errorCode: null,
    errorMessage: null,
    embeddedTrackControl: "metadata_only",
    activeEmbeddedTrackIndex: null,
    videoFrameControl: "not_video",
    presentedFrame: null,
    presentedMediaTime: null,
    totalVideoFrames: null,
    droppedVideoFrames: null,
  };
}

export class TimedMediaController {
  private element: HTMLMediaElement | null = null;
  private clockAdapter: TimedClockAdapter | null = null;
  private clockFrame = 0;
  private clockLastNow = 0;
  private followers = new Map<string, Follower>();
  private listeners = new Set<Listener>();
  private cleanupElement: (() => void) | null = null;
  private snapshot: TimedMediaSnapshot = initialSnapshot();
  private masterVolume = 1;
  private masterMuted = false;
  private primaryEnabled = true;
  private primaryGain = 1;
  private videoFrameCallbackId: number | null = null;
  private videoFrameCallbackElement: VideoFrameElement | null = null;

  getSnapshot() { return this.snapshot; }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  attach(element: HTMLMediaElement | null) {
    this.detachClock();
    const previous = this.element;
    this.cleanupVideoFrameCallback();
    this.cleanupElement?.();
    this.cleanupElement = null;
    if (previous && previous !== element) previous.pause();
    this.element = element;
    if (!element) {
      this.snapshot = initialSnapshot();
      this.emit();
      return;
    }
    this.applyFollowerMix();
    const events = [
      "loadstart", "loadedmetadata", "durationchange", "progress", "canplay", "playing", "play", "pause",
      "timeupdate", "seeking", "seeked", "waiting", "stalled", "ended", "ratechange", "volumechange", "error",
      "emptied", "abort", "suspend",
    ] as const;
    const handler = (event: Event) => this.handleElementEvent(event.type);
    for (const event of events) element.addEventListener(event, handler);
    this.cleanupElement = () => { for (const event of events) element.removeEventListener(event, handler); };
    this.updateSnapshot("loading");
    this.scheduleVideoFrameCallback();
    this.syncFollowers(true);
  }

  attachClock(adapter: TimedClockAdapter | null) {
    this.cleanupVideoFrameCallback();
    this.cleanupElement?.();
    this.cleanupElement = null;
    this.element?.pause();
    this.element = null;
    this.detachClock();
    this.clockAdapter = adapter;
    if (!adapter) {
      this.snapshot = initialSnapshot();
      this.emit();
      return;
    }
    this.snapshot = {
      ...initialSnapshot(),
      phase: adapter.paused ? "ready" : "playing",
      currentTime: clamp(adapter.currentTime, 0, Math.max(0, adapter.duration)),
      duration: Math.max(0, Number(adapter.duration) || 0),
      playbackRate: clamp(adapter.playbackRate || 1, 0.1, 4),
      readyState: 4,
      networkState: 1,
    };
    this.emit();
    if (!adapter.paused) this.scheduleClockFrame();
  }

  async play() {
    if (this.clockAdapter) {
      try {
        await this.clockAdapter.play();
        this.clockAdapter.paused = false;
        this.clockLastNow = 0;
        this.scheduleClockFrame();
        this.updateClockSnapshot("playing");
        return true;
      } catch {
        this.updateClockSnapshot("error");
        return false;
      }
    }
    const element = this.element;
    if (!element) return false;
    try {
      await element.play();
      await Promise.all([...this.followers.values()].filter((item) => item.enabled).map((item) => item.element.play().catch(() => undefined)));
      this.updateSnapshot("playing");
      return true;
    } catch {
      this.updateSnapshot(element.error ? "error" : "paused");
      return false;
    }
  }

  pause() {
    if (this.clockAdapter) {
      this.clockAdapter.pause();
      this.clockAdapter.paused = true;
      this.stopClockFrame();
      this.updateClockSnapshot("paused");
      return;
    }
    this.element?.pause();
    for (const follower of this.followers.values()) follower.element.pause();
    this.updateSnapshot("paused");
  }

  stop() {
    this.pause();
    this.seek(0, { exactFollowers: true });
  }

  toggle() {
    if (this.clockAdapter) return this.clockAdapter.paused || this.snapshot.ended ? this.play() : (this.pause(), Promise.resolve(true));
    if (!this.element || this.element.paused || this.element.ended) return this.play();
    this.pause();
    return Promise.resolve(true);
  }

  seek(seconds: number, options: { exactFollowers?: boolean } = {}) {
    if (this.clockAdapter) {
      const target = clamp(seconds, 0, Math.max(0, this.clockAdapter.duration));
      this.clockAdapter.seek(target);
      this.clockAdapter.currentTime = target;
      this.updateClockSnapshot(this.clockAdapter.paused ? "paused" : "playing");
      return;
    }
    const element = this.element;
    if (!element) return;
    const duration = Number.isFinite(element.duration) && element.duration > 0 ? element.duration : Number.MAX_SAFE_INTEGER;
    const target = clamp(seconds, 0, duration);
    element.currentTime = target;
    for (const follower of this.followers.values()) {
      if (!Number.isFinite(follower.element.duration) || follower.element.duration <= 0 || target <= follower.element.duration + 0.1) follower.element.currentTime = target;
    }
    this.updateSnapshot("seeking");
    if (options.exactFollowers) this.syncFollowers(true);
  }

  jump(deltaSeconds: number) {
    this.seek((this.clockAdapter?.currentTime ?? this.element?.currentTime ?? 0) + deltaSeconds);
  }

  stepFrame(direction: -1 | 1, frameRate: number) {
    const fps = clamp(frameRate, 1, 240);
    const element = this.element;
    if (!element && !this.clockAdapter) return;
    this.pause();
    const basis = this.clockAdapter?.currentTime ?? this.snapshot.presentedMediaTime ?? element?.currentTime ?? 0;
    const frame = Math.max(0, Math.round(basis * fps) + direction);
    this.seek(frame / fps, { exactFollowers: true });
  }

  setPlaybackRate(value: number) {
    const rate = clamp(value, 0.1, 4);
    if (this.clockAdapter) {
      this.clockAdapter.playbackRate = rate;
      this.clockAdapter.setPlaybackRate?.(rate);
      this.updateClockSnapshot();
      return;
    }
    if (this.element) this.element.playbackRate = rate;
    for (const follower of this.followers.values()) follower.element.playbackRate = rate;
    this.updateSnapshot();
  }

  setVolume(value: number) {
    this.masterVolume = clamp(value, 0, 1);
    this.applyFollowerMix();
    this.updateSnapshot();
  }

  setMuted(value: boolean) {
    this.masterMuted = Boolean(value);
    this.applyFollowerMix();
    this.updateSnapshot();
  }

  setPrimaryOutput(options: { enabled?: boolean; gain?: number }) {
    if (options.enabled !== undefined) this.primaryEnabled = options.enabled;
    if (options.gain !== undefined) this.primaryGain = clamp(options.gain, 0, 4);
    this.applyFollowerMix();
    this.updateSnapshot();
  }

  selectEmbeddedTrack(trackIndex: number | null) {
    const element = this.element as (HTMLMediaElement & { audioTracks?: { length: number; [index: number]: { enabled: boolean } } }) | null;
    const tracks = element?.audioTracks;
    if (!tracks || !Number.isInteger(trackIndex) || trackIndex == null) {
      this.snapshot = { ...this.snapshot, embeddedTrackControl: tracks ? "supported" : "metadata_only", activeEmbeddedTrackIndex: trackIndex };
      this.emit();
      return false;
    }
    for (let index = 0; index < tracks.length; index += 1) tracks[index].enabled = index === trackIndex;
    this.snapshot = { ...this.snapshot, embeddedTrackControl: "supported", activeEmbeddedTrackIndex: trackIndex };
    this.emit();
    return true;
  }

  registerFollower(options: TimedMediaFollowerOptions) {
    const follower: Follower = {
      id: options.id,
      element: options.element,
      enabled: options.enabled !== false,
      muted: Boolean(options.muted),
      gain: clamp(options.gain ?? 1, 0, 4),
    };
    this.followers.set(options.id, follower);
    follower.element.preload = "metadata";
    follower.element.playbackRate = this.element?.playbackRate || 1;
    this.applyFollowerMix();
    this.syncFollower(follower, true);
    return () => {
      follower.element.pause();
      this.followers.delete(options.id);
    };
  }

  updateFollower(id: string, patch: Partial<Pick<TimedMediaFollowerOptions, "enabled" | "muted" | "gain">>) {
    const follower = this.followers.get(id);
    if (!follower) return;
    if (patch.enabled !== undefined) follower.enabled = patch.enabled;
    if (patch.muted !== undefined) follower.muted = patch.muted;
    if (patch.gain !== undefined) follower.gain = clamp(patch.gain, 0, 4);
    if (!follower.enabled) follower.element.pause();
    else if (this.element && !this.element.paused) void follower.element.play().catch(() => undefined);
    this.applyFollowerMix();
    this.syncFollower(follower, true);
  }

  dispose() {
    this.detachClock();
    this.cleanupVideoFrameCallback();
    this.cleanupElement?.();
    this.cleanupElement = null;
    this.element?.pause();
    this.element = null;
    for (const follower of this.followers.values()) follower.element.pause();
    this.followers.clear();
    this.listeners.clear();
    this.snapshot = initialSnapshot();
  }

  private emit() { for (const listener of this.listeners) listener(this.snapshot); }

  private handleElementEvent(type: string) {
    if (type === "timeupdate" || type === "seeked" || type === "playing" || type === "ratechange") this.syncFollowers(type === "seeked");
    let phase: TimedMediaPhase | undefined;
    if (type === "loadstart" || type === "emptied") phase = "loading";
    else if (type === "loadedmetadata" || type === "canplay") phase = this.element?.paused ? "ready" : "playing";
    else if (type === "playing" || type === "play") phase = "playing";
    else if (type === "pause") phase = this.element?.ended ? "ended" : "paused";
    else if (type === "seeking") phase = "seeking";
    else if (type === "seeked") phase = this.element?.paused ? "paused" : "playing";
    else if (type === "waiting") phase = "waiting";
    else if (type === "stalled") phase = "stalled";
    else if (type === "ended") phase = "ended";
    else if (type === "error") phase = "error";
    this.updateSnapshot(phase);
  }

  private updateSnapshot(phase?: TimedMediaPhase, frame?: VideoFrameMetadataLike) {
    const element = this.element;
    if (!element) return;
    const audioTracks = (element as HTMLMediaElement & { audioTracks?: { length: number; [index: number]: { enabled: boolean } } }).audioTracks;
    let activeEmbeddedTrackIndex = this.snapshot.activeEmbeddedTrackIndex;
    if (audioTracks) {
      for (let index = 0; index < audioTracks.length; index += 1) if (audioTracks[index].enabled) { activeEmbeddedTrackIndex = index; break; }
    }
    const video = videoElement(element);
    const quality = videoQuality(video);
    const hasVideoFrameCallback = Boolean(video?.requestVideoFrameCallback);
    const duration = Number.isFinite(element.duration) && element.duration >= 0 ? element.duration : 0;
    const frameMediaTime = Number(frame?.mediaTime);
    const presentedFrames = Number(frame?.presentedFrames);
    this.snapshot = {
      phase: phase || this.snapshot.phase,
      currentTime: Number.isFinite(frameMediaTime) ? frameMediaTime : Number.isFinite(element.currentTime) ? element.currentTime : 0,
      duration,
      playbackRate: Number.isFinite(element.playbackRate) ? element.playbackRate : 1,
      volume: this.masterVolume,
      muted: this.masterMuted,
      ended: Boolean(element.ended),
      seeking: Boolean(element.seeking),
      readyState: Number(element.readyState || 0),
      networkState: Number(element.networkState || 0),
      buffered: ranges(element.buffered),
      seekable: ranges(element.seekable),
      errorCode: element.error?.code || null,
      errorMessage: mediaErrorMessage(element),
      embeddedTrackControl: audioTracks ? "supported" : "metadata_only",
      activeEmbeddedTrackIndex,
      videoFrameControl: video ? hasVideoFrameCallback ? "supported" : "fallback" : "not_video",
      presentedFrame: Number.isFinite(presentedFrames) ? presentedFrames : this.snapshot.presentedFrame,
      presentedMediaTime: Number.isFinite(frameMediaTime) ? frameMediaTime : video ? this.snapshot.presentedMediaTime : null,
      totalVideoFrames: quality.totalVideoFrames,
      droppedVideoFrames: quality.droppedVideoFrames,
    };
    this.emit();
  }

  private scheduleVideoFrameCallback() {
    const video = videoElement(this.element);
    if (!video?.requestVideoFrameCallback) return;
    this.videoFrameCallbackElement = video;
    const tick = (_now: number, metadata: VideoFrameMetadataLike) => {
      if (this.videoFrameCallbackElement !== video || this.element !== video) return;
      this.updateSnapshot(undefined, metadata);
      this.syncFollowers(false);
      this.videoFrameCallbackId = video.requestVideoFrameCallback?.(tick) ?? null;
    };
    this.videoFrameCallbackId = video.requestVideoFrameCallback(tick);
  }

  private cleanupVideoFrameCallback() {
    const video = this.videoFrameCallbackElement;
    if (video && this.videoFrameCallbackId != null && video.cancelVideoFrameCallback) {
      try { video.cancelVideoFrameCallback(this.videoFrameCallbackId); } catch { /* already released by the media element */ }
    }
    this.videoFrameCallbackId = null;
    this.videoFrameCallbackElement = null;
  }

  private updateClockSnapshot(phase?: TimedMediaPhase) {
    const adapter = this.clockAdapter;
    if (!adapter) return;
    const duration = Math.max(0, Number(adapter.duration) || 0);
    const currentTime = clamp(adapter.currentTime, 0, duration || Number.MAX_SAFE_INTEGER);
    const ended = duration > 0 && currentTime >= duration - 0.0001;
    this.snapshot = {
      ...this.snapshot,
      phase: phase || (ended ? "ended" : adapter.paused ? "paused" : "playing"),
      currentTime,
      duration,
      playbackRate: clamp(adapter.playbackRate || 1, 0.1, 4),
      ended,
      seeking: false,
      readyState: 4,
      networkState: 1,
      buffered: duration > 0 ? [{ start: 0, end: duration }] : [],
      seekable: duration > 0 ? [{ start: 0, end: duration }] : [],
      errorCode: phase === "error" ? 1 : null,
      errorMessage: phase === "error" ? "Timed animation transport reported an error." : null,
      embeddedTrackControl: "metadata_only",
      activeEmbeddedTrackIndex: null,
      videoFrameControl: "not_video",
      presentedFrame: null,
      presentedMediaTime: null,
      totalVideoFrames: null,
      droppedVideoFrames: null,
    };
    this.emit();
  }

  private scheduleClockFrame() {
    if (!this.clockAdapter || this.clockAdapter.paused || this.clockFrame) return;
    const tick = (now: number) => {
      this.clockFrame = 0;
      const adapter = this.clockAdapter;
      if (!adapter || adapter.paused) { this.clockLastNow = 0; return; }
      const previous = this.clockLastNow || now;
      this.clockLastNow = now;
      const delta = Math.min(0.1, Math.max(0, (now - previous) / 1000));
      const duration = Math.max(0, Number(adapter.duration) || 0);
      const next = clamp(adapter.currentTime + delta * clamp(adapter.playbackRate || 1, 0.1, 4), 0, duration || Number.MAX_SAFE_INTEGER);
      adapter.seek(next);
      adapter.currentTime = next;
      if (duration > 0 && next >= duration - 0.0001) {
        adapter.pause();
        adapter.paused = true;
        this.clockLastNow = 0;
        this.updateClockSnapshot("ended");
        return;
      }
      this.updateClockSnapshot("playing");
      this.scheduleClockFrame();
    };
    this.clockFrame = requestAnimationFrame(tick);
  }

  private stopClockFrame() {
    if (this.clockFrame) cancelAnimationFrame(this.clockFrame);
    this.clockFrame = 0;
    this.clockLastNow = 0;
  }

  private detachClock() {
    this.stopClockFrame();
    if (this.clockAdapter) {
      try { this.clockAdapter.pause(); } catch { /* clock already disposed */ }
    }
    this.clockAdapter = null;
  }

  private applyFollowerMix() {
    if (this.element) {
      this.element.muted = this.masterMuted || !this.primaryEnabled;
      this.element.volume = clamp(this.masterVolume * this.primaryGain, 0, 1);
    }
    for (const follower of this.followers.values()) {
      follower.element.muted = this.masterMuted || follower.muted || !follower.enabled;
      follower.element.volume = clamp(this.masterVolume * follower.gain, 0, 1);
    }
  }

  private syncFollowers(exact = false) { for (const follower of this.followers.values()) this.syncFollower(follower, exact); }

  private syncFollower(follower: Follower, exact: boolean) {
    const master = this.element;
    if (!master || !follower.enabled) return;
    follower.element.playbackRate = master.playbackRate;
    const drift = Math.abs((follower.element.currentTime || 0) - (master.currentTime || 0));
    if (exact || drift > 0.12) {
      try { follower.element.currentTime = master.currentTime || 0; } catch { /* follower metadata may not be ready yet */ }
    }
    if (master.paused || master.ended) follower.element.pause();
    else if (follower.element.paused) void follower.element.play().catch(() => undefined);
  }
}
