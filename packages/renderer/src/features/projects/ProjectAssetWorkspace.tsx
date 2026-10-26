import { ClusterNativeSelect, ClusterInput } from "../../components/ClusterNativeControls";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterTextArea } from "../../components/ClusterTextArea";
import { useDeferredValue, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterEmptyState } from "../../components/ClusterEmptyState";
import { ClusterResizableSplit } from "../../components/ClusterResizableSplit";
import { ClusterFileButton } from "../../components/ClusterFileButton";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import { ClusterRecoveryNotice } from "../../components/ClusterContextActions";
import { confirmCluster } from "../../components/cluster-dialog-service";
import { api, API_URL, uploadApi } from "../../core/api";
import { captureNativeScreen, onNativeFilesystemDrop, pickNativeFiles, uploadNativeProjectFile, type ClusterNativeLocalHandle } from "../../core/desktop";
import { formatRelativeTime } from "../../core/format";
import type { Project, ProjectFile, User } from "../application/application-models";
import { ProjectSectionHeader, ProjectSectionStatus } from "./ProjectWorkspacePrimitives";
import { LinkedWorkPanel } from "../workflow/LinkedWorkPanel";
import { WorkActionMenu } from "../workflow/WorkActionMenu";
import { UnifiedAudioViewer, UnifiedImageViewer, UnifiedPdfViewer, UnifiedThreeViewer, UnifiedVideoViewer } from "../viewer";

const ASSET_ROLES = ["source", "derived", "proxy", "export", "reference", "deliverable"] as const;
const ASSET_STATUSES = ["active", "review", "approved", "superseded", "archived"] as const;

type AssetListResponse = {
  items: ProjectFile[];
  nextCursor: string | null;
  hasMore: boolean;
  summary: { total: number; bytes: number; duplicates: number; locked: number; versions: number; archived: number };
  collections: Array<{ id: string; label: string; count: number }>;
};
type AssetLineageResponse = { asset: ProjectFile; versions: ProjectFile[]; relationships: Array<{ id: string; sourceId: string; targetId: string; relationship: string }>; related: ProjectFile[] };
type AssetVerifyResponse = { ok: boolean; exists: boolean; sizeMatches: boolean; checksumMatches: boolean; expectedBytes: number; actualBytes: number | null; checksumSha256: string | null; repaired: boolean };
type AssetIntegrityResponse = {
  ok: boolean; complete: boolean; inventoryFailed: boolean; unavailable: Array<{ id: string; title: string }>; checkedAt: string; scanned: number; truncated: boolean; activeBytes: number; archivedBytes: number;
  missing: Array<{ id: string; title: string; originalName: string }>;
  sizeMismatch: Array<{ id: string; title: string; expectedBytes: number; actualBytes: number }>;
  danglingLineageIds: string[]; staleLockIds: string[]; orphanCount: number; orphanSamples: string[];
};

type Props = {
  project: Project;
  currentUser: User;
  canContribute: boolean;
  canManage: boolean;
  bytesToSize: (value?: number | null) => string;
  onReloadMedia: () => Promise<void>;
};

function previewKind(asset: ProjectFile) {
  const mime = String(asset.mimeType || "").toLowerCase();
  const extension = String(asset.originalName || "").split(".").pop()?.toLowerCase() || "";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("model/") || ["glb", "gltf", "fbx", "obj", "dae", "stl", "ply", "3ds", "blend"].includes(extension)) return "model";
  if (mime.startsWith("text/") || mime === "application/json") return "frame";
  return "download";
}
function labelize(value?: string | null) { return String(value || "").replace(/[-_]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()); }
function versionFamily(asset: ProjectFile) { return asset.versionGroupId || asset.id; }
function assetFileUrl(asset: ProjectFile, inline = false) { return `${API_URL}/api/project-files/${encodeURIComponent(asset.id)}/file${inline ? "?inline=1" : ""}`; }
function uniqueAssets(items: ProjectFile[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function AssetPreview({ asset, compareAsset = null, title, userId }: { asset: ProjectFile; compareAsset?: ProjectFile | null; title?: ReactNode; userId?: string | null }) {
  const kind = previewKind(asset);
  const compareInput = compareAsset && previewKind(compareAsset) === kind ? { locator: { provider: "project_file" as const, fileId: compareAsset.id } } : null;
  const inlineUrl = assetFileUrl(asset, true);
  const fileUrl = assetFileUrl(asset);
  return <div className="project-asset-compare-pane-v495">
    {title ? <header>{title}</header> : null}
    <div className="project-asset-preview-stage-v495">
      {kind === "image" ? <UnifiedImageViewer input={{ locator: { provider: "project_file", fileId: asset.id } }} compareInput={compareInput} userId={userId} /> : null}
      {kind === "pdf" ? <UnifiedPdfViewer input={{ locator: { provider: "project_file", fileId: asset.id } }} compareInput={compareInput} userId={userId} /> : null}
      {kind === "video" ? <UnifiedVideoViewer input={{ locator: { provider: "project_file", fileId: asset.id } }} compareInput={compareInput} userId={userId} /> : null}
      {kind === "audio" ? <UnifiedAudioViewer input={{ locator: { provider: "project_file", fileId: asset.id } }} compareInput={compareInput} userId={userId} /> : null}
      {kind === "model" ? <UnifiedThreeViewer input={{ locator: { provider: "project_file", fileId: asset.id } }} compareInput={compareInput} userId={userId} /> : null}
      {kind === "frame" ? <iframe src={inlineUrl} title={`${asset.title} preview`} sandbox="allow-same-origin" /> : null}
      {kind === "download" ? <div><strong>Preview unavailable</strong><span>{asset.mimeType || "Unknown file type"}</span><a href={fileUrl} target="_blank" rel="noreferrer">Open file</a></div> : null}
    </div>
  </div>;
}

export function ProjectAssetWorkspace({ project, currentUser, canContribute, canManage, bytesToSize, onReloadMedia }: Props) {
  const [payload, setPayload] = useState<AssetListResponse>({ items: [], nextCursor: null, hasMore: false, summary: { total: 0, bytes: 0, duplicates: 0, locked: 0, versions: 0, archived: 0 }, collections: [] });
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [collection, setCollection] = useState("all");
  const [role, setRole] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [duplicatesOnly, setDuplicatesOnly] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lineage, setLineage] = useState<AssetLineageResponse | null>(null);
  const [compareId, setCompareId] = useState("");
  const [verifyResult, setVerifyResult] = useState<AssetVerifyResponse | null>(null);
  const [integrity, setIntegrity] = useState<AssetIntegrityResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [message, setMessage] = useState("");
  const [lastArchivedAsset, setLastArchivedAsset] = useState<{ id: string; title: string; revision: number } | null>(null);
  const [uploadCollection, setUploadCollection] = useState("shared");
  const [uploadRole, setUploadRole] = useState<(typeof ASSET_ROLES)[number]>("source");
  const [uploadAsVersion, setUploadAsVersion] = useState(false);
  const [draft, setDraft] = useState({ title: "", description: "", category: "shared", assetRole: "source", status: "active", tags: "", parentId: "" });
  const requestEpoch = useRef(0);

  const selected = payload.items.find((item) => item.id === selectedId) || null;
  const selectedParentId = selected?.derivedFromId || selected?.proxyOfId || selected?.exportOfId || "";
  const assetDraftDirty = Boolean(selected && (
    draft.title !== selected.title ||
    draft.description !== (selected.description || "") ||
    draft.category !== (selected.category || "shared") ||
    draft.assetRole !== (selected.assetRole || "source") ||
    draft.status !== (selected.status || "active") ||
    draft.tags !== (selected.tags || []).join(", ") ||
    draft.parentId !== selectedParentId
  ));
  const { confirmDiscard: confirmDiscardAssetDraft } = useUnsavedChangesGuard({
    dirty: assetDraftDirty,
    title: "Discard unsaved asset metadata?",
    message: "This asset has unsaved metadata changes. Select another asset and discard those edits?",
  });
  const compareAsset = lineage?.versions.find((item) => item.id === compareId) || null;
  const familyItems = useMemo(() => lineage?.versions || (selected ? payload.items.filter((item) => versionFamily(item) === versionFamily(selected)) : []), [lineage, payload.items, selected]);
  const orderedFamilyItems = useMemo(() => [...familyItems].sort((left, right) => Number(left.versionNumber || 1) - Number(right.versionNumber || 1) || new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()), [familyItems]);
  const selectedFamilyIndex = selected ? orderedFamilyItems.findIndex((item) => item.id === selected.id) : -1;
  const previousFamilyVersion = selectedFamilyIndex > 0 ? orderedFamilyItems[selectedFamilyIndex - 1] : null;
  const nextFamilyVersion = selectedFamilyIndex >= 0 && selectedFamilyIndex < orderedFamilyItems.length - 1 ? orderedFamilyItems[selectedFamilyIndex + 1] : null;

  async function selectAssetSafely(assetId: string) {
    if (!assetId || assetId === selectedId) return true;
    if (!await confirmDiscardAssetDraft()) return false;
    setSelectedId(assetId);
    return true;
  }

  async function handleAssetOptionKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, assetId: string) {
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const options = Array.from(event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="option"]') || []);
    if (!options.length) return;
    const currentIndex = Math.max(0, options.findIndex((option) => option.dataset.assetId === assetId));
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? options.length - 1 : Math.max(0, Math.min(options.length - 1, currentIndex + (event.key === "ArrowDown" ? 1 : -1)));
    event.preventDefault();
    const next = options[nextIndex];
    if (!next?.dataset.assetId || !await selectAssetSafely(next.dataset.assetId)) return;
    window.requestAnimationFrame(() => next.focus());
  }

  function assetQuery(cursor?: string | null) {
    const params = new URLSearchParams();
    if (deferredQuery.trim()) params.set("q", deferredQuery.trim());
    if (collection !== "all") params.set("collection", collection);
    if (role !== "all") params.set("role", role);
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (duplicatesOnly) params.set("duplicatesOnly", "1");
    if (includeArchived) params.set("includeArchived", "1");
    params.set("limit", "100");
    if (cursor) params.set("cursor", cursor);
    return params;
  }

  async function loadAssets(preferredId?: string | null, append = false, cursor?: string | null) {
    const epoch = append ? requestEpoch.current : ++requestEpoch.current;
    const next = await api<AssetListResponse>(`/api/projects/${project.id}/assets?${assetQuery(cursor).toString()}`);
    if (epoch !== requestEpoch.current) return;
    setPayload((current) => append ? { ...next, items: uniqueAssets([...current.items, ...next.items]) } : next);
    if (!append) {
      setSelectedId((current) => {
        const target = preferredId || current;
        return target && next.items.some((item) => item.id === target) ? target : next.items[0]?.id || null;
      });
    }
  }

  async function hydrateDeepLinkedAsset(targetId: string) {
    setSelectedId(targetId);
    if (payload.items.some((item) => item.id === targetId)) return;
    try {
      const asset = await api<ProjectFile>(`/api/project-files/${targetId}`);
      if (asset.projectId !== project.id) return;
      setPayload((current) => ({ ...current, items: uniqueAssets([asset, ...current.items]) }));
    } catch { /* permission and missing-state handling stay server authoritative */ }
  }

  useEffect(() => { void loadAssets().catch((error) => setMessage(error instanceof Error ? error.message : "Assets failed to load.")); }, [project.id, deferredQuery, collection, role, statusFilter, duplicatesOnly, includeArchived]);
  useEffect(() => {
    const syncDeepLink = (event?: Event) => {
      let targetId = "";
      if (event instanceof CustomEvent) {
        const detail = (event as CustomEvent<{ scope?: string; id?: string | null }>).detail;
        if (detail?.scope === "project-asset") targetId = String(detail.id || "");
      }
      if (!targetId && typeof window !== "undefined") {
        const inspect = new URL(window.location.href).searchParams.get("inspect") || "";
        if (inspect.startsWith("project-asset:")) targetId = inspect.slice("project-asset:".length);
      }
      if (targetId) void hydrateDeepLinkedAsset(targetId);
    };
    syncDeepLink();
    window.addEventListener("cluster:inspector-state-changed", syncDeepLink);
    window.addEventListener("popstate", syncDeepLink);
    return () => {
      window.removeEventListener("cluster:inspector-state-changed", syncDeepLink);
      window.removeEventListener("popstate", syncDeepLink);
    };
  }, [project.id]);
  useEffect(() => { const unsubscribe = onNativeFilesystemDrop((event) => { void queueNativeHandles(event.items, "drop"); }); return () => { unsubscribe(); }; }, [project.id, canContribute, uploadAsVersion, selectedId, selected?.revision, uploadCollection, uploadRole]);

  useEffect(() => {
    setVerifyResult(null);
    setCompareId("");
    if (!selected) { setLineage(null); return; }
    setDraft({ title: selected.title, description: selected.description || "", category: selected.category || "shared", assetRole: selected.assetRole || "source", status: selected.status || "active", tags: (selected.tags || []).join(", "), parentId: selected.derivedFromId || selected.proxyOfId || selected.exportOfId || "" });
    void api<AssetLineageResponse>(`/api/project-files/${selected.id}/lineage`).then(setLineage).catch(() => setLineage(null));
  }, [selectedId, selected?.revision]);

  async function refresh(preferredId?: string | null) { await Promise.all([loadAssets(preferredId), onReloadMedia()]); }
  async function loadMore() {
    if (!payload.nextCursor || loadingMore) return;
    setLoadingMore(true);
    try { await loadAssets(selectedId, true, payload.nextCursor); }
    catch (error) { setMessage(error instanceof Error ? error.message : "More assets could not be loaded."); }
    finally { setLoadingMore(false); }
  }

  async function uploadBrowserFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file || !canContribute) return;
    setBusy(true); setMessage(`Uploading ${file.name}…`);
    try {
      const result = await uploadApi<ProjectFile>(`/api/projects/${project.id}/files`, {
        file,
        label: `Upload asset ${file.name}`,
        body: {
          title: uploadAsVersion && selected ? selected.title : file.name.replace(/\.[^.]+$/, ""), originalName: file.name, mimeType: file.type || "application/octet-stream", sizeBytes: file.size,
          category: uploadAsVersion && selected ? selected.category : uploadCollection, assetRole: uploadAsVersion && selected ? selected.assetRole || uploadRole : uploadRole,
          status: uploadAsVersion ? "review" : "active", tags: uploadAsVersion && selected ? selected.tags || [] : [], versionGroupId: uploadAsVersion && selected ? versionFamily(selected) : null,
          derivedFromId: uploadAsVersion && selected ? selected.id : null, duplicatePolicy: "reuse",
        },
        invalidate: [`/api/projects/${project.id}/media`, `/api/projects/${project.id}/assets`],
      });
      if (result.queued) setMessage(`${file.name} is queued for upload when the connection returns.`);
      else setMessage(result.result && (result.result as any).duplicateReused ? "Exact duplicate reused instead of storing another copy." : `${file.name} uploaded.`);
      await refresh(result.result?.id || selected?.id || null);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Asset upload failed."); }
    finally { setBusy(false); }
  }

  async function queueNativeHandles(handles: readonly ClusterNativeLocalHandle[], source: "picker" | "drop") {
    const files = handles.filter((handle) => handle.kind === "file").slice(0, 16);
    if (!files.length) { if (source === "picker") setMessage(""); return; }
    if (!canContribute) { setMessage("You do not have permission to add dropped files to this project."); return; }
    setBusy(true);
    setMessage(source === "drop" ? `Validating ${files.length} dropped file${files.length === 1 ? "" : "s"} through the Desktop transfer pipeline…` : "Adding files to the resumable Desktop queue…");
    try {
      for (const handle of files) {
        await uploadNativeProjectFile(handle.handle, {
          projectId: project.id, title: uploadAsVersion && selected ? selected.title : handle.name.replace(/\.[^.]+$/, ""), originalName: handle.name, mimeType: handle.mimeType || "application/octet-stream",
          category: uploadAsVersion && selected ? selected.category : uploadCollection, assetRole: uploadAsVersion && selected ? selected.assetRole || uploadRole : uploadRole,
          status: uploadAsVersion ? "review" : "active", tags: uploadAsVersion && selected ? selected.tags || [] : [], versionGroupId: uploadAsVersion && selected ? versionFamily(selected) : null,
          derivedFromId: uploadAsVersion && selected ? selected.id : null,
        });
      }
      setMessage(`${files.length} file${files.length === 1 ? "" : "s"} added to the resumable Desktop transfer queue. Native paths remain opaque; the server still performs the normal verified upload/finalization checks.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Native resumable upload is unavailable."); }
    finally { setBusy(false); }
  }


  async function captureDesktop(mode: "screen" | "window") {
    if (!canContribute) return;
    setBusy(true);
    setMessage(mode === "window" ? "Capturing the active Cluster window…" : "Capturing the current screen…");
    try {
      const capture = await captureNativeScreen({ mode });
      await queueNativeHandles([capture], "picker");
      setMessage(`${mode === "window" ? "Window" : "Screen"} capture added to the resumable Desktop upload queue.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Desktop capture failed.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadDesktopResumable() {
    if (!canContribute) return;
    setBusy(true); setMessage("Choose files for the resumable Desktop queue…");
    try {
      const handles = await pickNativeFiles({ title: "Add project assets", multiple: true });
      setBusy(false);
      await queueNativeHandles(handles, "picker");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Native resumable upload is unavailable."); setBusy(false); }
  }

  async function saveSelected() {
    if (!selected || !canContribute) return;
    setBusy(true);
    try {
      const roleValue = draft.assetRole as (typeof ASSET_ROLES)[number];
      const lineageField = roleValue === "proxy" ? "proxyOfId" : roleValue === "export" || roleValue === "deliverable" ? "exportOfId" : roleValue === "derived" ? "derivedFromId" : null;
      const body: Record<string, unknown> = {
        title: draft.title.trim(), description: draft.description.trim() || null, category: draft.category.trim() || "shared", assetRole: roleValue,
        status: draft.status, tags: draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean), expectedRevision: Number(selected.revision || 1),
      };
      body.derivedFromId = lineageField === "derivedFromId" ? draft.parentId || null : null;
      body.proxyOfId = lineageField === "proxyOfId" ? draft.parentId || null : null;
      body.exportOfId = lineageField === "exportOfId" ? draft.parentId || null : null;
      const updated = await api<ProjectFile>(`/api/project-files/${selected.id}`, { method: "PATCH", body: JSON.stringify(body) });
      setMessage("Asset metadata saved.");
      await refresh(updated.id);
    } catch (error) {
      const text = error instanceof Error ? error.message : "Asset could not be saved.";
      if (/changed|revision|locked/i.test(text)) await refresh(selected.id).catch(() => undefined);
      setMessage(/changed|revision/i.test(text) ? `${text} The latest asset state has been reloaded.` : text);
    } finally { setBusy(false); }
  }

  async function changeLock(action: "acquire" | "release" | "refresh") {
    if (!selected || !canContribute) return;
    setBusy(true);
    try {
      const updated = await api<ProjectFile>(`/api/project-files/${selected.id}/lock`, { method: "POST", body: JSON.stringify({ action, ttlMinutes: 30 }) });
      setMessage(action === "release" ? "Asset lock released." : action === "refresh" ? "Asset lock refreshed for 30 minutes." : "Asset locked for 30 minutes.");
      await refresh(updated.id);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Asset lock could not be changed."); }
    finally { setBusy(false); }
  }

  async function setArchived(archived: boolean) {
    if (!selected || !canManage) return;
    if (archived && !await confirmCluster({ title: "Archive asset?", message: "The file remains stored and recoverable, but leaves normal project asset views.", confirmLabel: "Archive", tone: "danger" })) return;
    setBusy(true);
    try {
      const updated = await api<ProjectFile>(`/api/project-files/${selected.id}`, { method: "PATCH", body: JSON.stringify({ archived, expectedRevision: Number(selected.revision || 1) }) });
      setLastArchivedAsset(archived ? { id: updated.id, title: updated.title, revision: Number(updated.revision || Number(selected.revision || 1) + 1) } : null);
      setMessage(archived ? "Asset archived." : "Asset restored.");
      await refresh(archived ? null : updated.id);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Asset archive state could not be changed."); }
    finally { setBusy(false); }
  }

  async function undoArchive() {
    if (!lastArchivedAsset || busy) return;
    const archived = lastArchivedAsset;
    setBusy(true);
    try {
      const restored = await api<ProjectFile>(`/api/project-files/${archived.id}`, { method: "PATCH", body: JSON.stringify({ archived: false, expectedRevision: archived.revision }) });
      setLastArchivedAsset(null);
      setIncludeArchived(true);
      setMessage(`${archived.title} restored.`);
      await refresh(restored.id);
    } catch (error) {
      setLastArchivedAsset(null);
      setMessage(error instanceof Error ? `Could not restore archived asset: ${error.message}` : "Could not restore archived asset.");
      await refresh(null).catch(() => undefined);
    } finally { setBusy(false); }
  }

  async function verifySelected(repairMissingChecksum = false) {
    if (!selected) return;
    setBusy(true); setMessage("Verifying stored file…");
    try {
      const result = await api<AssetVerifyResponse>(`/api/project-files/${selected.id}/verify`, { method: "POST", body: JSON.stringify({ repairMissingChecksum, expectedRevision: Number(selected.revision || 1) }) });
      setVerifyResult(result);
      setMessage(result.ok ? (result.repaired ? "File verified and missing checksum metadata repaired." : "Stored file verified.") : result.exists ? "Stored file integrity check found a mismatch." : "Stored file is missing.");
      if (result.repaired) await refresh(selected.id);
    } catch (error) { setMessage(error instanceof Error ? error.message : "File verification failed."); }
    finally { setBusy(false); }
  }

  async function runIntegrityCheck() {
    if (!canManage) return;
    setBusy(true); setMessage("Checking project asset storage…");
    try {
      const result = await api<AssetIntegrityResponse>(`/api/projects/${project.id}/assets/integrity`);
      setIntegrity(result);
      setMessage(result.ok && !result.staleLockIds.length && !result.orphanCount ? "Asset storage integrity is clean." : "Asset storage check found items that need review.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Asset integrity check failed."); }
    finally { setBusy(false); }
  }

  async function repairIntegrity(action: "release-stale-locks" | "archive-missing-records") {
    if (!canManage) return;
    if (action === "archive-missing-records" && !await confirmCluster({ title: "Archive missing asset records?", message: "Database records whose stored files are missing will be moved into the recoverable archive view. No disk files are deleted.", confirmLabel: "Archive missing", tone: "danger" })) return;
    setBusy(true);
    try {
      const result = await api<{ changed: number; after: AssetIntegrityResponse }>(`/api/projects/${project.id}/assets/integrity/repair`, { method: "POST", body: JSON.stringify({ action }) });
      setIntegrity(result.after); setMessage(`${result.changed} asset record${result.changed === 1 ? "" : "s"} repaired.`); await refresh(selectedId);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Asset integrity repair failed."); }
    finally { setBusy(false); }
  }

  const fileUrl = selected ? assetFileUrl(selected) : "";
  const lockedByOther = Boolean(selected?.lock && selected.lock.ownerId !== currentUser.id && !currentUser.isAdmin);

  return <section className="project-subpage-v312 project-assets-v495">
    <ProjectSectionHeader eyebrow="Project assets" title="Files & asset management" description="Versioned, searchable project files with server-assigned versions, duplicate detection, lineage, integrity checks, recoverable archives, safe previews, and resumable Desktop ingest." metrics={[
      { label: "Assets", value: payload.summary.total }, { label: "Storage", value: bytesToSize(payload.summary.bytes) }, { label: "Collections", value: payload.collections.length },
      { label: "Duplicates", value: payload.summary.duplicates, tone: payload.summary.duplicates ? "warning" : "neutral" }, { label: "Locked", value: payload.summary.locked, tone: payload.summary.locked ? "warning" : "neutral" },
    ]} actions={<div className="project-asset-actions-v495"><ClusterFileButton label={uploadAsVersion && selected ? "Upload next version" : "Upload file"} size="compact" variant="secondary" disabled={!canContribute || busy} onChange={uploadBrowserFile} /><ClusterButton size="compact" variant="quiet" disabled={!canContribute || busy} onClick={() => void uploadDesktopResumable()}>Desktop resumable</ClusterButton><ClusterButton size="compact" variant="quiet" disabled={!canContribute || busy} onClick={() => void captureDesktop("screen")}>Capture screen</ClusterButton><ClusterButton size="compact" variant="quiet" disabled={!canContribute || busy} onClick={() => void captureDesktop("window")}>Capture window</ClusterButton>{canManage ? <ClusterButton size="compact" variant="quiet" disabled={busy} onClick={() => void runIntegrityCheck()}>Check storage</ClusterButton> : null}</div>} />
    {message ? <ProjectSectionStatus tone={/failed|error|unavailable|locked|missing|mismatch|review/i.test(message) ? "danger" : "good"}>{message}</ProjectSectionStatus> : null}
    {lastArchivedAsset ? <ClusterRecoveryNotice message={`${lastArchivedAsset.title} archived.`} onAction={undoArchive} onDismiss={() => setLastArchivedAsset(null)} /> : null}

    <div className="project-asset-toolbar-v495">
      <ClusterTextInput type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title, file name, tags…" aria-label="Search project assets" />
      <ClusterNativeSelect value={collection} onChange={(event) => setCollection(event.target.value)} aria-label="Asset collection"><option value="all">All collections</option>{payload.collections.map((item) => <option key={item.id} value={item.id}>{item.label} ({item.count})</option>)}</ClusterNativeSelect>
      <ClusterNativeSelect value={role} onChange={(event) => setRole(event.target.value)} aria-label="Asset role"><option value="all">All roles</option>{ASSET_ROLES.map((item) => <option key={item} value={item}>{labelize(item)}</option>)}</ClusterNativeSelect>
      <ClusterNativeSelect value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Asset status"><option value="all">All statuses</option>{ASSET_STATUSES.map((item) => <option key={item} value={item}>{labelize(item)}</option>)}</ClusterNativeSelect>
      <label><ClusterInput type="checkbox" checked={duplicatesOnly} onChange={(event) => setDuplicatesOnly(event.target.checked)} /> Duplicates</label>
      <label><ClusterInput type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} /> Archived</label>
    </div>

    <div className="project-asset-upload-config-v495">
      <label>New uploads <ClusterTextInput value={uploadCollection} onChange={(event) => setUploadCollection(event.target.value)} placeholder="Collection" /></label>
      <label>Role <ClusterNativeSelect value={uploadRole} onChange={(event) => setUploadRole(event.target.value as typeof uploadRole)}>{ASSET_ROLES.map((item) => <option key={item} value={item}>{labelize(item)}</option>)}</ClusterNativeSelect></label>
      <label><ClusterInput type="checkbox" checked={uploadAsVersion} disabled={!selected} onChange={(event) => setUploadAsVersion(event.target.checked)} /> Upload as next version{selected ? ` of ${selected.title}` : ""}</label>
    </div>

    {integrity ? <section className={`project-asset-integrity-v495 ${integrity.ok ? "good" : "warning"}`} aria-label="Asset storage integrity">
      <div><strong>{!integrity.complete ? "Storage check incomplete" : integrity.ok ? "Storage records verified" : "Storage needs review"}</strong><small>{integrity.scanned.toLocaleString()} records · {bytesToSize(integrity.activeBytes)} active · {bytesToSize(integrity.archivedBytes)} archived{integrity.truncated ? " · scan capped" : ""}{integrity.inventoryFailed ? " · inventory unavailable" : ""}{integrity.unavailable.length ? ` · ${integrity.unavailable.length} unverified records` : ""}</small></div>
      <div className="project-asset-integrity-stats-v495"><span>Missing <b>{integrity.missing.length}</b></span><span>Unverified <b>{integrity.unavailable.length}</b></span><span>Size mismatch <b>{integrity.sizeMismatch.length}</b></span><span>Dangling lineage <b>{integrity.danglingLineageIds.length}</b></span><span>Stale locks <b>{integrity.staleLockIds.length}</b></span><span>Orphans <b>{integrity.orphanCount}</b></span></div>
      <div className="project-asset-integrity-actions-v495">{integrity.complete && integrity.staleLockIds.length ? <ClusterButton size="compact" variant="quiet" disabled={busy} onClick={() => void repairIntegrity("release-stale-locks")}>Release stale locks</ClusterButton> : null}{integrity.complete && integrity.missing.length ? <ClusterButton size="compact" variant="quiet" disabled={busy} onClick={() => void repairIntegrity("archive-missing-records")}>Archive missing records</ClusterButton> : null}<ClusterButton size="compact" variant="quiet" disabled={busy} onClick={() => setIntegrity(null)}>Hide</ClusterButton></div>
    </section> : null}

    <ClusterResizableSplit className="project-asset-layout-v495" label="asset list" persistKey="project-assets-list" side="start" minWidth={220} maxWidth={420} defaultWidth={280}>
      <ClusterResizableSplit className="project-asset-review-split-v498" label="asset metadata inspector" persistKey="project-assets-inspector" side="end" minWidth={280} maxWidth={520} defaultWidth={340}>
        <div className={`project-asset-preview-v495 ${compareAsset ? "comparing" : ""}`}>
        {selected ? <>
          <header><div><span>{labelize(selected.assetRole || "source")} · {selected.category}</span><h3>{selected.title}</h3><small>{selected.originalName} · {bytesToSize(selected.sizeBytes)}</small></div><a href={fileUrl} target="_blank" rel="noreferrer">Download</a></header>
          {compareAsset && previewKind(selected) === previewKind(compareAsset) && ["image", "pdf", "video", "audio", "model"].includes(previewKind(selected)) ? <AssetPreview asset={selected} compareAsset={compareAsset} userId={currentUser.id} title={<><strong>{selected.versionLabel || `v${selected.versionNumber || 1}`} vs {compareAsset.versionLabel || `v${compareAsset.versionNumber || 1}`}</strong><span>Unified comparison session</span></>} /> : compareAsset ? <div className="project-asset-compare-grid-v495"><AssetPreview asset={selected} userId={currentUser.id} title={<><strong>{selected.versionLabel || `v${selected.versionNumber || 1}`}</strong><span>Current selection</span></>} /><AssetPreview asset={compareAsset} userId={currentUser.id} title={<><strong>{compareAsset.versionLabel || `v${compareAsset.versionNumber || 1}`}</strong><span>{bytesToSize(compareAsset.sizeBytes)}</span></>} /></div> : <AssetPreview asset={selected} userId={currentUser.id} />}
          <div className="project-asset-facts-v495"><span><b>Checksum</b>{selected.checksumSha256 ? `${selected.checksumSha256.slice(0, 12)}…` : "Pending checksum"}</span><span><b>Version family</b>{versionFamily(selected).slice(0, 12)}</span><span><b>Revision</b>{selected.revision || 1}</span><span><b>Updated</b>{formatRelativeTime(selected.updatedAt)}</span></div>
        </> : <ClusterEmptyState compact kind="first-use" title="Select an asset" description="Choose an asset from the list to preview its content, metadata, versions, and linked work." />}
      </div>
        <aside className="project-asset-inspector-v495">
        {selected ? <>
          <div className="project-asset-lock-v495"><strong>{selected.lock ? `Locked by ${selected.lock.ownerName || (selected.lock.ownerId === currentUser.id ? "you" : "another user")}` : "Unlocked"}</strong><small>{selected.lock?.expiresAt ? `Expires ${formatRelativeTime(selected.lock.expiresAt)}` : "Locks prevent concurrent metadata edits and expire automatically."}</small><div>{selected.lock?.ownerId === currentUser.id ? <><ClusterButton size="compact" variant="quiet" disabled={busy} onClick={() => void changeLock("refresh")}>Refresh 30m</ClusterButton><ClusterButton size="compact" variant="quiet" disabled={busy} onClick={() => void changeLock("release")}>Unlock</ClusterButton></> : currentUser.isAdmin && selected.lock ? <ClusterButton size="compact" variant="quiet" disabled={busy} onClick={() => void api<ProjectFile>(`/api/project-files/${selected.id}/lock`, { method: "POST", body: JSON.stringify({ action: "release", force: true }) }).then(() => refresh(selected.id))}>Force unlock</ClusterButton> : <ClusterButton size="compact" variant="quiet" disabled={busy || lockedByOther} onClick={() => void changeLock("acquire")}>Lock 30m</ClusterButton>}</div></div>
          <fieldset disabled={!canContribute || busy || lockedByOther}><label>Title<ClusterTextInput value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} /></label><label>Description<ClusterTextArea value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} /></label><label>Collection<ClusterTextInput value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value }))} /></label><label>Role<ClusterNativeSelect value={draft.assetRole} onChange={(event) => setDraft((current) => ({ ...current, assetRole: event.target.value, parentId: "" }))}>{ASSET_ROLES.map((item) => <option key={item} value={item}>{labelize(item)}</option>)}</ClusterNativeSelect></label><label>Status<ClusterNativeSelect value={draft.status} onChange={(event) => setDraft((current) => ({ ...current, status: event.target.value }))}>{ASSET_STATUSES.map((item) => <option key={item} value={item}>{labelize(item)}</option>)}</ClusterNativeSelect></label><label>Tags<ClusterTextInput value={draft.tags} onChange={(event) => setDraft((current) => ({ ...current, tags: event.target.value }))} placeholder="client, texture, final" /></label>{["derived", "proxy", "export", "deliverable"].includes(draft.assetRole) ? <label>Source asset<ClusterNativeSelect value={draft.parentId} onChange={(event) => setDraft((current) => ({ ...current, parentId: event.target.value }))}><option value="">No source link</option>{payload.items.filter((item) => item.id !== selected.id).map((item) => <option key={item.id} value={item.id}>{item.title} · {item.versionLabel || `v${item.versionNumber || 1}`}</option>)}</ClusterNativeSelect></label> : null}<ClusterButton size="compact" variant="secondary" disabled={!draft.title.trim()} onClick={() => void saveSelected()}>Save metadata</ClusterButton></fieldset>
          <section><header><strong>Version lineage</strong><span>{familyItems.length || 1}</span></header><label className="project-asset-compare-select-v495">Compare with<ClusterNativeSelect value={compareId} onChange={(event) => setCompareId(event.target.value)}><option value="">No comparison</option>{orderedFamilyItems.filter((item) => item.id !== selected.id).map((item) => <option key={item.id} value={item.id}>{item.versionLabel || `v${item.versionNumber || 1}`} · {item.title}</option>)}</ClusterNativeSelect></label><div className="button-row"><ClusterButton size="compact" variant="quiet" disabled={!previousFamilyVersion} onClick={() => previousFamilyVersion && setCompareId(previousFamilyVersion.id)}>Compare previous</ClusterButton><ClusterButton size="compact" variant="quiet" disabled={!nextFamilyVersion} onClick={() => nextFamilyVersion && setCompareId(nextFamilyVersion.id)}>Compare next</ClusterButton><ClusterButton size="compact" variant="quiet" disabled={!compareId} onClick={() => setCompareId("")}>Clear compare</ClusterButton></div><div className="project-asset-lineage-v495">{familyItems.map((item) => <ClusterButton unstyled type="button" key={item.id} className={item.id === selected.id ? "selected" : ""} onClick={() => void selectAssetSafely(item.id)}><span>{item.versionLabel || `v${item.versionNumber || 1}`}</span><strong>{item.title}</strong><small>{labelize(item.status)} · {formatRelativeTime(item.updatedAt)}</small></ClusterButton>)}</div>{lineage?.relationships.length ? <small>{lineage.relationships.map((item) => labelize(item.relationship)).join(" · ")}</small> : null}</section>
          <section><header><strong>File integrity</strong>{verifyResult ? <span>{verifyResult.ok ? "OK" : "!"}</span> : null}</header>{verifyResult ? <small>{verifyResult.exists ? `${verifyResult.sizeMatches ? "Size OK" : "Size mismatch"} · ${verifyResult.checksumMatches ? "Checksum OK" : "Checksum mismatch"}` : "Stored file missing"}</small> : <small>Verify the stored bytes against the database checksum and expected size.</small>}<div className="project-asset-integrity-actions-v495"><ClusterButton size="compact" variant="quiet" disabled={busy} onClick={() => void verifySelected(false)}>Verify file</ClusterButton>{canManage && !selected.checksumSha256 ? <ClusterButton size="compact" variant="quiet" disabled={busy} onClick={() => void verifySelected(true)}>Repair checksum</ClusterButton> : null}</div></section>
          <section><header><strong>Workflow context</strong></header><WorkActionMenu context={{ source: { kind: "file", id: selected.id, projectId: project.id, label: selected.title }, navigation: { screen: "project", projectId: project.id, projectTab: "assets", inspectScope: "project-asset", inspectId: selected.id }, projectId: project.id }} label={`${selected.title} work actions`} /><LinkedWorkPanel projectId={project.id} kind="file" entityId={selected.id} compact /></section>
          {canManage ? <div className="project-asset-danger-v495"><ClusterButton size="compact" variant="quiet" disabled={busy} onClick={() => void setArchived(!Boolean(selected.archived))}>{selected.archived ? "Restore asset" : "Archive asset"}</ClusterButton></div> : null}
        </> : null}
      </aside>
      </ClusterResizableSplit>
      <div className="project-asset-list-v495" role="listbox" aria-label="Project assets">
        {payload.items.length ? payload.items.map((asset) => <ClusterButton unstyled key={asset.id} type="button" role="option" data-asset-id={asset.id} tabIndex={asset.id === selectedId ? 0 : -1} aria-selected={asset.id === selectedId} className={asset.id === selectedId ? "selected" : ""} onKeyDown={(event) => void handleAssetOptionKeyDown(event, asset.id)} onClick={() => void selectAssetSafely(asset.id)}>
          <span><strong>{asset.title}</strong><small>{asset.originalName}</small></span>
          <span className="project-asset-badges-v495"><em>{asset.versionLabel || `v${asset.versionNumber || 1}`}</em><em>{labelize(asset.assetRole || "source")}</em>{asset.duplicateOfId ? <em className="warning">duplicate</em> : null}{asset.lock ? <em className="warning">locked</em> : null}{asset.archived ? <em>archived</em> : null}</span>
          <small>{asset.category || "shared"} · {bytesToSize(asset.sizeBytes)} · {formatRelativeTime(asset.updatedAt)}</small>
        </ClusterButton>) : <ClusterEmptyState compact kind="filtered" title="No assets match" description="Adjust the asset search, collection, status, or archive filters." />}
        {payload.hasMore ? <div className="project-asset-load-more-v495"><ClusterButton size="compact" variant="quiet" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Loading…" : `Load more (${payload.items.length.toLocaleString()} shown)`}</ClusterButton></div> : null}
      </div>
    </ClusterResizableSplit>
  </section>;
}
