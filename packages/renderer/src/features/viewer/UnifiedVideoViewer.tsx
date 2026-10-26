import type { EmbeddedAudioTrackMetadata, ReviewScreenAnnotation, ViewableResourceDerivative } from "@cluster/shared";
import { clusterApiFetch } from "@cluster/api-client";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ClusterButton, ClusterIconButton } from "../../components/ClusterButton";
import { ClusterIcon } from "../../components/ClusterIcon";
import { ClusterInput, ClusterNativeSelect } from "../../components/ClusterNativeControls";
import { ClusterTextArea } from "../../components/ClusterTextArea";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterSlider } from "../../components/ClusterSlider";
import { readPreferenceStorage, writePreferenceStorage } from "../../core/privacy-consent";
import { runtimeStyle } from "../../core/runtime-style";
import { TimedMediaController, type TimedMediaSnapshot } from "./timed-media-controller";
import { useTimedMediaController } from "./use-timed-media-controller";
import { useTimedMediaSystemIntegration } from "./use-timed-media-system-integration";
import { useViewerAssetSession } from "./use-viewer-asset-session";
import { useReviewComparisonSession } from "./use-review-comparison-session";
import { ViewerComparisonBar } from "./ViewerComparisonBar";
import { ViewerOverlayLayer } from "./ViewerOverlayLayer";
import { ViewerShell } from "./ViewerShell";
import { ViewerState } from "./ViewerState";
import { viewerOverlayCatalogForMedium } from "./viewer-overlay-catalog";
import { absoluteViewerResourceUrl } from "./viewer-resource-loader";
import { formatVideoTimecode, normalizedVideoFrameRate, parseVideoTimecode, videoFrameNumber } from "./video-timecode";
import { resolveVideoStoryboard, videoStoryboardFrameAt } from "./video-storyboard";
import type { ViewerAssetSession, ViewerAssetSessionInput, ViewerCommandDefinition, ViewerMode } from "./viewer-contracts";

const VIDEO_PLAYBACK_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;
const VIDEO_SOURCE_MODES = ["auto", "review", "proxy", "original"] as const;
export type VideoSourceMode = typeof VIDEO_SOURCE_MODES[number];
export type VideoComparisonMode = "side" | "wipe" | "reference" | "difference";

export type UnifiedVideoViewerHandle = {
  seek: (seconds: number) => void;
  stepFrame: (direction: -1 | 1) => void;
  pause: () => void;
  getCurrentTime: () => number;
};

type ReviewCommentRecord = {
  id: string;
  body?: string | null;
  status?: string | null;
  locator?: unknown;
  user?: { displayName?: string | null; username?: string | null } | null;
};

type VideoCaptionTrack = {
  id: string;
  index: number;
  label: string;
  language: string | null;
  default: boolean;
  derivative: ViewableResourceDerivative;
  url: string;
};

type VideoChapter = { index: number; startSeconds: number; endSeconds: number | null; title: string };
type VideoSourceSelection = { mode: VideoSourceMode; requestedMode: VideoSourceMode; label: string; url: string; derivative: ViewableResourceDerivative | null; degradedReason: string | null };

function clamp(value: number, minimum: number, maximum: number) { return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum)); }
function record(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function formatBytes(value: number) {
  const safe = Math.max(0, Number(value) || 0);
  if (safe < 1024) return `${safe} B`;
  if (safe < 1024 ** 2) return `${(safe / 1024).toFixed(1)} KB`;
  if (safe < 1024 ** 3) return `${(safe / 1024 ** 2).toFixed(1)} MB`;
  return `${(safe / 1024 ** 3).toFixed(2)} GB`;
}
function bufferAhead(snapshot: TimedMediaSnapshot) {
  const range = snapshot.buffered.find((item) => snapshot.currentTime >= item.start - 0.05 && snapshot.currentTime <= item.end + 0.05);
  return range ? Math.max(0, range.end - snapshot.currentTime) : 0;
}
function readNumberPreference(key: string, fallback: number) {
  const value = Number(readPreferenceStorage(key));
  return Number.isFinite(value) ? value : fallback;
}
function sourceLabel(mode: VideoSourceMode) { return mode === "auto" ? "Auto" : mode === "review" ? "Review" : mode === "proxy" ? "Proxy" : "Original"; }

function productionProbe(session: ViewerAssetSession) {
  const production = record(session.metadata?.production);
  return record(production?.probe) || production || {};
}

function frameRateForSession(session: ViewerAssetSession) {
  const probe = productionProbe(session);
  const sourceAsset = session.asset || {};
  return normalizedVideoFrameRate(probe.frameRate ?? sourceAsset.frameRate ?? 30);
}

function videoDimensions(session: ViewerAssetSession) {
  const probe = productionProbe(session);
  const width = Number(probe.width ?? session.asset?.width);
  const height = Number(probe.height ?? session.asset?.height);
  return { width: Number.isFinite(width) && width > 0 ? width : null, height: Number.isFinite(height) && height > 0 ? height : null };
}

function videoCodec(session: ViewerAssetSession) {
  const probe = productionProbe(session);
  return String(probe.codec || session.asset?.codec || "Unknown");
}

function videoBitRate(session: ViewerAssetSession) {
  const value = Number(productionProbe(session).bitRate);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function embeddedAudioTracks(session: ViewerAssetSession): EmbeddedAudioTrackMetadata[] {
  const probe = productionProbe(session);
  const raw = Array.isArray(probe.audioTracks) ? probe.audioTracks : [];
  return raw.slice(0, 64).map((value, position) => {
    const item = record(value) || {};
    const index = Number.isFinite(Number(item.index)) ? Number(item.index) : position;
    return {
      id: typeof item.id === "string" && item.id.trim() ? item.id.trim().slice(0, 120) : `stream:${index}`,
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

function captionTracks(session: ViewerAssetSession): VideoCaptionTrack[] {
  return session.resource.derivatives.filter((item) => item.kind === "captions_vtt" && item.url).slice(0, 32).map((derivative, position) => {
    const item = record(record(derivative.metadata)?.captionTrack) || {};
    const index = Number.isFinite(Number(item.index)) ? Number(item.index) : position;
    return {
      id: typeof item.id === "string" && item.id ? item.id.slice(0, 120) : `caption:${derivative.variantKey || index}`,
      index,
      label: typeof item.label === "string" && item.label ? item.label.slice(0, 160) : `Captions ${position + 1}`,
      language: typeof item.language === "string" ? item.language.slice(0, 32) : null,
      default: Boolean(item.default),
      derivative,
      url: absoluteViewerResourceUrl(derivative.url || ""),
    };
  });
}

function videoChapters(session: ViewerAssetSession): VideoChapter[] {
  const raw = productionProbe(session).chapters;
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 2000).map((value, index) => {
    const item = record(value) || {};
    const startSeconds = Number(item.startSeconds);
    const endSeconds = Number(item.endSeconds);
    return {
      index: Number.isFinite(Number(item.index)) ? Number(item.index) : index,
      startSeconds: Number.isFinite(startSeconds) && startSeconds >= 0 ? startSeconds : 0,
      endSeconds: Number.isFinite(endSeconds) && endSeconds >= 0 ? endSeconds : null,
      title: typeof item.title === "string" && item.title.trim() ? item.title.trim().slice(0, 240) : `Chapter ${index + 1}`,
    };
  }).filter((chapter) => Number.isFinite(chapter.startSeconds)).sort((a, b) => a.startSeconds - b.startSeconds);
}

function videoComments(asset: Record<string, unknown> | null | undefined) {
  const comments = Array.isArray(asset?.comments) ? asset.comments : [];
  return comments.filter((value): value is ReviewCommentRecord => Boolean(value && typeof value === "object" && typeof (value as ReviewCommentRecord).id === "string"));
}

function mediaLocator(value: unknown) {
  const locator = record(value);
  if (!locator || locator.type !== "media_time") return null;
  const timeSeconds = Number(locator.timeSeconds);
  if (!Number.isFinite(timeSeconds) || timeSeconds < 0) return null;
  const end = Number(locator.endTimeSeconds);
  const annotation = record(locator.annotation) as ReviewScreenAnnotation | null;
  return {
    type: "media_time" as const,
    timeSeconds,
    endTimeSeconds: Number.isFinite(end) && end >= timeSeconds ? end : null,
    frameNumber: Number.isFinite(Number(locator.frameNumber)) ? Number(locator.frameNumber) : null,
    presentedFrame: Number.isFinite(Number(locator.presentedFrame)) ? Number(locator.presentedFrame) : null,
    sourceVersionId: typeof locator.sourceVersionId === "string" ? locator.sourceVersionId : null,
    sourceArtifactId: typeof locator.sourceArtifactId === "string" ? locator.sourceArtifactId : null,
    audioTrackId: typeof locator.audioTrackId === "string" ? locator.audioTrackId : null,
    annotation,
  };
}

function selectVideoSource(session: ViewerAssetSession, requestedMode: VideoSourceMode): VideoSourceSelection {
  const resource = session.resource;
  const review = resource.derivatives.find((item) => item.kind === "review_encode" && item.url) || null;
  const proxy = resource.derivatives.find((item) => item.kind === "proxy" && item.url) || null;
  const originalUrl = absoluteViewerResourceUrl(resource.source.sourceUrl || "");
  const original = originalUrl && resource.source.support === "native" ? { mode: "original" as const, label: "Original", url: originalUrl, derivative: null } : null;
  const fromDerivative = (mode: "review" | "proxy", derivative: ViewableResourceDerivative) => ({ mode, label: mode === "review" ? "Review encode" : "Proxy", url: absoluteViewerResourceUrl(derivative.url || ""), derivative });
  const candidates = requestedMode === "review" ? [review ? fromDerivative("review", review) : null, proxy ? fromDerivative("proxy", proxy) : null, original]
    : requestedMode === "proxy" ? [proxy ? fromDerivative("proxy", proxy) : null, review ? fromDerivative("review", review) : null, original]
    : requestedMode === "original" ? [original, review ? fromDerivative("review", review) : null, proxy ? fromDerivative("proxy", proxy) : null]
    : resource.source.support === "derivative" ? [review ? fromDerivative("review", review) : null, proxy ? fromDerivative("proxy", proxy) : null, original]
    : [review ? fromDerivative("review", review) : null, original, proxy ? fromDerivative("proxy", proxy) : null];
  const selected = candidates.find((item): item is NonNullable<typeof item> => Boolean(item?.url));
  if (!selected) return { mode: requestedMode, requestedMode, label: sourceLabel(requestedMode), url: "", derivative: null, degradedReason: resource.source.degradationReason || "No authorized browser-playable source or derivative is available." };
  return {
    ...selected,
    requestedMode,
    degradedReason: selected.mode === requestedMode || requestedMode === "auto" ? null : `${sourceLabel(requestedMode)} is unavailable; ${selected.label.toLowerCase()} is being used instead.`,
  };
}

function annotationBox(annotation: ReviewScreenAnnotation | null | undefined) {
  if (!annotation || annotation.shape && annotation.shape !== "box") return null;
  const x = clamp(Number(annotation.x), 0, 1);
  const y = clamp(Number(annotation.y), 0, 1);
  const width = clamp(Number(annotation.width), 0, 1 - x);
  const height = clamp(Number(annotation.height), 0, 1 - y);
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

function captionLabel(track: VideoCaptionTrack) { return `${track.label}${track.language ? ` · ${track.language.toUpperCase()}` : ""}`; }
function audioTrackLabel(track: EmbeddedAudioTrackMetadata) { return `${track.label || `Track ${track.index + 1}`}${track.language ? ` · ${track.language.toUpperCase()}` : ""}${track.channelLayout ? ` · ${track.channelLayout}` : track.channels ? ` · ${track.channels}ch` : ""}`; }

function StoryboardPreview({ storyboard, seconds, ratio, frameRate }: { storyboard: ReturnType<typeof resolveVideoStoryboard>; seconds: number; ratio: number; frameRate: number }) {
  const frame = videoStoryboardFrameAt(storyboard, seconds);
  if (!storyboard || !frame) return null;
  const width = 180;
  const scale = width / Math.max(1, frame.width);
  const height = Math.max(1, Math.round(frame.height * scale));
  const sheetWidth = storyboard.manifest.sheetWidth || storyboard.manifest.columns * storyboard.manifest.frameWidth;
  const sheetHeight = storyboard.manifest.sheetHeight || storyboard.manifest.rows * storyboard.manifest.frameHeight;
  return <div className="cluster-video-storyboard-preview" style={runtimeStyle({ left: `${clamp(ratio, 0, 1) * 100}%`, width, height })}>
    <div style={runtimeStyle({ width, height, backgroundImage: `url("${storyboard.url.replace(/"/g, "%22")}")`, backgroundRepeat: "no-repeat", backgroundSize: `${sheetWidth * scale}px ${sheetHeight * scale}px`, backgroundPosition: `${-frame.x * scale}px ${-frame.y * scale}px` })} />
    <span>{formatVideoTimecode(frame.timeSeconds, frameRate)}</span>
  </div>;
}

function ReviewComposer({ session, controller, snapshot, frameRate, activeTrackId, activeSourceArtifactId, onClose, onReload, onDrawingChange, annotation }: {
  session: ViewerAssetSession;
  controller: TimedMediaController;
  snapshot: TimedMediaSnapshot;
  frameRate: number;
  activeTrackId: string | null;
  activeSourceArtifactId: string | null;
  onClose: () => void;
  onReload: () => void;
  onDrawingChange: (value: boolean) => void;
  annotation: ReviewScreenAnnotation | null;
}) {
  const [body, setBody] = useState("");
  const [start, setStart] = useState(() => formatVideoTimecode(snapshot.currentTime, frameRate));
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const locator = session.resource.source.locator;
  const assetId = locator.provider === "review_asset" ? locator.assetId : null;
  if (!assetId) return null;
  async function submit() {
    if (!assetId || !body.trim() || busy) return;
    const startSeconds = parseVideoTimecode(start, frameRate);
    const endSeconds = end.trim() ? parseVideoTimecode(end, frameRate) : null;
    if (startSeconds == null) return;
    setBusy(true);
    try {
      await clusterApiFetch(`/api/review-assets/${encodeURIComponent(assetId)}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: body.trim(),
          locator: {
            type: "media_time",
            timeSeconds: startSeconds,
            endTimeSeconds: endSeconds != null && endSeconds > startSeconds ? endSeconds : null,
            frameNumber: videoFrameNumber(startSeconds, frameRate),
            presentedFrame: snapshot.presentedFrame,
            sourceVersionId: session.resource.source.versionId || null,
            sourceArtifactId: activeSourceArtifactId,
            audioTrackId: activeTrackId,
            annotation,
          },
          status: "open",
        }),
      });
      setBody("");
      onDrawingChange(false);
      onReload();
      onClose();
    } finally { setBusy(false); }
  }
  return <form className="cluster-viewer-review-composer cluster-video-review-composer" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <div className="cluster-video-review-composer-head"><strong>Review note</strong><ClusterIconButton label="Close review note" size="compact" variant="quiet" onClick={onClose}><ClusterIcon name="close" /></ClusterIconButton></div>
    <div className="cluster-video-review-time-fields"><label><span>In</span><ClusterTextInput value={start} onChange={(event) => setStart(event.target.value)} /></label><ClusterButton size="compact" variant="quiet" type="button" onClick={() => setStart(formatVideoTimecode(controller.getSnapshot().currentTime, frameRate))}>Current</ClusterButton><label><span>Out</span><ClusterTextInput value={end} onChange={(event) => setEnd(event.target.value)} placeholder="Optional" /></label><ClusterButton size="compact" variant="quiet" type="button" onClick={() => setEnd(formatVideoTimecode(controller.getSnapshot().currentTime, frameRate))}>Current</ClusterButton></div>
    <ClusterTextArea value={body} onChange={(event) => setBody(event.target.value)} placeholder="Describe the change or approval note…" />
    <div className="cluster-video-review-composer-actions"><ClusterButton size="compact" variant={annotation ? "primary" : "secondary"} type="button" onClick={() => { controller.pause(); onDrawingChange(true); }}>{annotation ? "Region marked" : "Mark region"}</ClusterButton><ClusterButton variant="primary" type="submit" disabled={!body.trim() || busy}>{busy ? "Adding…" : "Add note"}</ClusterButton></div>
  </form>;
}

function VideoAdapter({ session, compareSession, visibleOverlayIds, overlayPlacements, controller, snapshot, sourceMode, onSourceMode, comparisonMode, comparisonAmount, syncComparison, showComposer, onShowComposer, onReload, onDiagnostics, onDurationDiscovered }: {
  session: ViewerAssetSession;
  compareSession: ViewerAssetSession | null;
  visibleOverlayIds: readonly string[];
  overlayPlacements: Record<string, string>;
  controller: TimedMediaController;
  snapshot: TimedMediaSnapshot;
  sourceMode: VideoSourceMode;
  onSourceMode: (value: VideoSourceMode) => void;
  comparisonMode: VideoComparisonMode;
  comparisonAmount: number;
  syncComparison: boolean;
  showComposer: boolean;
  onShowComposer: (value: boolean) => void;
  onReload: () => void;
  onDiagnostics: (value: Record<string, unknown>) => void;
  onDurationDiscovered?: (seconds: number) => void;
}) {
  const frameRate = frameRateForSession(session);
  const dimensions = videoDimensions(session);
  const selection = useMemo(() => selectVideoSource(session, sourceMode), [session.resource, sourceMode]);
  const compareSelection = useMemo(() => compareSession ? selectVideoSource(compareSession, "auto") : null, [compareSession]);
  const tracks = useMemo(() => embeddedAudioTracks(session), [session.metadata, session.asset]);
  const captions = useMemo(() => captionTracks(session), [session.resource.derivatives]);
  const chapters = useMemo(() => videoChapters(session), [session.metadata]);
  const comments = useMemo(() => videoComments(session.asset), [session.asset]);
  const storyboard = useMemo(() => resolveVideoStoryboard(session.resource), [session.resource.derivatives]);
  const [activeTrackId, setActiveTrackId] = useState<string | null>(() => tracks.find((track) => track.default)?.id || tracks[0]?.id || null);
  const [activeCaptionId, setActiveCaptionId] = useState<string>("");
  const [timeEntry, setTimeEntry] = useState("");
  const [hover, setHover] = useState<{ seconds: number; ratio: number } | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [draftAnnotation, setDraftAnnotation] = useState<ReviewScreenAnnotation | null>(null);
  const annotationStart = useRef<{ x: number; y: number } | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const compareVideoRef = useRef<HTMLVideoElement | null>(null);

  const setMainElement = useCallback((element: HTMLVideoElement | null) => {
    videoRef.current = element;
    controller.attach(element);
  }, [controller]);

  useEffect(() => {
    const compare = compareVideoRef.current;
    if (!compare || !compareSelection?.url) return;
    if (syncComparison) return controller.registerFollower({ id: "video-compare", element: compare, enabled: true, muted: true, gain: 0 });
    return controller.registerFollower({ id: "video-compare", element: compare, enabled: false, muted: true, gain: 0 });
  }, [controller, compareSelection?.url, syncComparison]);

  useEffect(() => {
    const selected = tracks.find((track) => track.id === activeTrackId) || null;
    controller.selectEmbeddedTrack(selected?.index ?? null);
  }, [controller, activeTrackId, tracks]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    for (let index = 0; index < video.textTracks.length; index += 1) {
      const element = video.querySelectorAll("track")[index] as HTMLTrackElement | undefined;
      video.textTracks[index].mode = element?.dataset.clusterCaptionId === activeCaptionId ? "showing" : "disabled";
    }
  }, [activeCaptionId, captions]);

  const ahead = bufferAhead(snapshot);
  useEffect(() => {
    onDiagnostics({
      phase: snapshot.phase,
      currentTime: snapshot.currentTime,
      duration: snapshot.duration,
      frameRate,
      frameNumber: videoFrameNumber(snapshot.currentTime, frameRate),
      presentedFrame: snapshot.presentedFrame,
      presentedMediaTime: snapshot.presentedMediaTime,
      frameCallback: snapshot.videoFrameControl,
      totalVideoFrames: snapshot.totalVideoFrames,
      droppedVideoFrames: snapshot.droppedVideoFrames,
      bufferAheadSeconds: Number(ahead.toFixed(3)),
      bufferedRanges: snapshot.buffered.length,
      seekableRanges: snapshot.seekable.length,
      sourceMode,
      sourceKind: selection.derivative?.kind || "original",
      sourceBytes: selection.derivative?.sizeBytes || session.resource.source.sizeBytes,
      comparisonMode: compareSession ? comparisonMode : "off",
      captionTrack: activeCaptionId || "off",
      embeddedAudioTrack: activeTrackId,
      errorCode: snapshot.errorCode,
      errorMessage: snapshot.errorMessage,
    });
  }, [snapshot.phase, snapshot.currentTime, snapshot.duration, snapshot.presentedFrame, snapshot.presentedMediaTime, snapshot.videoFrameControl, snapshot.totalVideoFrames, snapshot.droppedVideoFrames, snapshot.errorCode, snapshot.errorMessage, snapshot.buffered, snapshot.seekable, frameRate, ahead, sourceMode, selection.derivative?.id, compareSession?.resource.source.id, comparisonMode, activeCaptionId, activeTrackId, onDiagnostics, session.resource.source.sizeBytes]);

  const markerComments = comments.map((comment) => ({ comment, locator: mediaLocator(comment.locator) })).filter((value): value is { comment: ReviewCommentRecord; locator: NonNullable<ReturnType<typeof mediaLocator>> } => Boolean(value.locator));
  const activeAnnotations = visibleOverlayIds.includes("review.annotations") ? markerComments.filter(({ locator }) => locator.annotation && snapshot.currentTime >= locator.timeSeconds - 0.2 && snapshot.currentTime <= (locator.endTimeSeconds ?? locator.timeSeconds + 0.65) + 0.2) : [];
  const activeCaption = captions.find((track) => track.id === activeCaptionId) || null;

  function timelinePointer(event: ReactPointerEvent<HTMLDivElement>, commit: boolean) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || snapshot.duration <= 0) return;
    const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const seconds = ratio * snapshot.duration;
    setHover({ seconds, ratio });
    if (commit) controller.seek(seconds, { exactFollowers: true });
  }

  function annotationPoint(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return { x: clamp((event.clientX - rect.left) / rect.width, 0, 1), y: clamp((event.clientY - rect.top) / rect.height, 0, 1) };
  }

  function startAnnotation(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drawing) return;
    const point = annotationPoint(event);
    if (!point) return;
    annotationStart.current = point;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function finishAnnotation(event: ReactPointerEvent<HTMLDivElement>) {
    if (!drawing || !annotationStart.current) return;
    const start = annotationStart.current;
    const end = annotationPoint(event);
    annotationStart.current = null;
    if (!end) return;
    const annotation: ReviewScreenAnnotation = { shape: "box", x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
    if (annotation.width < 0.01 || annotation.height < 0.01) return;
    setDraftAnnotation(annotation);
    setDrawing(false);
  }

  function commitTimeEntry() {
    const value = parseVideoTimecode(timeEntry, frameRate);
    if (value != null) { controller.seek(value, { exactFollowers: true }); setTimeEntry(""); }
  }

  if (!selection.url) return <ViewerState compact tone="warning" title="Video source unavailable" description="This resource does not expose an authorized streamable source." actions={<ClusterButton size="compact" variant="secondary" onClick={onReload}>Retry</ClusterButton>} />;

  if (snapshot.phase === "error") return <ViewerState compact tone="error" title="Video playback failed" description={snapshot.errorMessage || "The authorized video source could not be played."} actions={<ClusterButton size="compact" variant="secondary" onClick={onReload}>Retry</ClusterButton>} />;

  const overlayValues = {
    "review.annotations": `${markerComments.length} review mark${markerComments.length === 1 ? "" : "s"}`,
    "source.derivative": `${sourceLabel(sourceMode)} · ${selection.label}`,
    "comparison.state": compareSession ? `${comparisonMode} · ${Math.round(comparisonAmount)}%` : null,
    "video.timecode": formatVideoTimecode(snapshot.currentTime, frameRate),
    "video.frame_number": `F${videoFrameNumber(snapshot.currentTime, frameRate).toLocaleString()}${snapshot.presentedFrame != null ? ` · P${snapshot.presentedFrame.toLocaleString()}` : ""}`,
    "video.fps": `${frameRate.toFixed(frameRate % 1 ? 3 : 0)} fps`,
    "video.resolution": dimensions.width && dimensions.height ? `${dimensions.width}×${dimensions.height}` : "Resolution unknown",
    "video.safe_areas": "Title / action safe",
    "video.center_guides": "Center guides",
    "video.dropped_frames": snapshot.droppedVideoFrames == null ? "Dropped frames unavailable" : `${snapshot.droppedVideoFrames.toLocaleString()} dropped / ${(snapshot.totalVideoFrames || 0).toLocaleString()} total`,
    "video.buffer_health": `${ahead.toFixed(1)}s ahead · ${snapshot.buffered.length} range${snapshot.buffered.length === 1 ? "" : "s"}`,
    "video.captions": activeCaption ? captionLabel(activeCaption) : "Captions off",
    "audio.meters": tracks.length ? `${tracks.length} embedded audio track${tracks.length === 1 ? "" : "s"}` : "Container audio",
  };

  return <div className="cluster-video-adapter">
    {selection.degradedReason ? <div className="cluster-video-source-warning" role="status"><ClusterIcon name="warning" /><span>{selection.degradedReason}</span></div> : null}
    <div className={`cluster-video-stage ${compareSession ? `is-comparing compare-${comparisonMode}` : ""}`} style={runtimeStyle({ "--cluster-video-compare": `${clamp(comparisonAmount, 15, 85)}%` })}>
      <div className="cluster-video-primary"><video ref={setMainElement} src={selection.url || undefined} preload="metadata" crossOrigin="use-credentials" playsInline aria-label={`${session.resource.source.title} video`} onLoadedMetadata={(event) => { const duration = event.currentTarget.duration; if (Number.isFinite(duration) && duration > 0) onDurationDiscovered?.(duration); }}>
        {captions.map((track) => <track key={track.id} data-cluster-caption-id={track.id} kind="subtitles" src={track.url} label={track.label} srcLang={track.language || "und"} default={track.default} />)}
      </video></div>
      {compareSession && compareSelection?.url ? <div className="cluster-video-compare" style={comparisonMode === "wipe" ? runtimeStyle({ clipPath: `inset(0 ${100 - clamp(comparisonAmount, 15, 85)}% 0 0)` }) : comparisonMode === "difference" ? runtimeStyle({ opacity: clamp(comparisonAmount, 15, 85) / 100 }) : undefined}><video ref={compareVideoRef} src={compareSelection.url} preload="metadata" crossOrigin="use-credentials" playsInline muted aria-label="Comparison video" /></div> : null}
      <div className={`cluster-video-annotation-surface${drawing ? " drawing" : ""}`} onPointerDown={startAnnotation} onPointerUp={finishAnnotation} aria-label={drawing ? "Drag to mark a normalized review region" : undefined}>
        {activeAnnotations.map(({ comment, locator }) => { const box = annotationBox(locator.annotation); return box ? <span key={comment.id} className="cluster-video-annotation-box" style={runtimeStyle({ left: `${box.x * 100}%`, top: `${box.y * 100}%`, width: `${box.width * 100}%`, height: `${box.height * 100}%` })} /> : null; })}
        {draftAnnotation && annotationBox(draftAnnotation) ? <span className="cluster-video-annotation-box draft" style={runtimeStyle({ left: `${annotationBox(draftAnnotation)!.x * 100}%`, top: `${annotationBox(draftAnnotation)!.y * 100}%`, width: `${annotationBox(draftAnnotation)!.width * 100}%`, height: `${annotationBox(draftAnnotation)!.height * 100}%` })} /> : null}
      </div>
      <ViewerOverlayLayer visibleIds={visibleOverlayIds} placements={overlayPlacements} values={overlayValues}>
        {visibleOverlayIds.includes("video.safe_areas") ? <div className="cluster-video-safe-area" /> : null}
        {visibleOverlayIds.includes("video.center_guides") ? <div className="cluster-video-center-guides"><span /><span /></div> : null}
      </ViewerOverlayLayer>
      {snapshot.phase === "waiting" || snapshot.phase === "stalled" || snapshot.phase === "loading" ? <div className="cluster-video-playback-state" role="status"><span className="cluster-viewer-spinner" /><span>{snapshot.phase === "loading" ? "Loading video" : snapshot.phase === "stalled" ? "Playback stalled" : "Buffering"}</span></div> : null}
    </div>

    <div className="cluster-video-timeline-wrap">
      <div className="cluster-video-timeline" role="slider" tabIndex={0} aria-label="Video timeline" aria-valuemin={0} aria-valuemax={snapshot.duration || 0} aria-valuenow={snapshot.currentTime} onPointerMove={(event) => timelinePointer(event, false)} onPointerLeave={() => setHover(null)} onPointerDown={(event) => timelinePointer(event, true)}>
        <div className="cluster-video-buffered">{snapshot.buffered.map((range, index) => snapshot.duration > 0 ? <span key={`${range.start}:${range.end}:${index}`} style={runtimeStyle({ left: `${clamp(range.start / snapshot.duration, 0, 1) * 100}%`, width: `${clamp((range.end - range.start) / snapshot.duration, 0, 1) * 100}%` })} /> : null)}</div>
        <span className="cluster-video-progress" style={runtimeStyle({ width: `${snapshot.duration > 0 ? clamp(snapshot.currentTime / snapshot.duration, 0, 1) * 100 : 0}%` })} />
        {chapters.map((chapter) => snapshot.duration > 0 ? <ClusterButton key={chapter.index} variant="quiet" size="compact" className="cluster-video-chapter-marker" style={runtimeStyle({ left: `${clamp(chapter.startSeconds / snapshot.duration, 0, 1) * 100}%` })} title={`${chapter.title} · ${formatVideoTimecode(chapter.startSeconds, frameRate)}`} aria-label={`Go to chapter ${chapter.title}`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); controller.seek(chapter.startSeconds); }}><span /></ClusterButton> : null)}
        {markerComments.map(({ comment, locator }) => snapshot.duration > 0 ? <ClusterButton key={comment.id} variant="quiet" size="compact" className={`cluster-video-review-marker${comment.status === "resolved" ? " resolved" : ""}`} style={runtimeStyle({ left: `${clamp(locator.timeSeconds / snapshot.duration, 0, 1) * 100}%` })} title={`${formatVideoTimecode(locator.timeSeconds, frameRate)} · ${comment.body || "Review note"}`} aria-label={`Review note at ${formatVideoTimecode(locator.timeSeconds, frameRate)}`} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); controller.seek(locator.timeSeconds); }}><span /></ClusterButton> : null)}
        {hover && storyboard ? <StoryboardPreview storyboard={storyboard} seconds={hover.seconds} ratio={hover.ratio} frameRate={frameRate} /> : null}
      </div>
    </div>

    <div className="cluster-video-transport" role="group" aria-label="Video transport controls">
      <ClusterIconButton label={snapshot.phase === "playing" ? "Pause" : "Play"} variant="primary" onClick={() => void controller.toggle()}><ClusterIcon name={snapshot.phase === "playing" ? "pause" : "play"} /></ClusterIconButton>
      <ClusterButton size="compact" variant="quiet" onClick={() => controller.stepFrame(-1, frameRate)}>Previous frame</ClusterButton>
      <ClusterButton size="compact" variant="quiet" onClick={() => controller.stepFrame(1, frameRate)}>Next frame</ClusterButton>
      <span className="cluster-video-time-readout"><strong>{formatVideoTimecode(snapshot.currentTime, frameRate)}</strong><small>F{videoFrameNumber(snapshot.currentTime, frameRate).toLocaleString()} / {formatVideoTimecode(snapshot.duration, frameRate)}</small></span>
      <form className="cluster-video-time-entry" onSubmit={(event) => { event.preventDefault(); commitTimeEntry(); }}><ClusterTextInput aria-label="Seek to timecode" placeholder="00:00:00:00" value={timeEntry} onChange={(event) => setTimeEntry(event.target.value)} /><ClusterButton size="compact" variant="quiet" type="submit">Go</ClusterButton></form>
      <label className="cluster-video-volume"><ClusterIcon name={snapshot.muted ? "mute" : "volume"} /><ClusterSlider aria-label="Master volume" min="0" max="1" step="0.01" value={snapshot.volume} onChange={(event) => { const value = Number(event.target.value); controller.setVolume(value); writePreferenceStorage("cluster-media-volume", String(value)); }} /></label>
      <ClusterIconButton label={snapshot.muted ? "Unmute" : "Mute"} size="compact" variant="quiet" selected={snapshot.muted} onClick={() => controller.setMuted(!snapshot.muted)}><ClusterIcon name={snapshot.muted ? "mute" : "volume"} /></ClusterIconButton>
    </div>

    <div className="cluster-video-production-controls">
      <label><span>Source</span><ClusterNativeSelect value={sourceMode} onChange={(event) => onSourceMode(event.target.value as VideoSourceMode)}>{VIDEO_SOURCE_MODES.map((value) => <option key={value} value={value}>{sourceLabel(value)}</option>)}</ClusterNativeSelect></label>
      <label><span>Speed</span><ClusterNativeSelect value={snapshot.playbackRate} onChange={(event) => { const value = Number(event.target.value); controller.setPlaybackRate(value); writePreferenceStorage("cluster-media-playback-rate", String(value)); }}>{VIDEO_PLAYBACK_RATES.map((rate) => <option key={rate} value={rate}>{rate}×</option>)}</ClusterNativeSelect></label>
      {tracks.length ? <label><span>Audio</span><ClusterNativeSelect value={activeTrackId || ""} onChange={(event) => setActiveTrackId(event.target.value || null)}>{tracks.map((track) => <option key={track.id} value={track.id}>{audioTrackLabel(track)}</option>)}</ClusterNativeSelect></label> : null}
      {captions.length ? <label><span>Captions</span><ClusterNativeSelect value={activeCaptionId} onChange={(event) => setActiveCaptionId(event.target.value)}><option value="">Off</option>{captions.map((track) => <option key={track.id} value={track.id}>{captionLabel(track)}</option>)}</ClusterNativeSelect></label> : null}
      {chapters.length ? <label><span>Chapter</span><ClusterNativeSelect value="" onChange={(event) => { const target = chapters.find((chapter) => String(chapter.index) === event.target.value); if (target) controller.seek(target.startSeconds); }}><option value="">Jump to…</option>{chapters.map((chapter) => <option key={chapter.index} value={chapter.index}>{chapter.title}</option>)}</ClusterNativeSelect></label> : null}
      <span className="cluster-video-source-detail">{selection.label} · {formatBytes(selection.derivative?.sizeBytes || session.resource.source.sizeBytes)} · {videoCodec(session)}{videoBitRate(session) ? ` · ${(videoBitRate(session)! / 1_000_000).toFixed(1)} Mb/s` : ""}</span>
    </div>

    {tracks.length > 1 && snapshot.embeddedTrackControl === "metadata_only" ? <small className="cluster-video-degraded-note">This runtime exposes audio-track metadata but not native container-track switching. Selection is retained as review context while playback uses the container default.</small> : null}
    {showComposer && session.capabilities.comment ? <ReviewComposer session={session} controller={controller} snapshot={snapshot} frameRate={frameRate} activeTrackId={activeTrackId} activeSourceArtifactId={selection.derivative?.id || null} annotation={draftAnnotation} onDrawingChange={(value) => { setDrawing(value); if (value) setDraftAnnotation(null); }} onClose={() => { setDrawing(false); setDraftAnnotation(null); onShowComposer(false); }} onReload={onReload} /> : null}
  </div>;
}

export const UnifiedVideoViewer = forwardRef<UnifiedVideoViewerHandle, {
  input: ViewerAssetSessionInput;
  compareInput?: ViewerAssetSessionInput | null;
  userId?: string | null;
  mode?: ViewerMode;
  onModeChange?: (mode: ViewerMode) => void;
  comparisonMode?: VideoComparisonMode;
  comparisonAmount?: number;
  onReviewMutation?: () => void;
  onDurationDiscovered?: (seconds: number) => void;
}>(({ input, compareInput = null, userId, mode: controlledMode, onModeChange, comparisonMode, comparisonAmount, onReviewMutation, onDurationDiscovered }, ref) => {
  const assetSession = useViewerAssetSession(input);
  const compareSession = useViewerAssetSession(compareInput);
  const identity = assetSession.session ? `${assetSession.session.resource.source.provider}:${assetSession.session.resource.source.id}:${assetSession.session.resource.source.versionId || ""}` : "video:pending";
  const { controller, snapshot } = useTimedMediaController(identity);
  useTimedMediaSystemIntegration({ controller, snapshot, session: assetSession.session });
  const [localMode, setLocalMode] = useState<ViewerMode>(controlledMode || "view");
  const [sourceMode, setSourceMode] = useState<VideoSourceMode>("auto");
  const [showComposer, setShowComposer] = useState(false);
  const [adapterDiagnostics, setAdapterDiagnostics] = useState<Record<string, unknown>>({});
  const mode = controlledMode || localMode;
  const frameRate = assetSession.session ? frameRateForSession(assetSession.session) : 30;
  const { comparisonSession, comparison } = useReviewComparisonSession({ medium: "video", userId, identity, enabled: Boolean(compareInput), initialMode: comparisonMode, initialAmount: comparisonAmount });
  const activeComparisonMode = (comparison.mode === "side" || comparison.mode === "wipe" || comparison.mode === "reference" || comparison.mode === "difference") ? comparison.mode : "side";
  const setMode = useCallback((next: ViewerMode) => { setLocalMode(next); onModeChange?.(next); }, [onModeChange]);

  useEffect(() => {
    controller.setVolume(clamp(readNumberPreference("cluster-media-volume", 1), 0, 1));
    controller.setPlaybackRate(clamp(readNumberPreference("cluster-media-playback-rate", 1), 0.25, 2));
  }, [controller]);

  useImperativeHandle(ref, () => ({
    seek: (seconds) => controller.seek(seconds, { exactFollowers: true }),
    stepFrame: (direction) => controller.stepFrame(direction, frameRate),
    pause: () => controller.pause(),
    getCurrentTime: () => controller.getSnapshot().currentTime,
  }), [controller, frameRate]);

  const comments = useMemo(() => assetSession.session ? videoComments(assetSession.session.asset) : [], [assetSession.session?.asset]);
  const markerTimes = useMemo(() => comments.map((comment) => mediaLocator(comment.locator)?.timeSeconds).filter((value): value is number => Number.isFinite(value)).sort((a, b) => a - b), [comments]);
  const seekMarker = useCallback((direction: -1 | 1) => {
    if (!markerTimes.length) return;
    const current = controller.getSnapshot().currentTime;
    if (direction > 0) controller.seek(markerTimes.find((value) => value > current + 0.05) ?? markerTimes[0], { exactFollowers: true });
    else controller.seek([...markerTimes].reverse().find((value) => value < current - 0.05) ?? markerTimes[markerTimes.length - 1], { exactFollowers: true });
  }, [controller, markerTimes]);

  const commands = useMemo<ViewerCommandDefinition[]>(() => [
    { id: "viewer.video.play_pause", label: snapshot.phase === "playing" ? "Pause" : "Play", icon: snapshot.phase === "playing" ? "pause" : "play", shortcut: "space", priority: 5, group: "transport", run: async () => { await controller.toggle(); } },
    { id: "viewer.video.previous_frame", label: "Previous frame", icon: "previous", shortcut: "arrowleft", priority: 10, group: "transport", run: () => controller.stepFrame(-1, frameRate) },
    { id: "viewer.video.next_frame", label: "Next frame", icon: "next", shortcut: "arrowright", priority: 15, group: "transport", run: () => controller.stepFrame(1, frameRate) },
    { id: "viewer.video.back", label: "Back 5 seconds", icon: "rewind", shortcut: "j", priority: 25, group: "transport", overflow: true, run: () => controller.jump(-5) },
    { id: "viewer.video.forward", label: "Forward 5 seconds", icon: "forward", shortcut: "l", priority: 30, group: "transport", overflow: true, run: () => controller.jump(5) },
    { id: "viewer.video.previous_marker", label: "Previous review marker", icon: "previous", shortcut: "shift+arrowleft", priority: 35, group: "review", overflow: true, enabled: () => markerTimes.length > 0, run: () => seekMarker(-1) },
    { id: "viewer.video.next_marker", label: "Next review marker", icon: "next", shortcut: "shift+arrowright", priority: 40, group: "review", overflow: true, enabled: () => markerTimes.length > 0, run: () => seekMarker(1) },
    { id: "viewer.video.add_note", label: "Add review note", icon: "comment", shortcut: "a", priority: 20, group: "review", requiredCapability: "comment", visible: (context) => context.resource.source.locator.provider === "review_asset", run: () => { setShowComposer(true); setMode("review"); } },
    { id: "viewer.video.mute", label: snapshot.muted ? "Unmute" : "Mute", icon: snapshot.muted ? "volume" : "mute", shortcut: "m", priority: 45, group: "transport", overflow: true, run: () => controller.setMuted(!snapshot.muted) },
  ], [snapshot.phase, snapshot.muted, controller, frameRate, markerTimes.length, seekMarker, setMode]);

  const reload = useCallback(() => { assetSession.reload(); onReviewMutation?.(); }, [assetSession.reload, onReviewMutation]);

  return <ViewerShell
    assetSession={assetSession}
    userId={userId}
    mode={mode}
    onModeChange={setMode}
    commands={commands}
    overlays={viewerOverlayCatalogForMedium("video")}
    adapterDiagnostics={{ ...adapterDiagnostics, comparison: compareSession.session ? comparison : null }}
    onReviewNavigate={(locator) => { if (locator.type === "media_time") controller.seek(locator.timeSeconds, { exactFollowers: true }); }}
    renderAdapter={({ session, visibleOverlayIds, overlayPlacements }) => <div className="cluster-viewer-comparison-stack">
      {compareSession.session ? <ViewerComparisonBar session={comparisonSession} snapshot={comparison} primaryLabel={session.resource.source.title} secondaryLabel={compareSession.session.resource.source.title} /> : null}
      <VideoAdapter
      session={session}
      compareSession={compareSession.session}
      visibleOverlayIds={visibleOverlayIds}
      overlayPlacements={overlayPlacements}
      controller={controller}
      snapshot={snapshot}
      sourceMode={sourceMode}
      onSourceMode={setSourceMode}
      comparisonMode={activeComparisonMode}
      comparisonAmount={comparison.amount}
      syncComparison={comparison.syncPlayback}
      showComposer={showComposer}
      onShowComposer={setShowComposer}
      onReload={reload}
      onDiagnostics={setAdapterDiagnostics}
      onDurationDiscovered={onDurationDiscovered}
    />
    </div>}
  />;
});

UnifiedVideoViewer.displayName = "UnifiedVideoViewer";
