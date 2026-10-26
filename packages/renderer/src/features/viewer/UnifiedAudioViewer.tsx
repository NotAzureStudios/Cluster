import {
  AUDIO_MONITORING_PRESETS,
  AUDIO_OUTPUT_MODES,
  type AudioMonitoringPreset,
  type AudioOutputMode,
  type EmbeddedAudioTrackMetadata,
  type ProductionAudioStemMetadata,
  type ReviewLocator,
  type ViewableResourceDerivative,
} from "@cluster/shared";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ClusterButton, ClusterIconButton } from "../../components/ClusterButton";
import { ClusterIcon } from "../../components/ClusterIcon";
import { ClusterInput, ClusterNativeSelect } from "../../components/ClusterNativeControls";
import { ClusterTextArea } from "../../components/ClusterTextArea";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterSlider } from "../../components/ClusterSlider";
import { clusterApiFetch } from "@cluster/api-client";
import { readPreferenceStorage, writePreferenceStorage } from "../../core/privacy-consent";
import { runtimeStyle } from "../../core/runtime-style";
import { useAudioMeter } from "./use-audio-meter";
import { useAudioWaveform } from "./audio-waveform";
import { useTimedMediaController } from "./use-timed-media-controller";
import { useTimedMediaSystemIntegration } from "./use-timed-media-system-integration";
import { ViewerOverlayLayer } from "./ViewerOverlayLayer";
import { ViewerShell } from "./ViewerShell";
import { ViewerState } from "./ViewerState";
import { viewerOverlayCatalogForMedium } from "./viewer-overlay-catalog";
import { absoluteViewerResourceUrl, resolveViewerResourceSource } from "./viewer-resource-loader";
import { useViewerAssetSession } from "./use-viewer-asset-session";
import { useReviewComparisonSession } from "./use-review-comparison-session";
import { ViewerComparisonBar } from "./ViewerComparisonBar";
import type { ReviewComparisonSnapshot } from "./review-comparison-session";
import type { ViewerAssetSession, ViewerAssetSessionInput, ViewerCommandDefinition, ViewerMode } from "./viewer-contracts";
import type { TimedMediaController, TimedMediaSnapshot } from "./timed-media-controller";

const AUDIO_PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;
const AUDIO_SKIP_SECONDS = [1, 5, 10, 30] as const;
const STEM_GAIN_MIN_DB = -24;
const STEM_GAIN_MAX_DB = 12;

type ReviewCommentRecord = {
  id: string;
  body?: string | null;
  status?: string | null;
  createdAt?: string | null;
  locator?: unknown;
  user?: { displayName?: string | null; username?: string | null } | null;
};

type StemMonitoringState = {
  enabled: boolean;
  muted: boolean;
  solo: boolean;
  gainDb: number;
  meterRms: number;
  meterPeak: number;
  meterSupported: boolean;
};

type AudioStemRuntime = ProductionAudioStemMetadata & {
  derivative: ViewableResourceDerivative | null;
  url: string;
};

function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, Number.isFinite(value) ? value : min)); }
function dbToGain(value: number) { return Math.pow(10, clamp(value, STEM_GAIN_MIN_DB, STEM_GAIN_MAX_DB) / 20); }
function gainToDb(value: number) { return value > 0 ? 20 * Math.log10(value) : STEM_GAIN_MIN_DB; }
function percent(value: number) { return `${Math.round(clamp(value, 0, 1) * 100)}%`; }

function formatTime(seconds: number) {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const whole = Math.floor(safe);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = String(whole % 60).padStart(2, "0");
  const millis = String(Math.floor((safe - Math.floor(safe)) * 1000)).padStart(3, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${secs}.${millis}` : `${minutes}:${secs}.${millis}`;
}

function formatShortTime(seconds: number) {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const whole = Math.floor(safe);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = String(whole % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${secs}` : `${minutes}:${secs}`;
}

function parseTime(value: string) {
  const text = String(value || "").trim();
  if (!text) return null;
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
  const parts = text.split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part)) || parts.length > 3) return null;
  let seconds = 0;
  for (const part of parts) seconds = seconds * 60 + part;
  return seconds;
}

function readNumberPreference(key: string, fallback: number) {
  const value = Number(readPreferenceStorage(key));
  return Number.isFinite(value) ? value : fallback;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function embeddedTracks(session: ViewerAssetSession): EmbeddedAudioTrackMetadata[] {
  const production = record(session.metadata?.production);
  const raw = Array.isArray(production?.audioTracks) ? production.audioTracks : [];
  return raw.slice(0, 64).map((value, position) => {
    const item = record(value) || {};
    const index = Number.isFinite(Number(item.index)) ? Number(item.index) : position;
    const id = typeof item.id === "string" && item.id.trim() ? item.id.trim().slice(0, 120) : `stream:${index}`;
    return {
      id,
      index,
      label: typeof item.label === "string" ? item.label.slice(0, 160) : typeof item.title === "string" ? item.title.slice(0, 160) : `Track ${position + 1}`,
      language: typeof item.language === "string" ? item.language.slice(0, 32) : null,
      codec: typeof item.codec === "string" ? item.codec.slice(0, 80) : null,
      profile: typeof item.profile === "string" ? item.profile.slice(0, 120) : null,
      channels: Number.isFinite(Number(item.channels)) ? Number(item.channels) : null,
      channelLayout: typeof item.channelLayout === "string" ? item.channelLayout.slice(0, 120) : null,
      sampleRateHz: Number.isFinite(Number(item.sampleRateHz)) ? Number(item.sampleRateHz) : null,
      bitRate: Number.isFinite(Number(item.bitRate)) ? Number(item.bitRate) : null,
      sampleFormat: typeof item.sampleFormat === "string" ? item.sampleFormat.slice(0, 80) : null,
      default: Boolean(item.default),
      commentary: Boolean(item.commentary),
    };
  });
}

function audioStemMetadata(value: unknown, fallbackId: string): ProductionAudioStemMetadata | null {
  const item = record(value);
  if (!item) return null;
  const id = String(item.id || fallbackId).trim().slice(0, 120);
  if (!id) return null;
  const rawRole = String(item.role || "custom").toLowerCase();
  const role = ["mix", "dialogue", "music", "sfx", "vo", "production", "custom"].includes(rawRole) ? rawRole as ProductionAudioStemMetadata["role"] : "custom";
  return {
    id,
    label: String(item.label || item.title || id).trim().slice(0, 160) || id,
    role,
    derivativeId: typeof item.derivativeId === "string" ? item.derivativeId : null,
    variantKey: typeof item.variantKey === "string" ? item.variantKey : null,
    channels: Number.isFinite(Number(item.channels)) ? Number(item.channels) : null,
    channelLayout: typeof item.channelLayout === "string" ? item.channelLayout.slice(0, 120) : null,
    defaultGainDb: Number.isFinite(Number(item.defaultGainDb)) ? clamp(Number(item.defaultGainDb), STEM_GAIN_MIN_DB, STEM_GAIN_MAX_DB) : 0,
  };
}

function productionStems(session: ViewerAssetSession): AudioStemRuntime[] {
  const production = record(session.metadata?.production);
  const declared = Array.isArray(production?.audioStems) ? production.audioStems : [];
  const collected = new Map<string, ProductionAudioStemMetadata>();
  for (let index = 0; index < declared.length; index += 1) {
    const stem = audioStemMetadata(declared[index], `stem:${index}`);
    if (stem) collected.set(stem.id, stem);
  }
  for (const derivative of session.resource.derivatives) {
    if (derivative.kind !== "audio_stem") continue;
    const metadata = record(derivative.metadata)?.audioStem;
    const stem = audioStemMetadata(metadata, derivative.variantKey || derivative.id) || { id: derivative.variantKey || derivative.id, label: derivative.variantKey || "Stem", role: "custom" as const };
    collected.set(stem.id, { ...stem, derivativeId: derivative.id, variantKey: derivative.variantKey });
  }
  return [...collected.values()].slice(0, 32).map((stem) => {
    const derivative = session.resource.derivatives.find((item) => stem.derivativeId ? item.id === stem.derivativeId : item.kind === "audio_stem" && item.variantKey === stem.variantKey) || null;
    return { ...stem, derivative, url: derivative?.url ? absoluteViewerResourceUrl(derivative.url) : "" };
  });
}

function audioComments(asset: Record<string, unknown> | null | undefined) {
  const comments = Array.isArray(asset?.comments) ? asset.comments : [];
  return comments.filter((value): value is ReviewCommentRecord => Boolean(value && typeof value === "object" && typeof (value as ReviewCommentRecord).id === "string"));
}

function audioLocator(value: unknown) {
  const locator = record(value);
  if (!locator || locator.type !== "audio_region") return null;
  const timeSeconds = Number(locator.timeSeconds);
  if (!Number.isFinite(timeSeconds) || timeSeconds < 0) return null;
  const end = Number(locator.endTimeSeconds);
  return {
    type: "audio_region" as const,
    timeSeconds,
    endTimeSeconds: Number.isFinite(end) && end >= timeSeconds ? end : null,
    trackId: typeof locator.trackId === "string" ? locator.trackId : null,
    stemId: typeof locator.stemId === "string" ? locator.stemId : null,
  };
}

function trackLabel(track: EmbeddedAudioTrackMetadata) {
  const parts = [track.label || `Track ${track.index + 1}`];
  if (track.language) parts.push(track.language.toUpperCase());
  if (track.channelLayout) parts.push(track.channelLayout);
  else if (track.channels) parts.push(`${track.channels}ch`);
  return parts.join(" · ");
}

function monitorPresetLabel(value: AudioMonitoringPreset) {
  return value === "full_mix" ? "Full Mix" : value === "dialogue_focus" ? "Dialogue Focus" : value === "music_effects" ? "Music + Effects" : value === "mono_check" ? "Mono Check" : "Custom";
}

function outputLabel(value: AudioOutputMode) {
  return value === "stereo" ? "Stereo" : value === "mono" ? "Mono" : value === "left" ? "Left channel" : "Right channel";
}

function AudioWaveformCanvas({
  title,
  samples,
  snapshot,
  comments,
  showMarkers,
  showRegions,
  onSeek,
}: {
  title: string;
  samples: number[];
  snapshot: TimedMediaSnapshot;
  comments: ReviewCommentRecord[];
  showMarkers: boolean;
  showRegions: boolean;
  onSeek: (seconds: number) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef(false);
  const duration = Math.max(0, snapshot.duration);
  const progress = duration > 0 ? clamp(snapshot.currentTime / duration, 0, 1) : 0;

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    if (!canvas || !host) return;
    const draw = () => {
      const rect = host.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(width * dpr));
      canvas.height = Math.max(1, Math.round(height * dpr));
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      const style = getComputedStyle(host);
      const unplayed = style.getPropertyValue("--cluster-workbench-border-strong").trim() || "currentColor";
      const played = style.getPropertyValue("--accent").trim() || "currentColor";
      const center = height / 2;
      const source = samples.length ? samples : Array.from({ length: Math.min(160, Math.max(24, Math.round(width / 6))) }, () => 0.08);
      const bars = Math.min(source.length, Math.max(24, Math.floor(width / 3)));
      for (let bar = 0; bar < bars; bar += 1) {
        const start = Math.floor(bar * source.length / bars);
        const end = Math.max(start + 1, Math.floor((bar + 1) * source.length / bars));
        let peak = 0;
        for (let index = start; index < end && index < source.length; index += 1) peak = Math.max(peak, Number(source[index] || 0));
        const x = bar * width / bars;
        const barWidth = Math.max(1, width / bars - 1);
        const barHeight = Math.max(2, clamp(peak, 0, 1) * (height - 18));
        context.fillStyle = bar / Math.max(1, bars - 1) <= progress ? played : unplayed;
        context.globalAlpha = samples.length ? 0.92 : 0.34;
        context.fillRect(x, center - barHeight / 2, barWidth, barHeight);
      }
      context.globalAlpha = 1;
      context.fillStyle = played;
      context.fillRect(Math.round(progress * width), 4, 1, height - 8);
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(host);
    return () => observer.disconnect();
  }, [progress, samples]);

  const seekAt = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!duration) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    onSeek(ratio * duration);
  }, [duration, onSeek]);

  const markerComments = comments.map((comment) => ({ comment, locator: audioLocator(comment.locator) })).filter((item): item is { comment: ReviewCommentRecord; locator: NonNullable<ReturnType<typeof audioLocator>> } => Boolean(item.locator));

  return <div
    ref={hostRef}
    className="cluster-audio-waveform"
    role="slider"
    tabIndex={0}
    aria-label={`Waveform position for ${title}`}
    aria-valuemin={0}
    aria-valuemax={Math.max(0, duration)}
    aria-valuenow={Math.max(0, snapshot.currentTime)}
    aria-valuetext={formatTime(snapshot.currentTime)}
    onPointerDown={(event) => { dragRef.current = true; event.currentTarget.setPointerCapture(event.pointerId); seekAt(event); }}
    onPointerMove={(event) => { if (dragRef.current) seekAt(event); }}
    onPointerUp={(event) => { dragRef.current = false; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); seekAt(event); }}
    onPointerCancel={() => { dragRef.current = false; }}
    onKeyDown={(event) => {
      if (!duration) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); onSeek(snapshot.currentTime + (event.key === "ArrowRight" ? 1 : -1)); }
      if (event.key === "Home") { event.preventDefault(); onSeek(0); }
      if (event.key === "End") { event.preventDefault(); onSeek(duration); }
    }}
  >
    <canvas ref={canvasRef} aria-hidden="true" />
    <div className="cluster-audio-buffer-ranges" aria-hidden="true">{snapshot.buffered.map((range, index) => duration > 0 ? <span key={`${range.start}:${range.end}:${index}`} style={runtimeStyle({ left: `${clamp(range.start / duration, 0, 1) * 100}%`, width: `${clamp((range.end - range.start) / duration, 0, 1) * 100}%` })} /> : null)}</div>
    {showRegions ? <div className="cluster-audio-review-regions" aria-hidden="true">{markerComments.filter(({ locator }) => locator.endTimeSeconds != null && duration > 0).map(({ comment, locator }) => <span key={comment.id} style={runtimeStyle({ left: `${clamp(locator.timeSeconds / duration, 0, 1) * 100}%`, width: `${clamp(((locator.endTimeSeconds || locator.timeSeconds) - locator.timeSeconds) / duration, 0, 1) * 100}%` })} />)}</div> : null}
    {showMarkers ? <div className="cluster-audio-review-markers">{markerComments.map(({ comment, locator }) => duration > 0 ? <ClusterButton type="button" key={comment.id} variant="quiet" size="compact" className={`cluster-audio-review-marker${comment.status === "resolved" ? " resolved" : ""}`} style={runtimeStyle({ left: `${clamp(locator.timeSeconds / duration, 0, 1) * 100}%` })} title={`${formatShortTime(locator.timeSeconds)} · ${comment.body || "Review note"}`} aria-label={`Review note at ${formatTime(locator.timeSeconds)}`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onSeek(locator.timeSeconds); }}><span /></ClusterButton> : null)}</div> : null}
  </div>;
}

function Meter({ rms, peak, supported, label }: { rms: number; peak: number; supported: boolean; label: string }) {
  const rmsDb = gainToDb(Math.max(0.00001, rms));
  const peakDb = gainToDb(Math.max(0.00001, peak));
  const level = clamp((rmsDb + 60) / 60, 0, 1);
  const peakLevel = clamp((peakDb + 60) / 60, 0, 1);
  return <div className="cluster-audio-meter" aria-label={`${label} level${supported ? ` ${rmsDb.toFixed(1)} dB` : " unavailable"}`} data-supported={supported ? "true" : "false"}>
    <span><i style={runtimeStyle({ height: `${level * 100}%` })} /><b style={runtimeStyle({ bottom: `${peakLevel * 100}%` })} /></span>
    <small>{supported ? `${rmsDb.toFixed(1)} dB` : "n/a"}</small>
  </div>;
}

function AudioStemFollower({
  stem,
  controller,
  enabled,
  muted,
  gainDb,
  outputMode,
  onMeter,
}: {
  stem: AudioStemRuntime;
  controller: TimedMediaController;
  enabled: boolean;
  muted: boolean;
  gainDb: number;
  outputMode: AudioOutputMode;
  onMeter: (meter: { rms: number; peak: number; supported: boolean }) => void;
}) {
  const [element, setElement] = useState<HTMLAudioElement | null>(null);
  const meter = useAudioMeter(element, outputMode);
  const onMeterRef = useRef(onMeter);
  onMeterRef.current = onMeter;

  useEffect(() => {
    if (!element) return;
    return controller.registerFollower({ id: stem.id, element, enabled, muted, gain: dbToGain(gainDb) });
  }, [controller, element, stem.id]);
  useEffect(() => controller.updateFollower(stem.id, { enabled, muted, gain: dbToGain(gainDb) }), [controller, stem.id, enabled, muted, gainDb]);
  useEffect(() => onMeterRef.current({ rms: meter.rms, peak: meter.peak, supported: meter.supported }), [meter.rms, meter.peak, meter.supported]);

  if (!stem.url) return null;
  return <audio ref={setElement} src={stem.url} preload="metadata" crossOrigin="use-credentials" aria-hidden="true" className="cluster-audio-hidden-media" />;
}

function AudioReviewComposer({
  session,
  snapshot,
  activeTrackId,
  activeStemId,
  onReload,
  onClose,
}: {
  session: ViewerAssetSession;
  snapshot: TimedMediaSnapshot;
  activeTrackId: string | null;
  activeStemId: string | null;
  onReload: () => void;
  onClose: () => void;
}) {
  const [body, setBody] = useState("");
  const [start, setStart] = useState(snapshot.currentTime);
  const [end, setEnd] = useState<number | null>(null);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState("");
  const locatorProvider = session.resource.source.locator.provider;

  useEffect(() => { setStart(snapshot.currentTime); setEnd(null); }, [session.resource.source.id]);

  async function submit() {
    if (!body.trim() || locatorProvider !== "review_asset") return;
    setPosting(true); setError("");
    const locator: ReviewLocator = { type: "audio_region", timeSeconds: Math.max(0, start), endTimeSeconds: end != null && end >= start ? end : null, trackId: activeTrackId, stemId: activeStemId };
    try {
      const response = await clusterApiFetch(`/api/review-assets/${encodeURIComponent(session.resource.source.locator.assetId)}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ body: body.trim(), locator, status: "open", category: "audio", priority: "medium" }),
      });
      if (!response.ok) throw new Error(`Review note could not be saved (${response.status}).`);
      setBody("");
      onReload();
      onClose();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Review note could not be saved.");
    } finally { setPosting(false); }
  }

  return <form className="cluster-viewer-review-composer cluster-audio-review-composer" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <strong>Audio review note</strong>
    <div className="cluster-audio-range-fields">
      <label><span>In</span><ClusterTextInput value={formatTime(start)} onChange={(event) => { const parsed = parseTime(event.target.value); if (parsed != null) setStart(Math.max(0, parsed)); }} /></label>
      <label><span>Out</span><ClusterTextInput value={end == null ? "" : formatTime(end)} placeholder="Optional" onChange={(event) => { const parsed = parseTime(event.target.value); setEnd(parsed == null ? null : Math.max(0, parsed)); }} /></label>
      <ClusterButton type="button" size="compact" variant="quiet" onClick={() => setStart(snapshot.currentTime)}>Set In</ClusterButton>
      <ClusterButton type="button" size="compact" variant="quiet" onClick={() => setEnd(snapshot.currentTime)}>Set Out</ClusterButton>
    </div>
    <ClusterTextArea autoFocus rows={3} maxLength={4000} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Describe the audio change, timing issue, mix note, or approval feedback…" />
    <small>{activeTrackId ? `Track context: ${activeTrackId}` : "Mix context"}{activeStemId ? ` · Stem: ${activeStemId}` : ""}</small>
    {error ? <span className="cluster-viewer-inline-error">{error}</span> : null}
    <div><ClusterButton type="button" variant="quiet" size="compact" onClick={onClose}>Cancel</ClusterButton><ClusterButton type="submit" variant="primary" size="compact" disabled={posting || !body.trim()}>{posting ? "Posting…" : "Post note"}</ClusterButton></div>
  </form>;
}

function AudioAdapter({
  session,
  compareSession,
  comparison,
  visibleOverlayIds,
  overlayPlacements,
  controller,
  snapshot,
  playbackRate,
  skipSeconds,
  outputMode,
  monitoringPreset,
  activeTrackId,
  stemStates,
  showComposer,
  onPlaybackRate,
  onSkipSeconds,
  onOutputMode,
  onMonitoringPreset,
  onActiveTrack,
  onStemState,
  onShowComposer,
  onReload,
  onDiagnostics,
}: {
  session: ViewerAssetSession;
  compareSession: ViewerAssetSession | null;
  comparison: ReviewComparisonSnapshot;
  visibleOverlayIds: readonly string[];
  overlayPlacements: Record<string, string>;
  controller: TimedMediaController;
  snapshot: TimedMediaSnapshot;
  playbackRate: number;
  skipSeconds: number;
  outputMode: AudioOutputMode;
  monitoringPreset: AudioMonitoringPreset;
  activeTrackId: string | null;
  stemStates: Record<string, StemMonitoringState>;
  showComposer: boolean;
  onPlaybackRate: (value: number) => void;
  onSkipSeconds: (value: number) => void;
  onOutputMode: (value: AudioOutputMode) => void;
  onMonitoringPreset: (value: AudioMonitoringPreset) => void;
  onActiveTrack: (value: string | null) => void;
  onStemState: (id: string, patch: Partial<StemMonitoringState>) => void;
  onShowComposer: (value: boolean) => void;
  onReload: () => void;
  onDiagnostics: (value: Record<string, unknown>) => void;
}) {
  const selection = useMemo(() => resolveViewerResourceSource(session.resource, ["review_encode", "proxy"]), [session.resource]);
  const compareSelection = useMemo(() => compareSession ? resolveViewerResourceSource(compareSession.resource, ["review_encode", "proxy"]) : null, [compareSession]);
  const waveform = useAudioWaveform(session.resource);
  const compareWaveform = useAudioWaveform(compareSession?.resource || session.resource);
  const tracks = useMemo(() => embeddedTracks(session), [session.metadata]);
  const stems = useMemo(() => productionStems(session), [session.metadata, session.resource.derivatives]);
  const comments = useMemo(() => audioComments(session.asset), [session.asset]);
  const [mainElement, setMainElement] = useState<HTMLAudioElement | null>(null);
  const [compareElement, setCompareElement] = useState<HTMLAudioElement | null>(null);
  const [timeEntry, setTimeEntry] = useState("");
  const masterMeter = useAudioMeter(mainElement, outputMode);
  const anySolo = stems.some((stem) => stemStates[stem.id]?.enabled && stemStates[stem.id]?.solo);
  const enabledStemIds = stems.filter((stem) => {
    const state = stemStates[stem.id];
    return Boolean(stem.url && state?.enabled && (!anySolo || state.solo));
  }).map((stem) => stem.id);
  const activeStemId = enabledStemIds.find((id) => !stemStates[id]?.muted) || enabledStemIds[0] || null;
  const selectedTrack = tracks.find((track) => track.id === activeTrackId) || tracks.find((track) => track.default) || tracks[0] || null;

  useEffect(() => {
    controller.attach(mainElement);
    if (mainElement) {
      controller.setPlaybackRate(playbackRate);
      controller.selectEmbeddedTrack(selectedTrack?.index ?? null);
    }
    return () => controller.attach(null);
  }, [controller, mainElement]);
  useEffect(() => {
    if (!compareElement || !compareSelection?.url) return;
    return controller.registerFollower({ id: "audio-compare", element: compareElement, enabled: comparison.syncPlayback, muted: comparison.activeSide !== "secondary", gain: comparison.activeSide === "secondary" ? 1 : 0 });
  }, [controller, compareElement, compareSelection?.url]);
  useEffect(() => controller.updateFollower("audio-compare", { enabled: comparison.syncPlayback, muted: comparison.activeSide !== "secondary", gain: comparison.activeSide === "secondary" ? 1 : 0 }), [controller, comparison.syncPlayback, comparison.activeSide]);
  useEffect(() => controller.setPlaybackRate(playbackRate), [controller, playbackRate]);
  useEffect(() => { controller.selectEmbeddedTrack(selectedTrack?.index ?? null); }, [controller, selectedTrack?.index]);
  useEffect(() => {
    if (!compareSession) { controller.setPrimaryOutput({ enabled: enabledStemIds.length === 0 }); return; }
    controller.setPrimaryOutput({ enabled: enabledStemIds.length === 0 && (!comparison.syncPlayback || comparison.activeSide === "primary") });
  }, [controller, enabledStemIds.join("|"), compareSession?.resource.source.id, comparison.syncPlayback, comparison.activeSide]);

  useEffect(() => {
    onDiagnostics({
      playbackPhase: snapshot.phase,
      currentTimeSeconds: Number(snapshot.currentTime.toFixed(3)),
      durationSeconds: Number(snapshot.duration.toFixed(3)),
      playbackRate: snapshot.playbackRate,
      bufferedRanges: snapshot.buffered.length,
      seekableRanges: snapshot.seekable.length,
      readyState: snapshot.readyState,
      networkState: snapshot.networkState,
      embeddedTracks: tracks.length,
      embeddedTrackControl: snapshot.embeddedTrackControl,
      activeEmbeddedTrack: selectedTrack?.id || null,
      productionStems: stems.length,
      activeStemCount: enabledStemIds.length,
      waveform: waveform.state,
      waveformBins: waveform.data?.channels.reduce((sum, channel) => sum + channel.samples.length, 0) || 0,
      meterSupported: masterMeter.supported,
      outputMode,
      monitoringPreset,
      comparisonMode: compareSession ? comparison.mode : "off",
      comparisonSide: compareSession ? comparison.activeSide : null,
      comparisonWaveform: compareSession ? compareWaveform.state : null,
      errorCode: snapshot.errorCode,
      errorMessage: snapshot.errorMessage,
    });
  }, [snapshot, tracks.length, selectedTrack?.id, stems.length, enabledStemIds.length, waveform.state, waveform.data, masterMeter.supported, outputMode, monitoringPreset, compareSession?.resource.source.id, comparison.mode, comparison.activeSide, compareWaveform.state, onDiagnostics]);

  const waveformSamples = waveform.data?.channels[0]?.samples || [];
  const compareWaveformSamples = compareWaveform.data?.channels[0]?.samples || [];
  const maxPeak = waveform.data?.channels.reduce((peak, channel) => Math.max(peak, Number(channel.peak || 0)), 0) || masterMeter.peak;
  const maxRms = waveform.data?.channels.reduce((peak, channel) => Math.max(peak, Number(channel.rms || 0)), 0) || masterMeter.rms;
  const bufferAhead = snapshot.buffered.reduce((best, range) => range.start <= snapshot.currentTime && range.end >= snapshot.currentTime ? Math.max(best, range.end - snapshot.currentTime) : best, 0);
  const trackSummary = selectedTrack ? trackLabel(selectedTrack) : "Container mix";
  const meterSummary = `${gainToDb(Math.max(masterMeter.rms, 0.00001)).toFixed(1)} dB RMS · ${gainToDb(Math.max(masterMeter.peak, 0.00001)).toFixed(1)} dB peak`;
  const values: Record<string, string> = {
    "audio.timecode": `${formatTime(snapshot.currentTime)} / ${formatTime(snapshot.duration)}`,
    "audio.tracks": `${trackSummary}${activeStemId ? ` · ${activeStemId}` : ""}`,
    "audio.meters": masterMeter.supported ? meterSummary : "Meter unavailable",
    "audio.peaks": `${gainToDb(Math.max(maxPeak, 0.00001)).toFixed(1)} dBFS peak`,
    "audio.loudness": waveform.data ? `${gainToDb(Math.max(maxRms, 0.00001)).toFixed(1)} dBFS RMS` : "Waveform analysis unavailable",
    "audio.waveform_markers": `${comments.filter((comment) => audioLocator(comment.locator)).length} review marker${comments.length === 1 ? "" : "s"}`,
    "audio.clip_regions": `${comments.filter((comment) => audioLocator(comment.locator)?.endTimeSeconds != null).length} timed region${comments.length === 1 ? "" : "s"}`,
    "source.derivative": selection.derivative ? `${selection.derivative.kind} · ${selection.derivative.variantKey}` : "Original source",
  };

  function seek(seconds: number) { controller.seek(clamp(seconds, 0, snapshot.duration || Number.MAX_SAFE_INTEGER)); }
  function commitTimeEntry() { const parsed = parseTime(timeEntry); if (parsed != null) seek(parsed); setTimeEntry(""); }

  if (!selection.url) return <ViewerState compact tone="warning" title="Audio source unavailable" description="This resource does not expose an authorized streamable source." actions={<ClusterButton size="compact" variant="secondary" onClick={onReload}>Retry</ClusterButton>} />;

  if (snapshot.phase === "error") return <ViewerState compact tone="error" title="Audio playback failed" description={snapshot.errorMessage || "The authorized audio source could not be played."} actions={<ClusterButton size="compact" variant="secondary" onClick={onReload}>Retry</ClusterButton>} />;

  return <div className="cluster-audio-adapter">
    <audio ref={setMainElement} src={selection.url} preload="metadata" crossOrigin="use-credentials" className="cluster-audio-hidden-media" aria-label={`${session.resource.source.title} audio`} />
    {compareSelection?.url ? <audio ref={setCompareElement} src={compareSelection.url} preload="metadata" crossOrigin="use-credentials" className="cluster-audio-hidden-media" aria-label="Comparison audio" /> : null}
    {stems.map((stem) => {
      const state = stemStates[stem.id] || { enabled: false, muted: false, solo: false, gainDb: stem.defaultGainDb || 0, meterRms: 0, meterPeak: 0, meterSupported: false };
      const effectiveEnabled = state.enabled && (!anySolo || state.solo);
      return <AudioStemFollower key={stem.id} stem={stem} controller={controller} enabled={effectiveEnabled} muted={state.muted} gainDb={state.gainDb} outputMode={outputMode} onMeter={(meter) => onStemState(stem.id, { meterRms: meter.rms, meterPeak: meter.peak, meterSupported: meter.supported })} />;
    })}

    <div className="cluster-audio-main">
      <div className="cluster-audio-stage-head">
        <div><ClusterIcon name="audio" /><span><strong>{session.resource.source.title}</strong><small>{session.resource.source.mimeType} · {trackSummary}</small></span></div>
        <Meter rms={masterMeter.rms} peak={masterMeter.peak} supported={masterMeter.supported} label="Master" />
      </div>

      <div className={compareSession ? "cluster-audio-waveform-compare" : ""}>
        <AudioWaveformCanvas title={session.resource.source.title} samples={waveformSamples} snapshot={snapshot} comments={comments} showMarkers={visibleOverlayIds.includes("audio.waveform_markers") || visibleOverlayIds.includes("review.annotations")} showRegions={visibleOverlayIds.includes("audio.clip_regions")} onSeek={seek} />
        {compareSession ? <AudioWaveformCanvas title={compareSession.resource.source.title} samples={compareWaveformSamples} snapshot={snapshot} comments={[]} showMarkers={false} showRegions={false} onSeek={seek} /> : null}
      </div>
      <div className="cluster-audio-waveform-meta"><span>{waveform.state === "ready" ? `${waveformSamples.length.toLocaleString()} canonical waveform bins` : waveform.state === "loading" ? "Loading canonical waveform…" : waveform.state === "error" ? "Waveform artifact unavailable" : "Waveform not generated; streamed transport remains available"}</span><span>{bufferAhead > 0 ? `${bufferAhead.toFixed(1)}s buffered ahead` : snapshot.phase}</span></div>

      <div className="cluster-audio-transport" role="group" aria-label="Audio transport controls">
        <ClusterIconButton label={`Back ${skipSeconds} seconds`} variant="quiet" onClick={() => controller.jump(-skipSeconds)}><ClusterIcon name="rewind" /></ClusterIconButton>
        <ClusterIconButton label={snapshot.phase === "playing" ? "Pause" : "Play"} variant="primary" onClick={() => void controller.toggle()}><ClusterIcon name={snapshot.phase === "playing" ? "pause" : "play"} /></ClusterIconButton>
        <ClusterIconButton label={`Forward ${skipSeconds} seconds`} variant="quiet" onClick={() => controller.jump(skipSeconds)}><ClusterIcon name="forward" /></ClusterIconButton>
        <span className="cluster-audio-time-readout">{formatShortTime(snapshot.currentTime)} <small>/ {formatShortTime(snapshot.duration)}</small></span>
        <form className="cluster-audio-time-entry" onSubmit={(event) => { event.preventDefault(); commitTimeEntry(); }}><ClusterTextInput aria-label="Seek to timecode" placeholder="mm:ss" value={timeEntry} onChange={(event) => setTimeEntry(event.target.value)} /><ClusterButton size="compact" variant="quiet" type="submit">Go</ClusterButton></form>
        <label className="cluster-audio-master-volume"><ClusterIcon name={snapshot.muted ? "mute" : "volume"} /><ClusterSlider aria-label="Master volume" min="0" max="1" step="0.01" value={snapshot.volume} onChange={(event) => { const value = Number(event.target.value); controller.setVolume(value); writePreferenceStorage("cluster-media-volume", String(value)); }} /><span>{percent(snapshot.volume)}</span></label>
        <ClusterIconButton label={snapshot.muted ? "Unmute" : "Mute"} variant="quiet" selected={snapshot.muted} onClick={() => controller.setMuted(!snapshot.muted)}><ClusterIcon name={snapshot.muted ? "mute" : "volume"} /></ClusterIconButton>
      </div>
    </div>

    <aside className="cluster-audio-mixer" aria-label="Audio monitoring mixer">
      <section>
        <header><div><strong>Monitoring</strong><span>Session-only mix state</span></div></header>
        <div className="cluster-audio-preset-grid">{AUDIO_MONITORING_PRESETS.filter((preset) => preset !== "custom").map((preset) => <ClusterButton key={preset} size="compact" variant="quiet" selected={monitoringPreset === preset} onClick={() => onMonitoringPreset(preset)}>{monitorPresetLabel(preset)}</ClusterButton>)}</div>
        <label><span>Output</span><ClusterNativeSelect value={outputMode} onChange={(event) => onOutputMode(event.target.value as AudioOutputMode)}>{AUDIO_OUTPUT_MODES.map((mode) => <option key={mode} value={mode}>{outputLabel(mode)}</option>)}</ClusterNativeSelect></label>
        <label><span>Playback</span><ClusterNativeSelect value={playbackRate} onChange={(event) => onPlaybackRate(Number(event.target.value))}>{AUDIO_PLAYBACK_RATES.map((rate) => <option key={rate} value={rate}>{rate}×</option>)}</ClusterNativeSelect></label>
        <label><span>Skip</span><ClusterNativeSelect value={skipSeconds} onChange={(event) => onSkipSeconds(Number(event.target.value))}>{AUDIO_SKIP_SECONDS.map((seconds) => <option key={seconds} value={seconds}>{seconds}s</option>)}</ClusterNativeSelect></label>
      </section>

      <section>
        <header><div><strong>Embedded tracks</strong><span>{tracks.length ? `${tracks.length} container stream${tracks.length === 1 ? "" : "s"}` : "No track metadata"}</span></div></header>
        {tracks.length ? <ClusterNativeSelect aria-label="Embedded audio track" value={selectedTrack?.id || ""} onChange={(event) => onActiveTrack(event.target.value || null)}>{tracks.map((track) => <option key={track.id} value={track.id}>{trackLabel(track)}</option>)}</ClusterNativeSelect> : <p className="muted">No embedded-track metadata was reported by the media probe.</p>}
        {tracks.length > 1 && snapshot.embeddedTrackControl === "metadata_only" ? <small className="cluster-audio-degraded-note">This runtime does not expose browser audio-track switching. The selected track is retained as review context, but playback remains the container default.</small> : null}
      </section>

      <section className="cluster-audio-stems-section">
        <header><div><strong>Production stems</strong><span>{stems.length ? `${stems.length} available` : "No stem derivatives"}</span></div></header>
        {stems.length ? <div className="cluster-audio-stem-list">{stems.map((stem) => {
          const state = stemStates[stem.id] || { enabled: false, muted: false, solo: false, gainDb: stem.defaultGainDb || 0, meterRms: 0, meterPeak: 0, meterSupported: false };
          const unavailable = !stem.url;
          return <article key={stem.id} data-enabled={state.enabled ? "true" : "false"} data-unavailable={unavailable ? "true" : "false"}>
            <div className="cluster-audio-stem-name"><ClusterInput type="checkbox" aria-label={`Enable ${stem.label}`} checked={state.enabled} disabled={unavailable} onChange={(event) => onStemState(stem.id, { enabled: event.target.checked })} /><span><strong>{stem.label}</strong><small>{stem.role} · {stem.channelLayout || (stem.channels ? `${stem.channels}ch` : "layout unknown")}{unavailable ? " · source unavailable" : ""}</small></span></div>
            <div className="cluster-audio-stem-actions"><ClusterButton size="compact" variant="quiet" selected={state.muted} disabled={unavailable} onClick={() => onStemState(stem.id, { muted: !state.muted })}>M</ClusterButton><ClusterButton size="compact" variant="quiet" selected={state.solo} disabled={unavailable} onClick={() => onStemState(stem.id, { solo: !state.solo, enabled: true })}>S</ClusterButton></div>
            <label className="cluster-audio-stem-gain"><span>Gain</span><ClusterSlider aria-label={`${stem.label} gain`} min={STEM_GAIN_MIN_DB} max={STEM_GAIN_MAX_DB} step="0.5" value={state.gainDb} disabled={unavailable} onChange={(event) => onStemState(stem.id, { gainDb: Number(event.target.value) })} /><output>{state.gainDb > 0 ? "+" : ""}{state.gainDb.toFixed(1)} dB</output></label>
            <Meter rms={state.meterRms} peak={state.meterPeak} supported={state.meterSupported && !unavailable} label={stem.label} />
          </article>;
        })}</div> : <p className="muted">Full Mix uses the authorized source. Dialogue, music, effects, VO, and production stems appear here only when explicit stem derivatives exist.</p>}
      </section>
    </aside>

    <ViewerOverlayLayer visibleIds={visibleOverlayIds} placements={overlayPlacements} values={values} />
    {showComposer && session.capabilities.comment && session.resource.source.locator.provider === "review_asset" ? <AudioReviewComposer session={session} snapshot={snapshot} activeTrackId={selectedTrack?.id || null} activeStemId={activeStemId} onReload={onReload} onClose={() => onShowComposer(false)} /> : null}
  </div>;
}

export function UnifiedAudioViewer({
  input,
  compareInput = null,
  userId,
  mode: controlledMode,
  onModeChange,
}: {
  input: ViewerAssetSessionInput;
  compareInput?: ViewerAssetSessionInput | null;
  userId?: string | null;
  mode?: ViewerMode;
  onModeChange?: (mode: ViewerMode) => void;
}) {
  const assetSession = useViewerAssetSession(input);
  const compareAssetSession = useViewerAssetSession(compareInput);
  const identity = assetSession.session ? `${assetSession.session.resource.source.provider}:${assetSession.session.resource.source.id}:${assetSession.session.resource.source.versionId || ""}` : "audio:pending";
  const { controller, snapshot } = useTimedMediaController(identity);
  useTimedMediaSystemIntegration({ controller, snapshot, session: assetSession.session });
  const { comparisonSession, comparison } = useReviewComparisonSession({ medium: "audio", userId, identity, enabled: Boolean(compareInput) });
  const [localMode, setLocalMode] = useState<ViewerMode>(controlledMode || "view");
  const [playbackRate, setPlaybackRate] = useState(() => clamp(readNumberPreference("cluster-media-playback-rate", 1), 0.25, 2));
  const [skipSeconds, setSkipSeconds] = useState(() => {
    const stored = readNumberPreference("cluster-media-skip-seconds", 10);
    return AUDIO_SKIP_SECONDS.includes(stored as (typeof AUDIO_SKIP_SECONDS)[number]) ? stored : 10;
  });
  const [outputMode, setOutputMode] = useState<AudioOutputMode>("stereo");
  const [monitoringPreset, setMonitoringPreset] = useState<AudioMonitoringPreset>("full_mix");
  const [activeTrackId, setActiveTrackId] = useState<string | null>(null);
  const [stemStates, setStemStates] = useState<Record<string, StemMonitoringState>>({});
  const [showComposer, setShowComposer] = useState(false);
  const [adapterDiagnostics, setAdapterDiagnostics] = useState<Record<string, unknown>>({});
  const mode = controlledMode || localMode;
  const setMode = useCallback((next: ViewerMode) => { setLocalMode(next); onModeChange?.(next); }, [onModeChange]);

  const sessionStems = useMemo(() => assetSession.session ? productionStems(assetSession.session) : [], [assetSession.session?.resource.source.id, assetSession.session?.resource.derivatives, assetSession.session?.metadata]);
  useEffect(() => {
    setStemStates((current) => {
      const next: Record<string, StemMonitoringState> = {};
      for (const stem of sessionStems) next[stem.id] = current[stem.id] || { enabled: false, muted: false, solo: false, gainDb: stem.defaultGainDb || 0, meterRms: 0, meterPeak: 0, meterSupported: false };
      return next;
    });
  }, [sessionStems]);

  useEffect(() => {
    const volume = clamp(readNumberPreference("cluster-media-volume", 1), 0, 1);
    controller.setVolume(volume);
  }, [controller]);

  const applyPreset = useCallback((preset: AudioMonitoringPreset) => {
    setMonitoringPreset(preset);
    if (preset === "mono_check") setOutputMode("mono");
    else if (preset !== "custom") setOutputMode("stereo");
    setStemStates((current) => {
      const next = { ...current };
      for (const stem of sessionStems) {
        const existing = next[stem.id] || { enabled: false, muted: false, solo: false, gainDb: stem.defaultGainDb || 0, meterRms: 0, meterPeak: 0, meterSupported: false };
        const enabled = preset === "dialogue_focus" ? stem.role === "dialogue" || stem.role === "vo"
          : preset === "music_effects" ? stem.role === "music" || stem.role === "sfx"
          : false;
        next[stem.id] = { ...existing, enabled, muted: false, solo: false, gainDb: stem.defaultGainDb || 0 };
      }
      return next;
    });
  }, [sessionStems]);

  const updateStemState = useCallback((id: string, patch: Partial<StemMonitoringState>) => {
    setMonitoringPreset("custom");
    setStemStates((current) => ({ ...current, [id]: { ...(current[id] || { enabled: false, muted: false, solo: false, gainDb: 0, meterRms: 0, meterPeak: 0, meterSupported: false }), ...patch } }));
  }, []);

  const comments = useMemo(() => assetSession.session ? audioComments(assetSession.session.asset) : [], [assetSession.session?.asset]);
  const markerTimes = useMemo(() => comments.map((comment) => audioLocator(comment.locator)?.timeSeconds).filter((value): value is number => Number.isFinite(value)).sort((a, b) => a - b), [comments]);
  const seekMarker = useCallback((direction: -1 | 1) => {
    if (!markerTimes.length) return;
    const current = snapshot.currentTime;
    if (direction > 0) controller.seek(markerTimes.find((value) => value > current + 0.05) ?? markerTimes[0]);
    else controller.seek([...markerTimes].reverse().find((value) => value < current - 0.05) ?? markerTimes[markerTimes.length - 1]);
  }, [controller, markerTimes, snapshot.currentTime]);

  const commands = useMemo<ViewerCommandDefinition[]>(() => [
    { id: "viewer.audio.play_pause", label: snapshot.phase === "playing" ? "Pause" : "Play", icon: snapshot.phase === "playing" ? "pause" : "play", shortcut: "space", priority: 5, group: "transport", run: async () => { await controller.toggle(); } },
    { id: "viewer.audio.back", label: `Back ${skipSeconds}s`, icon: "rewind", shortcut: "arrowleft", priority: 10, group: "transport", run: () => controller.jump(-skipSeconds) },
    { id: "viewer.audio.forward", label: `Forward ${skipSeconds}s`, icon: "forward", shortcut: "arrowright", priority: 15, group: "transport", run: () => controller.jump(skipSeconds) },
    { id: "viewer.audio.previous_marker", label: "Previous review marker", icon: "previous", shortcut: "shift+arrowleft", priority: 30, group: "review", overflow: true, enabled: () => markerTimes.length > 0, run: () => seekMarker(-1) },
    { id: "viewer.audio.next_marker", label: "Next review marker", icon: "next", shortcut: "shift+arrowright", priority: 35, group: "review", overflow: true, enabled: () => markerTimes.length > 0, run: () => seekMarker(1) },
    { id: "viewer.audio.add_note", label: "Add review note", icon: "comment", shortcut: "a", priority: 20, group: "review", requiredCapability: "comment", visible: (context) => context.resource.source.locator.provider === "review_asset", run: () => { setShowComposer(true); setMode("review"); } },
    { id: "viewer.audio.mute", label: snapshot.muted ? "Unmute" : "Mute", icon: snapshot.muted ? "volume" : "mute", shortcut: "m", priority: 40, group: "transport", overflow: true, run: () => controller.setMuted(!snapshot.muted) },
  ], [snapshot.phase, snapshot.muted, skipSeconds, controller, markerTimes.length, seekMarker, setMode]);

  function changeRate(value: number) {
    const rate = clamp(value, 0.25, 2);
    setPlaybackRate(rate);
    writePreferenceStorage("cluster-media-playback-rate", String(rate));
  }
  function changeSkip(value: number) {
    const skip = AUDIO_SKIP_SECONDS.includes(value as (typeof AUDIO_SKIP_SECONDS)[number]) ? value : 10;
    setSkipSeconds(skip);
    writePreferenceStorage("cluster-media-skip-seconds", String(skip));
  }

  return <ViewerShell
    assetSession={assetSession}
    userId={userId}
    mode={mode}
    onModeChange={setMode}
    commands={commands}
    overlays={viewerOverlayCatalogForMedium("audio")}
    adapterDiagnostics={{ ...adapterDiagnostics, comparison: compareAssetSession.session ? comparison : null }}
    onReviewNavigate={(locator) => { if (locator.type === "audio_region") controller.seek(locator.timeSeconds, { exactFollowers: true }); }}
    renderAdapter={({ session, visibleOverlayIds, overlayPlacements }) => <div className="cluster-viewer-comparison-stack">
      {compareAssetSession.session ? <ViewerComparisonBar session={comparisonSession} snapshot={comparison} primaryLabel={session.resource.source.title} secondaryLabel={compareAssetSession.session.resource.source.title} /> : null}
      <AudioAdapter
      session={session}
      compareSession={compareAssetSession.session}
      comparison={comparison}
      visibleOverlayIds={visibleOverlayIds}
      overlayPlacements={overlayPlacements}
      controller={controller}
      snapshot={snapshot}
      playbackRate={playbackRate}
      skipSeconds={skipSeconds}
      outputMode={outputMode}
      monitoringPreset={monitoringPreset}
      activeTrackId={activeTrackId}
      stemStates={stemStates}
      showComposer={showComposer}
      onPlaybackRate={changeRate}
      onSkipSeconds={changeSkip}
      onOutputMode={(value) => { setOutputMode(value); setMonitoringPreset("custom"); }}
      onMonitoringPreset={applyPreset}
      onActiveTrack={setActiveTrackId}
      onStemState={updateStemState}
      onShowComposer={setShowComposer}
      onReload={assetSession.reload}
      onDiagnostics={setAdapterDiagnostics}
    />
    </div>}
  />;
}
