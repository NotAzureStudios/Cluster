import { ClusterDisclosureGroup } from "../../components/ClusterDisclosureGroup";
import { useEffect, useRef, useState } from "react";
import {
  getNativeRuntimeInfo,
  getNativeStartupDiagnostics,
  prepareNativeDiagnosticsPreview,
  exportNativeDiagnosticsPreview,
  getNativeTransfers,
  getNativeWidgetLibraryStatus,
  rescanNativeWidgetLibrary,
  openNativeWidgetLibrary,
  getNativeKioskStatus,
  setNativeKioskMode,
  pauseNativeTransfer,
  resumeNativeTransfer,
  retryNativeTransfer,
  cancelNativeTransfer,
  captureNativeScreen,
  removeNativeTransfer,
  retryAllNativeTransfers,
  openNativeTransferResult,
  revealNativeTransferResult,
  subscribeNativeTransfers,
  subscribeNativeFileWatch,
  openNativeAppSettings,
  openNativeHandle,
  previewNativeHandle,
  openNativeServerProfiles,
  pickNativeDirectory,
  pickNativeSaveDestination,
  pickNativeFiles,
  requestNativeCapability,
  revealNativeHandle,
  startNativeFileWatch,
  stopNativeFileWatch,
  listNativeFileWatches,
  writeNativeClipboardText,
  type ClusterNativeLocalHandle,
  type ClusterNativeLocalPreview,
  type ClusterNativeRuntimeInfo,
  type ClusterNativeStartupDiagnostics,
  type ClusterNativeDiagnosticPreview,
  type ClusterNativeTransfer,
  type ClusterNativeWidgetLibraryStatus,
  type ClusterNativeKioskStatus,
  type ClusterDesktopFileWatch,
} from "../../core/desktop";
import "./desktop-native-services.css";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { openSharedCreate } from "../create/shared-create-handoff";
import { requireNativeActionConfirmed, requireNativeOpenConfirmed } from "./desktop-native-outcomes";

function bytes(value?: number) {
  if (!Number.isFinite(value)) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = Math.max(0, Number(value));
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index += 1; }
  return `${amount >= 100 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`;
}

export function DesktopNativeServicesPanel() {
  const desktop = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("clusterDesktop") === "1";
  const [runtime, setRuntime] = useState<ClusterNativeRuntimeInfo | null>(null);
  const [items, setItems] = useState<ClusterNativeLocalHandle[]>([]);
  const [message, setMessage] = useState("");
  const [watches, setWatches] = useState<ClusterDesktopFileWatch[]>([]);
  const [lastWatchEvent, setLastWatchEvent] = useState<string>("");
  const [transfers, setTransfers] = useState<ClusterNativeTransfer[]>([]);
  const [diagnostics, setDiagnostics] = useState<ClusterNativeStartupDiagnostics | null>(null);
  const [diagnosticPreview, setDiagnosticPreview] = useState<ClusterNativeDiagnosticPreview | null>(null);
  const [preview, setPreview] = useState<ClusterNativeLocalPreview | null>(null);
  const [widgetLibrary, setWidgetLibrary] = useState<ClusterNativeWidgetLibraryStatus | null>(null);
  const [kiosk, setKiosk] = useState<ClusterNativeKioskStatus | null>(null);
  const [region, setRegion] = useState({ x: "0", y: "0", width: "1280", height: "720" });
  const activeUtilities = useRef(new Set<string>());
  const [pendingUtilities, setPendingUtilities] = useState<string[]>([]);

  // Synchronous lock: a second click in the same React frame cannot duplicate a native request.
  async function runUtility(key: string, operation: () => Promise<void>) {
    if (activeUtilities.current.has(key)) return;
    activeUtilities.current.add(key);
    setPendingUtilities(Array.from(activeUtilities.current));
    try { await operation(); }
    finally {
      activeUtilities.current.delete(key);
      setPendingUtilities(Array.from(activeUtilities.current));
    }
  }

  async function openLocalItem(item: ClusterNativeLocalHandle, action: "open" | "reveal") {
    try {
      const completed = action === "open" ? await openNativeHandle(item.handle) : await revealNativeHandle(item.handle);
      requireNativeActionConfirmed(completed, `Could not ${action} ${item.name}.`);
      setMessage(`${action === "open" ? "Opened" : "Revealed"} ${item.name} through Cluster Desktop.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : `Could not ${action} ${item.name}.`);
    }
  }

  async function openDesktopUtility(target: "servers" | "settings") {
    try {
      const result = target === "servers" ? await openNativeServerProfiles() : await openNativeAppSettings();
      requireNativeOpenConfirmed(result, `Could not open Desktop ${target === "servers" ? "server profiles" : "app settings"}.`);
      setMessage(`Desktop ${target === "servers" ? "server profiles" : "app settings"} requested.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Native Desktop window could not be opened.");
    }
  }

  useEffect(() => {
    if (!desktop) return;
    let active = true;
    const loads = [
      getNativeRuntimeInfo().then((value) => { if (active) setRuntime(value); }),
      listNativeFileWatches().then((value) => { if (active) setWatches(value); }),
      getNativeTransfers().then((value) => { if (active) setTransfers(value); }),
      getNativeStartupDiagnostics().then((value) => { if (active) setDiagnostics(value); }),
      getNativeWidgetLibraryStatus().then((value) => { if (active) setWidgetLibrary(value); }),
      getNativeKioskStatus().then((value) => { if (active) setKiosk(value); }),
    ];
    void Promise.allSettled(loads).then((results) => {
      if (!active) return;
      const failed = results.filter((result) => result.status === "rejected").length;
      if (failed) setMessage(`${failed} native service${failed === 1 ? "" : "s"} could not be loaded. Available services remain usable; retry the affected action or reopen Desktop services.`);
    });
    const watchSeq = new Map<string, number>();
    const refreshWatches = async () => {
      try {
        const value = await listNativeFileWatches();
        if (!active) return;
        for (const watch of value) {
          const nextSeq = Math.max(0, Number(watch.changeSeq || 0));
          const previousSeq = watchSeq.get(watch.watchId);
          if (previousSeq !== undefined && nextSeq > previousSeq) {
            const when = watch.changedAt ? new Date(watch.changedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" }) : "recently";
            setLastWatchEvent(`${watch.kind} ${watch.exists === false ? "became unavailable" : "changed"} at ${when}`);
          }
          watchSeq.set(watch.watchId, nextSeq);
        }
        setWatches(value);
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : "Background file-watch status could not be refreshed.");
      }
    };
    const refreshTransfers = async () => {
      try {
        const value = await getNativeTransfers();
        if (active) setTransfers(value);
      } catch (error) {
        if (active) setMessage(error instanceof Error ? error.message : "Background transfer status could not be refreshed.");
      }
    };
    const reconcile = () => {
      if (document.visibilityState !== "visible") return;
      void refreshWatches();
      void refreshTransfers();
    };
    // Native push events are authoritative. Reconciliation is only a slow recovery path for
    // missed broker events or a resumed/minimized desktop window. Hidden windows do not wake
    // once per minute merely to discover that they are still hidden.
    let reconciliationTimer = 0;
    const scheduleReconciliation = () => {
      if (reconciliationTimer) window.clearTimeout(reconciliationTimer);
      reconciliationTimer = 0;
      if (!active || document.visibilityState !== "visible") return;
      reconciliationTimer = window.setTimeout(() => {
        reconciliationTimer = 0;
        reconcile();
        scheduleReconciliation();
      }, 60_000);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") { reconcile(); scheduleReconciliation(); }
      else if (reconciliationTimer) { window.clearTimeout(reconciliationTimer); reconciliationTimer = 0; }
    };
    const onFocus = () => { reconcile(); scheduleReconciliation(); };
    scheduleReconciliation();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onFocus);
    const unsubscribe = subscribeNativeFileWatch((event) => {
      if (!active) return;
      const when = new Date(event.changedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
      setLastWatchEvent(`${event.kind} ${event.exists ? "changed" : "became unavailable"} at ${when}`);
      setWatches((current) => current.map((watch) => watch.watchId === event.watchId
        ? { ...watch, kind: event.kind, exists: event.exists, changedAt: event.changedAt, changeSeq: Math.max(0, Number(watch.changeSeq || 0)) + 1 }
        : watch));
    });
    const unsubscribeTransfers = subscribeNativeTransfers((event) => setTransfers(event.items));
    return () => {
      active = false;
      if (reconciliationTimer) window.clearTimeout(reconciliationTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onFocus);
      unsubscribe();
      unsubscribeTransfers();
    };
  }, [desktop]);

  if (!desktop) return <div className="desktop-native-empty"><strong>Desktop capabilities</strong><span>Native capabilities are available in Cluster Desktop.</span></div>;

  async function prepareDiagnosticsExport() {
    try {
      const value = await prepareNativeDiagnosticsPreview();
      setDiagnosticPreview(value);
      setMessage("Sanitized diagnostics are ready for review. Export writes these exact previewed bytes only.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Desktop diagnostics could not be prepared.");
    }
  }

  async function exportDiagnostics() {
    if (!diagnosticPreview) return;
    try {
      const stamp = new Date(diagnosticPreview.generatedAt).toISOString().slice(0, 10);
      const destination = await pickNativeSaveDestination({
        title: "Export reviewed Desktop diagnostics",
        suggestedName: `cluster-desktop-diagnostics-${stamp}.json`,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!destination) return;
      const result = await exportNativeDiagnosticsPreview({
        previewId: diagnosticPreview.previewId,
        sha256: diagnosticPreview.sha256,
        destinationHandle: destination.handle,
      });
      setMessage(result.written ? `Exported the reviewed diagnostic payload (${bytes(result.sizeBytes)}).` : "Desktop diagnostics were not exported.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Desktop diagnostics could not be exported.");
    }
  }

  async function captureSurface(mode: "screen" | "window" | "region") {
    try {
      const regionInput = mode === "region" ? { x: Number(region.x), y: Number(region.y), width: Number(region.width), height: Number(region.height) } : {};
      const captured = await captureNativeScreen({ mode, ...regionInput });
      setItems((current) => [captured, ...current.filter((item) => item.handle !== captured.handle)].slice(0, 16));
      // Capturing can succeed even if generating a preview subsequently fails.
      // Keep the captured handle and report partial success rather than invite a duplicate capture.
      try {
        setPreview(await previewNativeHandle(captured.handle));
        setMessage(`${mode === "window" ? "Window" : mode === "region" ? "Region" : "Screen"} captured as a temporary opaque handle. Attach or upload it before the handle expires.`);
      } catch (previewError) {
        setPreview(null);
        setMessage(`Capture succeeded and the temporary file remains available, but its preview failed: ${previewError instanceof Error ? previewError.message : "Preview unavailable"}`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Native capture failed.");
    }
  }


  async function quickCapture(mode: "card" | "ticket", captureMode: "screen" | "window" | "region") {
    try {
      const regionInput = captureMode === "region" ? { x: Number(region.x), y: Number(region.y), width: Number(region.width), height: Number(region.height) } : {};
      const captured = await captureNativeScreen({ mode: captureMode, ...regionInput });
      openSharedCreate(mode, {
        title: `${captureMode === "window" ? "Window" : captureMode === "region" ? "Region" : "Screen"} capture`,
        details: "Captured from Cluster Desktop. The image will upload through Project Assets and attach as evidence after creation.",
        nativeFiles: [captured],
      });
      setMessage(`${captureMode === "window" ? "Window" : captureMode === "region" ? "Region" : "Screen"} capture handed to Shared Create.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Quick Capture failed.");
    }
  }

  async function chooseFiles() {
    try {
      const selected = await pickNativeFiles({ title: "Choose local files", multiple: true });
      setItems(selected);
      setMessage(selected.length ? `${selected.length} local item${selected.length === 1 ? "" : "s"} granted to this desktop session.` : "No files selected.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "File selection failed.");
    }
  }

  async function chooseFolder() {
    try {
      const selected = await pickNativeDirectory({ title: "Choose local folder" });
      if (selected) setItems((current) => [selected, ...current.filter((item) => item.handle !== selected.handle)].slice(0, 16));
      setMessage(selected ? "Folder access granted for this desktop session." : "No folder selected.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Folder selection failed.");
    }
  }

  async function watch(item: ClusterNativeLocalHandle) {
    try {
      const created = await startNativeFileWatch(item.handle);
      setWatches((current) => current.some((entry) => entry.watchId === created.watchId) ? current : [...current, created]);
      setMessage(`${item.name} is now watched by the background Workstation Service.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "File watch failed.");
    }
  }

  async function previewItem(item: ClusterNativeLocalHandle) {
    try {
      setPreview(await previewNativeHandle(item.handle));
      setMessage(`Previewed ${item.name} through the native opaque-handle boundary.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Local preview failed.");
    }
  }

  async function stopWatch(watchId: string) {
    try {
      await stopNativeFileWatch(watchId);
      setWatches((current) => current.filter((entry) => entry.watchId !== watchId));
      setMessage("Native file watch stopped.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not stop file watch.");
    }
  }

  async function runTransferAction(action: "pause" | "resume" | "retry" | "cancel" | "remove" | "open" | "reveal", transferId: string) {
    try {
      if (action === "pause") await pauseNativeTransfer(transferId);
      else if (action === "resume") await resumeNativeTransfer(transferId);
      else if (action === "retry") await retryNativeTransfer(transferId);
      else if (action === "cancel") await cancelNativeTransfer(transferId);
      else if (action === "remove") await removeNativeTransfer(transferId);
      else if (action === "open") await openNativeTransferResult(transferId);
      else await revealNativeTransferResult(transferId);
      setMessage(`Native transfer ${action} request completed.`);
      try { setTransfers(await getNativeTransfers()); }
      catch (refreshError) {
        setMessage(`Native transfer ${action} request completed; latest status could not be refreshed: ${refreshError instanceof Error ? refreshError.message : "Refresh unavailable"}`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Native transfer action failed.");
    }
  }

  async function retryTransfers() {
    try {
      await retryAllNativeTransfers();
      setMessage("Retryable native transfers were queued again.");
      try { setTransfers(await getNativeTransfers()); }
      catch (refreshError) {
        setMessage(`Retry request completed; latest transfer status could not be refreshed: ${refreshError instanceof Error ? refreshError.message : "Refresh unavailable"}`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Native transfer retry failed.");
    }
  }

  async function copyRuntime() {
    try {
      const written = await writeNativeClipboardText(JSON.stringify({ profileId: runtime?.profileId || null, serverUrl: runtime?.serverUrl || null, protocolVersion: runtime?.protocolVersion || 3 }, null, 2));
      requireNativeActionConfirmed(written, "Desktop clipboard did not accept the runtime summary.");
      setMessage("Desktop runtime summary copied using the native clipboard boundary.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Clipboard write failed.");
    }
  }

  async function refreshWidgetLibrary() {
    try {
      setWidgetLibrary(await rescanNativeWidgetLibrary());
      setMessage("Desktop widget library rescanned.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Widget library scan failed.");
    }
  }

  async function openWidgetLibrary() {
    try {
      const result = await openNativeWidgetLibrary();
      requireNativeOpenConfirmed(result, "Desktop widget library folder did not open.");
      setMessage("Desktop widget library folder opened.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Widget library could not be opened.");
    }
  }

  async function toggleKiosk() {
    try {
      const next = await setNativeKioskMode(!Boolean(kiosk?.enabled));
      setKiosk(next);
      setMessage(next.enabled ? `Kiosk mode enabled. Exit with ${next.exitShortcut}.` : "Kiosk mode disabled.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Kiosk mode could not be changed.");
    }
  }

  async function notify() {
    try {
      await requestNativeCapability("notification.show", { title: "Cluster", body: "Native capability broker is active.", route: "settings" });
      setMessage("Native notification requested.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Notification failed.");
    }
  }

  return <section className="desktop-native-services" aria-label="Desktop native capabilities">
    <div className="desktop-native-summary">
      <div><span>Broker</span><strong>{runtime ? "Ready" : "Connecting"}</strong><small>protocol {runtime?.protocolVersion || 2}</small></div>
      <div><span>Profile</span><strong>{runtime?.profileId ? "Isolated" : "—"}</strong><small>server scoped</small></div>
      <div><span>Filesystem</span><strong>Opaque</strong><small>no raw paths</small></div>
      <div><span>Surface</span><strong>{runtime?.capabilities.length || 0}</strong><small>allowlisted actions</small></div>
      <div><span>Parity</span><strong>{runtime?.sharedRendererParity ? "Shared" : "Checking"}</strong><small>same product renderer</small></div>
    </div>

    <div className="desktop-native-grid">
      <article className="desktop-native-card span-2">
        <header><div><h3>Capture & local access</h3><p>Screenshots and selected files become temporary opaque handles that can feed Cluster uploads and evidence without exposing local paths.</p></div></header>
        <div className="desktop-capture-actions">
          <ClusterButton className="" type="button" busy={pendingUtilities.includes("capture:screen")} busyLabel="Capturing…" onClick={() => void runUtility("capture:screen", () => captureSurface("screen"))} variant="primary">Capture screen</ClusterButton>
          <ClusterButton className="" type="button" busy={pendingUtilities.includes("capture:window")} busyLabel="Capturing…" onClick={() => void runUtility("capture:window", () => captureSurface("window"))} variant="secondary">Capture window</ClusterButton>
          <ClusterButton className="" type="button" busy={pendingUtilities.includes("choose-files")} busyLabel="Choosing…" onClick={() => void runUtility("choose-files", chooseFiles)} variant="secondary">Choose files</ClusterButton>
          <ClusterButton className="" type="button" busy={pendingUtilities.includes("choose-folder")} busyLabel="Choosing…" onClick={() => void runUtility("choose-folder", chooseFolder)} variant="secondary">Choose folder</ClusterButton>
        </div>
        <ClusterDisclosureGroup title="Capture a screen region">
          <div className="desktop-capture-actions">
            <ClusterTextInput aria-label="Region X" inputMode="numeric" value={region.x} onChange={(event) => setRegion((current) => ({ ...current, x: event.target.value }))} placeholder="X" />
            <ClusterTextInput aria-label="Region Y" inputMode="numeric" value={region.y} onChange={(event) => setRegion((current) => ({ ...current, y: event.target.value }))} placeholder="Y" />
            <ClusterTextInput aria-label="Region width" inputMode="numeric" value={region.width} onChange={(event) => setRegion((current) => ({ ...current, width: event.target.value }))} placeholder="Width" />
            <ClusterTextInput aria-label="Region height" inputMode="numeric" value={region.height} onChange={(event) => setRegion((current) => ({ ...current, height: event.target.value }))} placeholder="Height" />
            <ClusterButton type="button" busy={pendingUtilities.includes("capture:region")} busyLabel="Capturing…" onClick={() => void runUtility("capture:region", () => captureSurface("region"))} variant="secondary">Capture region</ClusterButton>
          </div>
        </ClusterDisclosureGroup>
        <div className="desktop-transfer-list">
          {!items.length && <p className="muted tight">No local items granted.</p>}
          {items.map((item) => <div className="desktop-transfer-row" key={item.handle}>
            <div className="desktop-transfer-main"><strong>{item.name}</strong><span>{item.kind}{item.sizeBytes !== undefined ? ` · ${bytes(item.sizeBytes)}` : ""}</span></div>
            <div className="desktop-transfer-actions">
              <ClusterButton className="" type="button" busy={pendingUtilities.includes(`open:${item.handle}`)} busyLabel="Opening…" onClick={() => void runUtility(`open:${item.handle}`, () => openLocalItem(item, "open"))} variant="quiet" size="compact">Open</ClusterButton>
              <ClusterButton className="" type="button" busy={pendingUtilities.includes(`reveal:${item.handle}`)} busyLabel="Revealing…" onClick={() => void runUtility(`reveal:${item.handle}`, () => openLocalItem(item, "reveal"))} variant="quiet" size="compact">Reveal</ClusterButton>
              <ClusterButton className="" type="button" busy={pendingUtilities.includes(`preview:${item.handle}`)} busyLabel="Working…" onClick={() => void runUtility(`preview:${item.handle}`, () => previewItem(item))} variant="quiet" size="compact">Preview</ClusterButton>
              <ClusterButton className="" type="button" busy={pendingUtilities.includes(`watch:${item.handle}`)} busyLabel="Working…" onClick={() => void runUtility(`watch:${item.handle}`, () => watch(item))} variant="quiet" size="compact">Watch</ClusterButton>
            </div>
          </div>)}
        </div>
        {preview && <div className="desktop-local-preview-v481" aria-label={`Preview ${preview.name}`}>
          <div><strong>{preview.name}</strong><span>{preview.previewKind}{preview.mimeType ? ` · ${preview.mimeType}` : ""}{preview.sizeBytes !== undefined ? ` · ${bytes(preview.sizeBytes)}` : ""}</span></div>
          {preview.width && preview.height ? <small>{preview.width} × {preview.height} pixels</small> : null}
          {preview.text ? <pre>{preview.text}</pre> : <p className="muted tight">Native metadata preview only. The local path remains private to the desktop host.</p>}
          {preview.truncated && <small>Text preview capped at 8 KB.</small>}
          <ClusterButton className="" type="button" onClick={() => setPreview(null)} variant="quiet" size="compact">Close preview</ClusterButton>
        </div>}
        {watches.length > 0 && <div className="desktop-watch-list">
          {watches.map((entry) => <div key={entry.watchId}><code>{entry.kind}</code><span>{entry.watchId.slice(0, 18)}… · {entry.exists === false ? "missing" : "active"}{entry.backgroundIndependent ? " · background" : ""}</span><ClusterButton className="" type="button" busy={pendingUtilities.includes(`stop-watch:${entry.watchId}`)} busyLabel="Working…" onClick={() => void runUtility(`stop-watch:${entry.watchId}`, () => stopWatch(entry.watchId))} variant="quiet" size="compact">Stop</ClusterButton></div>)}
        </div>}
        {lastWatchEvent && <p className="muted tight" role="status">{lastWatchEvent}</p>}
      </article>


      <article className="desktop-native-card span-2">
        <header><div><h3>Quick Capture</h3><p>Capture native screen evidence, then hand it to Shared Create. The created work item remains canonical; the image uploads as a normal Project Asset and links as evidence after verification.</p></div></header>
        <div className="desktop-capture-actions">
          <ClusterButton type="button" busy={pendingUtilities.includes("quick:card:screen")} busyLabel="Capturing…" onClick={() => void runUtility("quick:card:screen", () => quickCapture("card", "screen"))} variant="primary">Screen → card</ClusterButton>
          <ClusterButton type="button" busy={pendingUtilities.includes("quick:ticket:screen")} busyLabel="Capturing…" onClick={() => void runUtility("quick:ticket:screen", () => quickCapture("ticket", "screen"))} variant="secondary">Screen → ticket</ClusterButton>
          <ClusterButton type="button" busy={pendingUtilities.includes("quick:card:window")} busyLabel="Capturing…" onClick={() => void runUtility("quick:card:window", () => quickCapture("card", "window"))} variant="secondary">Window → card</ClusterButton>
          <ClusterButton type="button" busy={pendingUtilities.includes("quick:ticket:window")} busyLabel="Capturing…" onClick={() => void runUtility("quick:ticket:window", () => quickCapture("ticket", "window"))} variant="secondary">Window → ticket</ClusterButton>
          <ClusterButton type="button" busy={pendingUtilities.includes("quick:card:region")} busyLabel="Capturing…" onClick={() => void runUtility("quick:card:region", () => quickCapture("card", "region"))} variant="secondary">Region → card</ClusterButton>
          <ClusterButton type="button" busy={pendingUtilities.includes("quick:ticket:region")} busyLabel="Capturing…" onClick={() => void runUtility("quick:ticket:region", () => quickCapture("ticket", "region"))} variant="secondary">Region → ticket</ClusterButton>
        </div>
      </article>

      <article className="desktop-native-card span-2">
        <header>
          <div><h3>Native transfers</h3><p>Resumable transfers run in the background Workstation Service and survive Desktop window/process exit. The renderer receives status, never local paths or session secrets.</p></div>
          {transfers.some((item) => item.state === "failed") && <ClusterButton className="" type="button" busy={pendingUtilities.includes("retry-transfers")} busyLabel="Retrying…" onClick={() => void runUtility("retry-transfers", retryTransfers)} variant="quiet" size="compact">Retry failed</ClusterButton>}
        </header>
        <div className="desktop-transfer-list">
          {!transfers.length && <p className="muted tight">No native transfers in this server profile.</p>}
          {transfers.slice(0, 12).map((transfer) => {
            const progress = Math.max(0, Math.min(100, Math.round(Number(transfer.progress || 0) * (Number(transfer.progress || 0) <= 1 ? 100 : 1))));
            const error = typeof transfer.error === "string" ? transfer.error : transfer.error?.message;
            return <div className="desktop-transfer-row" key={transfer.id}>
              <div className="desktop-transfer-main">
                <strong>{transfer.title || transfer.fileName || "Transfer"}</strong>
                <span>{transfer.direction} · {transfer.state}{transfer.totalBytes ? ` · ${bytes(transfer.transferredBytes)} / ${bytes(transfer.totalBytes)}` : ""}</span>
                {(transfer.state === "running" || transfer.state === "queued" || transfer.state === "verifying") && <progress max={100} value={progress} aria-label={`${progress}%`} />}
                {error && <span>{error}</span>}
              </div>
              <div className="desktop-transfer-actions">
                {transfer.canPause && <ClusterButton className="" type="button" busy={pendingUtilities.includes(`transfer:pause:${transfer.id}`)} busyLabel="Working…" onClick={() => void runUtility(`transfer:pause:${transfer.id}`, () => runTransferAction("pause", transfer.id))} variant="quiet" size="compact">Pause</ClusterButton>}
                {transfer.canResume && <ClusterButton className="" type="button" busy={pendingUtilities.includes(`transfer:resume:${transfer.id}`)} busyLabel="Working…" onClick={() => void runUtility(`transfer:resume:${transfer.id}`, () => runTransferAction("resume", transfer.id))} variant="quiet" size="compact">Resume</ClusterButton>}
                {transfer.canRetry && <ClusterButton className="" type="button" busy={pendingUtilities.includes(`transfer:retry:${transfer.id}`)} busyLabel="Working…" onClick={() => void runUtility(`transfer:retry:${transfer.id}`, () => runTransferAction("retry", transfer.id))} variant="quiet" size="compact">Retry</ClusterButton>}
                {transfer.canOpen && <ClusterButton className="" type="button" busy={pendingUtilities.includes(`transfer:open:${transfer.id}`)} busyLabel="Working…" onClick={() => void runUtility(`transfer:open:${transfer.id}`, () => runTransferAction("open", transfer.id))} variant="quiet" size="compact">Open</ClusterButton>}
                {transfer.canOpen && <ClusterButton className="" type="button" busy={pendingUtilities.includes(`transfer:reveal:${transfer.id}`)} busyLabel="Working…" onClick={() => void runUtility(`transfer:reveal:${transfer.id}`, () => runTransferAction("reveal", transfer.id))} variant="quiet" size="compact">Reveal</ClusterButton>}
                {["queued", "running", "paused", "verifying"].includes(transfer.state) && <ClusterButton className="" type="button" busy={pendingUtilities.includes(`transfer:cancel:${transfer.id}`)} busyLabel="Working…" onClick={() => void runUtility(`transfer:cancel:${transfer.id}`, () => runTransferAction("cancel", transfer.id))} variant="quiet" size="compact">Cancel</ClusterButton>}
                {["complete", "failed", "cancelled"].includes(transfer.state) && <ClusterButton className="" type="button" busy={pendingUtilities.includes(`transfer:remove:${transfer.id}`)} busyLabel="Working…" onClick={() => void runUtility(`transfer:remove:${transfer.id}`, () => runTransferAction("remove", transfer.id))} variant="quiet" size="compact">Remove</ClusterButton>}
              </div>
            </div>;
          })}
        </div>
      </article>

      <article className="desktop-native-card">
        <header><div><h3>Desktop controls</h3><p>Native windows stay outside the renderer.</p></div></header>
        <div className="desktop-capture-actions">
          <ClusterButton className="" type="button" busy={pendingUtilities.includes("servers")} busyLabel="Opening…" onClick={() => void runUtility("servers", () => openDesktopUtility("servers"))} variant="secondary">Servers</ClusterButton>
          <ClusterButton className="" type="button" busy={pendingUtilities.includes("settings")} busyLabel="Opening…" onClick={() => void runUtility("settings", () => openDesktopUtility("settings"))} variant="secondary">App settings</ClusterButton>
          <ClusterButton className="" type="button" busy={pendingUtilities.includes("test-notification")} busyLabel="Sending…" onClick={() => void runUtility("test-notification", notify)} variant="secondary">Test notification</ClusterButton>
          <ClusterButton className="" type="button" busy={pendingUtilities.includes("copy-runtime")} busyLabel="Copying…" onClick={() => void runUtility("copy-runtime", copyRuntime)} variant="secondary">Copy runtime</ClusterButton>
        </div>
      </article>

      <article className="desktop-native-card">
        <header><div><h3>Kiosk mode</h3><p>Full-screen Desktop presentation mode with a native escape shortcut.</p></div></header>
        <div className="desktop-credential-list">
          <div><code>state</code><span>{kiosk?.enabled ? "enabled" : "disabled"}</span></div>
          <div><code>exit</code><span>{kiosk?.exitShortcut || "Ctrl+Shift+F10"}</span></div>
          <div><code>persistence</code><span>device setting</span></div>
        </div>
        <ClusterButton variant={kiosk?.enabled ? "danger" : "primary"} type="button" busy={pendingUtilities.includes("toggle-kiosk")} busyLabel="Updating…" onClick={() => void runUtility("toggle-kiosk", toggleKiosk)}>
          {kiosk?.enabled ? "Exit kiosk" : "Enter kiosk"}
        </ClusterButton>
      </article>

      <article className="desktop-native-card">
        <header><div><h3>Widget library</h3><p>Custom widgets are discovered from the Desktop library as validated manifests. Arbitrary code is rejected.</p></div></header>
        <div className="desktop-credential-list">
          <div><code>runtime</code><span>{widgetLibrary?.runtime || "declarative-v1"}</span></div>
          <div><code>host</code><span>{widgetLibrary?.clusterVersion ? `Cluster ${widgetLibrary.clusterVersion}` : "checking"}</span></div>
          <div><code>installed</code><span>{widgetLibrary?.widgetCount ?? 0}</span></div>
          <div><code>invalid</code><span>{widgetLibrary?.invalidCount ?? 0}</span></div>
          <div><code>permissions</code><span>{widgetLibrary?.supportedPermissions?.length ?? 0} supported</span></div>
          <div><code>last change</code><span>{widgetLibrary?.lastOperation ? `${widgetLibrary.lastOperation.action} · ${widgetLibrary.lastOperation.id}` : "none"}</span></div>
          <div><code>code execution</code><span>blocked</span></div>
        </div>
        {!!widgetLibrary?.invalidWidgets?.length && <p className="desktop-native-card-note" role="status">Latest rejected manifest: {widgetLibrary.invalidWidgets[0]?.entry || "widget"} · {widgetLibrary.invalidWidgets[0]?.reason || "invalid manifest"}</p>}
        <div className="desktop-capture-actions">
          <ClusterButton className="" type="button" busy={pendingUtilities.includes("widget-library-open")} busyLabel="Opening…" onClick={() => void runUtility("widget-library-open", openWidgetLibrary)} variant="secondary">Open folder</ClusterButton>
          <ClusterButton className="" type="button" busy={pendingUtilities.includes("widget-library-rescan")} busyLabel="Scanning…" onClick={() => void runUtility("widget-library-rescan", refreshWidgetLibrary)} variant="secondary">Rescan</ClusterButton>
        </div>
      </article>

      <article className="desktop-native-card">
        <header><div><h3>Startup performance</h3><p>Cold-start phases are measured by the native host for this process rather than inferred from renderer timestamps.</p></div></header>
        <div className="desktop-credential-list">
          <div><code>controller</code><span>{runtime?.startupPerformance?.controllerReadyMs ?? 0} ms</span></div>
          <div><code>initialize</code><span>{runtime?.startupPerformance?.initializeMs !== undefined ? `${runtime.startupPerformance.initializeMs} ms` : "pending"}</span></div>
          <div><code>bootstrap</code><span>{runtime?.startupPerformance?.bootstrapStartedMs !== undefined ? `${runtime.startupPerformance.bootstrapStartedMs} ms` : "pending"}</span></div>
          <div><code>server ready</code><span>{runtime?.startupPerformance?.serverReadyMs !== undefined ? `${runtime.startupPerformance.serverReadyMs} ms` : "pending"}</span></div>
          <div><code>renderer ready</code><span>{runtime?.startupPerformance?.rendererReadyMs !== undefined ? `${runtime.startupPerformance.rendererReadyMs} ms` : "pending"}</span></div>
        </div>
        <p className="desktop-native-card-note">Compatibility and setup checks run in parallel after server readiness; renderer-state polling backs off while idle and suspends when Cluster is inactive.</p>
      </article>

      <article className="desktop-native-card span-2">
        <header><div><h3>Preview-first diagnostics</h3><p>Review the exact sanitized JSON before Cluster writes anything outside its native process.</p></div></header>
        <div className="desktop-credential-list">
          <div><code>raw paths</code><span>excluded</span></div>
          <div><code>server addresses</code><span>excluded</span></div>
          <div><code>credentials / cookies / CSRF</code><span>excluded</span></div>
          <div><code>user content</code><span>excluded</span></div>
          <div><code>retention</code><span>{diagnosticPreview ? `expires ${new Date(diagnosticPreview.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "10 minutes after preview"}</span></div>
          <div><code>SHA-256</code><span>{diagnosticPreview ? diagnosticPreview.sha256 : "generated with preview"}</span></div>
        </div>
        {diagnosticPreview ? <pre className="desktop-diagnostics-preview" aria-label="Sanitized diagnostic preview">{diagnosticPreview.text}</pre> : <p className="desktop-native-card-note">Nothing is exportable until you generate and review a sanitized preview.</p>}
        <div className="desktop-capture-actions">
          <ClusterButton type="button" variant="secondary" busy={pendingUtilities.includes("diagnostics-preview")} busyLabel="Preparing…" onClick={() => void runUtility("diagnostics-preview", prepareDiagnosticsExport)}>{diagnosticPreview ? "Refresh preview" : "Prepare preview"}</ClusterButton>
          <ClusterButton type="button" variant="primary" disabled={!diagnosticPreview} busy={pendingUtilities.includes("diagnostics-export")} busyLabel="Exporting…" onClick={() => void runUtility("diagnostics-export", exportDiagnostics)}>Export reviewed JSON</ClusterButton>
        </div>
      </article>

      <article className="desktop-native-card">
        <header><div><h3>Security boundary</h3><p>Requests are origin checked, profile bound, epoch bound, rate limited, schema validated, and audited by the native host.</p></div></header>
        <div className="desktop-credential-list">
          <div><code>process execution</code><span>not exposed</span></div>
          <div><code>raw filesystem paths</code><span>not exposed</span></div>
          <div><code>credentials</code><span>not exposed</span></div>
          <div><code>generic IPC</code><span>not exposed</span></div>
          <div><code>request profile</code><span>{runtime?.requestProfileBinding ? "bound" : "checking"}</span></div>
          <div><code>payload schema</code><span>{runtime?.strictPayloadSchemas ? "strict" : "checking"}</span></div>
          <div><code>file watching</code><span>opaque handles only</span></div>
          <div><code>clipboard read</code><span>user-confirmed · plain text · no polling</span></div>
          <div><code>screen capture</code><span>{runtime?.nativeCapture ? "opaque temporary handles" : "checking"}</span></div>
          <div><code>startup diagnostics</code><span>{diagnostics ? `${diagnostics.crashStreak} crash streak · ${diagnostics.cpuArchitecture || "unknown cpu"}` : "loading"}</span></div>
          <div><code>diagnostic paths</code><span>not exposed</span></div>
        </div>
      </article>

      <article className="desktop-native-card span-2">
        <header><div><h3>Desktop-only advantages</h3><p>The renderer stays shared with Web; only operating-system capabilities deliberately differ.</p></div></header>
        <div className="desktop-credential-list">
          {(runtime?.desktopOnlyAdvantages || []).map((advantage) => <div key={advantage}><code>{advantage}</code><span>native</span></div>)}
          {!runtime?.desktopOnlyAdvantages?.length && <div><code>runtime</code><span>loading</span></div>}
        </div>
      </article>
    </div>
    {message && <p className="desktop-native-message" role="status" aria-live="polite">{message}</p>}
  </section>;
}
