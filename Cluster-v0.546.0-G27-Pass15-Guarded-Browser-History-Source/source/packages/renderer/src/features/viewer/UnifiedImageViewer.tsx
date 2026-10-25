import { clusterApiFetch } from "@cluster/api-client";
import { DEFAULT_RESOURCE_BUDGETS, type ImageRegionLocator, type NormalizedPoint, type NormalizedRegion } from "@cluster/shared";
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterTextArea } from "../../components/ClusterTextArea";
import { runtimeStyle } from "../../core/runtime-style";
import { ViewerOverlayLayer } from "./ViewerOverlayLayer";
import { ViewerShell } from "./ViewerShell";
import { ViewerState } from "./ViewerState";
import { useViewerAssetSession } from "./use-viewer-asset-session";
import { useReviewComparisonSession } from "./use-review-comparison-session";
import { ViewerComparisonBar } from "./ViewerComparisonBar";
import type { ReviewComparisonSnapshot } from "./review-comparison-session";
import { useViewerResourceBlob } from "./viewer-resource-loader";
import { viewerOverlayCatalogForMedium } from "./viewer-overlay-catalog";
import type { ViewerAssetSessionInput, ViewerCommandDefinition, ViewerMode } from "./viewer-contracts";

type ImageViewMode = "fit" | "actual" | "custom";
type ImagePixel = { x: number; y: number; rgba: [number, number, number, number] };
type DragState = { kind: "pan"; startX: number; startY: number; originX: number; originY: number } | { kind: "annotate"; start: NormalizedPoint; current: NormalizedPoint };
type DraftAnnotation = { point?: NormalizedPoint; region?: NormalizedRegion };
type ImageReviewFocus = { token: number; locator: ImageRegionLocator };

type ReviewComment = {
  id: string;
  body?: string;
  status?: string;
  locator?: unknown;
  user?: { displayName?: string | null; username?: string | null } | null;
};

const IMAGE_DERIVATIVE_KINDS = ["image_preview"] as const;
const MIN_ZOOM = 0.02;
const MAX_ZOOM = 32;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function reviewComments(asset: Record<string, unknown> | null | undefined) {
  const comments = Array.isArray(asset?.comments) ? asset.comments : [];
  return comments.map((value) => record(value)).filter((value): value is Record<string, unknown> => Boolean(value)).map((value) => ({
    id: String(value.id || ""),
    body: typeof value.body === "string" ? value.body : undefined,
    status: typeof value.status === "string" ? value.status : undefined,
    locator: value.locator,
    user: record(value.user) as ReviewComment["user"],
  })).filter((value) => value.id);
}

function imageLocator(value: unknown): ImageRegionLocator | null {
  const locator = record(value);
  if (!locator || locator.type !== "image_region") return null;
  return locator as unknown as ImageRegionLocator;
}

function normalizePoint(value: number) {
  return clamp(value, 0, 1);
}

function normalizedRegion(a: NormalizedPoint, b: NormalizedPoint): DraftAnnotation {
  const left = Math.min(a.x, b.x);
  const top = Math.min(a.y, b.y);
  const width = Math.abs(a.x - b.x);
  const height = Math.abs(a.y - b.y);
  if (width < 0.005 && height < 0.005) return { point: { x: normalizePoint(b.x), y: normalizePoint(b.y) } };
  return { region: { x: normalizePoint(left), y: normalizePoint(top), width: normalizePoint(width), height: normalizePoint(height) } };
}

function formatPixel(pixel: ImagePixel | null) {
  if (!pixel) return "—";
  return `${pixel.x}, ${pixel.y}`;
}

function formatRgba(pixel: ImagePixel | null) {
  if (!pixel) return "—";
  const [r, g, b, a] = pixel.rgba;
  return `rgba(${r}, ${g}, ${b}, ${(a / 255).toFixed(2)})`;
}

function ImageAdapter({
  session,
  compareSession,
  comparison,
  visibleOverlayIds,
  overlayPlacements,
  viewMode,
  zoom,
  rotation,
  pan,
  annotationMode,
  draft,
  onZoomChange,
  onViewModeChange,
  onPanChange,
  onDraftChange,
  onAnnotationModeChange,
  onReload,
  reviewFocus,
}: {
  session: NonNullable<ReturnType<typeof useViewerAssetSession>["session"]>;
  compareSession: NonNullable<ReturnType<typeof useViewerAssetSession>["session"]> | null;
  comparison: ReviewComparisonSnapshot;
  visibleOverlayIds: readonly string[];
  overlayPlacements: Record<string, string>;
  viewMode: ImageViewMode;
  zoom: number;
  rotation: number;
  pan: { x: number; y: number };
  annotationMode: boolean;
  draft: DraftAnnotation | null;
  onZoomChange: (value: number) => void;
  onViewModeChange: (mode: ImageViewMode) => void;
  onPanChange: (pan: { x: number; y: number }) => void;
  onDraftChange: (draft: DraftAnnotation | null) => void;
  onAnnotationModeChange: (enabled: boolean) => void;
  onReload: () => void;
  reviewFocus: ImageReviewFocus | null;
}) {
  const loaded = useViewerResourceBlob(session.resource, IMAGE_DERIVATIVE_KINDS, "image/*");
  const compareLoaded = useViewerResourceBlob(compareSession?.resource || session.resource, IMAGE_DERIVATIVE_KINDS, "image/*", Boolean(compareSession));
  const hostRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [naturalSize, setNaturalSize] = useState({ width: 0, height: 0 });
  const [pixel, setPixel] = useState<ImagePixel | null>(null);
  const [note, setNote] = useState("");
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState("");
  const [blinkSecondary, setBlinkSecondary] = useState(false);

  useEffect(() => {
    if (!compareSession || comparison.mode !== "blink") { setBlinkSecondary(false); return; }
    let timer = 0;
    let active = true;
    const schedule = () => {
      if (!active || timer || document.visibilityState !== "visible") return;
      timer = window.setTimeout(() => { timer = 0; if (!active || document.visibilityState !== "visible") return; setBlinkSecondary((value) => !value); schedule(); }, comparison.blinkIntervalMs);
    };
    const onVisibility = () => { if (document.visibilityState === "visible") schedule(); else if (timer) { window.clearTimeout(timer); timer = 0; } };
    document.addEventListener("visibilitychange", onVisibility);
    schedule();
    return () => { active = false; if (timer) window.clearTimeout(timer); document.removeEventListener("visibilitychange", onVisibility); };
  }, [compareSession?.resource.source.id, comparison.mode, comparison.blinkIntervalMs]);

  const rotated = rotation % 180 !== 0;
  const fitScale = naturalSize.width && naturalSize.height && viewport.width && viewport.height
    ? clamp(Math.min((viewport.width - 36) / (rotated ? naturalSize.height : naturalSize.width), (viewport.height - 36) / (rotated ? naturalSize.width : naturalSize.height)), MIN_ZOOM, MAX_ZOOM)
    : 1;
  const activeScale = viewMode === "fit" ? fitScale : viewMode === "actual" ? 1 : zoom;
  const pixelCount = naturalSize.width * naturalSize.height;
  const overBudget = pixelCount > DEFAULT_RESOURCE_BUDGETS.maxImagePixels;

  useEffect(() => {
    if (!reviewFocus || !naturalSize.width || !naturalSize.height) return;
    const locator = reviewFocus.locator;
    const target = locator.region
      ? { x: locator.region.x + locator.region.width / 2, y: locator.region.y + locator.region.height / 2 }
      : locator.point || locator.path?.[0] || null;
    if (!target) return;
    const localX = (clamp(target.x, 0, 1) - 0.5) * naturalSize.width * activeScale;
    const localY = (clamp(target.y, 0, 1) - 0.5) * naturalSize.height * activeScale;
    const radians = (rotation * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    onPanChange({ x: -(localX * cos - localY * sin), y: -(localX * sin + localY * cos) });
  }, [reviewFocus?.token, naturalSize.width, naturalSize.height, activeScale, rotation, onPanChange]);

  useEffect(() => {
    const node = hostRef.current;
    if (!node) return;
    const update = () => setViewport({ width: Math.max(1, node.clientWidth), height: Math.max(1, node.clientHeight) });
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [loaded.objectUrl]);

  const pointFromEvent = useCallback((event: ReactPointerEvent<HTMLDivElement>): { normalized: NormalizedPoint; pixel: { x: number; y: number } } | null => {
    const image = imageRef.current;
    const host = hostRef.current;
    if (!image || !host || !naturalSize.width || !naturalSize.height) return null;
    const rect = host.getBoundingClientRect();
    const dx = event.clientX - (rect.left + rect.width / 2) - pan.x;
    const dy = event.clientY - (rect.top + rect.height / 2) - pan.y;
    const radians = -(rotation * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const unrotatedX = (dx * cos - dy * sin) / activeScale;
    const unrotatedY = (dx * sin + dy * cos) / activeScale;
    const imageX = unrotatedX + naturalSize.width / 2;
    const imageY = unrotatedY + naturalSize.height / 2;
    if (imageX < 0 || imageY < 0 || imageX >= naturalSize.width || imageY >= naturalSize.height) return null;
    return {
      normalized: { x: normalizePoint(imageX / naturalSize.width), y: normalizePoint(imageY / naturalSize.height) },
      pixel: { x: Math.floor(imageX), y: Math.floor(imageY) },
    };
  }, [activeScale, naturalSize.height, naturalSize.width, pan.x, pan.y, rotation]);

  const inspectPixel = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const mapped = pointFromEvent(event);
    const image = imageRef.current;
    if (!mapped || !image || overBudget) { setPixel(null); return; }
    const canvas = sampleCanvasRef.current || document.createElement("canvas");
    sampleCanvasRef.current = canvas;
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;
    try {
      context.clearRect(0, 0, 1, 1);
      context.drawImage(image, mapped.pixel.x, mapped.pixel.y, 1, 1, 0, 0, 1, 1);
      const data = context.getImageData(0, 0, 1, 1).data;
      setPixel({ x: mapped.pixel.x, y: mapped.pixel.y, rgba: [data[0], data[1], data[2], data[3]] });
    } catch {
      setPixel(null);
    }
  }, [overBudget, pointFromEvent]);

  const pointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (annotationMode && session.capabilities.annotate) {
      const mapped = pointFromEvent(event);
      if (!mapped) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = { kind: "annotate", start: mapped.normalized, current: mapped.normalized };
      onDraftChange({ point: mapped.normalized });
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { kind: "pan", startX: event.clientX, startY: event.clientY, originX: pan.x, originY: pan.y };
  }, [annotationMode, onDraftChange, pan.x, pan.y, pointFromEvent, session.capabilities.annotate]);

  const pointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    inspectPixel(event);
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.kind === "pan") {
      onPanChange({ x: drag.originX + event.clientX - drag.startX, y: drag.originY + event.clientY - drag.startY });
      return;
    }
    const mapped = pointFromEvent(event);
    if (!mapped) return;
    drag.current = mapped.normalized;
    onDraftChange(normalizedRegion(drag.start, mapped.normalized));
  }, [inspectPixel, onDraftChange, onPanChange, pointFromEvent]);

  const pointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.kind === "annotate") {
      const mapped = pointFromEvent(event);
      onDraftChange(normalizedRegion(drag.start, mapped?.normalized || drag.current));
    }
  }, [onDraftChange, pointFromEvent]);

  const postAnnotation = useCallback(async () => {
    if (!draft || !note.trim() || session.resource.source.locator.provider !== "review_asset") return;
    const locator: ImageRegionLocator = { type: "image_region", ...(draft.region ? { region: draft.region } : {}), ...(draft.point ? { point: draft.point } : {}) };
    setPosting(true);
    setPostError("");
    try {
      const response = await clusterApiFetch(`/api/review-assets/${encodeURIComponent(session.resource.source.locator.assetId)}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ body: note.trim(), locator, status: "open", category: "edit", priority: "medium" }),
      });
      if (!response.ok) throw new Error(`Review note could not be saved (${response.status}).`);
      setNote("");
      onDraftChange(null);
      onAnnotationModeChange(false);
      onReload();
    } catch (error) {
      setPostError(error instanceof Error ? error.message : "Review note could not be saved.");
    } finally {
      setPosting(false);
    }
  }, [draft, note, onAnnotationModeChange, onDraftChange, onReload, session.resource.source.locator]);

  const comments = reviewComments(session.asset).filter((comment) => imageLocator(comment.locator));
  const transform = `translate(${pan.x}px, ${pan.y}px) rotate(${rotation}deg) scale(${activeScale})`;
  const values: Record<string, string> = {
    "image.pixel_coordinates": overBudget ? "Pixel inspection disabled: decode budget exceeded" : formatPixel(pixel),
    "image.color_value": overBudget ? "Color sampling disabled" : formatRgba(pixel),
    "image.dimensions": naturalSize.width ? `${naturalSize.width} × ${naturalSize.height}${overBudget ? " · over inspection budget" : ""}` : "Loading dimensions",
    "image.zoom": `${Math.round(activeScale * 100)}%${viewMode === "fit" ? " · Fit" : viewMode === "actual" ? " · 100%" : ""}`,
    "source.derivative": loaded.derivative ? `${loaded.derivative.kind} · ${loaded.derivative.variantKey}` : "Original source",
    "comparison.state": compareSession ? `${comparison.mode} · ${Math.round(comparison.amount)}%` : "Off",
  };

  if (loaded.state === "loading" || loaded.state === "idle") return <ViewerState compact tone="loading" title="Loading image" description="Resolving the safe display source and decode budget…" />;
  if (loaded.state === "error" || !loaded.objectUrl) return <ViewerState compact tone="error" title="Image could not load" description={loaded.error instanceof Error ? loaded.error.message : "The image source is unavailable."} />;
  if (compareSession && comparison.mode === "side") return <div ref={hostRef} className="cluster-image-adapter is-comparing compare-side">
    <div className="cluster-image-side-grid"><div><span className="cluster-image-side-label">A · {session.resource.source.title}</span><img ref={imageRef} src={loaded.objectUrl} alt={session.resource.source.title} draggable={false} onLoad={(event) => setNaturalSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} /></div><div><span className="cluster-image-side-label">B · {compareSession.resource.source.title}</span>{compareLoaded.objectUrl ? <img src={compareLoaded.objectUrl} alt={compareSession.resource.source.title} draggable={false} /> : <span>Comparison image unavailable.</span>}</div></div>
    <ViewerOverlayLayer visibleIds={visibleOverlayIds} placements={overlayPlacements} values={values} />
  </div>;

  const compareLayerStyle = compareSession && compareLoaded.objectUrl ? comparison.mode === "wipe"
    ? runtimeStyle({ clipPath: `inset(0 ${100 - comparison.amount}% 0 0)` })
    : comparison.mode === "overlay" ? runtimeStyle({ opacity: comparison.amount / 100 })
    : comparison.mode === "difference" ? runtimeStyle({ opacity: comparison.amount / 100, mixBlendMode: "difference" })
    : comparison.mode === "blink" ? runtimeStyle({ opacity: blinkSecondary ? 1 : 0 })
    : undefined : undefined;

  return <div ref={hostRef} className={`cluster-image-adapter${annotationMode ? " annotation-mode" : ""}${activeScale >= 8 ? " pixel-grid-ready" : ""}`} onContextMenu={(event) => { if (!session.capabilities.copyImage) event.preventDefault(); }} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onPointerLeave={() => { if (!dragRef.current) setPixel(null); }} onWheel={(event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    event.preventDefault();
    onViewModeChange("custom");
    onZoomChange(clamp(activeScale * (event.deltaY > 0 ? 0.9 : 1.1), MIN_ZOOM, MAX_ZOOM));
  }}>
    <div className="cluster-image-canvas" data-grid={visibleOverlayIds.includes("image.grid") && activeScale >= 8 ? "true" : "false"}>
      <div className="cluster-image-plane" style={runtimeStyle({ width: naturalSize.width || undefined, height: naturalSize.height || undefined, transform })}>
        <img ref={imageRef} src={loaded.objectUrl} alt={session.resource.source.title} draggable={false} onLoad={(event) => setNaturalSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />
        {compareSession && compareLoaded.objectUrl ? <img className={`cluster-image-compare-layer compare-${comparison.mode}`} src={compareLoaded.objectUrl} alt={compareSession.resource.source.title} draggable={false} style={compareLayerStyle} /> : null}
        {visibleOverlayIds.includes("image.guides") ? <div className="cluster-image-guide-overlay"><span /><span /></div> : null}
        {visibleOverlayIds.includes("image.safe_areas") ? <div className="cluster-image-safe-area"><span /></div> : null}
        {visibleOverlayIds.includes("review.annotations") || draft || annotationMode ? <div className="cluster-image-review-layer">
        {visibleOverlayIds.includes("review.annotations") ? comments.map((comment) => {
          const locator = imageLocator(comment.locator);
          if (!locator) return null;
          const region = locator.region;
          const point = locator.point;
          const title = `${comment.user?.displayName || comment.user?.username || "Reviewer"}: ${comment.body || "Review note"}`;
          if (region) return <ClusterButton key={comment.id} variant="quiet" size="compact" className="cluster-image-review-region" title={title} onPointerDown={(event) => event.stopPropagation()} style={runtimeStyle({ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` })}><span>{comment.status === "resolved" ? "✓" : "•"}</span></ClusterButton>;
          if (point) return <ClusterButton key={comment.id} variant="quiet" size="compact" className="cluster-image-review-point" title={title} onPointerDown={(event) => event.stopPropagation()} style={runtimeStyle({ left: `${point.x * 100}%`, top: `${point.y * 100}%` })}>{comment.status === "resolved" ? "✓" : "•"}</ClusterButton>;
          return null;
        }) : null}
        {draft?.region ? <span className="cluster-image-review-draft" style={runtimeStyle({ left: `${draft.region.x * 100}%`, top: `${draft.region.y * 100}%`, width: `${draft.region.width * 100}%`, height: `${draft.region.height * 100}%` })} /> : null}
        {draft?.point ? <span className="cluster-image-review-draft-point" style={runtimeStyle({ left: `${draft.point.x * 100}%`, top: `${draft.point.y * 100}%` })} /> : null}
        </div> : null}
      </div>
    </div>
    <ViewerOverlayLayer visibleIds={visibleOverlayIds} placements={overlayPlacements} values={values} />
    {draft && session.capabilities.comment ? <form className="cluster-viewer-review-composer" onSubmit={(event) => { event.preventDefault(); void postAnnotation(); }}>
      <strong>Image review note</strong>
      <ClusterTextArea autoFocus rows={3} maxLength={4000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Describe what should change…" />
      {postError ? <span className="cluster-viewer-inline-error">{postError}</span> : null}
      <div><ClusterButton type="button" variant="quiet" size="compact" onClick={() => { onDraftChange(null); setNote(""); setPostError(""); }}>Cancel</ClusterButton><ClusterButton type="submit" variant="primary" size="compact" disabled={posting || !note.trim()}>{posting ? "Posting…" : "Post note"}</ClusterButton></div>
    </form> : null}
  </div>;
}

export function UnifiedImageViewer({
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
  const identity = assetSession.session ? `${assetSession.session.resource.source.provider}:${assetSession.session.resource.source.id}:${assetSession.session.resource.source.versionId || ""}` : "image:pending";
  const { comparisonSession, comparison } = useReviewComparisonSession({ medium: "image", userId, identity, enabled: Boolean(compareInput) });
  const [localMode, setLocalMode] = useState<ViewerMode>(controlledMode || "view");
  const [viewMode, setViewMode] = useState<ImageViewMode>("fit");
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [annotationMode, setAnnotationMode] = useState(false);
  const [draft, setDraft] = useState<DraftAnnotation | null>(null);
  const [reviewFocus, setReviewFocus] = useState<ImageReviewFocus | null>(null);
  const mode = controlledMode || localMode;
  const setMode = useCallback((next: ViewerMode) => { setLocalMode(next); onModeChange?.(next); }, [onModeChange]);

  const resetPan = useCallback(() => setPan({ x: 0, y: 0 }), []);
  const commands = useMemo<ViewerCommandDefinition[]>(() => [
    { id: "viewer.image.fit", label: "Fit", description: "Fit the image inside the available viewport.", icon: "fullscreen", shortcut: "1", priority: 10, group: "view", run: () => { setViewMode("fit"); resetPan(); } },
    { id: "viewer.image.actual", label: "100%", description: "Show one image pixel per CSS pixel.", icon: "image", shortcut: "2", priority: 15, group: "view", run: () => { setViewMode("actual"); setZoom(1); resetPan(); } },
    { id: "viewer.image.zoom_in", label: "Zoom in", icon: "zoom-in", shortcut: "+", priority: 20, group: "view", run: () => { setViewMode("custom"); setZoom((value) => clamp(value * 1.25, MIN_ZOOM, MAX_ZOOM)); } },
    { id: "viewer.image.zoom_out", label: "Zoom out", icon: "zoom-out", shortcut: "-", priority: 25, group: "view", run: () => { setViewMode("custom"); setZoom((value) => clamp(value / 1.25, MIN_ZOOM, MAX_ZOOM)); } },
    { id: "viewer.image.rotate", label: "Rotate", description: "Rotate clockwise by 90 degrees.", icon: "rotate", shortcut: "r", priority: 30, group: "view", run: () => { setRotation((value) => (value + 90) % 360); resetPan(); } },
    { id: "viewer.image.reset", label: "Reset view", icon: "reset", shortcut: "0", priority: 40, group: "view", overflow: true, run: () => { setViewMode("fit"); setZoom(1); setRotation(0); resetPan(); } },
    { id: "viewer.image.annotate", label: annotationMode ? "Stop annotating" : "Add review note", icon: "comment", shortcut: "a", priority: 10, group: "review", requiredCapability: "annotate", visible: (context) => context.resource.source.locator.provider === "review_asset", run: () => { setAnnotationMode((value) => !value); setDraft(null); setMode("review"); } },
  ], [annotationMode, resetPan, setMode]);

  return <ViewerShell
    assetSession={assetSession}
    userId={userId}
    mode={mode}
    onModeChange={setMode}
    commands={commands}
    overlays={viewerOverlayCatalogForMedium("image")}
    adapterDiagnostics={{ comparison: compareAssetSession.session ? comparison : null }}
    onReviewNavigate={(locator) => { if (locator.type === "image_region") setReviewFocus((current) => ({ token: (current?.token || 0) + 1, locator })); }}
    renderAdapter={({ session, visibleOverlayIds, overlayPlacements }) => <div className="cluster-viewer-comparison-stack">
      {compareAssetSession.session ? <ViewerComparisonBar session={comparisonSession} snapshot={comparison} primaryLabel={session.resource.source.title} secondaryLabel={compareAssetSession.session.resource.source.title} /> : null}
      <ImageAdapter
      session={session}
      compareSession={compareAssetSession.session}
      comparison={comparison}
      visibleOverlayIds={visibleOverlayIds}
      overlayPlacements={overlayPlacements}
      viewMode={viewMode}
      zoom={zoom}
      rotation={rotation}
      pan={pan}
      annotationMode={annotationMode}
      draft={draft}
      onZoomChange={setZoom}
      onViewModeChange={setViewMode}
      onPanChange={setPan}
      onDraftChange={setDraft}
      onAnnotationModeChange={setAnnotationMode}
      onReload={assetSession.reload}
      reviewFocus={reviewFocus}
    />
    </div>}
  />;
}
