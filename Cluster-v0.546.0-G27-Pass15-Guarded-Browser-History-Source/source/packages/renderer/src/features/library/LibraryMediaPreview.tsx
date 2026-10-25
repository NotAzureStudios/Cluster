import { ClusterButton, ClusterIconButton, ClusterLinkButton } from "../../components/ClusterButton";
import { useEffect, useRef, useState } from "react";
import { ClusterModal } from "../../components/ClusterModal";
import { API_URL } from "../../core/api";
import { PRIVACY_CONSENT_CHANGED_EVENT, externalContentAllowed, openPrivacyChoices } from "../../core/privacy-consent";
import { LibraryIcon, itemIconName } from "./LibraryIcons";
import { LibraryAudioArtwork } from "./LibraryAudioArtwork";
import { LibraryDocumentPreview } from "./LibraryDocumentPreview";
import { libraryFileUrl } from "./library-file-url";
import type { LibraryItem } from "./library-types";
import { runtimeStyle } from "../../core/runtime-style";
import { openClusterWorkNavigation } from "../workflow/work-navigation";
import { UnifiedAudioViewer, UnifiedImageViewer, UnifiedPdfViewer, UnifiedThreeViewer, UnifiedVideoViewer } from "../viewer";


export function LibraryAuthenticatedImage({ item, alt = "", compact = false }: { item: LibraryItem; alt?: string; compact?: boolean }) {
  const source = libraryFileUrl(item);
  const hostRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(!compact);
  const [state, setState] = useState({ url: "", failed: false });

  useEffect(() => {
    if (!compact || !hostRef.current || typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: "320px" });
    observer.observe(hostRef.current);
    return () => observer.disconnect();
  }, [compact, item.id]);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";
    setState({ url: "", failed: false });
    if (!source || !visible) return () => { cancelled = true; };
    fetch(source, { credentials: "include" }).then(async (response) => {
      if (!response.ok) throw new Error(`Image request failed (${response.status}).`);
      return response.blob();
    }).then((blob) => {
      if (cancelled) return;
      objectUrl = URL.createObjectURL(blob);
      setState({ url: objectUrl, failed: false });
    }).catch(() => { if (!cancelled) setState({ url: "", failed: true }); });
    return () => { cancelled = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [source, visible, item.updatedAt]);

  return <span ref={hostRef} className={`library-auth-image-v224${compact ? " compact" : ""}${state.failed ? " failed" : ""}`}>
    {state.url ? <img loading="lazy" decoding="async" src={state.url} alt={alt} draggable={false} /> : <span className="library-image-placeholder-v224"><LibraryIcon name={state.failed ? "image" : "file"} size={compact ? 32 : 44} /><small>{state.failed ? "Preview unavailable" : "Loading preview"}</small></span>}
  </span>;
}

export function LibraryVideoThumbnail({ item, large = false }: { item: LibraryItem; large?: boolean }) {
  const source = libraryFileUrl(item);
  const hostRef = useRef<HTMLSpanElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(large);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (large || !hostRef.current || typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    setVisible(false);
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: "480px" });
    observer.observe(hostRef.current);
    return () => observer.disconnect();
  }, [item.id, large]);

  useEffect(() => {
    setReady(false);
    setFailed(false);
  }, [item.id, item.updatedAt, source]);

  function captureFrame() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return;
    const maximumWidth = large ? 960 : 480;
    const scale = Math.min(1, maximumWidth / video.videoWidth);
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return;
    context.fillStyle = "#02050a";
    context.fillRect(0, 0, canvas.width, canvas.height);
    try {
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      setReady(true);
    } catch {
      setFailed(true);
    }
  }

  function chooseFrame() {
    const video = videoRef.current;
    if (!video) return;
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    if (duration > 0.35) video.currentTime = Math.min(Math.max(duration * 0.18, 0.15), Math.max(0.15, duration - 0.1));
    else captureFrame();
  }

  return <span ref={hostRef} className={`library-video-thumbnail-v225${large ? " large" : ""}${ready ? " ready" : ""}`}>
    {!ready && !failed ? <span className="library-image-placeholder-v224"><LibraryIcon name="video" size={large ? 44 : 32} /><small>{visible ? "Loading frame" : "Video preview"}</small></span> : null}
    {failed ? <span className="library-image-placeholder-v224"><LibraryIcon name="video" size={large ? 44 : 32} /><small>Frame unavailable</small></span> : null}
    <canvas ref={canvasRef} aria-label={`Video thumbnail for ${item.title}`} />
    {source && visible ? <video ref={videoRef} src={source} crossOrigin="use-credentials" muted playsInline preload="metadata" onLoadedMetadata={chooseFrame} onLoadedData={captureFrame} onSeeked={captureFrame} onError={() => setFailed(true)} aria-hidden="true" /> : null}
    <span className="library-video-thumbnail-play-v225"><LibraryIcon name="play" size={large ? 30 : 22} /></span>
  </span>;
}

function LibraryCompactAudioPreview({ item }: { item: LibraryItem }) {
  return <div className="library-compact-audio-v225">
    <LibraryAudioArtwork item={item} />
    <div className="library-compact-audio-overlay-v225">
      <span aria-hidden="true"><LibraryIcon name="audio" size={24} /></span>
      <div><strong>{item.title}</strong><span>{item.extension?.toUpperCase() || "Audio"} · Expand to play</span></div>
    </div>
  </div>;
}

function externalLinkHost(value?: string | null) {
  if (!value) return "External site";
  try { return new URL(value).hostname.replace(/^www\./i, "") || "External site"; } catch { return "External site"; }
}

function LibraryExternalLinkPreview({ item, expanded = false }: { item: LibraryItem; expanded?: boolean }) {
  if (!item.externalUrl) return null;
  const host = externalLinkHost(item.externalUrl);
  return <article className={`library-external-link-preview-v529${expanded ? " expanded" : ""}`}>
    <span className="library-external-link-icon-v529"><LibraryIcon name="link" size={28} /></span>
    <div className="library-external-link-copy-v529">
      <small>{host}</small>
      <h3>{item.title || host}</h3>
      {item.body || item.snippet ? <p>{item.body || item.snippet}</p> : null}
      <code>{item.externalUrl}</code>
    </div>
    <div className="library-external-link-actions-v529">
      <ClusterLinkButton href={item.externalUrl} target="_blank" rel="noreferrer" variant="primary"><LibraryIcon name="link" size={16} />Open link</ClusterLinkButton>
    </div>
  </article>;
}

export function LibraryTextPreview({ item, compact = false }: { item: LibraryItem; compact?: boolean }) {
  const inlineText = item.previewText || item.body || (compact ? item.snippet || "" : "");
  const [text, setText] = useState(inlineText);
  const [loading, setLoading] = useState(!inlineText && Boolean(item.fileUrl));
  const [message, setMessage] = useState("");
  useEffect(() => {
    let cancelled = false;
    setText(inlineText);
    setMessage("");
    if (inlineText || !item.fileUrl) {
      setLoading(false);
      return () => { cancelled = true; };
    }
    setLoading(true);
    fetch(libraryFileUrl(item), { credentials: "include" })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Preview request failed (${response.status}).`);
        return response.text();
      })
      .then((value) => { if (!cancelled) setText(value); })
      .catch((error) => { if (!cancelled) setMessage(error instanceof Error ? error.message : "Could not load text preview."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [item.id, item.updatedAt, item.fileUrl, inlineText]);

  if (loading) return <div className="library-preview-loading-v217"><span />Loading text preview…</div>;
  if (message) return <div className="library-preview-empty-v217"><strong>Text preview unavailable</strong><p>{message}</p></div>;
  const value = text || "This text file is empty.";
  const compactValue = compact && value.length > 560 ? `${value.slice(0, 560).trimEnd()}…` : value;
  return <pre className={`library-text-preview-v217${compact ? " compact" : ""}`}>{compactValue}</pre>;
}

export function LibraryModelThumbnail({ item }: { item: LibraryItem }) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const objectUrlRef = useRef("");
  const [visible, setVisible] = useState(false);
  const [imageUrl, setImageUrl] = useState("");
  const [failed, setFailed] = useState(false);
  const extension = String(item.extension || "3D").toUpperCase();
  const source = `${API_URL}${item.modelThumbnailUrl || `/api/library/${item.id}/model-thumbnail`}?v=${encodeURIComponent(item.checksumSha256 || item.updatedAt || "1")}`;

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: "480px" });
    observer.observe(host);
    return () => observer.disconnect();
  }, [item.id]);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    setFailed(false);
    setImageUrl("");
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = "";
    void fetch(source, { credentials: "include" }).then(async (response) => {
      if (!response.ok) throw new Error(`Thumbnail request failed (${response.status}).`);
      return response.blob();
    }).then((blob) => {
      if (cancelled) return;
      objectUrlRef.current = URL.createObjectURL(blob);
      setImageUrl(objectUrlRef.current);
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => {
      cancelled = true;
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = "";
    };
  }, [source, visible]);

  return <span ref={hostRef} className={`library-model-thumbnail-v237${failed ? " failed" : ""}`} role="img" aria-label={`${extension} model preview`}>
    {imageUrl ? <img loading="lazy" decoding="async" src={imageUrl} alt="" draggable={false} /> : <span className="library-model-thumbnail-state-v237"><LibraryIcon name="model" size={34} /><small>{failed ? "Expand to preview" : "Loading"}</small></span>}
    <small className="library-model-thumbnail-extension-v237">{extension}</small>
  </span>;
}

function YouTubePreview({ item, expanded }: { item: LibraryItem; expanded: boolean }) {
  const [externalAllowed, setExternalAllowed] = useState(() => externalContentAllowed());
  useEffect(() => {
    const update = () => setExternalAllowed(externalContentAllowed());
    window.addEventListener(PRIVACY_CONSENT_CHANGED_EVENT, update);
    return () => window.removeEventListener(PRIVACY_CONSENT_CHANGED_EVENT, update);
  }, []);
  if (!item.youtubeEmbedUrl) return <div className="library-preview-empty-v217"><LibraryIcon name={item.type === "youtube-playlist" ? "playlist" : "youtube"} size={44} /><strong>YouTube preview unavailable</strong><p>Check that the saved URL points to a public YouTube {item.type === "youtube-playlist" ? "playlist" : "video"}.</p>{item.externalUrl && <ClusterLinkButton className="" href={item.externalUrl} target="_blank" rel="noreferrer" variant="primary">Open on YouTube</ClusterLinkButton>}</div>;
  if (!externalAllowed) return <div className="library-preview-empty-v217 library-external-consent-v363"><LibraryIcon name={item.type === "youtube-playlist" ? "playlist" : "youtube"} size={44} /><strong>External preview blocked</strong><p>Cluster will not connect to YouTube until you allow external content in Privacy choices.</p><div><ClusterButton type="button" className="" onClick={openPrivacyChoices} variant="primary">Privacy choices</ClusterButton>{item.externalUrl && <ClusterLinkButton variant="secondary" href={item.externalUrl} target="_blank" rel="noreferrer">Open on YouTube</ClusterLinkButton>}</div></div>;
  return <div className={`library-youtube-preview-v229${expanded ? " expanded" : ""}`}>
    <iframe src={item.youtubeEmbedUrl} title={`${item.title} YouTube preview`} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen loading="lazy" referrerPolicy="no-referrer" />
    <div><LibraryIcon name={item.type === "youtube-playlist" ? "playlist" : "youtube"} size={17} /><strong>{item.type === "youtube-playlist" ? "YouTube playlist" : "YouTube video"}</strong>{item.externalUrl && <a href={item.externalUrl} target="_blank" rel="noreferrer">Open on YouTube</a>}</div>
  </div>;
}

export interface LibraryPreviewControls {
  shortcutsEnabled?: boolean;
  onPrevious?: () => void;
  onNext?: () => void;
  hasPrevious?: boolean;
  hasNext?: boolean;
  onShortcutHelp?: () => void;
}

export function LibraryPreview({ item, expanded = false, controls }: { item: LibraryItem; expanded?: boolean; controls?: LibraryPreviewControls }) {
  const source = libraryFileUrl(item);
  if (item.previewKind === "image" && source) return expanded
    ? <UnifiedImageViewer input={{ locator: { provider: "library_item", itemId: item.id } }} />
    : <div className="library-media-preview-v217 image"><LibraryAuthenticatedImage item={item} alt={item.title} /></div>;
  if (item.previewKind === "video" && source) return expanded
    ? <UnifiedVideoViewer input={{ locator: { provider: "library_item", itemId: item.id } }} />
    : <div className="library-compact-video-v225"><LibraryVideoThumbnail item={item} large /><span><LibraryIcon name="play" size={22} />Expand to play</span></div>;
  if (item.previewKind === "audio" && source) return expanded
    ? <UnifiedAudioViewer input={{ locator: { provider: "library_item", itemId: item.id } }} />
    : <LibraryCompactAudioPreview item={item} />;
  if (item.previewKind === "pdf" && source) return expanded
    ? <UnifiedPdfViewer input={{ locator: { provider: "library_item", itemId: item.id } }} />
    : <div className="library-preview-empty-v217"><LibraryIcon name="pdf" size={42} /><strong>{item.title}</strong><p>Expand to review pages.</p></div>;
  if (item.previewKind === "model" && source) return expanded
    ? <UnifiedThreeViewer input={{ locator: { provider: "library_item", itemId: item.id } }} />
    : <LibraryModelThumbnail item={item} />;
  if (item.previewKind === "youtube-video" || item.previewKind === "youtube-playlist") return <YouTubePreview item={item} expanded={expanded} />;
  if (item.previewKind === "text") return <LibraryTextPreview item={item} />;
  if (["office", "archive", "ebook"].includes(item.previewKind)) return <LibraryDocumentPreview item={item} />;
  if (item.previewKind === "external" && item.externalUrl) return <LibraryExternalLinkPreview item={item} expanded={expanded} />;
  if (item.previewKind === "folder") return <div className="library-preview-empty-v217"><LibraryIcon name="folder" size={48} style={runtimeStyle({ color: item.folderColor || undefined })} /><strong>{item.childCount || 0} items</strong><p>Open this folder to browse its contents.</p></div>;
  if (item.previewKind === "document") return <article className="library-document-preview-v217"><h3>{item.title}</h3><p>{item.body || item.snippet || "No document body."}</p></article>;
  return <div className="library-preview-empty-v217"><LibraryIcon name={itemIconName(item)} size={44} /><strong>Preview unavailable</strong><p>This format can still be downloaded and organized in Library.</p>{source && <ClusterLinkButton className="" href={libraryFileUrl(item, true)} variant="secondary">Download file</ClusterLinkButton>}</div>;
}

function LibraryShortcutGuide({ item, onClose }: { item: LibraryItem; onClose: () => void }) {
  const shortcuts = item.previewKind === "image" ? [
    ["1 / 2", "Fit image / show at 100%"],
    ["+ / -", "Zoom in or out"],
    ["R", "Rotate clockwise"],
    ["0", "Reset image view"],
    ["I / O", "Inspector / overlay drawer"],
    ["F", "Toggle viewer fullscreen"],
    ["Shift + ← / →", "Previous or next file"],
    ["Esc", "Close the viewer"],
  ] : item.previewKind === "audio" ? [
    ["Space", "Play or pause"],
    ["← / →", "Skip backward or forward"],
    ["Shift + ← / →", "Previous or next review marker"],
    ["M", "Mute or unmute"],
    ["A", "Add a review note when reviewing a review asset"],
    ["I / O", "Inspector / overlay drawer"],
    ["F", "Toggle viewer fullscreen"],
    ["Esc", "Close the viewer"],
  ] : item.previewKind === "pdf" ? [
    ["Page Up / Down", "Previous or next PDF page"],
    ["1 / 2", "Fit page / fit width"],
    ["+ / -", "Zoom in or out"],
    ["Ctrl + F", "Search document text"],
    ["R", "Rotate clockwise"],
    ["I / O", "Inspector / overlay drawer"],
    ["F", "Toggle viewer fullscreen"],
    ["Esc", "Close the viewer"],
  ] : [
    ["Space", "Play or pause"],
    ["← / →", "Previous or next frame"],
    ["J / L", "Jump backward or forward 5 seconds"],
    ["Shift + ← / →", "Previous or next file"],
    ["M", "Mute or unmute"],
    ["I / O", "Inspector / overlay drawer"],
    ["F", "Toggle viewer fullscreen"],
    ["?", "Show or hide this shortcut list"],
    ["Esc", "Close the viewer"],
  ];
  return <aside className="library-shortcuts-v218" aria-label="Viewer keyboard shortcuts">
    <header><div><LibraryIcon name="keyboard" size={20} /><strong>Viewer shortcuts</strong></div><ClusterIconButton label="Close shortcut guide" type="button" variant="quiet" size="compact" onClick={onClose}><LibraryIcon name="close" size={17} /></ClusterIconButton></header>
    <dl>{shortcuts.map(([key, description]) => <div key={key}><dt>{key}</dt><dd>{description}</dd></div>)}</dl>
  </aside>;
}

function formatViewerBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  const amount = value / 1024 ** index;
  return `${amount >= 10 || index === 0 ? Math.round(amount) : amount.toFixed(1)} ${units[index]}`;
}

export interface LibraryViewerModalProps {
  item: LibraryItem | null;
  items?: LibraryItem[];
  onSelect?: (item: LibraryItem) => void;
  onClose: () => void;
  onPrevious?: () => void;
  onNext?: () => void;
  hasPrevious?: boolean;
  hasNext?: boolean;
  position?: number;
  total?: number;
}

export function LibraryViewerModal({ item, items = [], onSelect, onClose, onPrevious, onNext, hasPrevious = false, hasNext = false, position, total }: LibraryViewerModalProps) {
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const [contextOpen, setContextOpen] = useState(false);
  useEffect(() => {
    if (!item) return;
    setShowShortcuts(false);
    setContextOpen(false);
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if ((event.shiftKey && event.key === "ArrowLeft") || event.key === "PageUp") { if (hasPrevious && onPrevious) { event.preventDefault(); onPrevious(); } }
      else if ((event.shiftKey && event.key === "ArrowRight") || event.key === "PageDown") { if (hasNext && onNext) { event.preventDefault(); onNext(); } }
      else if (event.key === "?") { event.preventDefault(); setShowShortcuts((value) => !value); }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [item?.id, onClose, onPrevious, onNext, hasPrevious, hasNext]);

  useEffect(() => {
    if (!item) return;
    const body = document.body;
    const root = document.documentElement;
    const bodyOverflow = body.style.overflow;
    const rootOverflow = root.style.overflow;
    body.style.overflow = "hidden";
    root.style.overflow = "hidden";
    body.classList.add("cluster-library-viewer-open-v234");
    return () => {
      body.style.overflow = bodyOverflow;
      root.style.overflow = rootOverflow;
      body.classList.remove("cluster-library-viewer-open-v234");
    };
  }, [item?.id]);

  if (!item) return null;
  const externalLink = item.previewKind === "external" && Boolean(item.externalUrl);
  const controls: LibraryPreviewControls = { shortcutsEnabled: !externalLink, onPrevious, onNext, hasPrevious, hasNext, onShortcutHelp: () => setShowShortcuts((value) => !value) };
  return <ClusterModal open onClose={onClose} backdropClassName="library-viewer-backdrop-v217" className={`library-viewer-v270${externalLink ? " is-external-v529" : ""}${contextOpen ? " context-open-v11" : ""}`} ariaLabel={`Preview ${item.title}`}>
      <header className="library-viewer-toolbar-v217">
        <div className="library-viewer-title-v218"><LibraryIcon name={itemIconName(item)} size={22} /><strong>{item.title}</strong>{position && total ? <em>{position} of {total}</em> : null}</div>
        <div className="library-viewer-actions-v220">
          {!externalLink ? <ClusterButton type="button" variant="quiet" size="compact" className={`library-viewer-tool-v220${contextOpen ? " active" : ""}`} selected={contextOpen} onClick={() => setContextOpen((value) => !value)} aria-label={contextOpen ? "Hide media details" : "Show media details"} title={contextOpen ? "Hide details" : "Show details"}><LibraryIcon name="note" size={20} /><span>Details</span></ClusterButton> : null}
          {!externalLink && items.length > 0 ? <ClusterButton type="button" variant="quiet" size="compact" className={`library-viewer-tool-v220${railOpen ? " active" : ""}`} selected={railOpen} onClick={() => setRailOpen((value) => !value)} aria-label={railOpen ? "Hide file list" : "Show file list"} title={railOpen ? "Hide files" : "Show files"}><LibraryIcon name={railOpen ? "panelClose" : "panelOpen"} size={21} /><span>Files</span></ClusterButton> : null}
          {!externalLink ? <ClusterButton type="button" variant="quiet" size="compact" className={`library-viewer-tool-v220${showShortcuts ? " active" : ""}`} selected={showShortcuts} onClick={() => setShowShortcuts((value) => !value)} aria-label="Media keyboard shortcuts" title="Keyboard shortcuts (?)"><LibraryIcon name="keyboard" size={21} /><span>Shortcuts</span></ClusterButton> : null}
          {externalLink && item.externalUrl ? <ClusterLinkButton className="library-viewer-tool-v220" href={item.externalUrl} target="_blank" rel="noreferrer" variant="quiet" size="compact"><LibraryIcon name="link" size={19} /><span>Open link</span></ClusterLinkButton> : <a className="library-viewer-tool-v220" href={libraryFileUrl(item, true)}><LibraryIcon name="download" size={21} /><span>Download</span></a>}
          <ClusterButton type="button" variant="quiet" size="compact" className="library-viewer-close-v220" onClick={onClose} aria-label="Close preview" title="Close preview (Escape)"><LibraryIcon name="close" size={23} /></ClusterButton>
        </div>
      </header>
      {!externalLink && contextOpen ? <div className="library-viewer-context-v495" aria-label="Media details">
        <div><span>Project</span><strong>{item.project?.name || (item.projectId ? "Linked project" : "Unassigned")}</strong></div>
        <div><span>Status</span><strong>{item.status || "active"}</strong></div>
        <div><span>Version</span><strong>{item.versionLabel || `r${item.revision || 1}`}</strong></div>
        <div><span>Review</span><strong>{item.approvedAt ? "Approved" : item.reviewDueAt ? `Due ${new Date(item.reviewDueAt).toLocaleDateString()}` : item.reviewer ? `With ${item.reviewer.displayName || item.reviewer.username}` : "No review due"}</strong></div>
        {item.projectId ? <ClusterButton type="button" variant="secondary" size="compact" onClick={() => openClusterWorkNavigation({ screen: "project", projectId: item.projectId! })}>Open project</ClusterButton> : null}
      </div> : null}
      <div className={`library-viewer-workspace-v270${externalLink || !(railOpen && items.length > 0) ? " rail-closed" : ""}`}>
        {!externalLink && railOpen && items.length > 0 ? <aside className="library-viewer-rail-v270" aria-label="Files in current Library view">
          <div className="library-viewer-rail-head-v270"><div><strong>Library files</strong><span>{items.length}</span></div><ClusterButton type="button" variant="quiet" size="compact" onClick={() => setRailOpen(false)} aria-label="Hide file list"><LibraryIcon name="panelClose" size={18} /></ClusterButton></div>
          <div className="library-viewer-rail-list-v270">
            {items.map((candidate, index) => <ClusterButton key={candidate.id} type="button" variant="quiet" className={candidate.id === item.id ? "active" : ""} selected={candidate.id === item.id} onClick={() => onSelect?.(candidate)}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <LibraryIcon name={itemIconName(candidate)} size={20} />
              <div><strong>{candidate.title}</strong><small>{candidate.extension?.toUpperCase() || candidate.type}{candidate.sizeBytes ? ` · ${formatViewerBytes(candidate.sizeBytes)}` : ""}</small></div>
            </ClusterButton>)}
          </div>
        </aside> : null}
        <div className="library-viewer-stage-v270">
          {!externalLink ? <ClusterButton type="button" variant="quiet" className="library-viewer-side-nav-v219 previous" onClick={onPrevious} disabled={!hasPrevious} aria-label="Previous file" title="Previous file (Shift + Left)"><LibraryIcon name="previous" size={28} /></ClusterButton> : null}
          <div className="library-viewer-body-v217"><LibraryPreview item={item} expanded controls={controls} /></div>
          {!externalLink ? <ClusterButton type="button" variant="quiet" className="library-viewer-side-nav-v219 next" onClick={onNext} disabled={!hasNext} aria-label="Next file" title="Next file (Shift + Right)"><LibraryIcon name="next" size={28} /></ClusterButton> : null}
          {!externalLink ? <footer className="library-viewer-status-v270"><span>{item.extension?.toUpperCase() || item.mimeGroup || item.type}</span>{item.sizeBytes ? <span>{formatViewerBytes(item.sizeBytes)}</span> : null}{position && total ? <span>{position} / {total}</span> : null}</footer> : null}
        </div>
      </div>
      {!externalLink && showShortcuts && <LibraryShortcutGuide item={item} onClose={() => setShowShortcuts(false)} />}
  </ClusterModal>;
}
