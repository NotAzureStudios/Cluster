import { clusterApiFetch } from "@cluster/api-client";
import { downloadAuthenticatedClusterFile } from "../../core/browser-download-transfers";
import { DEFAULT_RESOURCE_BUDGETS, VIEWER_CLIENT_RESOURCE_BUDGETS, type NormalizedPoint, type NormalizedRegion, type PdfRegionLocator } from "@cluster/shared";
import {
  GlobalWorkerOptions,
  PasswordResponses,
  TextLayer,
  getDocument,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from "pdfjs-dist";
import type { TextContent, TextItem } from "pdfjs-dist/types/src/display/api";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterIcon } from "../../components/ClusterIcon";
import { ClusterTextArea } from "../../components/ClusterTextArea";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { runtimeStyle } from "../../core/runtime-style";
import { copyClusterText } from "../../core/clipboard";
import { ViewerOverlayLayer } from "./ViewerOverlayLayer";
import { pdfPageIndexAtOffset, pdfPageOffsets, type PdfPageDimensions } from "./pdf-page-layout";
import { ViewerShell } from "./ViewerShell";
import { ViewerState } from "./ViewerState";
import { useViewerAssetSession } from "./use-viewer-asset-session";
import { useReviewComparisonSession } from "./use-review-comparison-session";
import { ViewerComparisonBar } from "./ViewerComparisonBar";
import { resolveViewerResourceSource } from "./viewer-resource-loader";
import { viewerOverlayCatalogForMedium } from "./viewer-overlay-catalog";
import { useViewerResourceScope } from "./viewer-resource-scope";
import { openPdfPrintFrame } from "./pdf-print-frame";
import type { ViewerAssetSessionInput, ViewerCommandDefinition, ViewerMode } from "./viewer-contracts";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const PDF_MIN_SCALE = 0.3;
const PDF_MAX_SCALE = 4;
const PDF_SCALE_STEP = 0.15;
const PDF_RENDER_WINDOW = 4;
const PDF_THUMB_STRIDE = 166;

type PdfFitMode = "page" | "width" | "custom";
type PdfRailMode = "pages" | "outline" | "search";
type PdfCoordinate = { page: number; x: number; y: number };
type DraftPdfAnnotation = { page: number; region: NormalizedRegion };
type DragAnnotation = { start: NormalizedPoint; current: NormalizedPoint; page: number };

type PdfSearchHit = { page: number; count: number; snippet: string };
type PdfOutlineEntry = { id: string; title: string; dest: unknown; depth: number };
type ReviewComment = { id: string; body?: string; status?: string; locator?: unknown; user?: { displayName?: string | null; username?: string | null } | null };

type PdfAdapterHandle = {
  goToPage: (page: number) => void;
  previousPage: () => void;
  nextPage: () => void;
  fitPage: () => void;
  fitWidth: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  rotate: () => void;
  toggleSearch: () => void;
  togglePages: () => void;
  toggleOutline: () => void;
  toggleAnnotation: () => void;
  print: () => void;
  copySelection: () => Promise<void>;
  download: () => void;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function boundedPdfOutputScale(width: number, height: number, maxPixels: number) {
  const requested = Math.min(VIEWER_CLIENT_RESOURCE_BUDGETS.maxPdfDevicePixelRatio, Math.max(1, window.devicePixelRatio || 1));
  const cssPixels = Math.max(1, width * height);
  const budgetScale = Math.sqrt(Math.max(1, maxPixels) / cssPixels);
  return Math.max(0.5, Math.min(requested, budgetScale));
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

function pdfLocator(value: unknown): PdfRegionLocator | null {
  const locator = record(value);
  if (!locator || locator.type !== "pdf_region" || !Number.isFinite(Number(locator.page))) return null;
  return locator as unknown as PdfRegionLocator;
}

function buildSearchHits(texts: string[], query: string): PdfSearchHit[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const hits: PdfSearchHit[] = [];
  for (let index = 0; index < texts.length; index += 1) {
    const text = texts[index] || "";
    const lower = text.toLocaleLowerCase();
    let count = 0;
    let cursor = 0;
    while ((cursor = lower.indexOf(needle, cursor)) >= 0) {
      count += 1;
      cursor += Math.max(1, needle.length);
    }
    if (!count) continue;
    const first = lower.indexOf(needle);
    const start = Math.max(0, first - 48);
    const end = Math.min(text.length, first + needle.length + 78);
    hits.push({ page: index + 1, count, snippet: `${start ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}` });
  }
  return hits;
}

function replaceTextWithHighlights(node: HTMLElement, query: string) {
  const value = node.textContent || "";
  node.replaceChildren();
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) { node.textContent = value; return; }
  const lower = value.toLocaleLowerCase();
  let cursor = 0;
  let index = lower.indexOf(needle);
  if (index < 0) { node.textContent = value; return; }
  while (index >= 0) {
    if (index > cursor) node.append(document.createTextNode(value.slice(cursor, index)));
    const mark = document.createElement("mark");
    mark.className = "cluster-static-pdf-search-mark";
    mark.textContent = value.slice(index, index + needle.length);
    node.append(mark);
    cursor = index + needle.length;
    index = lower.indexOf(needle, cursor);
  }
  if (cursor < value.length) node.append(document.createTextNode(value.slice(cursor)));
}

function flattenOutline(items: any[] | null | undefined, depth = 0, output: PdfOutlineEntry[] = []) {
  for (const item of items || []) {
    if (output.length >= 500) break;
    output.push({ id: `${output.length}:${String(item.title || "Section")}`, title: String(item.title || "Untitled section"), dest: item.dest, depth: Math.min(depth, 4) });
    if (Array.isArray(item.items) && item.items.length) flattenOutline(item.items, depth + 1, output);
  }
  return output;
}

function pageRegion(a: NormalizedPoint, b: NormalizedPoint, page: number): DraftPdfAnnotation {
  const width = Math.abs(a.x - b.x);
  const height = Math.abs(a.y - b.y);
  if (width < 0.005 && height < 0.005) {
    const size = 0.012;
    return { page, region: { x: clamp(b.x - size / 2, 0, 1 - size), y: clamp(b.y - size / 2, 0, 1 - size), width: size, height: size } };
  }
  return { page, region: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width, height } };
}

function PdfPageSurface({
  pdf,
  pageNumber,
  scale,
  rotation,
  active,
  searchQuery,
  annotations,
  annotationMode,
  draft,
  onCoordinate,
  onDraft,
  onSelection,
  onPageSize,
  canCopyText,
}: {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  scale: number;
  rotation: number;
  active: boolean;
  searchQuery: string;
  annotations: ReviewComment[];
  annotationMode: boolean;
  draft: DraftPdfAnnotation | null;
  onCoordinate: (coordinate: PdfCoordinate | null) => void;
  onDraft: (draft: DraftPdfAnnotation | null) => void;
  onSelection: (text: string) => void;
  onPageSize: (page: number, size: PdfPageDimensions) => void;
  canCopyText: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pendingCanvasRenderRef = useRef<Promise<void>>(Promise.resolve());
  const textRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragAnnotation | null>(null);
  const [page, setPage] = useState<PDFPageProxy | null>(null);
  const [textContent, setTextContent] = useState<TextContent | null>(null);
  const [size, setSize] = useState({ width: 612 * scale, height: 792 * scale });
  const [failed, setFailed] = useState(false);
  const [renderAttempt, setRenderAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setPage(null);
    setTextContent(null);
    void pdf.getPage(pageNumber).then((nextPage) => {
      if (cancelled) return;
      // Text extraction is optional. Failed extraction must not block rendering.
      setPage(nextPage);
      const dimensions = nextPage.getViewport({ scale: 1, rotation: 0 });
      onPageSize(pageNumber, { width: dimensions.width, height: dimensions.height });
      void nextPage.getTextContent().then((nextText) => {
        if (!cancelled) setTextContent(nextText);
      }).catch(() => undefined);
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [pageNumber, pdf, renderAttempt, onPageSize]);

  useEffect(() => {
    if (!page || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const viewport = page.getViewport({ scale, rotation });
    setSize({ width: viewport.width, height: viewport.height });
    let cancelled = false;
    let task: ReturnType<PDFPageProxy["render"]> | null = null;
    // PDF.js cancellation is asynchronous. Wait for the previous render to
    // settle before resizing or repainting this same canvas.
    const previous = pendingCanvasRenderRef.current;
    const render = async () => {
      await previous;
      if (cancelled) return;
      const outputScale = boundedPdfOutputScale(viewport.width, viewport.height, VIEWER_CLIENT_RESOURCE_BUDGETS.maxPdfCanvasPixels);
      canvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
      canvas.height = Math.max(1, Math.floor(viewport.height * outputScale));
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) { if (!cancelled) setFailed(true); return; }
      try {
        task = page.render({ canvas, canvasContext: context, viewport, transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0] });
        await task.promise;
      } catch (error: any) {
        if (!cancelled && error?.name !== "RenderingCancelledException") setFailed(true);
      }
    };
    pendingCanvasRenderRef.current = render();
    return () => { cancelled = true; task?.cancel(); };
  }, [page, rotation, scale]);

  useEffect(() => {
    const container = textRef.current;
    if (!page || !textContent || !container) return;
    const viewport = page.getViewport({ scale, rotation });
    container.replaceChildren();
    container.style.width = `${viewport.width}px`;
    container.style.height = `${viewport.height}px`;
    const layer = new TextLayer({ textContentSource: textContent, container, viewport });
    void layer.render().then(() => layer.textDivs.forEach((node) => replaceTextWithHighlights(node, searchQuery))).catch(() => undefined);
    return () => layer.cancel();
  }, [page, rotation, scale, searchQuery, textContent]);

  const normalizedPoint = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: clamp((event.clientX - rect.left) / Math.max(rect.width, 1), 0, 1), y: clamp((event.clientY - rect.top) / Math.max(rect.height, 1), 0, 1) };
  }, []);

  return <article className="cluster-static-pdf-page" data-active={active ? "true" : "false"} data-page={pageNumber} aria-label={`PDF page ${pageNumber}`}>
    <div className={`cluster-static-pdf-paper${annotationMode ? " annotation-mode" : ""}`} style={runtimeStyle({ width: size.width, height: size.height })}
      onPointerMove={(event) => {
        const point = normalizedPoint(event);
        onCoordinate({ page: pageNumber, x: point.x, y: point.y });
        const drag = dragRef.current;
        if (drag && drag.page === pageNumber) { drag.current = point; onDraft(pageRegion(drag.start, point, pageNumber)); }
      }}
      onPointerLeave={() => onCoordinate(null)}
      onPointerDown={(event) => {
        if (!annotationMode || event.button !== 0) return;
        event.preventDefault();
        const point = normalizedPoint(event);
        dragRef.current = { start: point, current: point, page: pageNumber };
        event.currentTarget.setPointerCapture(event.pointerId);
        onDraft(pageRegion(point, point, pageNumber));
      }}
      onPointerUp={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        const drag = dragRef.current;
        dragRef.current = null;
        if (!drag) return;
        const point = normalizedPoint(event);
        onDraft(pageRegion(drag.start, point, pageNumber));
      }}
      onMouseUp={() => {
        if (annotationMode || !canCopyText) return;
        const selected = window.getSelection()?.toString().trim() || "";
        if (selected) onSelection(selected.slice(0, 20_000));
      }}>
      <canvas ref={canvasRef} aria-hidden="true" />
      <div ref={textRef} className={`textLayer cluster-static-pdf-text-layer${canCopyText ? "" : " copy-disabled"}`} role="document" aria-label={`Selectable text for PDF page ${pageNumber}`} tabIndex={active ? 0 : -1} />
      <div className="cluster-static-pdf-review-layer">
        {annotations.map((comment) => {
          const locator = pdfLocator(comment.locator);
          if (!locator || locator.page !== pageNumber || !locator.region) return null;
          const title = `${comment.user?.displayName || comment.user?.username || "Reviewer"}: ${comment.body || "Review note"}`;
          return <ClusterButton key={comment.id} variant="quiet" size="compact" title={title} className="cluster-static-pdf-review-region" style={runtimeStyle({ left: `${locator.region.x * 100}%`, top: `${locator.region.y * 100}%`, width: `${locator.region.width * 100}%`, height: `${locator.region.height * 100}%` })}><span>{comment.status === "resolved" ? "✓" : "•"}</span></ClusterButton>;
        })}
        {draft?.page === pageNumber ? <span className="cluster-static-pdf-review-draft" style={runtimeStyle({ left: `${draft.region.x * 100}%`, top: `${draft.region.y * 100}%`, width: `${draft.region.width * 100}%`, height: `${draft.region.height * 100}%` })} /> : null}
      </div>
      {failed ? <ViewerState compact tone="error" title={`Page ${pageNumber} could not render`} description="Retry this page without reopening the document." actions={<ClusterButton type="button" variant="secondary" size="compact" onClick={() => { setFailed(false); setRenderAttempt((current) => current + 1); }}>Retry page</ClusterButton>} /> : null}
    </div>
    <span>Page {pageNumber}</span>
  </article>;
}

function PdfThumbnail({ pdf, pageNumber, active, rotation, onSelect }: { pdf: PDFDocumentProxy; pageNumber: number; active: boolean; rotation: number; onSelect: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    let task: ReturnType<PDFPageProxy["render"]> | null = null;
    void pdf.getPage(pageNumber).then((page) => {
      if (cancelled || !canvasRef.current) return;
      const base = page.getViewport({ scale: 1, rotation });
      const viewport = page.getViewport({ scale: Math.min(1, 108 / Math.max(base.width, 1)), rotation });
      const canvas = canvasRef.current;
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) return;
      task = page.render({ canvas, canvasContext: context, viewport });
      void task.promise.catch(() => undefined);
    });
    return () => { cancelled = true; task?.cancel(); };
  }, [pageNumber, pdf, rotation]);
  return <ClusterButton type="button" variant="quiet" className={`cluster-static-pdf-thumb${active ? " active" : ""}`} selected={active} onClick={onSelect}><canvas ref={canvasRef} /><span>{pageNumber}</span></ClusterButton>;
}

function PdfComparisonSurface({ session, pageNumber, scale, rotation }: { session: NonNullable<ReturnType<typeof useViewerAssetSession>["session"]>; pageNumber: number; scale: number; rotation: number }) {
  const scope = useViewerResourceScope();
  const source = useMemo(() => resolveViewerResourceSource(session.resource), [session.resource]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null);
  const [message, setMessage] = useState("Loading comparison document…");
  useEffect(() => {
    if (!source.url || source.sizeBytes > DEFAULT_RESOURCE_BUDGETS.maxPdfSourceBytes) { setDocument(null); setMessage("Comparison document is unavailable or exceeds the PDF source budget."); return; }
    let active = true;
    const task = getDocument({ url: source.url, withCredentials: true, enableXfa: false, stopAtErrors: false });
    const unregister = scope.registerCleanup(() => { void task.destroy(); });
    void task.promise.then(async (pdf) => { if (!active) { await pdf.destroy(); return; } if (pdf.numPages > DEFAULT_RESOURCE_BUDGETS.maxPdfPages) { await pdf.destroy(); throw new Error("Comparison PDF exceeds the page budget."); } setDocument(pdf); setMessage(""); }).catch((error) => { if (active) { setDocument(null); setMessage(error instanceof Error ? error.message : "Comparison PDF could not open."); } });
    return () => { active = false; void task.destroy(); unregister(); };
  }, [scope, source.url, source.sizeBytes]);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!document || !canvas) return;
    let cancelled = false; let task: ReturnType<PDFPageProxy["render"]> | null = null;
    void document.getPage(clamp(pageNumber, 1, document.numPages)).then((page) => { if (cancelled) return; const viewport = page.getViewport({ scale, rotation }); const ratio = boundedPdfOutputScale(viewport.width, viewport.height, VIEWER_CLIENT_RESOURCE_BUDGETS.maxPdfComparisonCanvasPixels); canvas.width = Math.max(1, Math.ceil(viewport.width * ratio)); canvas.height = Math.max(1, Math.ceil(viewport.height * ratio)); canvas.style.width = `${Math.ceil(viewport.width)}px`; canvas.style.height = `${Math.ceil(viewport.height)}px`; const context = canvas.getContext("2d", { alpha: false }); if (!context) return; task = page.render({ canvas, canvasContext: context, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] }); return task.promise; }).catch(() => undefined);
    return () => { cancelled = true; task?.cancel(); };
  }, [document, pageNumber, scale, rotation]);
  return <div className="cluster-static-pdf-compare-surface" aria-label={`Comparison PDF page ${pageNumber}`}>{message ? <span>{message}</span> : <canvas ref={canvasRef} />}</div>;
}

const PdfAdapter = forwardRef<PdfAdapterHandle, {
  session: NonNullable<ReturnType<typeof useViewerAssetSession>["session"]>;
  compareSession: NonNullable<ReturnType<typeof useViewerAssetSession>["session"]> | null;
  visibleOverlayIds: readonly string[];
  overlayPlacements: Record<string, string>;
  onReload: () => void;
  onModeChange: (mode: ViewerMode) => void;
}>(function PdfAdapter({ session, compareSession, visibleOverlayIds, overlayPlacements, onReload, onModeChange }, ref) {
  const scope = useViewerResourceScope();
  const source = useMemo(() => resolveViewerResourceSource(session.resource), [session.resource]);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const previousOffsetsRef = useRef<number[] | null>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error" | "password">("loading");
  const [error, setError] = useState("");
  const [passwordUpdate, setPasswordUpdate] = useState<((password: string) => void) | null>(null);
  const [password, setPassword] = useState("");
  const [pageCount, setPageCount] = useState(0);
  const [activePage, setActivePage] = useState(1);
  const [pageSize, setPageSize] = useState<PdfPageDimensions>({ width: 612, height: 792 });
  const [pageDimensions, setPageDimensions] = useState<Record<number, PdfPageDimensions>>({});
  const [viewport, setViewport] = useState({ width: 900, height: 700 });
  const [fitMode, setFitMode] = useState<PdfFitMode>("width");
  const [customScale, setCustomScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [railOpen, setRailOpen] = useState(true);
  const [railMode, setRailMode] = useState<PdfRailMode>("pages");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [pageTexts, setPageTexts] = useState<string[]>([]);
  const [indexing, setIndexing] = useState(false);
  const [indexTruncated, setIndexTruncated] = useState(false);
  const [outline, setOutline] = useState<PdfOutlineEntry[]>([]);
  const [selectedText, setSelectedText] = useState("");
  const [coordinate, setCoordinate] = useState<PdfCoordinate | null>(null);
  const [annotationMode, setAnnotationMode] = useState(false);
  const [draft, setDraft] = useState<DraftPdfAnnotation | null>(null);
  const [note, setNote] = useState("");
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState("");
  const [railScrollTop, setRailScrollTop] = useState(0);

  useEffect(() => {
    if (!source.url) { setState("error"); setError("This PDF does not expose a safe viewer source."); return; }
    if (source.sizeBytes > DEFAULT_RESOURCE_BUDGETS.maxPdfSourceBytes) {
      setState("error");
      setError(`PDF exceeds the ${Math.round(DEFAULT_RESOURCE_BUDGETS.maxPdfSourceBytes / 1024 / 1024)} MB viewer source budget.`);
      return;
    }
    let active = true;
    setState("loading");
    setError("");
    setPdf(null);
    setPageCount(0);
    setPageSize({ width: 612, height: 792 });
    setPageDimensions({});
    setActivePage(1);
    setPageTexts([]);
    setOutline([]);
    setIndexTruncated(false);
    const task = getDocument({ url: source.url, withCredentials: true, enableXfa: false, stopAtErrors: false });
    loadingTaskRef.current = task;
    const unregister = scope.registerCleanup(() => { void task.destroy(); });
    task.onPassword = (updatePassword: (password: string) => void, reason: number) => {
      if (!active) return;
      if (reason === PasswordResponses.NEED_PASSWORD || reason === PasswordResponses.INCORRECT_PASSWORD) {
        setPasswordUpdate(() => updatePassword);
        setState("password");
      }
    };
    void task.promise.then(async (document) => {
      if (!active) { await document.destroy(); return; }
      if (document.numPages > DEFAULT_RESOURCE_BUDGETS.maxPdfPages) {
        await document.destroy();
        throw new Error(`PDF has ${document.numPages} pages and exceeds the ${DEFAULT_RESOURCE_BUDGETS.maxPdfPages.toLocaleString()} page viewer budget.`);
      }
      setPdf(document);
      setPageCount(document.numPages);
      // Opening must not wait on metadata, outline extraction, or a slow first
      // page before allowing the viewer to display the available document.
      setState("ready");
      void document.getPage(1).then((first) => {
        if (!active) return;
        const firstViewport = first.getViewport({ scale: 1, rotation: 0 });
        setPageSize({ width: firstViewport.width, height: firstViewport.height });
        setPageDimensions((current) => ({ ...current, 1: { width: firstViewport.width, height: firstViewport.height } }));
      }).catch(() => undefined);
      void document.getOutline().then((rawOutline) => {
        if (active) setOutline(flattenOutline(rawOutline));
      }).catch(() => undefined);
    }).catch((reason) => {
      if (!active) return;
      setState("error");
      setError(reason instanceof Error ? reason.message : "PDF could not be opened safely.");
    });
    return () => {
      active = false;
      void task.destroy();
      unregister();
      if (loadingTaskRef.current === task) loadingTaskRef.current = null;
    };
  }, [scope, source.sizeBytes, source.url]);

  useEffect(() => {
    const node = scrollerRef.current;
    if (!node) return;
    const update = () => setViewport({ width: Math.max(1, node.clientWidth), height: Math.max(1, node.clientHeight) });
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, [pdf, railOpen]);

  const recordPageSize = useCallback((pageNumber: number, size: PdfPageDimensions) => {
    if (!Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) return;
    setPageDimensions((current) => {
      const previous = current[pageNumber];
      if (previous?.width === size.width && previous?.height === size.height) return current;
      return { ...current, [pageNumber]: size };
    });
  }, []);

  const rotated = rotation % 180 !== 0;
  const baseWidth = rotated ? pageSize.height : pageSize.width;
  const baseHeight = rotated ? pageSize.width : pageSize.height;
  const widthScale = clamp((viewport.width - (railOpen ? 32 : 52)) / Math.max(baseWidth, 1), PDF_MIN_SCALE, PDF_MAX_SCALE);
  const pageScale = clamp(Math.min(widthScale, (viewport.height - 52) / Math.max(baseHeight, 1)), PDF_MIN_SCALE, PDF_MAX_SCALE);
  const scale = fitMode === "width" ? widthScale : fitMode === "page" ? pageScale : customScale;
  const pageOffsets = useMemo(() => pdfPageOffsets(pageCount, pageSize, pageDimensions, scale, rotation), [pageCount, pageSize, pageDimensions, scale, rotation]);
  const scroller = scrollerRef.current;
  const scrollTop = scroller?.scrollTop || 0;
  const firstVisibleIndex = pdfPageIndexAtOffset(pageOffsets, scrollTop);
  const lastVisibleIndex = pdfPageIndexAtOffset(pageOffsets, scrollTop + viewport.height);
  const renderStart = Math.max(0, firstVisibleIndex - PDF_RENDER_WINDOW);
  const renderEnd = Math.min(pageCount, lastVisibleIndex + PDF_RENDER_WINDOW + 1);
  // Anchor the scroller to the same page when actual page measurements arrive,
  // or when zoom/rotation changes the virtual PDF geometry.
  useLayoutEffect(() => {
    const previous = previousOffsetsRef.current;
    previousOffsetsRef.current = pageOffsets;
    const node = scrollerRef.current;
    if (!node || !previous || previous.length !== pageOffsets.length || previous === pageOffsets) return;
    const currentTop = node.scrollTop;
    const pageIndex = pdfPageIndexAtOffset(previous, currentTop);
    const correctedTop = pageOffsets[pageIndex] + Math.max(0, currentTop - previous[pageIndex]);
    if (Math.abs(correctedTop - currentTop) < 0.5) return;
    const behavior = node.style.scrollBehavior;
    node.style.scrollBehavior = "auto";
    node.scrollTop = correctedTop;
    node.style.scrollBehavior = behavior;
  }, [pageOffsets]);
  const renderPages = useMemo(() => Array.from({ length: Math.max(0, renderEnd - renderStart) }, (_, index) => renderStart + index + 1), [renderEnd, renderStart]);

  const goToPage = useCallback((requested: number) => {
    const next = clamp(Math.round(requested || 1), 1, Math.max(1, pageCount));
    setActivePage(next);
    const node = scrollerRef.current;
    if (node) node.scrollTo({ top: pageOffsets[next - 1], behavior: document.documentElement.dataset.motion === "reduced" ? "auto" : "smooth" });
  }, [pageCount, pageOffsets]);

  const searchHits = useMemo(() => buildSearchHits(pageTexts, searchQuery), [pageTexts, searchQuery]);
  const comments = reviewComments(session.asset);

  useEffect(() => {
    if (!pdf || !searchOpen || pageTexts.length || indexing) return;
    let active = true;
    setIndexing(true);
    setIndexTruncated(false);
    void (async () => {
      const texts: string[] = [];
      let characters = 0;
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        if (!active) return;
        const page = await pdf.getPage(pageNumber);
        const text = await page.getTextContent();
        const value = text.items.filter((entry): entry is TextItem => "str" in entry).map((entry) => entry.str).join(" ");
        const remaining = DEFAULT_RESOURCE_BUDGETS.maxPdfTextCharacters - characters;
        if (remaining <= 0) { setIndexTruncated(true); break; }
        const bounded = value.slice(0, remaining);
        texts.push(bounded);
        characters += bounded.length;
        if (bounded.length < value.length) { setIndexTruncated(true); break; }
      }
      if (active) setPageTexts(texts);
    })().catch(() => { if (active) setIndexTruncated(true); }).finally(() => { if (active) setIndexing(false); });
    return () => { active = false; };
  }, [indexing, pageTexts.length, pdf, searchOpen]);

  const toggleSearch = useCallback(() => {
    if (searchOpen) {
      setSearchOpen(false);
      setRailMode("pages");
      return;
    }
    setSearchOpen(true);
    setRailOpen(true);
    setRailMode("search");
    window.setTimeout(() => searchInputRef.current?.focus(), 0);
  }, [searchOpen]);

  const adjustZoom = useCallback((delta: number) => {
    setFitMode("custom");
    setCustomScale((current) => clamp((fitMode === "custom" ? current : scale) + delta, PDF_MIN_SCALE, PDF_MAX_SCALE));
  }, [fitMode, scale]);

  const download = useCallback(async () => {
    if (!source.url) throw new Error("The PDF source is not available for download.");
    const fileName = session.resource.source.originalName || "document.pdf";
    if (source.url.startsWith("blob:") || source.url.startsWith("data:")) {
      const anchor = document.createElement("a");
      anchor.href = source.url;
      anchor.download = fileName;
      anchor.click();
      return;
    }
    const url = new URL(source.url, window.location.href);
    await downloadAuthenticatedClusterFile({ url: `${url.pathname}${url.search}`, fileName });
  }, [session.resource.source.originalName, source.url]);

  const print = useCallback(async () => {
    if (!source.url) throw new Error("The PDF source is not available for printing.");
    const controller = new AbortController();
    const unregisterAbort = scope.registerCleanup(() => controller.abort());
    try {
      const response = source.url.startsWith("blob:") || source.url.startsWith("data:")
        ? await fetch(source.url, { signal: controller.signal })
        : await clusterApiFetch(new URL(source.url, window.location.href).pathname + new URL(source.url, window.location.href).search, { signal: controller.signal, headers: { Accept: "application/pdf" } });
      if (!response.ok) throw new Error(`PDF printing could not start (${response.status}).`);
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      openPdfPrintFrame(blob, scope);
    } finally {
      unregisterAbort();
    }
  }, [scope, source.url]);

  const copySelection = useCallback(async () => {
    if (!selectedText) throw new Error("Select some PDF text before copying.");
    // The viewer must use Cluster's native/browser clipboard fallback and must
    // reject a failed copy so the command menu stays available for a retry.
    if (!await copyClusterText(selectedText)) throw new Error("Could not copy the PDF selection. Check clipboard access and try again.");
  }, [selectedText]);

  const goOutlineDestination = useCallback(async (dest: unknown) => {
    if (!pdf || !dest) return;
    const resolved = typeof dest === "string" ? await pdf.getDestination(dest) : dest;
    if (!Array.isArray(resolved) || !resolved[0]) return;
    const first = resolved[0] as any;
    const index = typeof first === "object" ? await pdf.getPageIndex(first) : Number(first);
    if (Number.isFinite(index)) goToPage(index + 1);
  }, [goToPage, pdf]);

  const postAnnotation = useCallback(async () => {
    if (!draft || !note.trim() || session.resource.source.locator.provider !== "review_asset") return;
    const locator: PdfRegionLocator = { type: "pdf_region", page: draft.page, region: draft.region, ...(selectedText ? { selectedTextRef: selectedText.slice(0, 1000) } : {}) };
    setPosting(true);
    setPostError("");
    try {
      const response = await clusterApiFetch(`/api/review-assets/${encodeURIComponent(session.resource.source.locator.assetId)}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ body: note.trim(), locator, status: "open", category: "edit", priority: "medium" }),
      });
      if (!response.ok) throw new Error(`Review note could not be saved (${response.status}).`);
      setDraft(null);
      setNote("");
      setAnnotationMode(false);
      onReload();
    } catch (reason) {
      setPostError(reason instanceof Error ? reason.message : "Review note could not be saved.");
    } finally { setPosting(false); }
  }, [draft, note, onReload, selectedText, session.resource.source.locator]);

  useImperativeHandle(ref, () => ({
    goToPage,
    previousPage: () => goToPage(activePage - 1),
    nextPage: () => goToPage(activePage + 1),
    fitPage: () => setFitMode("page"),
    fitWidth: () => setFitMode("width"),
    zoomIn: () => adjustZoom(PDF_SCALE_STEP),
    zoomOut: () => adjustZoom(-PDF_SCALE_STEP),
    rotate: () => setRotation((value) => (value + 90) % 360),
    toggleSearch,
    togglePages: () => { setRailOpen(true); setRailMode("pages"); },
    toggleOutline: () => { setRailOpen(true); setRailMode("outline"); },
    toggleAnnotation: () => { setAnnotationMode((value) => !value); setDraft(null); onModeChange("review"); },
    print,
    copySelection,
    download,
  }), [activePage, adjustZoom, copySelection, download, goToPage, onModeChange, print, toggleSearch]);

  const submitPage = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    goToPage(Number(data.get("page") || activePage));
  }, [activePage, goToPage]);

  const pageCoordinateValue = coordinate ? `Page ${coordinate.page} · ${Math.round(coordinate.x * 1000) / 10}%, ${Math.round(coordinate.y * 1000) / 10}%` : `Page ${activePage}`;
  const values: Record<string, string> = {
    "pdf.page_coordinates": pageCoordinateValue,
    "pdf.review_markers": `${comments.filter((comment) => pdfLocator(comment.locator)).length} note${comments.filter((comment) => pdfLocator(comment.locator)).length === 1 ? "" : "s"}`,
    "pdf.selection": selectedText ? `${selectedText.slice(0, 90)}${selectedText.length > 90 ? "…" : ""}` : "No text selected",
    "source.derivative": source.derivative ? `${source.derivative.kind} · ${source.derivative.variantKey}` : "Original source",
  };

  if (state === "loading") return <ViewerState compact tone="loading" title="Opening PDF" description="Using bounded page rendering and HTTP range delivery where the source supports it." />;
  if (state === "password") return <form className="cluster-static-pdf-password" onSubmit={(event) => { event.preventDefault(); if (!password || !passwordUpdate) return; passwordUpdate(password); setPassword(""); setState("loading"); }}><ClusterIcon name="lock" /><strong>Password required</strong><p>This document is encrypted. The password is used only by the local PDF parser.</p><ClusterTextInput type="password" autoFocus value={password} onChange={(event) => setPassword(event.target.value)} /><ClusterButton type="submit" variant="primary" disabled={!password}>Unlock</ClusterButton></form>;
  if (state === "error" || !pdf) return <ViewerState compact tone="error" title="PDF could not open" description={error || "The document could not be parsed safely."} />;

  const railViewportHeight = railRef.current?.clientHeight || viewport.height;
  const thumbFirst = clamp(Math.floor(railScrollTop / PDF_THUMB_STRIDE), 0, Math.max(0, pageCount - 1));
  const thumbCount = Math.ceil(railViewportHeight / PDF_THUMB_STRIDE) + 6;
  const thumbStart = Math.max(0, thumbFirst - 3);
  const thumbEnd = Math.min(pageCount, thumbStart + thumbCount);
  const thumbPages = Array.from({ length: Math.max(0, thumbEnd - thumbStart) }, (_, index) => thumbStart + index + 1);

  return <div className="cluster-static-pdf-adapter" data-rail={railOpen ? "open" : "closed"}>
    {railOpen ? <aside className="cluster-static-pdf-rail">
      <header><div role="tablist" aria-label="PDF navigation"><ClusterButton type="button" variant="quiet" size="compact" selected={railMode === "pages"} onClick={() => setRailMode("pages")}>Pages</ClusterButton><ClusterButton type="button" variant="quiet" size="compact" selected={railMode === "outline"} onClick={() => setRailMode("outline")}>Outline</ClusterButton><ClusterButton type="button" variant="quiet" size="compact" selected={railMode === "search"} onClick={() => { setRailMode("search"); setSearchOpen(true); }}>Search</ClusterButton></div><ClusterButton type="button" variant="quiet" size="compact" onClick={() => setRailOpen(false)} aria-label="Hide PDF navigation"><ClusterIcon name="panel-close" /></ClusterButton></header>
      {railMode === "pages" ? <div ref={railRef} className="cluster-static-pdf-thumbnails" onScroll={(event) => setRailScrollTop(event.currentTarget.scrollTop)}>
        <div style={runtimeStyle({ height: thumbStart * PDF_THUMB_STRIDE })} />
        {thumbPages.map((page) => <PdfThumbnail key={page} pdf={pdf} pageNumber={page} active={page === activePage} rotation={rotation} onSelect={() => goToPage(page)} />)}
        <div style={runtimeStyle({ height: Math.max(0, (pageCount - thumbEnd) * PDF_THUMB_STRIDE) })} />
      </div> : null}
      {railMode === "outline" ? <div className="cluster-static-pdf-outline">{outline.length ? outline.map((entry) => <ClusterButton key={entry.id} type="button" variant="quiet" style={runtimeStyle({ paddingLeft: 9 + entry.depth * 14 })} onClick={() => void goOutlineDestination(entry.dest)}>{entry.title}</ClusterButton>) : <p>No document outline.</p>}</div> : null}
      {railMode === "search" ? <div className="cluster-static-pdf-search-panel"><label><ClusterIcon name="search" /><ClusterTextInput ref={searchInputRef} type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search document" /></label><span>{indexing ? "Indexing visible text…" : searchQuery ? `${searchHits.reduce((sum, hit) => sum + hit.count, 0)} matches${indexTruncated ? " · index truncated by budget" : ""}` : "Search starts a bounded local text index."}</span><div>{searchHits.map((hit) => <ClusterButton key={hit.page} type="button" variant="quiet" onClick={() => goToPage(hit.page)}><strong>Page {hit.page} · {hit.count}</strong><small>{hit.snippet}</small></ClusterButton>)}</div></div> : null}
    </aside> : null}
    <section className="cluster-static-pdf-workspace">
      <div className="cluster-static-pdf-contextbar">
        {!railOpen ? <ClusterButton type="button" variant="quiet" size="compact" onClick={() => setRailOpen(true)} aria-label="Show PDF navigation"><ClusterIcon name="panel-open" /></ClusterButton> : null}
        <form onSubmit={submitPage}><ClusterButton type="button" variant="quiet" size="compact" disabled={activePage <= 1} onClick={() => goToPage(activePage - 1)} aria-label="Previous page"><ClusterIcon name="chevron-left" /></ClusterButton><label>Page <ClusterTextInput name="page" inputMode="numeric" defaultValue={String(activePage)} key={activePage} aria-label="Page number" /> / {pageCount}</label><ClusterButton type="button" variant="quiet" size="compact" disabled={activePage >= pageCount} onClick={() => goToPage(activePage + 1)} aria-label="Next page"><ClusterIcon name="chevron-right" /></ClusterButton></form>
        <span>{Math.round(scale * 100)}% · {fitMode === "width" ? "Fit width" : fitMode === "page" ? "Fit page" : "Custom"}</span>
        {selectedText ? <span title={selectedText}>Selection: {selectedText.slice(0, 52)}{selectedText.length > 52 ? "…" : ""}</span> : null}
      </div>
      <div className={compareSession ? "cluster-static-pdf-comparison-grid" : "cluster-static-pdf-comparison-grid single"}>
        <div ref={scrollerRef} className="cluster-static-pdf-scroll" onScroll={(event) => {
          const node = event.currentTarget;
          const page = clamp(pdfPageIndexAtOffset(pageOffsets, node.scrollTop + node.clientHeight * 0.35) + 1, 1, pageCount);
          setActivePage(page);
        }}>
          <div style={runtimeStyle({ height: pageOffsets[renderStart] })} />
          {renderPages.map((pageNumber) => <PdfPageSurface key={pageNumber} pdf={pdf} pageNumber={pageNumber} scale={scale} rotation={rotation} active={activePage === pageNumber} searchQuery={searchQuery} annotations={visibleOverlayIds.includes("review.annotations") || visibleOverlayIds.includes("pdf.review_markers") ? comments : []} annotationMode={annotationMode} draft={draft} onCoordinate={setCoordinate} onDraft={setDraft} onSelection={setSelectedText} onPageSize={recordPageSize} canCopyText={Boolean(session.capabilities.copyText)} />)}
          <div style={runtimeStyle({ height: Math.max(0, pageOffsets[pageCount] - pageOffsets[renderEnd]) })} />
        </div>
        {compareSession ? <PdfComparisonSurface session={compareSession} pageNumber={activePage} scale={scale} rotation={rotation} /> : null}
      </div>
      <ViewerOverlayLayer visibleIds={visibleOverlayIds} placements={overlayPlacements} values={values} />
      {draft && session.capabilities.comment ? <form className="cluster-viewer-review-composer" onSubmit={(event) => { event.preventDefault(); void postAnnotation(); }}><strong>PDF review note · page {draft.page}</strong><ClusterTextArea autoFocus rows={3} maxLength={4000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Describe the requested change…" />{postError ? <span className="cluster-viewer-inline-error">{postError}</span> : null}<div><ClusterButton type="button" variant="quiet" size="compact" onClick={() => { setDraft(null); setNote(""); setPostError(""); }}>Cancel</ClusterButton><ClusterButton type="submit" variant="primary" size="compact" disabled={posting || !note.trim()}>{posting ? "Posting…" : "Post note"}</ClusterButton></div></form> : null}
    </section>
  </div>;
});

export function UnifiedPdfViewer({ input, compareInput = null, userId, mode: controlledMode, onModeChange }: { input: ViewerAssetSessionInput; compareInput?: ViewerAssetSessionInput | null; userId?: string | null; mode?: ViewerMode; onModeChange?: (mode: ViewerMode) => void }) {
  const assetSession = useViewerAssetSession(input);
  const compareAssetSession = useViewerAssetSession(compareInput);
  const identity = assetSession.session ? `${assetSession.session.resource.source.provider}:${assetSession.session.resource.source.id}:${assetSession.session.resource.source.versionId || ""}` : "pdf:pending";
  const { comparisonSession, comparison } = useReviewComparisonSession({ medium: "pdf", userId, identity, enabled: Boolean(compareInput) });
  const adapterRef = useRef<PdfAdapterHandle>(null);
  const [localMode, setLocalMode] = useState<ViewerMode>(controlledMode || "view");
  const mode = controlledMode || localMode;
  const setMode = useCallback((next: ViewerMode) => { setLocalMode(next); onModeChange?.(next); }, [onModeChange]);
  const commands = useMemo<ViewerCommandDefinition[]>(() => [
    { id: "viewer.pdf.previous", label: "Previous page", icon: "chevron-left", shortcut: "pageup", priority: 10, group: "navigation", run: () => adapterRef.current?.previousPage() },
    { id: "viewer.pdf.next", label: "Next page", icon: "chevron-right", shortcut: "pagedown", priority: 15, group: "navigation", run: () => adapterRef.current?.nextPage() },
    { id: "viewer.pdf.fit_page", label: "Fit page", icon: "pages", shortcut: "1", priority: 20, group: "view", run: () => adapterRef.current?.fitPage() },
    { id: "viewer.pdf.fit_width", label: "Fit width", icon: "fullscreen", shortcut: "2", priority: 25, group: "view", run: () => adapterRef.current?.fitWidth() },
    { id: "viewer.pdf.zoom_in", label: "Zoom in", icon: "zoom-in", shortcut: "+", priority: 30, group: "view", run: () => adapterRef.current?.zoomIn() },
    { id: "viewer.pdf.zoom_out", label: "Zoom out", icon: "zoom-out", shortcut: "-", priority: 35, group: "view", run: () => adapterRef.current?.zoomOut() },
    { id: "viewer.pdf.rotate", label: "Rotate", icon: "rotate", shortcut: "r", priority: 40, group: "view", run: () => adapterRef.current?.rotate() },
    { id: "viewer.pdf.search", label: "Search", icon: "search", shortcut: "ctrl+f", priority: 10, group: "document", allowInEditable: true, run: () => adapterRef.current?.toggleSearch() },
    { id: "viewer.pdf.pages", label: "Thumbnails", icon: "pages", priority: 45, group: "document", overflow: true, run: () => adapterRef.current?.togglePages() },
    { id: "viewer.pdf.outline", label: "Outline", icon: "list", priority: 50, group: "document", overflow: true, run: () => adapterRef.current?.toggleOutline() },
    { id: "viewer.pdf.annotate", label: "Add review note", icon: "comment", shortcut: "a", priority: 10, group: "review", requiredCapability: "annotate", visible: (context) => context.resource.source.locator.provider === "review_asset", run: () => adapterRef.current?.toggleAnnotation() },
    { id: "viewer.pdf.copy", label: "Copy selection", icon: "text", priority: 55, group: "document", overflow: true, requiredCapability: "copyText", run: () => adapterRef.current?.copySelection() },
    { id: "viewer.pdf.print", label: "Print", icon: "print", shortcut: "ctrl+p", priority: 55, group: "system", overflow: true, requiredCapability: "print", run: () => adapterRef.current?.print() },
    { id: "viewer.pdf.download", label: "Download original", icon: "download", priority: 60, group: "system", overflow: true, requiredCapability: "downloadOriginal", run: () => adapterRef.current?.download() },
  ], []);

  return <ViewerShell assetSession={assetSession} userId={userId} mode={mode} onModeChange={setMode} commands={commands} overlays={viewerOverlayCatalogForMedium("pdf")} adapterDiagnostics={{ comparison: compareAssetSession.session ? comparison : null }} onReviewNavigate={(locator) => { if (locator.type === "pdf_region") adapterRef.current?.goToPage(locator.page); }} renderAdapter={({ session, visibleOverlayIds, overlayPlacements }) => <div className="cluster-viewer-comparison-stack">
    {compareAssetSession.session ? <ViewerComparisonBar session={comparisonSession} snapshot={comparison} primaryLabel={session.resource.source.title} secondaryLabel={compareAssetSession.session.resource.source.title} /> : null}
    <PdfAdapter ref={adapterRef} session={session} compareSession={compareAssetSession.session} visibleOverlayIds={visibleOverlayIds} overlayPlacements={overlayPlacements} onReload={assetSession.reload} onModeChange={setMode} />
  </div>} />;
}
