import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ClusterButton, ClusterIconButton } from "../../components/ClusterButton";
import { ClusterIcon } from "../../components/ClusterIcon";
import { ClusterDockedInspector, ClusterInspectorPanel } from "../../components/ClusterWorkspacePanel";
import { confirmCluster, promptCluster } from "../../components/cluster-dialog-service";
import { createViewerCommandRegistry } from "./viewer-command-registry";
import { createViewerOverlayRegistry, loadViewerOverlayPreferences, saveViewerOverlayPreferences } from "./viewer-overlay-registry";
import { ViewerResourceScopeProvider } from "./viewer-resource-scope";
import { ViewerCommandBar } from "./ViewerCommandBar";
import { ViewerInspector } from "./ViewerInspector";
import { ViewerOverlayDrawer } from "./ViewerOverlayDrawer";
import { ViewerReviewPanel } from "./ViewerReviewPanel";
import { ViewerState } from "./ViewerState";
import { canDetachCurrentViewer, copyViewerReviewLink, detachCurrentViewer, downloadViewerOriginal, populateViewerDragTransfer, previewViewerExport, requestViewerExport } from "./viewer-system-integration";
import { buildViewerHardeningSnapshot } from "./viewer-runtime-hardening";
import { viewerAccessibilitySnapshot, viewerAriaKeyShortcuts, viewerShortcutCommands, viewerShortcutText } from "./viewer-accessibility";
import "./viewer-shell.css";
import type { ReviewLocator } from "@cluster/shared";
import type {
  ViewerAssetSessionResult,
  ViewerCommandContext,
  ViewerCommandDefinition,
  ViewerDiagnosticsSnapshot,
  ViewerMode,
  ViewerOverlayDefinition,
  ViewerInspectorSection,
  ViewerOverlayPreferences,
  ViewerPanel,
} from "./viewer-contracts";

function defaultTitle(session: ViewerAssetSessionResult) {
  return session.session?.resource.source.title || "Viewer";
}

export function ViewerShell({
  assetSession,
  userId,
  mode = "view",
  commands = [],
  overlays = [],
  renderAdapter,
  headerActions,
  adapterDiagnostics,
  adapterInspectorSections = [],
  onModeChange,
  onReviewNavigate,
}: {
  assetSession: ViewerAssetSessionResult;
  userId?: string | null;
  mode?: ViewerMode;
  commands?: readonly ViewerCommandDefinition[];
  overlays?: readonly ViewerOverlayDefinition[];
  renderAdapter: (input: { session: NonNullable<ViewerAssetSessionResult["session"]>; visibleOverlayIds: readonly string[]; overlayPlacements: Record<string, string> }) => ReactNode;
  headerActions?: ReactNode;
  adapterDiagnostics?: Record<string, unknown>;
  adapterInspectorSections?: readonly ViewerInspectorSection[];
  onModeChange?: (mode: ViewerMode) => void;
  onReviewNavigate?: (locator: ReviewLocator) => void;
}) {
  const rootRef = useRef<HTMLElement | null>(null);
  const fullscreenReturnFocusRef = useRef<HTMLElement | null>(null);
  const [panel, setPanel] = useState<ViewerPanel>("none");
  const [fullscreen, setFullscreen] = useState(false);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [systemStatus, setSystemStatus] = useState("");
  const [systemStatusError, setSystemStatusError] = useState(false);
  const medium = assetSession.session?.resource.source.medium || "video";
  const [overlayPreferences, setOverlayPreferences] = useState<ViewerOverlayPreferences>(() => loadViewerOverlayPreferences(userId, medium));
  const fullscreenSupported = typeof document !== "undefined" && document.fullscreenEnabled;

  const toggleFullscreen = useCallback(async () => {
    const root = rootRef.current;
    if (!root || !fullscreenSupported) return;
    if (document.fullscreenElement === root) {
      await document.exitFullscreen();
      return;
    }
    fullscreenReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    await root.requestFullscreen();
  }, [fullscreenSupported]);

  const session = assetSession.session;
  const runSystemAction = useCallback(async (pending: string, action: () => Promise<string | void>) => {
    setSystemStatusError(false);
    setSystemStatus(pending);
    try {
      const message = await action();
      setSystemStatus(message || "Action complete.");
    } catch (error) {
      setSystemStatusError(true);
      setSystemStatus(error instanceof Error ? error.message : "The viewer action could not be completed.");
      // The command surface must observe this failure rather than dismiss as success.
      throw error;
    }
  }, []);

  const confirmDerivativeExport = useCallback(async (selection: Parameters<typeof requestViewerExport>[1], label: string) => {
    if (!session) return false;
    const preview = await previewViewerExport(session, selection);
    const retained = Object.keys(preview.metadata || {});
    const retainedSensitive = Object.keys(preview.sensitiveMetadata || {});
    const removed = preview.removedSensitiveCategories || [];
    const summary = [
      retained.length ? `Retained metadata: ${retained.join(", ")}.` : "Retained metadata: none.",
      preview.sensitiveMetadataRedacted
        ? "Sensitive metadata values are redacted from this preview."
        : retainedSensitive.length
          ? `Sensitive metadata retained: ${retainedSensitive.join(", ")}.`
          : "Sensitive metadata retained: none.",
      removed.length ? `Sensitive categories removed: ${removed.join(", ")}.` : "No sensitive categories are explicitly removed by this policy.",
      "The derivative is generated only after you confirm this preview.",
    ].join("\n\n");
    return confirmCluster({
      title: `${label} metadata preview`,
      message: summary,
      confirmLabel: "Create export",
      cancelLabel: "Cancel",
    });
  }, [session]);

  const shellCommands = useMemo<ViewerCommandDefinition[]>(() => [
    {
      id: "viewer.shell.inspector",
      label: "Inspector",
      description: "Toggle the contextual asset inspector.",
      icon: "panel-open",
      shortcut: "i",
      priority: 10,
      group: "shell",
      run: () => setPanel((value) => value === "inspector" ? "none" : "inspector"),
    },
    {
      id: "viewer.shell.overlays",
      label: "Overlays",
      description: "Toggle production overlay controls.",
      icon: "grid",
      shortcut: "o",
      priority: 20,
      group: "shell",
      run: () => setPanel((value) => value === "overlays" ? "none" : "overlays"),
    },
    {
      id: "viewer.shell.shortcuts",
      label: "Keyboard shortcuts",
      description: "Show the active viewer command map and keyboard shortcuts.",
      icon: "keyboard",
      shortcut: "?",
      priority: 18,
      group: "shell",
      allowInEditable: false,
      run: () => setPanel((value) => value === "shortcuts" ? "none" : "shortcuts"),
    },
    {
      id: "viewer.shell.review",
      label: "Review",
      description: "Toggle shared review history, threads, and report actions.",
      icon: "comment",
      shortcut: "r",
      priority: 15,
      group: "shell",
      visible: (context) => Boolean(context.capabilities.viewReviewHistory),
      run: () => setPanel((value) => value === "comments" ? "none" : "comments"),
    },
    {
      id: "viewer.shell.fullscreen",
      label: fullscreen ? "Exit fullscreen" : "Enter fullscreen",
      description: "Toggle viewer fullscreen mode.",
      icon: fullscreen ? "minimize" : "fullscreen",
      shortcut: "f",
      priority: 10,
      group: "shell",
      enabled: () => fullscreenSupported,
      run: () => toggleFullscreen(),
    },
    {
      id: "viewer.system.copy-link",
      label: "Copy review link",
      description: "Copy the current Cluster review/workspace link without copying asset bytes.",
      icon: "link",
      priority: 72,
      group: "system",
      overflow: true,
      visible: (context) => context.resource.source.locator.provider === "review_asset",
      run: () => runSystemAction("Copying review link…", async () => {
        if (!(await copyViewerReviewLink())) throw new Error("Clipboard write access is unavailable in this runtime.");
        return "Review link copied.";
      }),
    },
    {
      id: "viewer.system.download-original",
      label: "Download original",
      description: "Download the unchanged original through the authorized resource endpoint.",
      icon: "download",
      priority: 70,
      group: "system",
      overflow: true,
      requiredCapability: "downloadOriginal",
      visible: (context) => context.resource.source.locator.provider === "review_asset",
      run: () => session ? runSystemAction("Starting original download…", async () => {
        const result = await downloadViewerOriginal(session);
        return result.native ? "Original added to the Desktop transfer queue." : "Original handed to the browser and recorded in Transfer Center.";
      }) : undefined,
    },
    {
      id: "viewer.system.export-preserve",
      label: "Export · Preserve metadata",
      description: "Export the unchanged original with source metadata preserved.",
      icon: "download",
      priority: 74,
      group: "system",
      overflow: true,
      requiredCapability: "downloadOriginal",
      visible: (context) => context.resource.source.locator.provider === "review_asset",
      run: () => session ? runSystemAction("Preparing preserved export…", async () => {
        const result = await requestViewerExport(session, { policy: "preserve" });
        return result.downloaded ? "Preserved export started." : "Preserved export is ready through the original-download endpoint.";
      }) : undefined,
    },
    {
      id: "viewer.system.export-safe-share",
      label: "Export · Safe Share",
      description: "Create a derivative that removes private metadata while retaining necessary technical rendering information.",
      icon: "lock",
      priority: 75,
      group: "system",
      overflow: true,
      requiredCapability: "exportDerivative",
      visible: (context) => context.resource.source.locator.provider === "review_asset" && context.medium !== "3d",
      run: () => session ? runSystemAction("Reviewing Safe Share metadata…", async () => {
        const selection = { policy: "safe_share", preserveTechnicalRenderingMetadata: true } as const;
        if (!(await confirmDerivativeExport(selection, "Safe Share"))) return "Safe Share export cancelled.";
        const result = await requestViewerExport(session, selection);
        return result.downloaded ? "Safe Share export started." : "Safe Share export remains queued in media processing.";
      }) : undefined,
    },
    {
      id: "viewer.system.export-strip-all",
      label: "Export · Strip all metadata",
      description: "Create a derivative with all non-required metadata removed.",
      icon: "lock",
      priority: 76,
      group: "system",
      overflow: true,
      requiredCapability: "exportDerivative",
      visible: (context) => context.resource.source.locator.provider === "review_asset" && context.medium !== "3d",
      run: () => session ? runSystemAction("Reviewing stripped-export metadata…", async () => {
        const selection = { policy: "strip_all", preserveTechnicalRenderingMetadata: false } as const;
        if (!(await confirmDerivativeExport(selection, "Strip all"))) return "Stripped export cancelled.";
        const result = await requestViewerExport(session, selection);
        return result.downloaded ? "Stripped export started." : "Stripped export remains queued in media processing.";
      }) : undefined,
    },
    {
      id: "viewer.system.export-custom",
      label: "Export · Custom metadata",
      description: "Choose which canonical metadata categories may accompany a sanitized derivative.",
      icon: "settings",
      priority: 77,
      group: "system",
      overflow: true,
      requiredCapability: "chooseMetadataPreservationPolicy",
      visible: (context) => context.resource.source.locator.provider === "review_asset" && context.medium !== "3d" && Boolean(context.capabilities.exportDerivative),
      run: async () => {
        if (!session) return;
        const raw = await promptCluster({
          title: "Custom metadata export",
          message: "Enter canonical metadata categories to retain, separated by commas. Normal categories are identity, production, review, and derived. Sensitive categories use sensitive.<category> and still require sensitive-metadata permission. Embedded private metadata is never re-injected into sanitized bytes.",
          label: "Categories",
          initialValue: "production",
          placeholder: "production, identity",
          confirmLabel: "Preview metadata",
        });
        if (raw === null) return;
        const includeCategories = [...new Set(raw.split(",").map((value) => value.trim()).filter((value) => /^[A-Za-z0-9_.-]{1,80}$/.test(value)))].slice(0, 64);
        await runSystemAction("Reviewing custom metadata policy…", async () => {
          const selection = { policy: "custom", preserveTechnicalRenderingMetadata: true, includeCategories } as const;
          if (!(await confirmDerivativeExport(selection, "Custom export"))) return "Custom export cancelled.";
          const result = await requestViewerExport(session, selection);
          return result.downloaded ? "Custom export started." : "Custom export remains queued in media processing.";
        });
      },
    },
    {
      id: "viewer.system.detach",
      label: "Open in separate window",
      description: "Open this workspace in a separate Cluster Desktop window for multi-monitor review.",
      icon: "forward",
      priority: 78,
      group: "system",
      overflow: true,
      visible: () => canDetachCurrentViewer(),
      run: () => runSystemAction("Opening separate viewer window…", async () => {
        if (!(await detachCurrentViewer(defaultTitle(assetSession)))) throw new Error("Separate viewer windows are available only for detachable Cluster Desktop workspaces.");
        return "Viewer opened in a separate Cluster window.";
      }),
    },
  ], [assetSession, confirmDerivativeExport, fullscreen, fullscreenSupported, runSystemAction, session, toggleFullscreen]);

  const registry = useMemo(() => createViewerCommandRegistry([...shellCommands, ...commands]), [shellCommands, commands]);
  const overlayRegistry = useMemo(() => createViewerOverlayRegistry(overlays), [overlays]);

  useEffect(() => setOverlayPreferences(loadViewerOverlayPreferences(userId, medium)), [userId, medium]);
  useEffect(() => saveViewerOverlayPreferences(userId, medium, overlayPreferences), [userId, medium, overlayPreferences]);
  useEffect(() => {
    if (!systemStatus) return;
    const timer = window.setTimeout(() => setSystemStatus(""), 7000);
    return () => window.clearTimeout(timer);
  }, [systemStatus]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) setViewport({ width: Math.round(box.width), height: Math.round(box.height) });
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [assetSession.session?.resource.source.id]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    function changed() {
      const isFullscreen = document.fullscreenElement === rootRef.current;
      setFullscreen(isFullscreen);
      if (!isFullscreen && fullscreenReturnFocusRef.current) {
        const target = fullscreenReturnFocusRef.current;
        fullscreenReturnFocusRef.current = null;
        window.setTimeout(() => target.isConnected && target.focus({ preventScroll: true }), 0);
      }
    }
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);

  const commandContext = useMemo<ViewerCommandContext | null>(() => session ? ({
    medium: session.resource.source.medium,
    mode,
    panel,
    fullscreen,
    resource: session.resource,
    capabilities: session.capabilities,
  }) : null, [session, mode, panel, fullscreen]);
  // Header buttons and detached inspector actions use the same registry authority as
  // the toolbar and keyboard shortcuts, including a handled failure outcome.
  const invokeViewerCommand = useCallback((id: string) => {
    if (!commandContext) return;
    void registry.execute(id, commandContext).catch(() => {
      setSystemStatusError(true);
      setSystemStatus("Viewer command failed. Check the current result before retrying.");
    });
  }, [registry, commandContext]);
  const availableOverlays = session ? overlayRegistry.available({ medium: session.resource.source.medium, mode, capabilities: session.capabilities }) : [];
  const visibleOverlayIds = session ? overlayRegistry.visibleIds({ medium: session.resource.source.medium, mode, capabilities: session.capabilities, preferences: overlayPreferences }) : [];
  const overlayPlacements = Object.fromEntries(visibleOverlayIds.map((id) => [id, overlayRegistry.placement(id, overlayPreferences) || "top-left"]));
  const conflicts = commandContext ? registry.conflicts(commandContext) : [];
  const hardening = useMemo(() => session ? buildViewerHardeningSnapshot({ resource: session.resource, metadata: session.metadata, adapterDiagnostics }) : null, [session, adapterDiagnostics]);
  const hardeningInspectorSections = useMemo<ViewerInspectorSection[]>(() => hardening ? [
    { title: "Format support", value: { "Policy version": hardening.format.policyVersion, Support: hardening.format.support, "Runtime dependent": hardening.format.runtimeDependent ? "Yes" : "No", "Required derivative": hardening.format.derivativeKinds.join(", ") || "None", Reason: hardening.format.reason || "Native viewer path" }, open: false },
    { title: "Color & display", value: { Status: hardening.color.status, HDR: hardening.color.signal.hdr ? "Yes" : "No", "Wide gamut": hardening.color.signal.wideGamut ? "Yes" : "No", Primaries: hardening.color.signal.colorPrimaries || "Unknown", Transfer: hardening.color.signal.colorTransfer || "Unknown", "Color space": hardening.color.signal.colorSpace || "Unknown", Range: hardening.color.signal.colorRange || "Unknown", "Bit depth": hardening.color.signal.bitDepth || "Unknown", "Display gamut": hardening.color.runtime.displayGamut, "Display HDR": hardening.color.runtime.highDynamicRange == null ? "Unknown" : hardening.color.runtime.highDynamicRange ? "Yes" : "No", "Reference authoritative": "No" }, open: false },
    { title: "Resource budget", value: { Status: hardening.budget.status, ...hardening.budget.checks }, open: false },
  ] : [], [hardening]);
  const accessibility = useMemo(() => viewerAccessibilitySnapshot(), [session?.resource.source.id, fullscreen, panel]);
  const accessibilityInspectorSections = useMemo<ViewerInspectorSection[]>(() => [{ title: "Accessibility", value: { "Reduced motion": accessibility.reducedMotion ? "On" : "Off", "High contrast": accessibility.highContrast ? "On" : "Off", "Reduced transparency": accessibility.reducedTransparency ? "On" : "Off", "Input modality": accessibility.inputModality, "Text scale": accessibility.textScale, "Status palette": accessibility.statusPalette, "Fullscreen focus recovery": "Enabled", "Non-color status labels": "Enabled" }, open: false }], [accessibility]);
  const activeShortcuts = commandContext ? viewerShortcutCommands(registry, commandContext) : [];
  const ariaKeyShortcuts = commandContext ? viewerAriaKeyShortcuts(registry, commandContext) : undefined;
  const diagnostics = useMemo<ViewerDiagnosticsSnapshot | null>(() => session && commandContext ? ({
    resourceProvider: session.resource.source.provider,
    support: session.resource.source.support,
    sourceMimeType: session.resource.source.mimeType,
    sourceSizeBytes: session.resource.source.sizeBytes,
    preferredDerivativeId: session.resource.preferredDerivativeId || null,
    derivativeCount: session.resource.derivatives.length,
    fullscreen,
    mode,
    panel,
    registeredCommands: registry.list(commandContext).length,
    commandConflicts: conflicts.length,
    availableOverlays: availableOverlays.length,
    visibleOverlays: visibleOverlayIds.length,
    viewportWidth: viewport.width || null,
    viewportHeight: viewport.height || null,
    adapter: { ...adapterDiagnostics, hardening },
  }) : null, [session, commandContext, fullscreen, mode, panel, registry, conflicts.length, availableOverlays.length, visibleOverlayIds.length, viewport, adapterDiagnostics, hardening]);

  if (assetSession.state === "idle") return null;
  if (assetSession.state === "loading" || !session) {
    if (assetSession.state === "error") return <ViewerState tone="error" title="Viewer could not open this asset" description={assetSession.error instanceof Error ? assetSession.error.message : String(assetSession.error || "The asset could not be opened safely.")} actions={<ClusterButton type="button" variant="secondary" onClick={assetSession.reload}>Retry</ClusterButton>} />;
    return <ViewerState tone="loading" title="Opening asset" description="Resolving permissions, resource support, and available derivatives…" />;
  }

  const title = defaultTitle(assetSession);
  const supportMessage = session.resource.source.degradationReason || (assetSession.state === "unsupported" ? "No safe viewer path is registered for this format." : null);
  const resourceKey = `${session.resource.source.provider}:${session.resource.source.id}:${session.resource.source.versionId || ""}`;

  return <ViewerResourceScopeProvider resourceKey={resourceKey}>
    <section ref={rootRef} className="cluster-viewer-shell" data-medium={session.resource.source.medium} data-mode={mode} data-panel={panel} data-fullscreen={fullscreen ? "true" : "false"} onKeyDownCapture={(event) => { if (commandContext) void registry.handleKeyDown(event, commandContext).catch(() => { setSystemStatusError(true); setSystemStatus("Viewer command failed. Check the current result before retrying."); }); }}>
      <header className="cluster-viewer-header">
        <div className="cluster-viewer-identity">
          <ClusterIcon name={session.resource.source.medium === "3d" ? "model" : session.resource.source.medium} />
          <div><strong title={title}>{title}</strong><span>{session.resource.source.originalName} · {session.resource.source.support}</span></div>
        </div>
        <div className="cluster-viewer-header-actions">
          {onModeChange ? <div className="cluster-viewer-mode-switch" role="group" aria-label="Viewer mode">{(["view", "review", "technical"] as ViewerMode[]).map((value) => <ClusterButton key={value} size="compact" variant="quiet" selected={mode === value} onClick={() => onModeChange(value)}>{value[0].toUpperCase() + value.slice(1)}</ClusterButton>)}</div> : null}
          {headerActions}
          {session.resource.source.locator.provider === "review_asset" && session.capabilities.downloadOriginal ? <ClusterIconButton label="Drag original out" title="Drag original out through the authorized download endpoint" size="compact" variant="quiet" draggable onDragStart={(event) => { if (!populateViewerDragTransfer(event.nativeEvent, session)) event.preventDefault(); }}><ClusterIcon name="drag" /></ClusterIconButton> : null}
          {session.capabilities.viewReviewHistory ? <ClusterIconButton label="Review" size="compact" variant="quiet" selected={panel === "comments"} onClick={() => invokeViewerCommand("viewer.shell.review")}><ClusterIcon name="comment" /></ClusterIconButton> : null}
          <ClusterIconButton label="Keyboard shortcuts" title="Keyboard shortcuts (?)" size="compact" variant="quiet" selected={panel === "shortcuts"} onClick={() => invokeViewerCommand("viewer.shell.shortcuts")}><ClusterIcon name="keyboard" /></ClusterIconButton>
          <ClusterIconButton label="Overlays" size="compact" variant="quiet" selected={panel === "overlays"} onClick={() => invokeViewerCommand("viewer.shell.overlays")}><ClusterIcon name="grid" /></ClusterIconButton>
          <ClusterIconButton label="Inspector" size="compact" variant="quiet" selected={panel === "inspector"} onClick={() => invokeViewerCommand("viewer.shell.inspector")}><ClusterIcon name="panel-open" /></ClusterIconButton>
          <ClusterIconButton label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"} size="compact" variant="quiet" disabled={!fullscreenSupported} onClick={() => invokeViewerCommand("viewer.shell.fullscreen")}><ClusterIcon name={fullscreen ? "minimize" : "fullscreen"} /></ClusterIconButton>
        </div>
      </header>
      {commandContext ? <ViewerCommandBar registry={registry} context={commandContext} /> : null}
      {systemStatus ? <p className="muted tight" role={systemStatusError ? "alert" : "status"} aria-live={systemStatusError ? "assertive" : "polite"}>{systemStatus}</p> : null}
      {supportMessage ? <div className="cluster-viewer-degradation" role="status"><ClusterIcon name="warning" /><span><strong>{assetSession.state === "unsupported" ? "Unsupported source" : "Degraded viewer path"}</strong>{supportMessage}</span></div> : null}
      {hardening?.advisories.map((message) => <div key={message} className="cluster-viewer-degradation" role="status"><ClusterIcon name="warning" /><span><strong>Viewer fidelity advisory</strong>{message}</span></div>)}
      <ClusterDockedInspector
        className="cluster-viewer-workspace"
        label="viewer side panel"
        persistKey={`viewer-${medium}-panel`}
        side="end"
        minWidth={280}
        maxWidth={560}
        defaultWidth={360}
        inspector={<>
          {panel === "overlays" ? <ViewerOverlayDrawer overlays={availableOverlays} visibleIds={visibleOverlayIds} preferences={overlayPreferences} onChange={setOverlayPreferences} onClose={() => setPanel("none")} onDetach={canDetachCurrentViewer() && commandContext ? () => invokeViewerCommand("viewer.system.detach") : undefined} /> : null}
          {panel === "inspector" && diagnostics ? <ViewerInspector session={session} diagnostics={diagnostics} onLoadSensitiveMetadata={assetSession.loadSensitiveMetadata} adapterSections={[...adapterInspectorSections, ...hardeningInspectorSections, ...accessibilityInspectorSections]} onClose={() => setPanel("none")} onDetach={canDetachCurrentViewer() && commandContext ? () => invokeViewerCommand("viewer.system.detach") : undefined} /> : null}
          {panel === "comments" && session.capabilities.viewReviewHistory ? <ViewerReviewPanel session={session} onNavigate={onReviewNavigate} onReload={assetSession.reload} onClose={() => setPanel("none")} /> : null}
          {panel === "shortcuts" ? <ClusterInspectorPanel label="Viewer keyboard shortcuts" title="Keyboard shortcuts" detail="Only commands active in the current viewer context are listed." onClose={() => setPanel("none")}><div className="cluster-viewer-drawer-section"><dl>{activeShortcuts.map((command) => <div key={command.id}><dt><kbd>{viewerShortcutText(command.shortcut || "")}</kbd></dt><dd>{command.label}</dd></div>)}</dl></div><div className="cluster-viewer-drawer-section"><strong>Accessibility behavior</strong><p>Fullscreen restores focus, status messages include text labels, global reduced-motion/high-contrast preferences are honored, and editable controls suppress viewer shortcuts unless a command explicitly opts in.</p></div></ClusterInspectorPanel> : null}
        </>}
      >
        <div className="cluster-viewer-stage" tabIndex={0} aria-label={`${session.resource.source.medium} viewer for ${title}`} aria-keyshortcuts={ariaKeyShortcuts}
          onDragOver={(event) => { if (Array.from(event.dataTransfer.types || []).includes("Files")) event.preventDefault(); }}
          onDrop={(event) => { if (!event.dataTransfer.files?.length) return; event.preventDefault(); event.stopPropagation(); setSystemStatus("Local files are not opened directly from browser drops. Drop them into Project Assets so Cluster can validate, authorize, and ingest them through the normal upload pipeline."); }}>
          {assetSession.state === "unsupported" ? <ViewerState compact tone="warning" title="Preview unavailable" description={supportMessage} /> : renderAdapter({ session, visibleOverlayIds, overlayPlacements })}
        </div>
      </ClusterDockedInspector>
      {conflicts.length ? <div className="cluster-viewer-command-conflict" role="status"><ClusterIcon name="warning" />{conflicts.length} viewer shortcut conflict{conflicts.length === 1 ? "" : "s"} resolved by command priority.</div> : null}
    </section>
  </ViewerResourceScopeProvider>;
}
