import { ClusterDisclosureGroup } from "../../components/ClusterDisclosureGroup";
import { downloadAuthenticatedClusterFile } from "../../core/browser-download-transfers";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { confirmCluster, promptCluster } from "../../components/cluster-dialog-service";
import { ClusterTextArea } from "../../components/ClusterTextArea";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type DragEvent, type ReactNode } from "react";
import { ApiError, api, mutateApi, queryApi, setApiQueryData, uploadApi } from "../../core/api";
import { useServerState } from "../../core/server-state";
import { useResourceChangeRefresh } from "../../core/use-resource-change-refresh";
import { LibraryIcon, folderIconName, itemIconName } from "./LibraryIcons";
import { LibraryAuthenticatedImage, LibraryModelThumbnail, LibraryPreview, LibraryTextPreview, LibraryVideoThumbnail, LibraryViewerModal } from "./LibraryMediaPreview";
import { libraryFileUrl } from "./library-file-url";
import { LibraryAudioArtwork } from "./LibraryAudioArtwork";
import { LibraryGovernanceBulkModal } from "./LibraryGovernanceBulkModal";
import { ClusterSelect } from "../../components/ClusterSelect";
import { ClusterSegmentedControl } from "../../components/ClusterSegmentedControl";
import { ClusterButton, ClusterIconButton, ClusterLinkButton } from "../../components/ClusterButton";
import { ClusterIcon } from "../../components/ClusterIcon";
import { ClusterModal } from "../../components/ClusterModal";
import { ClusterActionMenu, ClusterBulkActionBar } from "../../components/ClusterContextActions";
import { ClusterEmptyState } from "../../components/ClusterEmptyState";
import { SavedViewsToolbar } from "../../components/SavedViewsToolbar";
import { ColorField } from "../../components/ColorField";
import { ToolPageHeader } from "../../components/ToolPageHeader";
import { ClusterMasterDetail, useClusterDetailHistory } from "../../components/ClusterMasterDetail";
import { ClusterResizableRail } from "../../components/ClusterResizableRail";
import type { InspectorTab, LayoutMode, LibraryCollection, LibraryDerivativesPayload, LibraryFilters, LibraryGroupMode, LibraryItem, LibraryMetadata, LibraryOperation, LibraryReviewPayload, LibrarySearchScope, LibraryTransferFinalizeResponse, LibraryTransferOperationResponse, LibraryWorkspace, Project, User } from "./library-types";
import { mergeLibraryItems } from "./library-workspace-state";
import { describeLibraryBulkImpact, captureLibraryBulkRevisions, MAX_LIBRARY_BULK_IDS, type LibraryBulkScopePreview } from "./library-bulk-impact";
import { copyClusterText } from "../../core/clipboard";
import { EMPTY_FACETS } from "./library-types";
import "./library-workspace.css";
import { runtimeStyle } from "../../core/runtime-style";
import { CardGridLoadingState, TableLoadingState } from "../../components/LoadingState";
import { ClusterStatus } from "../../components/ClusterStatus";
import { RequestErrorState } from "../../components/RequestState";
import { readClusterWorkProjectContext, recoverClusterDetailNavigation } from "../workflow/work-navigation";
import { LinkedWorkPanel } from "../workflow/LinkedWorkPanel";
import { WorkActionMenu } from "../workflow/WorkActionMenu";
import { ProjectCollaborationStrip } from "../collaboration";
import { CollaborationPanel } from "../../components/CollaborationPanel";
import { LibraryGovernancePanel } from "./LibraryGovernancePanel";
import { LibraryUploadRecoveryPanel } from "./LibraryUploadRecoveryPanel";
import { LibraryResourceReferencesPanel } from "./LibraryResourceReferencesPanel";

import { ClusterInput } from "../../components/ClusterNativeControls";

const PAGE_SIZE = 80;
const FOLDER_COLORS = ["#7aa8ff", "#67d7b0", "#e7b45c", "#d18cff", "#ff8585", "#69c7e8", "#a7b0c2"];
const FOLDER_ICONS = ["folder", "game", "image", "video", "model", "code", "note", "archive", "star", "palette"] as const;
const FOLDER_ICON_LABELS: Record<(typeof FOLDER_ICONS)[number], string> = { folder: "Folder", game: "Game", image: "Images", video: "Video", model: "Models", code: "Code", note: "Notes", archive: "Archive", star: "Favorite", palette: "Creative" };

type LibraryCollectionGrant = { userId: string; role: "viewer" | "editor"; user: { id: string; username: string; displayName?: string | null; archived?: boolean } };
type LibraryBulkRenameMode = "replace" | "prefix" | "suffix" | "number";
type LibraryBulkRenameRule = { mode: LibraryBulkRenameMode; text: string; replacement: string; start: number; padding: number };
type LibraryBulkRenamePreview = { ok: true; renames: Array<{ id: string; from: string; to: string; revision: number }>; changedCount: number };
type CreateDraft = { kind: "folder" | "link" | "youtube-video" | "youtube-playlist"; title: string; body: string; externalUrl: string; folderColor: string; folderIcon: string; parentId?: string | null };
type FolderAccess = "none" | "view" | "contribute" | "edit" | "manage";
type LibrarySection = "folder" | "recent" | "favorites" | "shared" | "created" | "generated" | "trash" | "collection";
type FolderPermissionPayload = { ok: boolean; folderId: string; users: User[]; permissions: Array<{ userId: string; access: FolderAccess }> };
type LibraryAccessExplanation = { allowed: boolean; required: FolderAccess | "view"; effectiveAccess: FolderAccess | "none"; reasonCode: string; contributors: Array<{ kind: string; id?: string | null; access?: string | null; inherited?: boolean; detail: string }> };
type LibraryAccessExplanationPayload = { ok: boolean; itemId: string; currentUser: LibraryAccessExplanation; roster: Array<{ user: User; explanation: LibraryAccessExplanation }> | null };
type LibraryVersionRow = { id: string; versionNumber: number; actorId?: string | null; note?: string | null; title: string; originalName?: string | null; mimeType?: string | null; sizeBytes?: number | null; checksumSha256?: string | null; createdAt: string; downloadUrl?: string | null };
type LibraryVersionsPayload = { ok: boolean; itemId: string; versions: LibraryVersionRow[] };
type LibraryUploadState = { active: boolean; current: number; total: number; name: string; percent: number; message: string; uploadId: string | null; operationId: string | null };

function formatBytes(value?: number | null) {
  const bytes = Number(value || 0);
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / (1024 ** index)).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined, hour: "numeric", minute: "2-digit" }).format(date);
}

function userName(user?: User | null) { return user?.displayName || user?.username || "Unassigned"; }
function metadataToText(metadata?: LibraryMetadata) { return JSON.stringify(metadata || {}, null, 2); }
function parseMetadataText(value: string) {
  const parsed = value.trim() ? JSON.parse(value) : {};
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Custom metadata must be a JSON object.");
  return parsed as LibraryMetadata;
}
const MODEL_FILE_EXTENSIONS = new Set(["obj", "stl", "ply", "gltf", "glb", "fbx", "dae", "3ds", "blend"]);
const MODEL_COMPANION_EXTENSIONS = new Set(["mtl", "png", "jpg", "jpeg", "webp", "avif", "bmp", "gif", "bin", "tga", "dds", "hdr", "exr"]);
function fileExtension(name: string) { return name.split(".").pop()?.trim().toLowerCase() || ""; }
function fileBundleName(file: File) { return file.webkitRelativePath || file.name; }
function folderStyle(item: LibraryItem): CSSProperties { return { "--library-folder-color": item.folderColor || "#7aa8ff" } as CSSProperties; }
function isProtectedLibraryFolder(item?: LibraryItem | null) { return Boolean(item?.type === "folder" && ["packets-root", "project-folder"].includes(String(item.source || ""))); }

function FolderAppearancePicker({ color, icon, onColor, onIcon, compact = false }: { color: string; icon: string; onColor: (value: string) => void; onIcon: (value: string) => void; compact?: boolean }) {
  return <div className={`library-folder-style-v217 library-folder-style-v224${compact ? " compact" : ""}`}>
    <ColorField value={color} onChange={onColor} label="Folder color" swatches={FOLDER_COLORS} />
    <fieldset className="library-folder-icon-field-v227"><legend>Folder icon</legend><div className="library-folder-icons-v224">
      {FOLDER_ICONS.map((value) => <ClusterButton unstyled type="button" key={value} className={icon === value ? "active" : ""} onClick={() => onIcon(value)} aria-label={`Use ${FOLDER_ICON_LABELS[value]} folder icon`}><LibraryIcon name={value} size={18} /><small>{FOLDER_ICON_LABELS[value]}</small></ClusterButton>)}
    </div></fieldset>
  </div>;
}

function FolderTree({ folders, files, activeId, showFiles, onShowFiles, onOpenFolder, onOpenItem, onCreateFolder, onManagePermissions }: {
  folders: LibraryItem[];
  files: LibraryItem[];
  activeId: string | null;
  showFiles: boolean;
  onShowFiles: (value: boolean) => void;
  onOpenFolder: (id: string | null) => void;
  onOpenItem: (item: LibraryItem) => void;
  onCreateFolder: (parentId: string | null) => void;
  onManagePermissions: (item: LibraryItem) => void;
}) {
  const [expandedIds, setExpandedIds] = useServerState<string[]>("user", "library.explorer.expanded-folders", ["root"], { merge: (value) => Array.isArray(value) ? [...new Set(value.map(String).filter(Boolean))] : ["root"] });
  const expanded = useMemo(() => new Set(expandedIds.length ? expandedIds : ["root"]), [expandedIds]);
  const setExpanded = (update: Set<string> | ((current: Set<string>) => Set<string>)) => {
    const next = typeof update === "function" ? update(new Set(expanded)) : update;
    setExpandedIds([...next]);
  };
  const byParent = useMemo(() => {
    const map = new Map<string, LibraryItem[]>();
    for (const folder of folders) {
      const key = folder.parentId || "root";
      const list = map.get(key) || [];
      list.push(folder);
      map.set(key, list);
    }
    for (const list of map.values()) list.sort((a, b) => (Number(a.manualOrder ?? Number.MAX_SAFE_INTEGER) - Number(b.manualOrder ?? Number.MAX_SAFE_INTEGER)) || a.title.localeCompare(b.title));
    return map;
  }, [folders]);
  const filesByParent = useMemo(() => {
    const map = new Map<string, LibraryItem[]>();
    if (!showFiles) return map;
    for (const file of files) {
      const key = file.parentId || "root";
      const list = map.get(key) || [];
      list.push(file);
      map.set(key, list);
    }
    for (const list of map.values()) list.sort((a, b) => (Number(a.manualOrder ?? Number.MAX_SAFE_INTEGER) - Number(b.manualOrder ?? Number.MAX_SAFE_INTEGER)) || a.title.localeCompare(b.title));
    return map;
  }, [files, showFiles]);

  function toggle(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function renderBranch(parentId: string | null, depth: number): ReactNode {
    const key = parentId || "root";
    const childFolders = byParent.get(key) || [];
    const childFiles = filesByParent.get(key) || [];
    const open = expanded.has(key);
    if (!open) return null;
    return <>
      {childFolders.map((folder) => {
        const hasChildren = Boolean((byParent.get(folder.id) || []).length || (showFiles && (filesByParent.get(folder.id) || []).length));
        const folderOpen = expanded.has(folder.id);
        return <div key={folder.id} className="library-tree-branch-v229">
          <div className={`library-tree-row-v229${activeId === folder.id ? " active" : ""}`} style={runtimeStyle({ ...folderStyle(folder), paddingLeft: `${8 + depth * 13}px` })}>
            <ClusterButton unstyled type="button" className="library-tree-disclosure-v229" onClick={() => hasChildren && toggle(folder.id)} aria-label={`${folderOpen ? "Collapse" : "Expand"} ${folder.title}`} disabled={!hasChildren}><LibraryIcon name="chevron" size={14} className={folderOpen ? "open" : ""} /></ClusterButton>
            <ClusterButton unstyled type="button" className="library-tree-target-v229" onClick={() => { onOpenFolder(folder.id); if (hasChildren) setExpanded((current) => new Set(current).add(folder.id)); }}><LibraryIcon name={folderIconName(folder)} size={16} /><strong>{folder.title}</strong><em>{folder.childCount || 0}</em></ClusterButton>
            <ClusterActionMenu
              label={`Folder actions for ${folder.title}`}
              iconOnly
              className="library-tree-folder-actions-v14"
              items={[
                { id: "open", label: "Open folder", icon: "folder", onSelect: () => onOpenFolder(folder.id) },
                { id: "new-subfolder", label: "New subfolder", icon: "plus", onSelect: () => onCreateFolder(folder.id) },
                { id: "permissions", label: "Folder permissions", icon: "lock", onSelect: () => onManagePermissions(folder) },
              ]}
            />
          </div>
          {depth < 16 && renderBranch(folder.id, depth + 1)}
        </div>;
      })}
      {childFiles.map((file) => <ClusterButton unstyled type="button" key={file.id} className="library-tree-file-v229" style={runtimeStyle({ paddingLeft: `${32 + depth * 13}px` })} onClick={() => onOpenItem(file)} title={file.title}><LibraryIcon name={itemIconName(file)} size={14} /><span>{file.title}</span></ClusterButton>)}
    </>;
  }

  const rootHasChildren = Boolean((byParent.get("root") || []).length || (showFiles && (filesByParent.get("root") || []).length));
  const expandableFolderIds = folders.filter((folder) => Boolean((byParent.get(folder.id) || []).length || (showFiles && (filesByParent.get(folder.id) || []).length))).map((folder) => folder.id);
  const allExpanded = expandableFolderIds.every((id) => expanded.has(id)) && expanded.has("root");
  return <div className="library-tree-shell-v229">
    <div className="library-tree-toolbar-v13">
      <label className="library-tree-files-toggle-v229"><ClusterInput type="checkbox" checked={showFiles} onChange={(event) => onShowFiles(event.target.checked)} /><span>Show files in tree</span></label>
      <ClusterButton unstyled type="button" className="library-tree-expand-all-v13" onClick={() => setExpanded(allExpanded ? new Set(["root"]) : new Set(["root", ...expandableFolderIds]))}>{allExpanded ? "Collapse" : "Expand"} all</ClusterButton>
    </div>
    <nav className="library-folder-tree-v229" aria-label="Library file architecture">
      <div className={`library-tree-row-v229 root${activeId === null ? " active" : ""}`}>
        <ClusterButton unstyled type="button" className="library-tree-disclosure-v229" onClick={() => rootHasChildren && toggle("root")} disabled={!rootHasChildren} aria-label={`${expanded.has("root") ? "Collapse" : "Expand"} Library`}><LibraryIcon name="chevron" size={14} className={expanded.has("root") ? "open" : ""} /></ClusterButton>
        <ClusterButton unstyled type="button" className="library-tree-target-v229" onClick={() => onOpenFolder(null)}><LibraryIcon name="folder" size={16} /><strong>Library</strong><em>{folders.filter((item) => !item.parentId).length}</em></ClusterButton>
        <ClusterActionMenu label="Library root actions" iconOnly className="library-tree-folder-actions-v14" items={[{ id: "new-folder", label: "New folder", icon: "plus", onSelect: () => onCreateFolder(null) }]} />
      </div>
      {renderBranch(null, 0)}
    </nav>
  </div>;
}

function PinnedShelf({ items, onOpen }: { items: LibraryItem[]; onOpen: (item: LibraryItem) => void }) {
  if (!items.length) return null;
  return <section className="library-pinned-shelf-v217" aria-label="Pinned Library items">
    <div><LibraryIcon name="star" size={15} /><strong>Pinned</strong></div>
    <div>{items.map((item) => <ClusterButton unstyled key={item.id} style={item.type === "folder" ? folderStyle(item) : undefined} onClick={() => onOpen(item)}><LibraryIcon name={itemIconName(item)} size={18} /><span>{item.title}</span></ClusterButton>)}</div>
  </section>;
}

function LibraryListRows({ items, activeId, selectedIds, onSelect, onOpen, onPreview, reorderEnabled = false, onReorder }: {
  items: LibraryItem[]; activeId: string | null; selectedIds: Set<string>;
  onSelect: (item: LibraryItem, checked: boolean) => void; onOpen: (item: LibraryItem) => void; onPreview: (item: LibraryItem) => void;
  reorderEnabled?: boolean; onReorder?: (sourceId: string, targetId: string) => void;
}) {
  return <div className="library-list-rows-v10" role="rowgroup">
    {items.map((item) => <div key={item.id} className={`library-file-row-v217${activeId === item.id ? " active" : ""}${reorderEnabled ? " is-reorderable-v11" : ""}`} style={item.type === "folder" ? folderStyle(item) : undefined} role="row" aria-selected={selectedIds.has(item.id)} draggable={reorderEnabled} onDragStart={(event) => { if (!reorderEnabled) return; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-cluster-library-item", item.id); }} onDragOver={(event) => { if (reorderEnabled) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }} onDrop={(event) => { if (!reorderEnabled || !onReorder) return; event.preventDefault(); const sourceId = event.dataTransfer.getData("application/x-cluster-library-item"); if (sourceId && sourceId !== item.id) onReorder(sourceId, item.id); }}>
      <label aria-label={`Select ${item.title}`} role="cell"><ClusterInput type="checkbox" checked={selectedIds.has(item.id)} onChange={(event) => onSelect(item, event.target.checked)} /></label>
      <ClusterButton unstyled type="button" role="cell" className={`library-file-icon-v217 ${item.mimeGroup || item.type}`} onClick={() => onPreview(item)} aria-label={`${item.type === "folder" ? "Open" : "Preview"} ${item.title}`} title={item.type === "folder" ? "Open folder" : "Preview file"}><LibraryIcon name={itemIconName(item)} size={20} /></ClusterButton>
      <ClusterButton unstyled type="button" role="cell" className="library-file-name-v217" onClick={() => onOpen(item)}><strong>{item.pinned && <LibraryIcon name="star" size={13} />}{item.title}</strong><span>{item.originalName || item.snippet || item.type}</span></ClusterButton>
      <span role="cell">{item.project?.name || "Workspace"}</span><span role="cell">{item.type === "file" ? (item.extension?.toUpperCase() || item.mimeGroup || "File") : item.type}</span><span role="cell">{item.type === "folder" ? `${item.childCount || 0} items` : formatBytes(item.sizeBytes)}</span><span role="cell">{formatDate(item.updatedAt)}</span>
    </div>)}
  </div>;
}

function LibraryGridCard({ item, active, selected, onSelect, onOpen, onPreview, reorderEnabled = false, onReorder }: { item: LibraryItem; active: boolean; selected: boolean; onSelect: (checked: boolean) => void; onOpen: () => void; onPreview: () => void; reorderEnabled?: boolean; onReorder?: (sourceId: string, targetId: string) => void }) {
  const isText = item.previewKind === "text";
  return <article className={`library-grid-card-v219${active ? " active" : ""}${reorderEnabled ? " is-reorderable-v11" : ""}`} style={item.type === "folder" ? folderStyle(item) : undefined} draggable={reorderEnabled} onDragStart={(event) => { if (!reorderEnabled) return; event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-cluster-library-item", item.id); }} onDragOver={(event) => { if (reorderEnabled) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }} onDrop={(event) => { if (!reorderEnabled || !onReorder) return; event.preventDefault(); const sourceId = event.dataTransfer.getData("application/x-cluster-library-item"); if (sourceId && sourceId !== item.id) onReorder(sourceId, item.id); }}>
    <label><ClusterInput type="checkbox" checked={selected} onChange={(event) => onSelect(event.target.checked)} aria-label={`Select ${item.title}`} /></label>
    <ClusterButton unstyled type="button" className={`library-grid-preview-v219 ${item.mimeGroup || item.type}`} onClick={onPreview} aria-label={`${item.type === "folder" ? "Open" : "Preview"} ${item.title}`}>
      {(item.previewKind === "youtube-video" || item.previewKind === "youtube-playlist") && item.youtubeThumbnailUrl ? <span className="library-youtube-card-v229"><img src={item.youtubeThumbnailUrl} alt="" loading="lazy" /><span><LibraryIcon name={item.previewKind === "youtube-playlist" ? "playlist" : "youtube"} size={16} />{item.previewKind === "youtube-playlist" ? "Playlist" : "YouTube"}</span></span>
        : item.previewKind === "image" && item.fileUrl ? <LibraryAuthenticatedImage item={item} compact />
        : item.previewKind === "video" ? <LibraryVideoThumbnail item={item} />
          : item.previewKind === "model" ? <LibraryModelThumbnail item={item} />
          : item.previewKind === "audio" ? <LibraryAudioArtwork item={item} compact />
            : isText ? <LibraryTextPreview item={item} compact />
              : <LibraryIcon name={itemIconName(item)} size={item.type === "folder" ? 58 : 52} />}
    </ClusterButton>
    <ClusterButton unstyled type="button" className="library-grid-name-v217" onClick={onOpen}><strong>{item.pinned && <LibraryIcon name="star" size={13} />}{item.title}</strong><span>{item.type === "folder" ? `${item.childCount || 0} items` : `${item.extension?.toUpperCase() || item.type} · ${formatBytes(item.sizeBytes)}`}</span></ClusterButton>
  </article>;
}

function libraryGroupLabel(item: LibraryItem, mode: LibraryGroupMode) {
  if (mode === "type") return item.type === "folder" ? "Folders" : item.mimeGroup === "image" ? "Images" : item.mimeGroup === "video" ? "Video" : item.mimeGroup === "audio" ? "Audio" : item.mimeGroup === "pdf" ? "PDFs" : item.mimeGroup === "model" ? "3D models" : item.mimeGroup === "archive" ? "Archives" : item.mimeGroup === "office" ? "Documents" : item.mimeGroup === "text" ? "Text & code" : "Other";
  if (mode === "project") return item.project?.name || "Workspace";
  if (mode === "review") return String(item.reviewState || "draft").replace(/-/g, " ").replace(/^./, (value) => value.toUpperCase());
  return "Items";
}

function groupLibraryItems(items: LibraryItem[], mode: LibraryGroupMode) {
  if (mode === "none") return [{ key: "all", label: "", items }];
  const groups = new Map<string, LibraryItem[]>();
  for (const item of items) {
    const label = libraryGroupLabel(item, mode);
    const list = groups.get(label) || []; list.push(item); groups.set(label, list);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([label, entries]) => ({ key: label, label, items: entries }));
}

function LibraryFileFacts({ item }: { item: LibraryItem }) {
  return <dl className="library-preview-facts-v219">
    <div><dt>Type</dt><dd>{item.extension?.toUpperCase() || item.mimeType || item.type}</dd></div>
    <div><dt>Size</dt><dd>{formatBytes(item.sizeBytes)}</dd></div>
    <div><dt>Modified</dt><dd>{formatDate(item.fileModifiedAt || item.updatedAt)}</dd></div>
    <div><dt>Owner</dt><dd>{userName(item.owner)}</dd></div>
    <div><dt>Project</dt><dd>{item.project?.name || "Workspace"}</dd></div>
    <div><dt>Status</dt><dd>{item.lifecycleState}</dd></div>
    <div><dt>Review</dt><dd>{String(item.reviewState || "draft").replace(/-/g, " ")}</dd></div>
    <div><dt>Classification</dt><dd>{item.classification}</dd></div>
    <div><dt>Integrity</dt><dd>{item.integrityState || (item.checksumSha256 ? "verified" : "unverified")}</dd></div>
    <div><dt>Versions</dt><dd>{item.versionCount || 0}</dd></div>
    <div><dt>Backlinks</dt><dd>{item.backlinkCount || 0}</dd></div>
    {item.legalHold && <div className="full"><dt>Retention</dt><dd>Legal/administrative hold</dd></div>}
    {item.retentionUntil && <div className="full"><dt>Retain until</dt><dd>{formatDate(item.retentionUntil)}</dd></div>}
    {item.originalName && <div className="full"><dt>Original file</dt><dd>{item.originalName}</dd></div>}
    {item.checksumSha256 && <div className="full"><dt>SHA-256</dt><dd className="library-checksum-v217">{item.checksumSha256}</dd></div>}
  </dl>;
}

function LibraryInspector({ item, folders, projects, users, currentUser, tab, onTab, onSaved, onOpenFolder, onExpand, onManagePermissions, favorite, onToggleFavorite, onClose }: {
  item: LibraryItem | null; folders: LibraryItem[]; projects: Project[]; users: User[]; currentUser: User; tab: InspectorTab; onTab: (tab: InspectorTab) => void;
  onSaved: (item: LibraryItem) => void; onOpenFolder: (id: string) => void; onExpand: (item: LibraryItem) => void; onManagePermissions: (item: LibraryItem) => void;
  favorite: boolean; onToggleFavorite: (item: LibraryItem) => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState({ title: "", body: "", parentId: "", projectId: "", ownerId: "", status: "active", visibility: "internal", tags: "", externalUrl: "", metadata: "{}", folderColor: FOLDER_COLORS[0], folderIcon: "folder" });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [versions, setVersions] = useState<LibraryVersionRow[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [compareOlder, setCompareOlder] = useState("");
  const [compareNewer, setCompareNewer] = useState("current");
  const [review, setReview] = useState<LibraryReviewPayload["review"] | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [derivatives, setDerivatives] = useState<LibraryDerivativesPayload["derivatives"]>([]);
  const [derivativesLoading, setDerivativesLoading] = useState(false);
  const protectedFolder = isProtectedLibraryFolder(item);

  useEffect(() => {
    if (!item) return;
    setDraft({ title: item.title, body: item.body || "", parentId: item.parentId || "", projectId: item.projectId || "", ownerId: item.ownerId || "", status: item.status || "active", visibility: item.visibility || "internal", tags: (item.tags || []).join(", "), externalUrl: item.externalUrl || "", metadata: metadataToText(item.metadata), folderColor: item.folderColor || FOLDER_COLORS[0], folderIcon: item.folderIcon || "folder" });
    setMessage("");
  }, [item?.id, item?.updatedAt]);
  useEffect(() => {
    if (!item || tab !== "activity" || item.type !== "file") { setVersions([]); return; }
    let cancelled = false;
    setVersionsLoading(true);
    void queryApi<LibraryVersionsPayload>(`/api/library/${item.id}/versions`, { staleMs: 15_000, maxAgeMs: 5 * 60_000, tags: ["library", `library:${item.id}:versions`] })
      .then((result) => { if (!cancelled) setVersions(result.versions || []); })
      .catch(() => { if (!cancelled) setVersions([]); })
      .finally(() => { if (!cancelled) setVersionsLoading(false); });
    return () => { cancelled = true; };
  }, [item?.id, item?.updatedAt, item?.type, tab]);
  useEffect(() => {
    if (!item || item.type === "folder") { setReview(null); return; }
    let cancelled = false;
    setReviewLoading(true);
    void queryApi<LibraryReviewPayload>(`/api/library/${item.id}/review`, { staleMs: 5_000, maxAgeMs: 60_000, tags: ["library", `library:${item.id}:review`] })
      .then((result) => { if (!cancelled) setReview(result.review); })
      .catch(() => { if (!cancelled) setReview(null); })
      .finally(() => { if (!cancelled) setReviewLoading(false); });
    return () => { cancelled = true; };
  }, [item?.id, item?.updatedAt, item?.type]);
  useEffect(() => {
    if (!item || tab !== "activity" || item.type !== "file") { setDerivatives([]); return; }
    let cancelled = false;
    setDerivativesLoading(true);
    void queryApi<LibraryDerivativesPayload>(`/api/library/${item.id}/derivatives`, { staleMs: 10_000, maxAgeMs: 5 * 60_000, tags: ["library", `library:${item.id}:derivatives`] })
      .then((result) => { if (!cancelled) setDerivatives(result.derivatives || []); })
      .catch(() => { if (!cancelled) setDerivatives([]); })
      .finally(() => { if (!cancelled) setDerivativesLoading(false); });
    return () => { cancelled = true; };
  }, [item?.id, item?.updatedAt, item?.type, tab]);

  if (!item) return <aside className="library-inspector-v217 empty"><div className="library-preview-empty-v217"><LibraryIcon name="file" size={42} /><strong>Select an item</strong><p>Preview it, edit its description, or inspect technical details here.</p></div></aside>;

  const inspectedItem = item;
  const currentVersionSnapshot = { id: "current", versionNumber: (versions[0]?.versionNumber || 0) + 1,
    title: item.title, originalName: item.originalName, sizeBytes: item.sizeBytes,
    checksumSha256: item.checksumSha256, mimeType: item.mimeType };
  const comparableVersions = [currentVersionSnapshot, ...versions];
  const olderSnapshot = comparableVersions.find((version) => version.id === compareOlder) || versions[0] || null;
  const newerSnapshot = comparableVersions.find((version) => version.id === compareNewer) || currentVersionSnapshot;
  const compareAttributes: Array<{ label: string; older: string; newer: string; equal: boolean | null }> = olderSnapshot ? [
    { label: "SHA-256", older: olderSnapshot.checksumSha256 || "Unknown", newer: newerSnapshot.checksumSha256 || "Unknown", equal: olderSnapshot.checksumSha256 && newerSnapshot.checksumSha256 ? olderSnapshot.checksumSha256 === newerSnapshot.checksumSha256 : null },
    { label: "File size", older: olderSnapshot.sizeBytes == null ? "Unknown" : formatBytes(olderSnapshot.sizeBytes), newer: newerSnapshot.sizeBytes == null ? "Unknown" : formatBytes(newerSnapshot.sizeBytes), equal: olderSnapshot.sizeBytes != null && newerSnapshot.sizeBytes != null ? olderSnapshot.sizeBytes === newerSnapshot.sizeBytes : null },
    { label: "Source filename", older: olderSnapshot.originalName || "Unknown", newer: newerSnapshot.originalName || "Unknown", equal: olderSnapshot.originalName && newerSnapshot.originalName ? olderSnapshot.originalName === newerSnapshot.originalName : null },
    { label: "Media type", older: olderSnapshot.mimeType || "Unknown", newer: newerSnapshot.mimeType || "Unknown", equal: olderSnapshot.mimeType && newerSnapshot.mimeType ? olderSnapshot.mimeType === newerSnapshot.mimeType : null },
  ] : [];


  async function save() {
    setSaving(true); setMessage("");
    try {
      const metadata = parseMetadataText(draft.metadata);
      if (inspectedItem.type === "folder") { metadata.folderColor = draft.folderColor; metadata.folderIcon = draft.folderIcon; }
      // Relocation and Project transfer are policy-sensitive lifecycle operations.
      // Do not resubmit those identifiers through the metadata PATCH shortcut.
      const patch = { title: draft.title, body: draft.body || null, ownerId: draft.ownerId || null, status: draft.status, visibility: draft.visibility, tags: draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean), externalUrl: draft.externalUrl || null, metadata, changelogNote: "Library details updated." };
      const optimistic = { ...inspectedItem, ...patch, updatedAt: new Date().toISOString() } as LibraryItem;
      const result = await mutateApi<LibraryItem>(`/api/library/${inspectedItem.id}`, {
        method: "PATCH",
        body: { ...patch, expectedRevision: inspectedItem.revision },
        label: `Update ${inspectedItem.title}`,
        dedupeKey: `library:${inspectedItem.id}:metadata`,
        entityType: "library",
        entityId: inspectedItem.id,
        resourceKind: "library",
        resourceId: inspectedItem.parentId || inspectedItem.id,
        baseRevision: inspectedItem.revision,
        optimisticResult: optimistic,
        invalidate: ["/api/library"],
      });
      const saved = result.result || optimistic;
      const repair = saved as LibraryItem & { reconciled?: boolean; warning?: string };
      setMessage(result.queued ? "Saved on this device. Changes will sync when connected."
        : repair.reconciled === false ? repair.warning || "Changes committed; storage repair is required. Do not repeat the edit."
        : "Changes saved.");
      onSaved(saved);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save changes."); }
    finally { setSaving(false); }
  }

  async function restoreVersion(version: LibraryVersionRow) {
    if (!item || saving) return;
    const approved = await confirmCluster({
      title: `Restore v${version.versionNumber}?`,
      message: `This will replace the current file contents of ${item.title} with the saved version. The current file will be preserved in version history. Concurrent changes prevent the restore.`,
      confirmLabel: "Restore version",
    });
    if (!approved) return;
    setSaving(true); setMessage("");
    try {
      const result = await api<{ ok: boolean; item: LibraryItem }>(`/api/library/${item.id}/versions/${version.id}/restore`, { method: "POST", body: JSON.stringify({ expectedRevision: item.revision }) });
      onSaved(result.item);
      setMessage(`Restored v${version.versionNumber} as the current file.`);
      const refreshed = await queryApi<LibraryVersionsPayload>(`/api/library/${item.id}/versions`, { force: true, tags: ["library", `library:${item.id}:versions`] });
      setVersions(refreshed.versions || []);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not restore this version."); }
    finally { setSaving(false); }
  }

  async function updateReviewState(state: string) {
    if (!item) return;
    setReviewBusy(true); setMessage("");
    try {
      const result = await api<{ ok: true; item: LibraryItem }>(`/api/library/${item.id}/review`, { method: "PATCH", body: JSON.stringify({ state, expectedRevision: item.revision }) });
      const next = { ...item, ...result.item, reviewState: result.item.reviewState || state } as LibraryItem;
      onSaved(next);
      setReview((current) => current ? { ...current, state, approvedAt: state === "approved" ? (result.item.approvedAt || new Date().toISOString()) : null } : current);
      setMessage(`Review state changed to ${state.replace(/-/g, " ")}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not update review state."); }
    finally { setReviewBusy(false); }
  }

  async function updateReviewer(reviewerId: string) {
    if (!item) return;
    setReviewBusy(true); setMessage("");
    try {
      const result = await api<{ ok: true; item: LibraryItem }>(`/api/library/${item.id}/review`, { method: "PATCH", body: JSON.stringify({ reviewerId: reviewerId || null, expectedRevision: item.revision }) });
      const next = { ...item, ...result.item, reviewerId: reviewerId || null } as LibraryItem;
      onSaved(next);
      setReview((current) => current ? { ...current, reviewerId: reviewerId || null } : current);
      setMessage(reviewerId ? "Reviewer assigned." : "Reviewer cleared.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not update reviewer."); }
    finally { setReviewBusy(false); }
  }

  async function toggleReviewWatch() {
    if (!item || !review) return;
    setReviewBusy(true); setMessage("");
    try {
      await api(`/api/library/${item.id}/watch`, { method: review.watched ? "DELETE" : "POST", body: review.watched ? JSON.stringify({}) : undefined });
      setReview((current) => current ? { ...current, watched: !current.watched, watcherCount: Math.max(0, current.watcherCount + (current.watched ? -1 : 1)) } : current);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not update watch state."); }
    finally { setReviewBusy(false); }
  }

  async function toggleAssetLock() {
    if (!item || !review) return;
    setReviewBusy(true); setMessage("");
    try {
      if (review.lock?.active && review.lock.ownerId === currentUser.id && (!review.lock.deviceBound || review.lock.ownedByCurrentDevice)) {
        const result = await api<{ ok: true; lock: LibraryReviewPayload["review"]["lock"] }>(`/api/library/${item.id}/lock`, { method: "DELETE", body: JSON.stringify({ force: false }) });
        setReview((current) => current ? { ...current, lock: result.lock || null } : current);
      } else {
        const result = await api<{ ok: true; lock: NonNullable<LibraryReviewPayload["review"]["lock"]> }>(`/api/library/${item.id}/lock`, { method: "POST", body: JSON.stringify({ ttlSeconds: 1800, sourceKind: "cluster", reason: "Editing from Library inspector" }) });
        setReview((current) => current ? { ...current, lock: result.lock } : current);
      }
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not update asset lock."); }
    finally { setReviewBusy(false); }
  }

  async function rebuildDerivatives() {
    if (!item) return;
    setReviewBusy(true); setMessage("");
    try {
      await api(`/api/library/${item.id}/derivatives/rebuild`, { method: "POST", body: JSON.stringify({}) });
      setMessage("Preview rebuild queued. Existing previews are not valid for the new version until processing completes.");
      setDerivatives((current) => current.map((entry) => ({ ...entry, status: "stale", invalidatedAt: new Date().toISOString() })));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not queue derivative rebuild."); }
    finally { setReviewBusy(false); }
  }

  const tabs: Array<[InspectorTab, string]> = item.type === "folder"
    ? [["preview", "Folder"], ["references", "References"], ["lifecycle", "Lifecycle"], ["activity", "History"]]
    : [["preview", "Preview"], ["description", "Description"], ["references", "References"], ["lifecycle", "Lifecycle"], ["activity", "History"]];
  return <aside className="library-inspector-v217">
    <div className="library-inspector-head-v217" style={item.type === "folder" ? folderStyle(item) : undefined}><div><LibraryIcon name={itemIconName(item)} size={22} /><span>{item.mimeType || item.type}</span><strong>{item.title}</strong></div><div className="button-row"><ClusterIconButton type="button" className={favorite ? "library-favorite-toggle-v504 active" : "library-favorite-toggle-v504"} onClick={() => onToggleFavorite(item)} label={favorite ? "Remove from favorites" : "Add to favorites"}><LibraryIcon name="star" size={20} /></ClusterIconButton><WorkActionMenu iconOnly context={{ source: { kind: "library", id: item.id, projectId: item.projectId || item.project?.id || null, label: item.title }, navigation: { screen: "library", projectId: item.projectId || item.project?.id || null, inspectScope: "library-item", inspectId: item.id }, projectId: item.projectId || item.project?.id || null }} label={`${item.title} work actions`} /><ClusterIconButton className="library-inspector-close-v220" onClick={onClose} label="Close inspector"><LibraryIcon name="close" size={21} /></ClusterIconButton></div></div>
    <div className="library-inspector-tabs-v217" role="tablist" style={runtimeStyle({ gridTemplateColumns: `repeat(${tabs.length}, 1fr)` })}>{tabs.map(([value, label]) => <ClusterButton unstyled type="button" key={value} className={tab === value ? "active" : ""} onClick={() => onTab(value)}>{label}</ClusterButton>)}</div>
    {item.projectId || item.project?.id ? <LinkedWorkPanel projectId={item.projectId || item.project!.id} kind="library" entityId={item.id} compact /> : null}

    {tab === "preview" && item.type !== "folder" && <div className="library-inspector-scroll-v217"><LibraryPreview item={item} />{item.hasFile && <div className="library-preview-actions-v217"><ClusterLinkButton className="" href={libraryFileUrl(item, true)} variant="secondary" onClick={(event) => { event.preventDefault(); void downloadAuthenticatedClusterFile({ url: libraryFileUrl(item, true), fileName: item.originalName || item.title, sizeBytes: item.sizeBytes, expectedSha256: item.checksumSha256, preferDiskStreaming: true }).then(() => setMessage("Download requested. View Transfer Center for progress or browser handoff." )).catch((error) => setMessage(error instanceof Error ? error.message : "Download failed.")); }}>Download</ClusterLinkButton><ClusterButton type="button" className="" onClick={() => onExpand(item)} variant="primary">Expand</ClusterButton></div>}<LibraryFileFacts item={item} /></div>}

    {tab === "preview" && item.type === "folder" && <div className="library-inspector-scroll-v217 library-folder-editor-v220">
      <div className="library-folder-hero-v220" style={runtimeStyle({ "--library-folder-color": draft.folderColor || item.folderColor || "#7aa8ff" })}><div><LibraryIcon name={folderIconName({ folderIcon: draft.folderIcon })} size={44} /></div><span>{protectedFolder ? "Managed folder" : "Folder"}</span><strong>{draft.title || item.title}</strong><small>{item.childCount || 0} item{item.childCount === 1 ? "" : "s"}</small></div>
      <div className="library-folder-actions-v220"><ClusterButton type="button" className="" onClick={() => onOpenFolder(item.id)} variant="primary">Open folder</ClusterButton><ClusterButton type="button" className="" onClick={() => onManagePermissions(item)} variant="secondary">Permissions</ClusterButton><ClusterButton type="button" className="" onClick={save} disabled={saving || !draft.title.trim()} variant="secondary">{saving ? "Saving…" : "Save folder"}</ClusterButton></div>
      <label><span>Name</span><ClusterTextInput value={draft.title} onChange={(event) => setDraft((value) => ({ ...value, title: event.target.value }))} /></label>
      <label><span>Description</span><ClusterTextArea className="library-description-v217" value={draft.body} onChange={(event) => setDraft((value) => ({ ...value, body: event.target.value }))} placeholder="What belongs in this folder?" /></label>
      <label><span>Parent folder</span><ClusterSelect value={draft.parentId} onChange={() => {}} ariaLabel="Parent folder" disabled options={[{ value: "", label: "Library root" }, ...folders.filter((folder) => folder.id !== item.id).map((folder) => ({ value: folder.id, label: folder.title }))]} /></label><p className="library-managed-folder-note-v271">{protectedFolder ? "Cluster manages this folder; it cannot be moved." : "For a safe folder relocation, select it in Library and use Move to review the complete hierarchy and retention rules."}</p>
      <FolderAppearancePicker color={draft.folderColor} icon={draft.folderIcon} onColor={(folderColor) => setDraft((value) => ({ ...value, folderColor }))} onIcon={(folderIcon) => setDraft((value) => ({ ...value, folderIcon }))} compact />
      {message && <div className={message.includes("saved") ? "status-box slim" : "error-box slim"}>{message}</div>}
      <LibraryFileFacts item={item} />
    </div>}

    {tab === "description" && <div className="library-inspector-scroll-v217 library-editor-v217">
      <label><span>Name</span><ClusterTextInput value={draft.title} onChange={(event) => setDraft((value) => ({ ...value, title: event.target.value }))} /></label>
      <label><span>Description</span><ClusterTextArea className="library-description-v217" value={draft.body} onChange={(event) => setDraft((value) => ({ ...value, body: event.target.value }))} placeholder="Describe the file, context, usage, or decision…" /></label>
      <label><span>Tags</span><ClusterTextInput value={draft.tags} onChange={(event) => setDraft((value) => ({ ...value, tags: event.target.value }))} placeholder="environment, reference, approved" /></label>
      {item.externalUrl && <label><span>Link URL</span><ClusterTextInput value={draft.externalUrl} onChange={(event) => setDraft((value) => ({ ...value, externalUrl: event.target.value }))} /></label>}
      <div className="library-field-pair-v217"><label><span>Folder</span><ClusterSelect value={draft.parentId} onChange={() => {}} ariaLabel="Library folder" disabled options={[{ value: "", label: "Library root" }, ...folders.filter((folder) => folder.id !== item.id).map((folder) => ({ value: folder.id, label: folder.title }))]} /></label><label><span>Project</span><ClusterSelect value={draft.projectId} onChange={() => {}} ariaLabel="Library project" disabled options={[{ value: "", label: "Workspace" }, ...projects.filter((project) => !project.archived).map((project) => ({ value: project.id, label: project.name }))]} /></label></div><p className="library-managed-folder-note-v271">Use the Library Move action for folder changes. Moving an asset between Projects requires a separately authorized Project transfer workflow; editing its metadata does not change access ownership.</p>
      <div className="library-field-pair-v217"><label><span>Owner</span><ClusterSelect value={draft.ownerId} onChange={(ownerId) => setDraft((value) => ({ ...value, ownerId }))} ariaLabel="Library owner" options={[{ value: "", label: "Unassigned" }, ...users.map((user) => ({ value: user.id, label: userName(user) }))]} /></label><label><span>Status</span><ClusterSelect value={draft.status} onChange={(status) => setDraft((value) => ({ ...value, status }))} ariaLabel="Library status" options={[{ value: "active", label: "Active" }, { value: "draft", label: "Draft" }, { value: "in-review", label: "In review" }, { value: "approved", label: "Approved" }, { value: "needs-update", label: "Needs update" }, { value: "deprecated", label: "Deprecated" }, { value: "archived", label: "Archived" }]} /></label></div>
      <label><span>Visibility</span><ClusterSelect value={draft.visibility} onChange={(visibility) => setDraft((value) => ({ ...value, visibility }))} ariaLabel="Library visibility" options={[{ value: "internal", label: "Internal" }, { value: "project", label: "Project members" }, { value: "private", label: "Private" }]} /></label>
      {item.type === "folder" && <FolderAppearancePicker color={draft.folderColor} icon={draft.folderIcon} onColor={(folderColor) => setDraft((value) => ({ ...value, folderColor }))} onIcon={(folderIcon) => setDraft((value) => ({ ...value, folderIcon }))} compact />}
      <ClusterDisclosureGroup title="Custom metadata" className="library-metadata-editor-v219"><label><span>Metadata JSON</span><ClusterTextArea className="library-json-v217" value={draft.metadata} onChange={(event) => setDraft((value) => ({ ...value, metadata: event.target.value }))} spellCheck={false} /></label></ClusterDisclosureGroup>
      {message && <div className={message.includes("saved") ? "status-box slim" : "error-box slim"}>{message}</div>}<ClusterButton type="button" className="wide" onClick={save} disabled={saving || !draft.title.trim()} variant="primary">{saving ? "Saving…" : "Save changes"}</ClusterButton>
    </div>}


    {tab === "references" && <LibraryResourceReferencesPanel itemId={item.id} projectId={item.projectId || item.project?.id || null} />}
    {tab === "lifecycle" && <LibraryGovernancePanel item={item} onSaved={onSaved} onDestroyed={() => onClose()} />}

    {tab === "activity" && <div className="library-inspector-scroll-v217">
      {item.type !== "folder" && <section className="library-review-workflow-v504">
        <div className="library-section-title-v504"><strong>Review workflow</strong><span>{reviewLoading ? "Loading…" : review ? `${review.openAnnotations} open note${review.openAnnotations === 1 ? "" : "s"} · ${review.watcherCount} watching` : "Unavailable"}</span></div>
        {review && <><div className="library-field-pair-v217"><label><span>State</span><ClusterSelect value={review.state} onChange={(state) => void updateReviewState(state)} disabled={reviewBusy} ariaLabel="Library review state" options={[{ value: "draft", label: "Draft" }, { value: "in-review", label: "In review" }, { value: "approved", label: "Approved" }, { value: "changes-requested", label: "Changes requested" }, { value: "archived", label: "Archived" }]} /></label><label><span>Reviewer</span><ClusterSelect value={review.reviewerId || ""} onChange={(reviewerId) => void updateReviewer(reviewerId)} disabled={reviewBusy} ariaLabel="Library reviewer" options={[{ value: "", label: "Unassigned" }, ...users.map((user) => ({ value: user.id, label: userName(user) }))]} /></label></div>
          <div className="button-row"><ClusterButton type="button" variant="secondary" disabled={reviewBusy} onClick={() => void toggleReviewWatch()}>{review.watched ? "Stop watching" : "Watch changes"}</ClusterButton><ClusterButton type="button" variant="secondary" disabled={reviewBusy || Boolean(review.lock?.active && (review.lock.ownerId !== currentUser.id || (review.lock.deviceBound && !review.lock.ownedByCurrentDevice)))} onClick={() => void toggleAssetLock()}>{review.lock?.active && review.lock.ownerId === currentUser.id && (!review.lock.deviceBound || review.lock.ownedByCurrentDevice) ? "Release edit lock" : review.lock?.active && review.lock.ownerId === currentUser.id ? "Locked on another device" : review.lock?.active ? "Locked by another user" : "Lock for editing"}</ClusterButton></div>
          {review.lock?.active && <p className="muted">{review.lock.ownerId === currentUser.id ? (review.lock.deviceBound && !review.lock.ownedByCurrentDevice ? "Your account holds the edit lock on another device" : "You hold the edit lock on this device") : "Another user holds the edit lock"}{review.lock.expiresAt ? ` until ${formatDate(review.lock.expiresAt)}` : ""}{review.lock.sourceKind ? ` · ${review.lock.sourceKind}` : ""}.</p>}
          {review.approvedAt && <p className="muted">Approved {formatDate(review.approvedAt)}.</p>}
        </>}
      </section>}
      {item.type === "file" && <section className="library-version-history-v504"><div className="library-section-title-v504"><strong>Derived previews</strong><span>{derivativesLoading ? "Loading…" : `${derivatives.filter((entry) => entry.available).length}/${derivatives.length} current and ready`}</span></div>{derivatives.map((entry) => <article key={entry.id}><div><strong>{entry.kind.replace(/-/g, " ")}</strong><span>{entry.currentVersion === false ? "Previous file version" : entry.invalidatedAt ? "Invalidated" : entry.available ? "Ready" : entry.status}</span></div><p>{entry.variantKey}{entry.mimeType ? ` · ${entry.mimeType}` : ""}{entry.currentVersion === false ? " · Preview must be rebuilt for the current file" : ""}</p><small>{formatBytes(entry.sizeBytes)}{entry.builtAt ? ` · built ${formatDate(entry.builtAt)}` : ""}</small>{entry.fileUrl && <div className="button-row"><ClusterLinkButton href={entry.fileUrl} variant="secondary">Open derivative</ClusterLinkButton></div>}</article>)}{!derivativesLoading && !derivatives.length && <p className="muted">No derivative records yet.</p>}<ClusterButton type="button" variant="secondary" disabled={reviewBusy || !item.checksumSha256} onClick={() => void rebuildDerivatives()}>Rebuild previews</ClusterButton></section>}
      {item.type === "file" && versions.length > 0 && <section className="library-version-compare-v533">
        <div className="library-section-title-v504"><strong>Compare file revisions</strong><span>Metadata and checksum</span></div>
        <div className="library-version-compare-pickers-v533">
          <label className="field"><span>Earlier version</span><ClusterSelect ariaLabel="Earlier Library version" value={olderSnapshot?.id || ""} onChange={setCompareOlder} options={comparableVersions.map((version) => ({ value: version.id, label: version.id === "current" ? "Current" : `v${version.versionNumber}` }))} /></label>
          <label className="field"><span>Compare against</span><ClusterSelect ariaLabel="Later Library version" value={newerSnapshot.id} onChange={setCompareNewer} options={comparableVersions.map((version) => ({ value: version.id, label: version.id === "current" ? "Current" : `v${version.versionNumber}` }))} /></label>
        </div>
        {olderSnapshot?.id === newerSnapshot.id ? <p className="muted">Select two different revisions to compare.</p> : <div className="library-version-diff-v533">
          {compareAttributes.map((attribute) => <div key={attribute.label}><strong>{attribute.label}</strong><span title={attribute.older}>{attribute.older}</span><span aria-hidden="true">→</span><span title={attribute.newer}>{attribute.newer}</span><small>{attribute.equal == null ? "Unknown" : attribute.equal ? "Unchanged" : "Changed"}</small></div>)}
        </div>}
        <p className="muted tight">Comparison is metadata-only. It does not claim binary or visual content is identical unless matching hashes are available.</p>
      </section>}
      {item.type === "file" && <section className="library-version-history-v504"><div className="library-section-title-v504"><strong>File versions</strong><span>{versionsLoading ? "Loading…" : `${versions.length} saved`}</span></div>{versions.map((version) => <article key={version.id}><div><strong>v{version.versionNumber}</strong><span>{formatDate(version.createdAt)}</span></div><p>{version.note || version.originalName || "Previous file version"}</p><small>{formatBytes(version.sizeBytes)}{version.checksumSha256 ? ` · ${version.checksumSha256.slice(0, 12)}…` : ""}</small><div className="button-row">{version.downloadUrl && <ClusterLinkButton href={version.downloadUrl} variant="secondary" onClick={(event) => { event.preventDefault(); void downloadAuthenticatedClusterFile({ url: version.downloadUrl!, fileName: version.originalName || item.originalName || `library-version-${version.versionNumber}`, sizeBytes: version.sizeBytes, expectedSha256: version.checksumSha256, preferDiskStreaming: true }).then(() => setMessage(`Download requested for v${version.versionNumber}.`)).catch((error) => setMessage(error instanceof Error ? error.message : "Version download failed.")); }}>Download v{version.versionNumber}</ClusterLinkButton>}<ClusterButton type="button" variant="secondary" disabled={saving} onClick={() => void restoreVersion(version)}>Restore</ClusterButton></div></article>)}{!versionsLoading && !versions.length && <p className="muted">No prior file versions yet.</p>}</section>}
      {item.type !== "folder" && <CollaborationPanel entityType="library" entityId={item.id} currentUser={currentUser} users={users} title="Review notes" compact />}
      {message && <div className={message.includes("Could not") || message.includes("conflict") ? "error-box slim" : "status-box slim"}>{message}</div>}
      <div className="library-history-v217">{(item.changelog || []).map((entry, index) => <article key={`${entry.at}-${index}`}><span>{formatDate(entry.at)}</span><strong>{entry.note || `${entry.from || "new"} → ${entry.to || item.status}`}</strong></article>)}{!(item.changelog || []).length && <p>No recorded changes yet.</p>}</div><dl className="library-technical-v217"><div><dt>Created</dt><dd>{formatDate(item.createdAt)}</dd></div><div><dt>Updated</dt><dd>{formatDate(item.updatedAt)}</dd></div><div><dt>Owner</dt><dd>{userName(item.owner)}</dd></div><div><dt>Project</dt><dd>{item.project?.name || "Workspace"}</dd></div></dl></div>}
  </aside>;
}

export default function LibraryWorkspacePage({ projects, currentUser }: { projects: Project[]; currentUser: User }) {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [folders, setFolders] = useState<LibraryItem[]>([]);
  const [treeFiles, setTreeFiles] = useState<LibraryItem[]>([]);
  const [showTreeFiles, setShowTreeFiles] = useServerState<boolean>("user", "library.show-tree-files", false, { merge: (value) => value === true || Number(value) === 1 });
  const [explorerCollapsed, setExplorerCollapsed] = useServerState<boolean>("user", "library.explorer-collapsed", false, { merge: (value) => value === true || Number(value) === 1 });
  const [viewsOpen, setViewsOpen] = useServerState<boolean>("user", "library.explorer.views-open", true, { merge: (value, fallback) => value == null ? fallback : value === true || Number(value) === 1 });
  const [collectionsOpen, setCollectionsOpen] = useServerState<boolean>("user", "library.explorer.collections-open", true, { merge: (value, fallback) => value == null ? fallback : value === true || Number(value) === 1 });
  const [foldersOpen, setFoldersOpen] = useServerState<boolean>("user", "library.explorer.folders-open", true, { merge: (value, fallback) => value == null ? fallback : value === true || Number(value) === 1 });
  const [pinnedItems, setPinnedItems] = useState<LibraryItem[]>([]);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [collections, setCollections] = useState<LibraryCollection[]>([]);
  const [activeCollection, setActiveCollection] = useState<LibraryCollection | null>(null);
  const [sharingCollection, setSharingCollection] = useState<LibraryCollection | null>(null);
  const [sharingGrants, setSharingGrants] = useState<LibraryCollectionGrant[]>([]);
  const [sharingBusy, setSharingBusy] = useState(false);
  const [sharingLoading, setSharingLoading] = useState(false);
  const [sharingNotice, setSharingNotice] = useState("");
  const [sharingUserId, setSharingUserId] = useState("");
  const [sharingRole, setSharingRole] = useState<"viewer" | "editor">("viewer");
  const sharingPendingRef = useRef(false);
  const [path, setPath] = useState<Array<{ id: string; title: string }>>([]);
  const [facets, setFacets] = useState(EMPTY_FACETS);
  const [pagination, setPagination] = useState<LibraryWorkspace["pagination"]>({ cursor: null, hasMore: false, limit: PAGE_SIZE, loaded: 0 });
  const [users, setUsers] = useState<User[]>([]);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [librarySection, setLibrarySection] = useState<LibrarySection>("folder");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim());
  const [searchScope, setSearchScope] = useServerState<LibrarySearchScope>("user", "library.search-scope", "library", { merge: (value, fallback) => ["folder", "descendants", "project", "library"].includes(String(value)) ? value as LibrarySearchScope : fallback });
  const [groupBy, setGroupBy] = useServerState<LibraryGroupMode>("user", "library.group-by", "none", { merge: (value, fallback) => ["none", "type", "project", "review"].includes(String(value)) ? value as LibraryGroupMode : fallback });
  const [filters, setFilters] = useState<LibraryFilters>(() => ({ projectId: readClusterWorkProjectContext() || "", ownerId: "", type: "all", status: "active", mimeGroup: "all", visibility: "all", modified: "any", tag: "", pinned: "all", sort: "updated-desc" }));
  const [layout, setLayout] = useServerState<LayoutMode>("user", "library.layout", "grid", { merge: (value, fallback) => ["grid", "compact-grid", "list", "details"].includes(String(value)) ? value as LayoutMode : fallback });
  const [showFilters, setShowFilters] = useState(false);
  const [showSavedViews, setShowSavedViews] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeItem, setActiveItem] = useState<LibraryItem | null>(null);
  const [viewerItem, setViewerItem] = useState<LibraryItem | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const selectedIdsLiveRef = useRef(selectedIds);
  selectedIdsLiveRef.current = selectedIds;
  // A queued job lives on the server. Keep only its opaque identifier locally so
  // leaving Library does not make a still-running operation impossible to find.
  const [backgroundBulkJob, setBackgroundBulkJob] = useState<{ id: string; count: number; status: string; progress: number; message: string; changed: number; conflicted: number; denied: number; blocked: number; skipped: number } | null>(() => {
    try {
      const id = window.sessionStorage.getItem("cluster.library.activeBulkJob");
      return id ? { id, count: 0, status: "QUEUED", progress: 0, message: "Recovering bulk operation…", changed: 0, conflicted: 0, denied: 0, blocked: 0, skipped: 0 } : null;
    } catch { return null; }
  });
  const [hierarchyMoveJob, setHierarchyMoveJob] = useState<{ id: string; status: string; progress: number; message: string; moved: number; skipped: number } | null>(() => {
    try {
      const id = window.sessionStorage.getItem("cluster.library.hierarchyMoveJob");
      return id ? { id, status: "QUEUED", progress: 0, message: "Recovering hierarchy operation…", moved: 0, skipped: 0 } : null;
    } catch { return null; }
  });
  const [hierarchyLifecycleJob, setHierarchyLifecycleJob] = useState<{ id: string; action: string; status: string; progress: number; message: string; changed: number; preserved: number } | null>(() => {
    try {
      const saved = window.sessionStorage.getItem("cluster.library.hierarchyLifecycleJob");
      const parsed = saved ? JSON.parse(saved) : null;
      return parsed && typeof parsed.id === "string" && ["archive", "trash", "restore"].includes(parsed.action)
        ? { id: parsed.id, action: parsed.action, status: "QUEUED", progress: 0, message: "Recovering hierarchy lifecycle operation…", changed: 0, preserved: 0 } : null;
    } catch { return null; }
  });
  const [storageRepair, setStorageRepair] = useState<{ id: string; status: string; progress: number; message: string; unresolved: number | null } | null>(() => {
    try {
      const id = window.sessionStorage.getItem("cluster.library.storageRepairJob");
      return id ? { id, status: "QUEUED", progress: 0, message: "Recovering storage-repair status…", unresolved: null } : null;
    } catch { return null; }
  });
  const [orphanAudit, setOrphanAudit] = useState<{
    id: string; status: string; progress: number; message: string;
    result?: { inspectedFiles: number; protectedReferences: number; agedUnreferenced: number; agedBytes: number; recentUnreferenced: number; symlinksSkipped: number; warning: string; sample: Array<{ relativePath: string; sizeBytes: number; modifiedAt: string }> } | null;
  } | null>(() => {
    try {
      const id = window.sessionStorage.getItem("cluster.library.orphanAuditJob");
      return id ? { id, status: "QUEUED", progress: 0, message: "Recovering read-only audit…" } : null;
    } catch { return null; }
  });
  const orphanAuditStarting = useRef(false);
  const orphanReviewPending = useRef(false);
  const [orphanReview, setOrphanReview] = useState<{ relativePath: string; status: string; blockers: string[] } | null>(null);
  const [orphanReviewBusy, setOrphanReviewBusy] = useState<string | null>(null);
  const [governanceSelected, setGovernanceSelected] = useState<LibraryItem[] | null>(null);
  const governanceQueryRef = useRef("");
  const [renameRule, setRenameRule] = useState<LibraryBulkRenameRule | null>(null);
  const [renamePreview, setRenamePreview] = useState<(LibraryBulkRenamePreview & { ids: string[]; expectedRevisions: Record<string, number>; rule: LibraryBulkRenameRule }) | null>(null);
  const [renameBusy, setRenameBusy] = useState(false);
  const bulkPendingRef = useRef(false);
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("preview");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [storageIssue, setStorageIssue] = useState(false);
  const [status, setStatus] = useState("");
  const [uploading, setUploading] = useState<LibraryUploadState>({ active: false, current: 0, total: 0, name: "", percent: 0, message: "", uploadId: null, operationId: null });
  const [dropActive, setDropActive] = useState(false);
  const uploadProgressUiRef = useRef({ at: 0, percent: -1, message: "" });
  const [createDraft, setCreateDraft] = useState<CreateDraft | null>(null);
  const [bulkFolderId, setBulkFolderId] = useState("");
  const [permissionFolder, setPermissionFolder] = useState<LibraryItem | null>(null);
  const [permissionUsers, setPermissionUsers] = useState<User[]>([]);
  const [folderPermissions, setFolderPermissions] = useState<Record<string, FolderAccess>>({});
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [permissionMessage, setPermissionMessage] = useState("");
  const [permissionAccess, setPermissionAccess] = useState<LibraryAccessExplanationPayload | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const modelBundleInput = useRef<HTMLInputElement>(null);
  const requestSerial = useRef(0);
  const detailRequestSequence = useRef(0);
  const revalidateTimerRef = useRef(0);
  const revalidationInFlightRef = useRef(false);
  const revalidationPendingRef = useRef(false);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);
  const lastLoadedQueryKey = useRef<string | null>(null);
  const queryKey = `${librarySection}|${activeCollection?.id || "no-collection"}:${activeCollection?.revision || 0}|${folderId || "root"}|${deferredQuery}|${searchScope}|${groupBy}|${showTreeFiles}|${Object.values(filters).join("|")}`;
  const liveSelectionQueryKeyRef = useRef(queryKey);
  liveSelectionQueryKeyRef.current = queryKey;
  const matchingSelectionRef = useRef<{ queryKey: string; items: LibraryItem[] } | null>(null);
  const viewerSequence = useMemo(() => items.filter((item) => item.type !== "folder"), [items]);
  const viewerIndexById = useMemo(() => new Map(viewerSequence.map((item, index) => [item.id, index])), [viewerSequence]);
  const folderById = useMemo(() => new Map(folders.map((folder) => [folder.id, folder])), [folders]);
  const viewerIndex = viewerItem ? viewerIndexById.get(viewerItem.id) ?? -1 : -1;
  const selectedProtectedFolders = useMemo(() => Array.from(selectedIds, (id) => folderById.get(id)).filter((folder): folder is LibraryItem => Boolean(folder && isProtectedLibraryFolder(folder))), [folderById, selectedIds]);
  const groupedItems = useMemo(() => groupLibraryItems(items, groupBy), [items, groupBy]);
  const reorderEnabled = filters.sort === "custom" && librarySection === "folder" && !deferredQuery && groupBy === "none";

  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    if (!sentinel || !pagination.hasMore || loading || loadingMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadWorkspace(false);
    }, { root: null, rootMargin: "900px 0px", threshold: 0.01 });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [pagination.hasMore, pagination.cursor, loading, loadingMore, queryKey]);

  async function loadWorkspace(reset = true, force = false, quiet = false) {
    const serial = ++requestSerial.current;
    const sameQueryRefresh = reset && lastLoadedQueryKey.current === queryKey;
    if (!quiet && reset && sameQueryRefresh) setRefreshing(true);
    else if (!quiet && reset) setLoading(true);
    else if (!quiet) setLoadingMore(true);
    setError(null); setStorageIssue(false);
    if (librarySection === "collection" && activeCollection) {
      try {
        if (!reset && !pagination.cursor) return;
        const pagePath = `/api/library/collections/${encodeURIComponent(activeCollection.id)}/items?limit=${PAGE_SIZE}${!reset && pagination.cursor ? `&cursor=${encodeURIComponent(pagination.cursor)}` : ""}`;
        const result = reset
          ? await queryApi<{ ok: true; collection: LibraryCollection; items: LibraryItem[]; pagination: LibraryWorkspace["pagination"] }>(pagePath, { staleMs: 5_000, maxAgeMs: 60_000, force, tags: ["library", "library-collections", `library-collection:${activeCollection.id}`] })
          : await api<{ ok: true; collection: LibraryCollection; items: LibraryItem[]; pagination: LibraryWorkspace["pagination"] }>(pagePath);
        if (serial !== requestSerial.current) return;
        setActiveCollection(result.collection);
        const matchingSnapshot = reset && sameQueryRefresh && matchingSelectionRef.current?.queryKey === queryKey
          ? matchingSelectionRef.current : null;
        setItems((existing) => reset
          ? (matchingSnapshot ? mergeLibraryItems(result.items || [], matchingSnapshot.items) : result.items || [])
          : mergeLibraryItems(existing, result.items || []));
        setPagination({ ...result.pagination, loaded: reset ? result.items.length : pagination.loaded + result.items.length });
        if (reset) {
          if (!matchingSnapshot) matchingSelectionRef.current = null;
          const resultIds = new Set([...(result.items || []), ...(matchingSnapshot?.items || [])].map((item) => item.id));
          if (sameQueryRefresh) setSelectedIds((current) => new Set([...current].filter((id) => resultIds.has(id))));
          else setSelectedIds(new Set());
          lastLoadedQueryKey.current = queryKey;
        }
      } catch (loadError) {
        if (serial === requestSerial.current) setError(loadError);
      } finally { if (serial === requestSerial.current && !quiet) { setLoading(false); setRefreshing(false); setLoadingMore(false); } }
      return;
    }
    const params = new URLSearchParams({ parentId: folderId || "root", scope: (deferredQuery || searchScope === "descendants") ? (searchScope === "library" ? "all" : searchScope) : "folder", section: librarySection, q: deferredQuery, ...filters, includeTreeFiles: showTreeFiles ? "1" : "0", limit: String(PAGE_SIZE) });
    if (!reset && pagination.cursor) { params.set("cursor", pagination.cursor); params.set("includeContext", "0"); }
    try {
      const path = `/api/library/workspace?${params}`;
      const result = reset
        ? await queryApi<LibraryWorkspace>(path, { staleMs: 10_000, maxAgeMs: 10 * 60_000, staleWhileRevalidate: true, force, tags: ["library", "workspace"] })
        : await api<LibraryWorkspace>(path);
      if (serial !== requestSerial.current) return;
      const matchingSnapshot = reset && sameQueryRefresh && matchingSelectionRef.current?.queryKey === queryKey
        ? matchingSelectionRef.current : null;
      setItems((existing) => reset
        ? (matchingSnapshot ? mergeLibraryItems(result.items, matchingSnapshot.items) : result.items)
        : mergeLibraryItems(existing, result.items));
      if (result.folders) setFolders(result.folders);
      if (result.treeFiles) setTreeFiles(result.treeFiles);
      else if (!showTreeFiles) setTreeFiles([]);
      if (result.pinnedItems) setPinnedItems(result.pinnedItems);
      if (result.favoriteIds) setFavoriteIds(new Set(result.favoriteIds));
      if (result.path) setPath(result.path);
      if (result.facets) setFacets(result.facets);
      setPagination(result.pagination);
      if (reset) {
        if (!matchingSnapshot) matchingSelectionRef.current = null;
        const resultIds = new Set([...result.items, ...(matchingSnapshot?.items || [])].map((item) => item.id));
        if (sameQueryRefresh) setSelectedIds((current) => new Set([...current].filter((id) => resultIds.has(id))));
        else setSelectedIds(new Set());
        lastLoadedQueryKey.current = queryKey;
      }
    } catch (loadError) {
      if (serial === requestSerial.current) {
        const payload = loadError instanceof ApiError && loadError.payload && typeof loadError.payload === "object" ? loadError.payload as Record<string, unknown> : null;
        setStorageIssue(loadError instanceof ApiError ? loadError.code === "STORAGE_SCHEMA_OUT_OF_DATE" : payload?.code === "STORAGE_SCHEMA_OUT_OF_DATE");
        setError(loadError);
      }
    } finally { if (serial === requestSerial.current && !quiet) { setLoading(false); setRefreshing(false); setLoadingMore(false); } }
  }

  async function runWorkspaceRevalidation() {
    if (document.visibilityState !== "visible") return;
    if (revalidationInFlightRef.current) {
      revalidationPendingRef.current = true;
      return;
    }
    revalidationInFlightRef.current = true;
    try {
      await loadWorkspace(true, true, true);
    } finally {
      revalidationInFlightRef.current = false;
      if (revalidationPendingRef.current) {
        revalidationPendingRef.current = false;
        scheduleWorkspaceRevalidation();
      }
    }
  }

  function scheduleWorkspaceRevalidation() {
    window.clearTimeout(revalidateTimerRef.current);
    revalidateTimerRef.current = window.setTimeout(() => { void runWorkspaceRevalidation(); }, 300);
  }

  useEffect(() => { queryApi<User[]>("/api/users?summary=true&limit=1000", { staleMs: 30_000, maxAgeMs: 5 * 60_000, tags: ["users", "people"] }).then(setUsers).catch(() => setUsers([currentUser])); }, [currentUser.id]);
  useEffect(() => { void queryApi<{ ok: true; collections: LibraryCollection[] }>("/api/library/collections", { staleMs: 10_000, maxAgeMs: 5 * 60_000, tags: ["library", "library-collections"] }).then((result) => setCollections(result.collections || [])).catch(() => setCollections([])); }, []);
  useEffect(() => { const timeout = window.setTimeout(() => void loadWorkspace(true), deferredQuery ? 180 : 0); return () => window.clearTimeout(timeout); }, [queryKey]);
  useResourceChangeRefresh(() => runWorkspaceRevalidation(), { kinds: ["library", "file", "packet"], debounceMs: 180 });
  useEffect(() => {
    const refreshFromDelta = (event: Event) => {
      const changes = (event as CustomEvent<{ changes?: Array<{ entityType?: string }> }>).detail?.changes || [];
      if (changes.some((change) => change.entityType === "library") && document.visibilityState === "visible") scheduleWorkspaceRevalidation();
    };
    const onVisibility = () => { if (document.visibilityState === "visible") scheduleWorkspaceRevalidation(); };
    window.addEventListener("cluster-delta-applied", refreshFromDelta);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("cluster-delta-applied", refreshFromDelta);
      document.removeEventListener("visibilitychange", onVisibility);
      window.clearTimeout(revalidateTimerRef.current);
      revalidationPendingRef.current = false;
    };
  }, [queryKey]);
  useEffect(() => { if (!status) return; const timeout = window.setTimeout(() => setStatus(""), 3500); return () => window.clearTimeout(timeout); }, [status]);

  async function fetchDetail(item: LibraryItem, force = false) { return queryApi<LibraryItem>(`/api/library/${item.id}`, { staleMs: 15_000, maxAgeMs: 5 * 60_000, staleWhileRevalidate: true, force, tags: ["library", `library:${item.id}`] }); }
  const restoreLibraryDetail = useCallback((id: string | null) => {
    if (!id) { setActiveId(null); setActiveItem(null); return; }
    setActiveId(id); setInspectorTab("preview");
    const sequence = ++detailRequestSequence.current;
    void queryApi<LibraryItem>(`/api/library/${id}`, { staleMs: 15_000, maxAgeMs: 5 * 60_000, staleWhileRevalidate: true, tags: ["library", `library:${id}`] }).then((item) => {
      if (sequence !== detailRequestSequence.current) return;
      setActiveItem(item);
      if (item.projectId) setFilters((current) => ({ ...current, projectId: item.projectId || "" }));
      if (item.parentId) setFolderId(item.parentId);
      if (item.type === "folder") setFolderId(item.id);
    }).catch(() => {
      if (sequence !== detailRequestSequence.current) return;
      setActiveId(null);
      setActiveItem(null);
      recoverClusterDetailNavigation("library-item", {
        title: "Library item unavailable",
        message: "That Library item may have been deleted, moved, archived, or your access may have changed. Library stayed open.",
        tone: "warning",
      });
    });
  }, []);
  const libraryDetailHistory = useClusterDetailHistory("library-item", activeId, restoreLibraryDetail);
  async function selectItem(item: LibraryItem) {
    setInspectorTab("preview");
    libraryDetailHistory.openDetail(item.id);
  }
  async function openItemViewer(item: LibraryItem) {
    if (item.type === "folder") { setFolderId(item.id); setActiveId(null); setActiveItem(null); return; }
    setActiveId(item.id); setInspectorTab("preview");
    const sequence = ++detailRequestSequence.current;
    try { const detail = await fetchDetail(item); if (sequence !== detailRequestSequence.current) return; setActiveItem(detail); setViewerItem(detail); } catch (reason) { if (sequence === detailRequestSequence.current) setError(reason instanceof Error ? reason : new Error("Could not open preview.")); }
  }
  async function navigateViewer(direction: -1 | 1) {
    if (viewerIndex < 0) return;
    const candidate = viewerSequence[viewerIndex + direction];
    if (!candidate) return;
    const sequence = ++detailRequestSequence.current;
    try {
      const detail = await fetchDetail(candidate);
      if (sequence !== detailRequestSequence.current) return;
      setActiveId(detail.id);
      setActiveItem(detail);
      setViewerItem(detail);
      setInspectorTab("preview");
    } catch (reason) { if (sequence === detailRequestSequence.current) setError(reason instanceof Error ? reason : new Error("Could not open the next preview.")); }
  }
  async function openFolderPermissions(item: LibraryItem) {
    setPermissionFolder(item);
    setPermissionBusy(true);
    setPermissionMessage("");
    try {
      const [result, access] = await Promise.all([
        api<FolderPermissionPayload>(`/api/library/${item.id}/permissions`),
        queryApi<LibraryAccessExplanationPayload>(`/api/library/${item.id}/access-explanation`, { force: true, tags: ["library", `library:${item.id}:access`] }),
      ]);
      setPermissionUsers(result.users || []);
      setFolderPermissions(Object.fromEntries((result.permissions || []).map((entry) => [entry.userId, entry.access])));
      setPermissionAccess(access);
    } catch (reason) {
      setPermissionMessage(reason instanceof Error ? reason.message : "Folder permissions could not be loaded.");
    } finally {
      setPermissionBusy(false);
    }
  }
  async function saveFolderPermissions() {
    if (!permissionFolder) return;
    setPermissionBusy(true);
    setPermissionMessage("");
    try {
      await api(`/api/library/${permissionFolder.id}/permissions`, { method: "PUT", body: JSON.stringify({ entries: permissionUsers.map((user) => ({ userId: user.id, access: folderPermissions[user.id] || "none" })) }) });
      setPermissionMessage("Folder permissions saved.");
      const access = await queryApi<LibraryAccessExplanationPayload>(`/api/library/${permissionFolder.id}/access-explanation`, { force: true, tags: ["library", `library:${permissionFolder.id}:access`] });
      setPermissionAccess(access);
      scheduleWorkspaceRevalidation();
    } catch (reason) {
      setPermissionMessage(reason instanceof Error ? reason.message : "Folder permissions could not be saved.");
    } finally {
      setPermissionBusy(false);
    }
  }
  function toggleSelection(item: LibraryItem, checked: boolean) {
    if (checked && !selectedIds.has(item.id) && selectedIds.size >= MAX_LIBRARY_BULK_IDS) {
      setError(new Error(`Bulk actions are limited to ${MAX_LIBRARY_BULK_IDS} items. Apply the current selection before choosing more.`));
      return;
    }
    setSelectedIds((current) => { const next = new Set(current); if (checked && next.size < MAX_LIBRARY_BULK_IDS) next.add(item.id); else if (!checked) next.delete(item.id); return next; });
    if (checked) void selectItem(item);
  }

  async function toggleFavorite(item: LibraryItem) {
    const favorite = !favoriteIds.has(item.id);
    setFavoriteIds((current) => { const next = new Set(current); if (favorite) next.add(item.id); else next.delete(item.id); return next; });
    try {
      await mutateApi(`/api/library/${item.id}/favorite`, {
        method: "PUT",
        body: { favorite },
        label: `${favorite ? "Favorite" : "Unfavorite"} ${item.title}`,
        dedupeKey: `library:${item.id}:favorite`,
        entityType: "library",
        entityId: item.id,
        resourceKind: "library",
        resourceId: item.id,
        invalidate: ["/api/library"],
      });
      if (librarySection === "favorites" && !favorite) scheduleWorkspaceRevalidation();
    } catch (reason) {
      setFavoriteIds((current) => { const next = new Set(current); if (favorite) next.delete(item.id); else next.add(item.id); return next; });
      setError(reason instanceof Error ? reason : new Error("Could not update favorite."));
    }
  }

  async function awaitLibraryTransfer(operation: LibraryOperation, fileName: string, current: number, total: number) {
    let active = operation;
    for (let attempt = 0; attempt < 240; attempt += 1) {
      const operationProgress = Math.max(0, Math.min(100, Number(active.progress || 0)));
      setUploading((state) => ({ ...state, active: true, current, total, name: fileName, operationId: active.id, percent: Math.max(state.percent, Math.round(80 + operationProgress * 0.2)), message: active.progressMessage || (active.status === "queued" ? "Finalization queued…" : "Finalizing Library item…") }));
      if (active.status === "succeeded") return active;
      if (["failed", "dead-letter", "cancelled"].includes(active.status)) throw new Error(active.lastError || `Library transfer ${active.status}.`);
      const pollDelayMs = attempt < 8 ? 300 : attempt < 24 ? 750 : attempt < 60 ? 1_500 : 2_500;
      await new Promise((resolve) => window.setTimeout(resolve, pollDelayMs));
      const result = await api<LibraryTransferOperationResponse>(`/api/library/transfers/${active.id}`, { skipCacheInvalidation: true });
      active = result.operation;
    }
    throw new Error("Library transfer finalization did not finish before the client polling window ended.");
  }

  async function uploadSelection(files: File[], bundleMode = false, targetFolderId: string | null = folderId) {
    if (!files.length || uploading.active) return;
    setError(null); setStatus("");
    let completed = 0;
    let queued = 0;
    let lastUploaded: LibraryItem | null = null;
    const uploaded: Array<{ file: File; item: LibraryItem }> = [];
    const uploadBatchId = crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    try {
      for (const file of files) {
        const name = fileBundleName(file);
        uploadProgressUiRef.current = { at: 0, percent: -1, message: "" };
        setUploading({ active: true, current: completed + 1, total: files.length, name, percent: 0, message: "Preparing transfer…", uploadId: null, operationId: null });
        const upload = await uploadApi<LibraryTransferFinalizeResponse>("/api/library/transfers/finalize", {
          file,
          label: `Transfer ${name}`,
          body: {
            parentId: targetFolderId,
            projectId: filters.projectId || null,
            ownerId: currentUser.id,
            originalName: file.name,
            relativePath: file.webkitRelativePath || file.name,
            mimeType: file.type || "application/octet-stream",
            conflictPolicy: "rename",
            classification: "internal",
            tags: [],
            metadata: { browserLastModified: file.lastModified, browserRelativePath: file.webkitRelativePath || null, uploadBatchId },
          },
          invalidate: ["/api/library"],
          persistBeforeTransfer: false,
          onUploadSession: ({ id }) => setUploading((state) => ({ ...state, uploadId: id })),
          onProgress: (progress) => {
            const percent = Math.round(progress.percent * 0.8);
            const message = progress.phase === "verifying" ? "Transfer complete · verifying checksum…" : `${progress.percent}% transferred`;
            const now = performance.now();
            const previous = uploadProgressUiRef.current;
            if (percent < 80 && percent === previous.percent && message === previous.message && now - previous.at < 120) return;
            if (percent < 80 && now - previous.at < 90 && percent - previous.percent < 2 && message === previous.message) return;
            uploadProgressUiRef.current = { at: now, percent, message };
            setUploading((state) => ({ ...state, uploadId: progress.uploadId, percent: Math.max(state.percent, percent), message }));
          },
        });
        if (upload.queued) {
          queued += 1;
        } else if (upload.result?.operation) {
          const operation = await awaitLibraryTransfer(upload.result.operation, name, completed + 1, files.length);
          const receipt = operation.result && typeof operation.result === "object" ? (operation.result as Record<string, unknown>).receipt as Record<string, unknown> | undefined : undefined;
          const itemId = typeof receipt?.itemId === "string" ? receipt.itemId : null;
          if (!itemId) throw new Error("Library transfer completed without an item receipt.");
          const item = await api<LibraryItem>(`/api/library/${itemId}`, { skipCacheInvalidation: true });
          uploaded.push({ file, item });
          lastUploaded = item;
          setUploading((state) => ({ ...state, percent: 100, message: receipt?.postProcessing === "queued" ? "Transfer complete · previews processing in background" : "Transfer complete" }));
        }
        completed += 1;
        // Yield once per file so a large batch cannot starve paint/input between transfers.
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      }

      const modelUploads = uploaded.filter(({ file }) => MODEL_FILE_EXTENSIONS.has(fileExtension(file.name)));
      const companionUploads = uploaded.filter(({ file }) => MODEL_COMPANION_EXTENSIONS.has(fileExtension(file.name)));
      for (const modelUpload of modelUploads) {
        const companions = companionUploads
          .filter(({ item }) => item.id !== modelUpload.item.id)
          .slice(0, 128)
          .map(({ file, item }) => ({ id: item.id, name: fileBundleName(file), extension: item.extension || fileExtension(file.name), mimeType: item.mimeType || file.type || null }));
        while (companions.length > 1 && JSON.stringify(companions).length > 30_000) companions.pop();
        if (!companions.length) continue;
        const metadata: LibraryMetadata = { ...(modelUpload.item.metadata || {}), modelBundle: JSON.stringify(companions), modelBundleVersion: 1 };
        const linked = await api<LibraryItem>(`/api/library/${modelUpload.item.id}`, { method: "PATCH", body: JSON.stringify({ metadata, changelogNote: "Associated model materials and textures." }) });
        modelUpload.item = linked;
        lastUploaded = linked;
      }

      const modelCount = modelUploads.length;
      const onlineCount = completed - queued;
      const uploadedLabel = onlineCount ? `${onlineCount} transferred` : "";
      const queuedLabel = queued ? `${queued} queued for sync` : "";
      const summary = [uploadedLabel, queuedLabel, modelCount ? `${modelCount} model${modelCount === 1 ? "" : "s"} linked` : ""].filter(Boolean).join(" · ");
      setStatus(`${summary || "Transfer complete"}. Post-processing continues independently when required.`);
      if (onlineCount) scheduleWorkspaceRevalidation();
      if (lastUploaded) await selectItem(lastUploaded);
    } catch (reason) {
      setError(reason instanceof Error ? reason : new Error("Upload failed."));
    } finally {
      setUploading({ active: false, current: 0, total: 0, name: "", percent: 0, message: "", uploadId: null, operationId: null });
    }
  }

  function hasDraggedFiles(event: DragEvent<HTMLElement>) {
    return Array.from(event.dataTransfer.types || []).includes("Files");
  }

  function handleLibraryDragEnter(event: DragEvent<HTMLElement>) {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setDropActive(true);
  }

  function handleLibraryDragOver(event: DragEvent<HTMLElement>) {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    if (!dropActive) setDropActive(true);
  }

  function handleLibraryDragLeave(event: DragEvent<HTMLElement>) {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) return;
    setDropActive(false);
  }

  function handleLibraryDrop(event: DragEvent<HTMLElement>) {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    setDropActive(false);
    const files = Array.from(event.dataTransfer.files || []).filter((file) => file.size >= 0);
    if (!files.length) return;
    if (uploading.active) { setStatus("Finish the current transfer before starting another batch."); return; }
    void uploadSelection(files, false, folderId);
  }

  async function uploadFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    await uploadSelection(files, false);
  }

  async function uploadModelBundle(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    await uploadSelection(files, true);
  }


  async function createItem() {
    if (!createDraft?.title.trim()) return;
    try {
      const metadata: LibraryMetadata = createDraft.kind === "folder" ? { folderColor: createDraft.folderColor, folderIcon: createDraft.folderIcon } : {};
      const item = await api<LibraryItem>("/api/library", { method: "POST", body: JSON.stringify({ parentId: createDraft.parentId === undefined ? folderId : createDraft.parentId, projectId: filters.projectId || null, ownerId: currentUser.id, title: createDraft.title.trim(), body: createDraft.body || null, type: createDraft.kind, status: "active", priority: "medium", tags: [], externalUrl: createDraft.externalUrl || null, visibility: "internal", metadata }) });
      setCreateDraft(null);
      setStatus(item.type === "folder" ? "Folder created." : item.type === "youtube-playlist" ? "YouTube playlist added." : item.type === "youtube-video" ? "YouTube video added." : "Link added.");
      const explicitDifferentParent = createDraft.parentId !== undefined && createDraft.parentId !== folderId;
      if (!explicitDifferentParent) setItems((current) => current.some((entry) => entry.id === item.id) ? current.map((entry) => entry.id === item.id ? item : entry) : [item, ...current]);
      if (item.type === "folder") setFolders((current) => current.some((entry) => entry.id === item.id) ? current : [...current, item]);
      setApiQueryData(`/api/library/${item.id}`, item, { staleMs: 15_000, maxAgeMs: 5 * 60_000, tags: ["library", `library:${item.id}`] });
      scheduleWorkspaceRevalidation();
      if (item.type !== "folder") await selectItem(item);
    } catch (reason) { setError(reason instanceof Error ? reason : new Error("Could not create item.")); }
  }

  function openBulkGovernance() {
    if (bulkPendingRef.current || !currentUser.isAdmin || !selectedIds.size) return;
    const selected = items.filter((item) => selectedIds.has(item.id));
    if (selected.length !== selectedIds.size) {
      setError(new Error("Some selected Library items are not loaded. Refresh the selection before governance review."));
      return;
    }
    governanceQueryRef.current = queryKey;
    setGovernanceSelected(selected);
  }

  async function runBulk(action: "move" | "archive" | "restore" | "trash" | "pin" | "tag" | "untag" | "status", extra: Record<string, unknown> = {}) {
    if (!selectedIds.size || bulkPendingRef.current) return;
    if (["archive", "move", "trash"].includes(action) && selectedProtectedFolders.length) {
      setError(new Error("Packets and project Library folders are managed by Cluster and cannot be moved or archived."));
      return;
    }
    // Snapshot the selected IDs for confirmation and execution. Prevent concurrent
    // submissions even before React renders the pending state.
    const ids = [...selectedIds];
    bulkPendingRef.current = true;
    setBulkBusy(true);
    try {
      const destination = action === "move"
        ? ((extra.parentId ? folders.find((folder) => folder.id === extra.parentId)?.title : "Library root") || "Unknown folder")
        : (action === "tag" || action === "untag") ? String(extra.tag || "") : action === "status" ? String(extra.status || "") : "";
      const expectedRevisions = captureLibraryBulkRevisions(ids, items);
      // Folder trees use the R61 durable path. Ordinary flat edits retain the
      // existing atomic interactive operation and do not need a queue.
      if (action === "move" && ids.length <= 24 && items.some((item) => selectedIds.has(item.id) && item.type === "folder")) {
        const initialSerial = requestSerial.current;
        const parentId = typeof extra.parentId === "string" ? extra.parentId : null;
        const roots = ids.map((id) => ({ id, revision: expectedRevisions[id] }));
        const preview = await api<{ ok: true; roots: number; affected: number; digest: string; destinationId: string | null }>(
          "/api/library/bulk/hierarchy/move/preview", { method: "POST", body: JSON.stringify({ roots, parentId }) },
        );
        // A changed selection/destination or navigation invalidates the
        // confirmation; it must not silently move what the user no longer sees.
        if (initialSerial !== requestSerial.current ||
          ids.length !== selectedIdsLiveRef.current.size || ids.some((id) => !selectedIdsLiveRef.current.has(id)) ||
          (bulkFolderId || null) !== parentId) {
          throw new Error("Library selection or destination changed. Preview the move again.");
        }
        const accepted = await confirmCluster({
          title: `Queue move of ${preview.roots} Library root${preview.roots === 1 ? "" : "s"}`,
          message: `${preview.affected} items including descendants will change location under ${destination}. Each root commits separately. Cancellation does not undo roots already moved; storage repair runs as a separate durable job. Continue?`,
          confirmLabel: "Queue reviewed move", tone: "default",
        });
        if (!accepted) return;
        const queued = await api<{ ok: true; jobId: string; status: string }>("/api/library/bulk/hierarchy/move", {
          method: "POST", body: JSON.stringify({ roots, parentId, digest: preview.digest, requestKey: crypto.randomUUID() }),
        });
        try { window.sessionStorage.setItem("cluster.library.hierarchyMoveJob", queued.jobId); } catch { /* server retains job */ }
        setHierarchyMoveJob({ id: queued.jobId, status: queued.status, progress: 0,
          message: `Queued ${preview.affected} items across ${preview.roots} roots`, moved: 0, skipped: 0 });
        setStatus("The reviewed hierarchy move is queued. Committed roots and their storage-repair jobs are durable.");
        matchingSelectionRef.current = null;
        setSelectedIds(new Set());
        scheduleWorkspaceRevalidation();
        return;
      }
      if (["archive", "trash", "restore"].includes(action) &&
        items.some((item) => selectedIds.has(item.id) && item.type === "folder")) {
        if (ids.length > 24) throw new Error("Hierarchy lifecycle actions support at most 24 selected roots.");
        const initialSerial = requestSerial.current;
        const roots = ids.map((id) => ({ id, revision: expectedRevisions[id] }));
        const lifecycleAction = action as "archive" | "trash" | "restore";
        const preview = await api<{ roots: number; affected: number; preserved: number; digest: string }>(
          "/api/library/bulk/hierarchy/lifecycle/preview",
          { method: "POST", body: JSON.stringify({ roots, action: lifecycleAction }) },
        );
        if (initialSerial !== requestSerial.current ||
          ids.length !== selectedIdsLiveRef.current.size || ids.some((id) => !selectedIdsLiveRef.current.has(id)))
          throw new Error("Library selection changed. Review the hierarchy lifecycle action again.");
        const accepted = await confirmCluster({
          title: `${lifecycleAction === "trash" ? "Move to Trash" : lifecycleAction === "archive" ? "Archive" : "Restore"} ${preview.roots} hierarchy roots`,
          message: `${preview.affected} records reviewed, including descendants. ${preview.preserved} independently managed records will be preserved. Each root commits atomically with restore provenance. Cancellation keeps already committed roots; restoring a folder never revives separately trashed content. Continue?`,
          confirmLabel: `Queue ${lifecycleAction}`, tone: lifecycleAction === "trash" ? "danger" : "default",
        });
        if (!accepted) return;
        const queued = await api<{ jobId: string; status: string }>("/api/library/bulk/hierarchy/lifecycle", {
          method: "POST", body: JSON.stringify({ roots, action: lifecycleAction, digest: preview.digest, requestKey: crypto.randomUUID() }),
        });
        try { window.sessionStorage.setItem("cluster.library.hierarchyLifecycleJob", JSON.stringify({ id: queued.jobId, action: lifecycleAction })); }
        catch { /* durable server job remains */ }
        setHierarchyLifecycleJob({ id: queued.jobId, action: lifecycleAction, status: queued.status,
          progress: 0, message: `Queued ${preview.affected} reviewed records`, changed: 0, preserved: 0 });
        matchingSelectionRef.current = null;
        setSelectedIds(new Set());
        setStatus(`The hierarchy ${lifecycleAction} is queued. Each committed root retains its own recovery evidence.`);
        scheduleWorkspaceRevalidation();
        return;
      }
      // Authoritative access and recursive scope preflight. Do not confirm a destructive
      // folder action based solely on the currently loaded page of Library results.
      const recursive = ["move", "archive", "trash", "restore"].includes(action);
      const scope = recursive
        ? await api<LibraryBulkScopePreview>("/api/library/bulk/preview", { method: "POST", body: JSON.stringify({ ids, action, expectedRevisions, ...extra }) })
        : undefined;
      const impact = describeLibraryBulkImpact(action, ids, items, destination, scope);
      if (impact.needsConfirmation) {
        const approved = await confirmCluster({ title: impact.title, message: impact.message, confirmLabel: "Apply to selected", tone: action === "trash" ? "danger" : "default" });
        if (!approved) return;
      }
      const result = await api<{ ok: true; updated: number; committed?: boolean; reconciled?: boolean; warning?: string; reconciliationJobId?: string }>("/api/library/bulk", { method: "POST", body: JSON.stringify({ ids, action, expectedRevisions, ...extra }) });
      if (result.reconciliationJobId) {
        try { window.sessionStorage.setItem("cluster.library.storageRepairJob", result.reconciliationJobId); } catch { /* server job remains authoritative */ }
        setStorageRepair({ id: result.reconciliationJobId, status: "QUEUED", progress: 0, message: "File relocation queued", unresolved: null });
      }
      setStatus(result.reconciled === false
        ? (result.warning || "The Library move was committed, but storage reconciliation needs attention. Do not retry the move.")
        : `${impact.count} Library item${impact.count === 1 ? "" : "s"} updated (${action}).`);
      const completedIds = new Set(ids);
      if (["archive", "move", "trash"].includes(action)) setItems((current) => current.filter((item) => !completedIds.has(item.id)));
      matchingSelectionRef.current = null;
      setSelectedIds(new Set());
      setActiveId(null);
      setActiveItem(null);
      scheduleWorkspaceRevalidation();
    } catch (reason) {
      setError(reason instanceof Error ? reason : new Error("Bulk action failed."));
    } finally {
      bulkPendingRef.current = false;
      setBulkBusy(false);
    }
  }
  function editBulkRenameRule(patch: Partial<LibraryBulkRenameRule>) {
    setRenameRule((previous) => previous ? { ...previous, ...patch } : previous);
    setRenamePreview(null); // a changed rule always requires a new server preview
  }
  async function previewBulkRename() {
    if (!renameRule || !selectedIds.size || bulkPendingRef.current || renameBusy) return;
    setRenameBusy(true); setError(null);
    try {
      const ids = [...selectedIds];
      const expectedRevisions = captureLibraryBulkRevisions(ids, items);
      const rule = { ...renameRule };
      const preview = await api<LibraryBulkRenamePreview>('/api/library/bulk/preview', {
        method: 'POST', body: JSON.stringify({ action: 'rename', ids, expectedRevisions, rename: rule }),
      });
      setRenamePreview({ ...preview, ids, expectedRevisions, rule });
    } catch (cause) { setRenamePreview(null); setError(cause instanceof Error ? cause : new Error('Could not preview Library rename.')); }
    finally { setRenameBusy(false); }
  }
  async function applyBulkRename() {
    const preview = renamePreview;
    if (!preview || !renameRule || bulkPendingRef.current || renameBusy || !preview.changedCount) return;
    // No unreviewed selection or rules may slip into the mutation.
    if ([...selectedIds].sort().join('\0') !== [...preview.ids].sort().join('\0')
      || JSON.stringify(renameRule) !== JSON.stringify(preview.rule)) { setRenamePreview(null); setError(new Error('Selection or rule changed. Preview again.')); return; }
    bulkPendingRef.current = true; setRenameBusy(true); setBulkBusy(true); setError(null);
    try {
      await api('/api/library/bulk', { method: 'POST', body: JSON.stringify({
        action: 'rename', ids: preview.ids, expectedRevisions: preview.expectedRevisions,
        rename: preview.rule, confirmedTitles: Object.fromEntries(preview.renames.map((entry) => [entry.id, entry.to])),
      }) });
      setStatus(`Renamed ${preview.changedCount} Library item${preview.changedCount === 1 ? '' : 's'}.`);
      setRenameRule(null); setRenamePreview(null); matchingSelectionRef.current = null; setSelectedIds(new Set());
      scheduleWorkspaceRevalidation();
    } catch (cause) { setRenamePreview(null); setError(cause instanceof Error ? cause : new Error('Rename conflicted with newer Library changes.')); }
    finally { bulkPendingRef.current = false; setRenameBusy(false); setBulkBusy(false); }
  }
  /** Resolve the exact accessible result set on the server, including unloaded
   * pages. Reject >200 matches rather than silently executing a partial batch.
   */
  // Non-destructive bulk metadata operations use a separate durable job path.
  // Interactive selection remains capped at 200 and continues to use a single
  // atomic transaction. Neither path pretends that large moves/deletes are safe.
  async function queueMatchingMetadata(action: "tag" | "untag" | "pin" | "archive" | "unarchive", pinned?: boolean) {
    if (bulkPendingRef.current || loading || loadingMore || (librarySection === "collection" && (!activeCollection || activeCollection.accessRole === "viewer")) || query.trim() !== deferredQuery) return;
    const initialSerial = requestSerial.current;
    const startingCollection = librarySection === "collection" ? activeCollection : null;
    const startingSection = librarySection;
    const selectedTag = ["pin", "archive", "unarchive"].includes(action) ? undefined : (await promptCluster({
      title: action === "tag" ? "Tag matching Library items" : "Remove tag from matching Library items",
      message: "This applies to matching records across unloaded pages. Every item is rechecked before being changed.",
      label: "Exact tag", placeholder: "environment", confirmLabel: "Review matches",
    }))?.trim();
    if ((action === "tag" || action === "untag") && !selectedTag) return;
    if (requestSerial.current !== initialSerial) {
      setStatus("The Library view changed while editing. Review the new selection before queuing.");
      return;
    }
    const querySnapshot = {
      parentId: folderId || "root",
      scope: (deferredQuery || searchScope === "descendants") ? (searchScope === "library" ? "all" : searchScope) : "folder",
      section: librarySection, q: deferredQuery, ...filters,
    };
    bulkPendingRef.current = true;
    setBulkBusy(true);
    setError(null);
    const intent = startingSection === "collection" && startingCollection
      ? { action, tag: selectedTag, pinned, collectionId: startingCollection.id, expectedCollectionRevision: startingCollection.revision }
      : { action, tag: selectedTag, pinned, query: querySnapshot };
    try {
      const preview = await api<{ ok: true; count: number; digest: string; limit: number }>("/api/library/bulk/jobs/preview", {
        method: "POST", body: JSON.stringify(intent),
      });
      if (!preview.count) { setStatus("No accessible editable Library matches found."); return; }
      if (requestSerial.current !== initialSerial) throw new Error("The Library view changed after preview. Review the new selection before queuing.");
      const approved = await confirmCluster({
        title: `${action === "archive" ? "Archive" : action === "unarchive" ? "Restore from Archive" : "Update"} ${preview.count} Library items?`,
        message: `Queue a resumable ${action === "pin" ? (pinned ? "pin" : "unpin") : action} operation for ${preview.count} eligible accessible matches. ${action === "archive" ? "Archived files disappear from normal active views. They are not moved to Trash or deleted." : action === "unarchive" ? "Archived files return to Active; this does not restore deleted or trashed files." : "No files will be moved, archived, or deleted."} Files with changed permissions, revisions, edit locks, or hierarchy relationships will be skipped. Folders are excluded from background archive operations.`,
        confirmLabel: `Queue ${preview.count} ${action === "archive" ? "archives" : action === "unarchive" ? "restores" : "updates"}`,
      });
      if (!approved) return;
      if (requestSerial.current !== initialSerial) throw new Error("The Library view changed before confirmation. No job was queued.");
      // Keep the key stable for this one action intent, including after a lost response.
      const requestKey = crypto.randomUUID();
      const submit = () => api<{ ok: true; jobId: string; status: string; selectedCount: number }>("/api/library/bulk/jobs", {
        method: "POST", body: JSON.stringify({ ...intent, digest: preview.digest, requestKey }),
      });
      let accepted;
      try { accepted = await submit(); }
      catch (firstError) {
        // A timed-out HTTP response does not prove the server failed to enqueue.
        // One bounded retry with the SAME intent key resolves that ambiguity;
        // validation/authorization failures are never retried automatically.
        if (firstError instanceof ApiError && firstError.status < 500) throw firstError;
        try { accepted = await submit(); }
        catch { throw new Error("The queue outcome is uncertain. Check existing Library background operations before starting another edit."); }
      }
      try { window.sessionStorage.setItem("cluster.library.activeBulkJob", accepted.jobId); } catch { /* operations API remains authoritative */ }
      setBackgroundBulkJob({ id: accepted.jobId, count: accepted.selectedCount, status: accepted.status, progress: 0,
        message: "Queued for background processing", changed: 0, conflicted: 0, denied: 0, blocked: 0, skipped: 0 });
      setStatus(`${accepted.selectedCount} Library items queued. The operation can continue while you use other tools.`);
    } catch (reason) { setError(reason instanceof Error ? reason : new Error("Could not queue a Library bulk job.")); }
    finally { bulkPendingRef.current = false; setBulkBusy(false); }
  }

  useEffect(() => {
    const id = backgroundBulkJob?.id;
    if (!id || ["SUCCEEDED", "CANCELLED", "DEAD_LETTER"].includes(backgroundBulkJob?.status || "")) return;
    let disposed = false;
    let polling = false;
    async function refresh() {
      if (disposed || polling || document.visibilityState === "hidden") return;
      polling = true;
      try {
        const result = await api<{ ok: true; job: { id: string; status: string; progress: number; progressMessage?: string | null; lastError?: string | null }; checkpoint: { nextIndex: number; changed: number; conflicted: number; denied: number; blocked: number; skipped: number } | null }>(`/api/library/bulk/jobs/${encodeURIComponent(id!)}`);
        if (disposed) return;
        const checkpoint = result.checkpoint;
        setBackgroundBulkJob((current) => current && current.id === id ? {
          ...current, status: result.job.status, progress: result.job.progress,
          message: result.job.lastError || result.job.progressMessage || result.job.status.toLowerCase(),
          changed: checkpoint?.changed ?? 0, conflicted: checkpoint?.conflicted ?? 0,
          denied: checkpoint?.denied ?? 0, blocked: checkpoint?.blocked ?? 0, skipped: checkpoint?.skipped ?? 0,
        } : current);
        if (["SUCCEEDED", "CANCELLED", "DEAD_LETTER"].includes(result.job.status)) {
          try { window.sessionStorage.removeItem("cluster.library.activeBulkJob"); } catch { /* non-critical */ }
          scheduleWorkspaceRevalidation();
        }
      } catch (error) {
        if (!disposed) setBackgroundBulkJob((current) => current && current.id === id ? { ...current, message: `Status unavailable: ${error instanceof Error ? error.message : "Try again later"}` } : current);
      } finally { polling = false; }
    }
    void refresh();
    const interval = window.setInterval(() => void refresh(), 2500);
    document.addEventListener("visibilitychange", refresh);
    return () => { disposed = true; window.clearInterval(interval); document.removeEventListener("visibilitychange", refresh); };
  }, [backgroundBulkJob?.id, backgroundBulkJob?.status]);

  // A durable hierarchy operation can outlive this browser view. Poll only
  // while visible, and keep its opaque handle across Library navigation.
  useEffect(() => {
    const id = hierarchyMoveJob?.id;
    if (!id || ["SUCCEEDED", "CANCELLED", "DEAD_LETTER"].includes(hierarchyMoveJob?.status || "")) return;
    let disposed = false;
    let polling = false;
    async function refresh() {
      if (disposed || polling || document.visibilityState === "hidden") return;
      polling = true;
      try {
        const result = await api<{ job: { status: string; progress: number; progressMessage?: string | null; lastError?: string | null }; checkpoint: { nextIndex: number; moved: number; skipped: number } | null }>(
          `/api/library/bulk/hierarchy/move/${encodeURIComponent(id!)}`,
        );
        if (disposed) return;
        setHierarchyMoveJob((current) => current && current.id === id ? {
          ...current, status: result.job.status, progress: result.job.progress,
          message: result.job.lastError || result.job.progressMessage || result.job.status.toLowerCase(),
          moved: result.checkpoint?.moved ?? 0, skipped: result.checkpoint?.skipped ?? 0,
        } : current);
        if (["SUCCEEDED", "CANCELLED", "DEAD_LETTER"].includes(result.job.status)) {
          try { window.sessionStorage.removeItem("cluster.library.hierarchyMoveJob"); } catch { /* optional local state */ }
          scheduleWorkspaceRevalidation();
        }
      } catch (reason) {
        if (disposed) return;
        if (reason instanceof ApiError && [403, 404].includes(reason.status)) {
          try { window.sessionStorage.removeItem("cluster.library.hierarchyMoveJob"); } catch { /* optional local state */ }
          setHierarchyMoveJob((current) => current && current.id === id ? null : current);
        } else {
          setHierarchyMoveJob((current) => current && current.id === id ? { ...current, message: `Status unavailable: ${reason instanceof Error ? reason.message : "Retrying"}` } : current);
        }
      } finally { polling = false; }
    }
    void refresh();
    const interval = window.setInterval(() => void refresh(), 6000);
    document.addEventListener("visibilitychange", refresh);
    return () => { disposed = true; window.clearInterval(interval); document.removeEventListener("visibilitychange", refresh); };
  }, [hierarchyMoveJob?.id, hierarchyMoveJob?.status]);

  async function cancelHierarchyMove() {
    if (!hierarchyMoveJob || ["SUCCEEDED", "CANCELLED", "DEAD_LETTER"].includes(hierarchyMoveJob.status)) return;
    try {
      await api(`/api/library/bulk/hierarchy/move/${encodeURIComponent(hierarchyMoveJob.id)}/cancel`, { method: "POST" });
      setHierarchyMoveJob((current) => current ? { ...current, message: "Cancellation requested. Previously committed roots stay moved." } : current);
    } catch (reason) { setError(reason instanceof Error ? reason : new Error("Unable to cancel hierarchy move.")); }
  }

  useEffect(() => {
    const id = hierarchyLifecycleJob?.id;
    if (!id || ["SUCCEEDED", "CANCELLED", "DEAD_LETTER"].includes(hierarchyLifecycleJob?.status || "")) return;
    let disposed = false;
    let polling = false;
    async function refresh() {
      if (disposed || polling || document.visibilityState === "hidden") return;
      polling = true;
      try {
        const result = await api<{ job: { status: string; progress: number; progressMessage?: string | null; lastError?: string | null }; checkpoint: { changed: number; preserved: number } | null }>(
          `/api/library/bulk/hierarchy/lifecycle/${encodeURIComponent(id!)}`,
        );
        if (disposed) return;
        setHierarchyLifecycleJob((current) => current && current.id === id ? {
          ...current, status: result.job.status, progress: result.job.progress,
          message: result.job.lastError || result.job.progressMessage || result.job.status.toLowerCase(),
          changed: result.checkpoint?.changed ?? 0, preserved: result.checkpoint?.preserved ?? 0,
        } : current);
        if (["SUCCEEDED", "CANCELLED", "DEAD_LETTER"].includes(result.job.status)) {
          try { window.sessionStorage.removeItem("cluster.library.hierarchyLifecycleJob"); } catch { /* optional */ }
          scheduleWorkspaceRevalidation();
        }
      } catch (reason) {
        if (disposed) return;
        if (reason instanceof ApiError && [403, 404].includes(reason.status)) {
          try { window.sessionStorage.removeItem("cluster.library.hierarchyLifecycleJob"); } catch { /* optional */ }
          setHierarchyLifecycleJob((current) => current && current.id === id ? null : current);
        } else setHierarchyLifecycleJob((current) => current && current.id === id ? {
          ...current, message: `Status unavailable: ${reason instanceof Error ? reason.message : "Retrying"}`,
        } : current);
      } finally { polling = false; }
    }
    void refresh();
    const interval = window.setInterval(() => void refresh(), 6000);
    document.addEventListener("visibilitychange", refresh);
    return () => { disposed = true; window.clearInterval(interval); document.removeEventListener("visibilitychange", refresh); };
  }, [hierarchyLifecycleJob?.id, hierarchyLifecycleJob?.status]);

  async function cancelHierarchyLifecycle() {
    if (!hierarchyLifecycleJob || ["SUCCEEDED", "CANCELLED", "DEAD_LETTER"].includes(hierarchyLifecycleJob.status)) return;
    try {
      await api(`/api/library/bulk/hierarchy/lifecycle/${encodeURIComponent(hierarchyLifecycleJob.id)}/cancel`, { method: "POST" });
      setHierarchyLifecycleJob((current) => current ? { ...current,
        message: "Cancellation requested; previously committed roots remain changed." } : current);
    } catch (reason) { setError(reason instanceof Error ? reason : new Error("Unable to cancel hierarchy lifecycle job.")); }
  }

  // This is system maintenance after a committed move, never a second move.
  // Poll only while the Library is visible and only while the repair is active.
  useEffect(() => {
    const id = storageRepair?.id;
    if (!id || ["SUCCEEDED", "CANCELLED", "DEAD_LETTER"].includes(storageRepair?.status || "")) return;
    let disposed = false;
    let polling = false;
    async function refresh() {
      if (disposed || polling || document.visibilityState === "hidden") return;
      polling = true;
      try {
        const result = await api<{ ok: true; job: { status: string; progress: number; progressMessage?: string | null; lastError?: string | null; result?: { unresolved?: number; needsAttention?: boolean } | null } }>(`/api/library/storage/reconciliation/${encodeURIComponent(id!)}`);
        if (disposed) return;
        setStorageRepair((current) => current && current.id === id ? {
          ...current, status: result.job.status, progress: result.job.progress,
          message: result.job.lastError || result.job.progressMessage || result.job.status.toLowerCase(),
          unresolved: result.job.result?.unresolved ?? null,
        } : current);
        if (["SUCCEEDED", "CANCELLED", "DEAD_LETTER"].includes(result.job.status)) {
          try { window.sessionStorage.removeItem("cluster.library.storageRepairJob"); } catch { /* non-critical */ }
          scheduleWorkspaceRevalidation();
        }
      } catch (reason) {
        if (disposed) return;
        if (reason instanceof ApiError && [403, 404].includes(reason.status)) {
          // A different signed-in person must not inherit another user's
          // persisted job handle or poll an inaccessible background record.
          try { window.sessionStorage.removeItem("cluster.library.storageRepairJob"); } catch { /* non-critical */ }
          setStorageRepair((current) => current && current.id === id ? null : current);
          return;
        }
        setStorageRepair((current) => current && current.id === id ? { ...current, message: `Repair status temporarily unavailable: ${reason instanceof Error ? reason.message : "Retrying"}` } : current);
      } finally { polling = false; }
    }
    void refresh();
    const interval = window.setInterval(() => void refresh(), 6000);
    document.addEventListener("visibilitychange", refresh);
    return () => { disposed = true; window.clearInterval(interval); document.removeEventListener("visibilitychange", refresh); };
  }, [storageRepair?.id, storageRepair?.status]);

  async function startLibraryOrphanAudit() {
    if (orphanAuditStarting.current || (orphanAudit && !["SUCCEEDED", "CANCELLED", "DEAD_LETTER"].includes(orphanAudit.status))) return;
    orphanAuditStarting.current = true;
    try {
      const response = await api<{ jobId: string; status: string }>("/api/library/storage/orphans/audit", { method: "POST" });
      try { window.sessionStorage.setItem("cluster.library.orphanAuditJob", response.jobId); } catch { /* optional client recovery */ }
      setOrphanReview(null);
      setOrphanAudit({ id: response.jobId, status: response.status, progress: 0, message: "Read-only storage inventory queued" });
    } catch (reason) {
      setError(reason instanceof Error ? reason : new Error("Unable to start Library orphan audit."));
    } finally { orphanAuditStarting.current = false; }
  }

  async function reviewOrphanSample(relativePath: string) {
    if (orphanReviewPending.current || !orphanAudit?.id || orphanAudit.status !== "SUCCEEDED") return;
    orphanReviewPending.current = true;
    setOrphanReviewBusy(relativePath);
    try {
      const response = await api<{ review: { relativePath: string; status: string; blockers: string[] } }>(
        `/api/library/storage/orphans/audit/${encodeURIComponent(orphanAudit.id)}/review`,
        { method: "POST", body: JSON.stringify({ relativePath }) },
      );
      setOrphanReview(response.review);
    } catch (reason) {
      setError(reason instanceof Error ? reason : new Error("Unable to recheck this storage candidate."));
    } finally {
      orphanReviewPending.current = false;
      setOrphanReviewBusy(null);
    }
  }

  useEffect(() => {
    const id = orphanAudit?.id;
    if (!id || ["SUCCEEDED", "CANCELLED", "DEAD_LETTER"].includes(orphanAudit?.status || "")) return;
    let disposed = false;
    let fetching = false;
    async function refresh() {
      if (disposed || fetching || document.visibilityState === "hidden") return;
      fetching = true;
      try {
        const detail = await api<{ job: { status: string; progress: number; progressMessage?: string | null; lastError?: string | null; result?: NonNullable<NonNullable<typeof orphanAudit>["result"]> | null } }>(`/api/library/storage/orphans/audit/${encodeURIComponent(id!)}`);
        if (disposed) return;
        setOrphanAudit((current) => current && current.id === id ? {
          ...current, status: detail.job.status, progress: detail.job.progress,
          message: detail.job.lastError || detail.job.progressMessage || detail.job.status.toLowerCase(),
          result: detail.job.result ?? current.result,
        } : current);
        if (["SUCCEEDED", "CANCELLED", "DEAD_LETTER"].includes(detail.job.status)) {
          try { window.sessionStorage.removeItem("cluster.library.orphanAuditJob"); } catch { /* non-critical */ }
        }
      } catch (reason) {
        if (disposed) return;
        if (reason instanceof ApiError && [403, 404].includes(reason.status)) {
          try { window.sessionStorage.removeItem("cluster.library.orphanAuditJob"); } catch { /* non-critical */ }
          setOrphanAudit((current) => current && current.id === id ? null : current);
        } else {
          setOrphanAudit((current) => current && current.id === id ? { ...current, message: `Audit status unavailable: ${reason instanceof Error ? reason.message : "Retrying"}` } : current);
        }
      } finally { fetching = false; }
    }
    void refresh();
    const interval = window.setInterval(() => void refresh(), 6500);
    document.addEventListener("visibilitychange", refresh);
    return () => { disposed = true; window.clearInterval(interval); document.removeEventListener("visibilitychange", refresh); };
  }, [orphanAudit?.id, orphanAudit?.status]);

  async function cancelBackgroundBulk() {
    if (!backgroundBulkJob || ["SUCCEEDED", "CANCELLED", "DEAD_LETTER"].includes(backgroundBulkJob.status)) return;
    try {
      await api(`/api/library/bulk/jobs/${encodeURIComponent(backgroundBulkJob.id)}/cancel`, { method: "POST" });
      setBackgroundBulkJob((current) => current ? { ...current, message: "Cancellation requested. A committed chunk will not be undone." } : current);
    } catch (reason) { setError(reason instanceof Error ? reason : new Error("Unable to request cancellation.")); }
  }

  async function selectMatchingLibraryItems() {
    if (query.trim() !== deferredQuery || bulkPendingRef.current || loading || loadingMore || (librarySection === "collection" && !activeCollection)) return;
    const serial = requestSerial.current;
    const startingQuery = queryKey;
    bulkPendingRef.current = true;
    setBulkBusy(true);
    setError(null);
    try {
      const collectionAtStart = librarySection === "collection" ? activeCollection : null;
      const selection = collectionAtStart
        ? await api<{ ok: true; collectionRevision: number; selectedCount: number; items: LibraryItem[] }>(
          `/api/library/collections/${encodeURIComponent(collectionAtStart.id)}/select-matching`, {
            method: "POST", body: JSON.stringify({ expectedCollectionRevision: collectionAtStart.revision }),
          })
        : await api<{ ok: true; selectedCount: number; items: LibraryItem[] }>("/api/library/bulk/select-matching", {
          method: "POST",
          body: JSON.stringify({
            parentId: folderId || "root",
            scope: (deferredQuery || searchScope === "descendants") ? (searchScope === "library" ? "all" : searchScope) : "folder",
            section: librarySection, q: deferredQuery, ...filters,
          }),
        });
      // A navigation or filter change invalidates the selection snapshot.
      if (serial !== requestSerial.current || startingQuery !== liveSelectionQueryKeyRef.current) return;
      if (collectionAtStart && (!('collectionRevision' in selection) || selection.collectionRevision !== collectionAtStart.revision)) {
        throw new Error("Collection changed while selecting. Refresh and retry.");
      }
      if (selection.selectedCount !== selection.items.length || selection.items.length > MAX_LIBRARY_BULK_IDS) {
        throw new Error("Library returned an incomplete selection. No items were selected.");
      }
      matchingSelectionRef.current = { queryKey: startingQuery, items: selection.items };
      setItems(selection.items);
      setPagination({ cursor: null, hasMore: false, limit: PAGE_SIZE, loaded: selection.items.length });
      setSelectedIds(new Set(selection.items.map((item) => item.id)));
      setStatus(selection.items.length
        ? `Selected all ${selection.items.length} accessible ${collectionAtStart ? "collection items" : "Library matches"}, including unloaded pages. Permissions and revisions will be rechecked on apply.`
        : "No accessible Library items match these filters.");
    } catch (reason) {
      if (serial === requestSerial.current) setError(reason instanceof Error ? reason : new Error("Could not select matching Library items."));
    } finally {
      bulkPendingRef.current = false;
      setBulkBusy(false);
    }
  }
  function selectLoadedLibraryItems() {
    const eligible = items.slice(0, MAX_LIBRARY_BULK_IDS);
    setSelectedIds(new Set(eligible.map((item) => item.id)));
    setStatus(items.length > MAX_LIBRARY_BULK_IDS
      ? `Selected the first ${MAX_LIBRARY_BULK_IDS} loaded items. The server limits bulk actions to ${MAX_LIBRARY_BULK_IDS} at a time.`
      : `Selected ${eligible.length} loaded item${eligible.length === 1 ? "" : "s"}. Unloaded search results are not included.`);
  }
  function exportSelectedLibraryMetadata() {
    if (!selectedIds.size || bulkPendingRef.current) return;
    const selected = items.filter((item) => selectedIds.has(item.id)).slice(0, MAX_LIBRARY_BULK_IDS);
    if (selected.length !== selectedIds.size) { setError(new Error("Some selected records are no longer loaded. Refresh before exporting.")); return; }
    // Prevent spreadsheet formula injection: content from Library item titles,
    // tags, and descriptions is untrusted even when viewed by an admin.
    const cell = (value: unknown) => {
      let text = String(value ?? "").replace(/\r?\n/g, " ");
      if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
      return `"${text.replaceAll('"', '""')}"`;
    };
    const rows = [["ID", "Title", "Type", "Status", "Project ID", "Owner ID", "Parent ID", "Revision", "Tags", "Updated at"],
      ...selected.map((item) => [item.id, item.title, item.type, item.status, item.projectId || "", item.ownerId || "", item.parentId || "", String(item.revision), (item.tags || []).join("; "), item.updatedAt])];
    const csv = `\uFEFF${rows.map((row) => row.map(cell).join(",")).join("\r\n")}\r\n`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    try {
      const link = document.createElement("a"); link.href = url; link.download = `cluster-library-selection-${new Date().toISOString().slice(0, 10)}.csv`;
      link.style.display = "none"; document.body.appendChild(link); link.click(); link.remove();
      setStatus(`Exported metadata for ${selected.length} currently loaded Library items. File contents were not exported.`);
    } finally { window.setTimeout(() => URL.revokeObjectURL(url), 30_000); }
  }
  async function copySelectedLibraryIds() {
    const copied = await copyClusterText([...selectedIds].join("\n"));
    setStatus(copied ? `Copied ${selectedIds.size} Library ID${selectedIds.size === 1 ? "" : "s"}.` : "Clipboard is unavailable. No IDs were copied.");
  }
  async function bulkAddTag() {
    if (!selectedIds.size) return;
    const tag = (await promptCluster({ title: "Tag selected Library items", message: "Add one tag to every selected item. Existing tags are preserved.", label: "Tag", placeholder: "environment", confirmLabel: "Add tag" }))?.trim();
    if (!tag) return;
    await runBulk("tag", { tag });
  }
  async function bulkRemoveTag() {
    if (!selectedIds.size || bulkPendingRef.current) return;
    const selected = items.filter((item) => selectedIds.has(item.id));
    const available = [...new Set(selected.flatMap((item) => item.tags || []))].sort((a, b) => a.localeCompare(b));
    if (!available.length) { setStatus("Selected Library items have no tags to remove."); return; }
    const tag = (await promptCluster({ title: "Remove a tag from selected items", message: `Available tags: ${available.slice(0, 30).join(", ")}${available.length > 30 ? "…" : ""}. Other tags will remain unchanged.`, label: "Exact tag", placeholder: available[0], confirmLabel: "Remove tag" }))?.trim();
    if (!tag) return;
    if (!available.includes(tag)) { setError(new Error("That tag is not present in the selected Library items.")); return; }
    await runBulk("untag", { tag });
  }
  async function addSelectedToCollection(collection: LibraryCollection) {
    if (!selectedIds.size || bulkPendingRef.current || collection.kind !== "manual") return;
    const ids = [...selectedIds];
    bulkPendingRef.current = true;
    setBulkBusy(true);
    try {
      const expectedRevisions = captureLibraryBulkRevisions(ids, items);
      if (ids.length >= 25 && !(await confirmCluster({ title: `Add ${ids.length} items to ${collection.name}?`, message: "This adds references to a manual collection without moving or duplicating any Library files.", confirmLabel: "Add to collection" }))) return;
      const result = await api<{ ok: true; added: number; collection: LibraryCollection }>(`/api/library/collections/${encodeURIComponent(collection.id)}/items`, { method: "POST", body: JSON.stringify({ itemIds: ids, expectedRevisions, expectedCollectionRevision: collection.revision }) });
      setCollections((current) => current.map((entry) => entry.id === collection.id ? result.collection : entry));
      setActiveCollection((current) => current?.id === collection.id ? result.collection : current);
      setStatus(`Added ${result.added} new item${result.added === 1 ? "" : "s"} to ${collection.name}. Existing members were left unchanged.`);
      setSelectedIds(new Set());
      scheduleWorkspaceRevalidation();
    } catch (reason) { setError(reason instanceof Error ? reason : new Error("Could not update collection. Refresh the Library and retry.")); }
    finally { bulkPendingRef.current = false; setBulkBusy(false); }
  }
  async function removeSelectedFromCollection() {
    const collection = activeCollection;
    if (!collection || collection.kind !== "manual" || !selectedIds.size || bulkPendingRef.current) return;
    const ids = [...selectedIds];
    bulkPendingRef.current = true;
    setBulkBusy(true);
    try {
      if (!(await confirmCluster({ title: `Remove ${ids.length} collection reference${ids.length === 1 ? "" : "s"}?`, message: `Remove selected references from ${collection.name}? The original Library files and their folders will not be changed.`, confirmLabel: "Remove references" }))) return;
      const result = await api<{ ok: true; removed: number; collection: LibraryCollection }>(`/api/library/collections/${encodeURIComponent(collection.id)}/items`, { method: "DELETE", body: JSON.stringify({ itemIds: ids, expectedCollectionRevision: collection.revision }) });
      setCollections((current) => current.map((entry) => entry.id === collection.id ? result.collection : entry));
      setActiveCollection((current) => current?.id === collection.id ? result.collection : current);
      setItems((current) => current.filter((item) => !ids.includes(item.id)));
      setStatus(`Removed ${result.removed} reference${result.removed === 1 ? "" : "s"} from ${collection.name}; original files were not modified.`);
      setSelectedIds(new Set());
      setActiveItem(null);
      setActiveId(null);
      scheduleWorkspaceRevalidation();
    } catch (reason) { setError(reason instanceof Error ? reason : new Error("Could not remove collection references. Refresh and retry.")); }
    finally { bulkPendingRef.current = false; setBulkBusy(false); }
  }
  function beginCreateFolder(parentId: string | null = folderId) {
    setCreateDraft({ kind: "folder", title: "", body: "", externalUrl: "", folderColor: FOLDER_COLORS[0], folderIcon: "folder", parentId });
  }
  async function reorderLibraryItem(sourceId: string, targetId: string) {
    if (!reorderEnabled || sourceId === targetId) return;
    const before = items;
    const sourceIndex = before.findIndex((item) => item.id === sourceId);
    const targetIndex = before.findIndex((item) => item.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const optimistic = [...before];
    const [moved] = optimistic.splice(sourceIndex, 1);
    optimistic.splice(Math.max(0, optimistic.findIndex((item) => item.id === targetId)), 0, moved);
    setItems(optimistic);
    try {
      await api(`/api/library/${encodeURIComponent(sourceId)}/reorder`, { method: "POST", body: JSON.stringify({ targetId, position: "before" }) });
      setStatus("Custom Library order saved.");
      scheduleWorkspaceRevalidation();
    } catch (reason) {
      setItems(before);
      setError(reason instanceof Error ? reason : new Error("Could not save custom Library order."));
    }
  }

  function handleSaved(item: LibraryItem) {
    const repair = item as LibraryItem & { reconciled?: boolean; reconciliationJobId?: string; reconciliationJobStatus?: string; warning?: string };
    setActiveItem(item);
    setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, ...item } : entry));
    setFolders((current) => current.map((entry) => entry.id === item.id ? { ...entry, ...item } : entry));
    setApiQueryData(`/api/library/${item.id}`, item, { staleMs: 15_000, maxAgeMs: 5 * 60_000, tags: ["library", `library:${item.id}`] });
    if (repair.reconciliationJobId) {
      try { window.sessionStorage.setItem("cluster.library.storageRepairJob", repair.reconciliationJobId); } catch { /* optional local progress restoration */ }
      setStorageRepair({ id: repair.reconciliationJobId, status: repair.reconciliationJobStatus || "QUEUED", progress: 0, message: "Library file reconciliation queued", unresolved: null });
    }
    setStatus(repair.reconciled === false
      ? repair.warning || "The Library edit was saved but file reconciliation needs attention. Do not repeat the edit."
      : "Library item updated.");
    scheduleWorkspaceRevalidation();
  }
  function smartCollectionQueryFromCurrentView() {
    const conditions: Array<{ fieldId: string; operator: string; value?: unknown }> = [];
    if (filters.projectId) conditions.push({ fieldId: "projectId", operator: "equals", value: filters.projectId });
    if (librarySection === "folder" && searchScope === "folder") conditions.push({ fieldId: "parentId", operator: "equals", value: folderId });
    if (filters.ownerId) conditions.push({ fieldId: "ownerId", operator: "equals", value: filters.ownerId });
    if (filters.type !== "all") conditions.push({ fieldId: "type", operator: "equals", value: filters.type });
    if (filters.status !== "all") conditions.push({ fieldId: "status", operator: "equals", value: filters.status });
    if (filters.mimeGroup !== "all") conditions.push({ fieldId: "mimeGroup", operator: "equals", value: filters.mimeGroup });
    if (filters.visibility !== "all") conditions.push({ fieldId: "visibility", operator: "equals", value: filters.visibility });
    if (filters.pinned !== "all") conditions.push({ fieldId: "pinned", operator: "equals", value: filters.pinned === "yes" });
    if (filters.tag.trim()) conditions.push({ fieldId: "tags", operator: "contains", value: filters.tag.trim() });
    if (filters.modified !== "any") {
      const days = filters.modified === "day" ? 1 : filters.modified === "week" ? 7 : filters.modified === "month" ? 30 : 365;
      conditions.push({ fieldId: "updatedAt", operator: "greater_or_equal", value: `last-${days}-days` });
    }
    const [sortField, sortDirection] = filters.sort === "custom" ? ["manualOrder", "asc"] : filters.sort === "created-desc" ? ["createdAt", "desc"] : filters.sort === "title-asc" ? ["title", "asc"] : filters.sort === "title-desc" ? ["title", "desc"] : filters.sort === "size-desc" ? ["sizeBytes", "desc"] : filters.sort === "size-asc" ? ["sizeBytes", "asc"] : ["updatedAt", "desc"];
    return {
      ...(deferredQuery ? { search: deferredQuery } : {}),
      ...(librarySection === "folder" && searchScope === "descendants" && folderId ? { folderScope: { mode: "descendants", folderId } } : {}),
      filters: conditions.length ? { logic: "and", conditions } : null,
      sorts: [{ fieldId: sortField, direction: sortDirection }],
      page: { limit: 250 },
    };
  }

  function openCollection(collection: LibraryCollection) {
    setActiveCollection(collection);
    setLibrarySection("collection");
    setFolderId(null);
    setActiveItem(null); setActiveId(null); setSelectedIds(new Set());
  }

  async function refreshLibraryCollectionShares(collection: LibraryCollection) {
    const result = await api<{ ok: true; revision: number; grants: LibraryCollectionGrant[] }>(`/api/library/collections/${encodeURIComponent(collection.id)}/shares`, { skipCacheInvalidation: true });
    setSharingGrants(result.grants);
    setSharingCollection((current) => current?.id === collection.id ? { ...current, revision: result.revision } : current);
    return result;
  }

  async function openLibraryCollectionSharing(collection: LibraryCollection) {
    if (collection.accessRole !== "owner") return;
    setSharingCollection(collection);
    setSharingGrants([]);
    setSharingNotice("");
    setSharingUserId("");
    setSharingRole("viewer");
    setSharingLoading(true);
    try { await refreshLibraryCollectionShares(collection); }
    catch (reason) { setError(reason instanceof Error ? reason : new Error("Could not read collection sharing.")); setSharingCollection(null); }
    finally { setSharingLoading(false); }
  }

  async function changeLibraryCollectionGrant(userId: string, role: "viewer" | "editor" | null) {
    const collection = sharingCollection;
    if (!collection || sharingPendingRef.current) return;
    sharingPendingRef.current = true;
    setSharingBusy(true);
    setSharingNotice("");
    try {
      const result = await api<{ ok: true; collection: LibraryCollection }>(`/api/library/collections/${encodeURIComponent(collection.id)}/shares/${encodeURIComponent(userId)}`, {
        method: role ? "PUT" : "DELETE",
        body: JSON.stringify({ ...(role ? { role } : {}), expectedRevision: collection.revision }),
      });
      setSharingCollection(result.collection);
      setCollections((current) => current.map((entry) => entry.id === collection.id ? result.collection : entry));
      setActiveCollection((current) => current?.id === collection.id ? result.collection : current);
      // The grant was committed. A failed follow-up roster fetch is not a failed mutation.
      try { await refreshLibraryCollectionShares(result.collection); }
      catch { setSharingNotice("Access was updated, but the current sharing roster could not be refreshed. Close and reopen Share before making another change."); setStatus("Collection access saved. Sharing roster needs refreshing."); return; }
      setStatus(role ? "Collection access updated. File permissions remain unchanged." : "Collection access revoked.");
      if (role) setSharingUserId("");
    } catch (reason) {
      setError(reason instanceof Error ? reason : new Error("Could not change collection access."));
      // A conflicting revision must never be retried from the old state.
      try {
        const fresh = await api<{ ok: true; collections: LibraryCollection[] }>("/api/library/collections", { skipCacheInvalidation: true });
        const latest = fresh.collections.find((entry) => entry.id === collection.id);
        if (latest) {
          setCollections(fresh.collections);
          setSharingCollection(latest);
          await refreshLibraryCollectionShares(latest);
        }
      } catch { /* Preserve the visible error; the user may close and reopen sharing. */ }
    } finally { sharingPendingRef.current = false; setSharingBusy(false); }
  }

  async function createLibraryCollection(kind: "manual" | "smart") {
    if (kind === "smart" && librarySection === "collection") {
      setError(new Error("Open a Library folder or view before saving its filters as a new Smart Collection."));
      return;
    }
    if (kind === "smart" && librarySection === "folder" && searchScope === "descendants" && !folderId) {
      setError(new Error("Choose a folder to save a recursive Smart Collection, or select Entire Library."));
      return;
    }
    const suggested = kind === "smart" ? "Current Library view" : "New collection";
    const name = (await promptCluster({ title: kind === "smart" ? "Name this smart collection" : "Name this collection", message: kind === "smart" ? "Save the current Library filters and sorting as a reusable smart collection." : "Create a reusable manual Library collection.", label: "Collection name", initialValue: suggested, confirmLabel: "Create collection" }))?.trim();
    if (!name) return;
    try {
      const result = await api<{ ok: true; collection: LibraryCollection }>("/api/library/collections", { method: "POST", body: JSON.stringify({ name, kind, projectId: filters.projectId || null, ...(kind === "smart" ? { query: smartCollectionQueryFromCurrentView() } : {}) }) });
      setCollections((current) => [result.collection, ...current.filter((entry) => entry.id !== result.collection.id)]);
      setStatus(kind === "smart" ? "Smart collection saved from the current view." : "Collection created.");
      openCollection(result.collection);
    } catch (reason) { setError(reason instanceof Error ? reason : new Error("Could not create Library collection.")); }
  }

  async function renameLibraryCollection(collection: LibraryCollection) {
    const name = (await promptCluster({ title: "Rename collection", message: "Collection membership stays intact.", label: "Collection name", initialValue: collection.name, confirmLabel: "Rename" }))?.trim();
    if (!name || name === collection.name) return;
    try {
      const result = await api<{ ok: true; collection: LibraryCollection }>(`/api/library/collections/${collection.id}`, { method: "PATCH", body: JSON.stringify({ name, expectedRevision: collection.revision }) });
      setCollections((current) => current.map((entry) => entry.id === collection.id ? result.collection : entry));
      setActiveCollection((current) => current?.id === collection.id ? result.collection : current);
      setStatus("Collection renamed.");
    } catch (reason) { setError(reason instanceof Error ? reason : new Error("Could not rename Library collection.")); }
  }

  async function updateSmartCollectionFromCurrentView(collection: LibraryCollection) {
    if (collection.kind !== "smart") return;
    if (librarySection === "collection") {
      setError(new Error("Open a Library folder or view and adjust its filters before updating Smart Collection rules."));
      return;
    }
    if (librarySection === "folder" && searchScope === "descendants" && !folderId) {
      setError(new Error("Choose a folder for recursive scope before saving these rules."));
      return;
    }
    try {
      const result = await api<{ ok: true; collection: LibraryCollection }>(`/api/library/collections/${collection.id}`, { method: "PATCH", body: JSON.stringify({ query: smartCollectionQueryFromCurrentView(), expectedRevision: collection.revision }) });
      setCollections((current) => current.map((entry) => entry.id === collection.id ? result.collection : entry));
      setActiveCollection((current) => current?.id === collection.id ? result.collection : current);
      setStatus("Smart collection updated from the current Library view.");
      if (activeCollection?.id === collection.id) scheduleWorkspaceRevalidation();
    } catch (reason) { setError(reason instanceof Error ? reason : new Error("Could not update smart collection.")); }
  }

  async function deleteLibraryCollection(collection: LibraryCollection) {
    const confirmed = await confirmCluster({ title: "Remove collection?", message: `Remove ${collection.name}? Library items are not deleted.`, confirmLabel: "Remove collection", tone: "danger" });
    if (!confirmed) return;
    try {
      await api(`/api/library/collections/${collection.id}`, { method: "DELETE", body: JSON.stringify({ expectedRevision: collection.revision }) });
      setCollections((current) => current.filter((entry) => entry.id !== collection.id));
      if (activeCollection?.id === collection.id) { setActiveCollection(null); setLibrarySection("folder"); setFolderId(null); }
      setStatus("Collection removed. Library items were left intact.");
    } catch (reason) { setError(reason instanceof Error ? reason : new Error("Could not remove Library collection.")); }
  }

  function clearFilters() { setFilters({ projectId: "", ownerId: "", type: "all", status: "active", mimeGroup: "all", visibility: "all", modified: "any", tag: "", pinned: "all", sort: "updated-desc" }); setQuery(""); }
  function openLibrarySection(section: LibrarySection) { setLibrarySection(section); if (section !== "collection") setActiveCollection(null); if (section !== "folder") setFolderId(null); setActiveItem(null); setActiveId(null); setSelectedIds(new Set()); }

  const currentFolder = folders.find((folder) => folder.id === folderId) || null;
  const parentFolderId = currentFolder?.parentId || null;
  const sectionLabel = librarySection === "collection" ? (activeCollection?.name || "Collection") : ({ folder: "Library", recent: "Recent", favorites: "Favorites", shared: "Shared with me", created: "Created by me", generated: "Generated", trash: "Trash" } as Record<Exclude<LibrarySection, "collection">, string>)[librarySection];
  const storageBytes = items.reduce((sum, item) => sum + Number(item.sizeBytes || 0), 0);
  const popularTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of items) for (const raw of item.tags || []) { const tag = String(raw || "").trim(); if (tag) counts.set(tag, (counts.get(tag) || 0) + 1); }
    return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, 8);
  }, [items]);
  const searchScopeLabel = searchScope === "folder" ? "This folder" : searchScope === "descendants" ? "Folder + subfolders" : searchScope === "project" ? "Current project" : "Entire Library";
  const activeFilterCount = Object.entries(filters).filter(([key, value]) => !(["projectId", "ownerId", "tag"].includes(key) ? !value : ["type", "mimeGroup", "visibility"].includes(key) ? value === "all" : key === "activity" ? value === "active" : key === "modified" ? value === "any" : key === "pinned" ? value === "all" : key === "sort" ? value === "updated-desc" : false)).length + (query ? 1 : 0);
  const savedLibraryView = useMemo(() => ({ ...filters, query, layout, searchScope, groupBy }), [filters, query, layout, searchScope, groupBy]);
  function applySavedLibraryView(values: Record<string, string>) {
    setQuery(values.query || "");
    if (["folder", "descendants", "project", "library"].includes(values.searchScope || "")) setSearchScope(values.searchScope as LibrarySearchScope);
    if (["none", "type", "project", "review"].includes(values.groupBy || "")) setGroupBy(values.groupBy as LibraryGroupMode);
    if (["grid", "compact-grid", "list", "details"].includes(values.layout || "")) setLayout(values.layout as LayoutMode);
    setFilters((current) => ({
      ...current,
      projectId: values.projectId ?? current.projectId, ownerId: values.ownerId ?? current.ownerId, type: values.type || "all",
      status: values.status || "active", mimeGroup: values.mimeGroup || "all", visibility: values.visibility || "all",
      modified: values.modified || "any", tag: values.tag || "", pinned: ["all", "yes", "no"].includes(values.pinned || "") ? values.pinned as LibraryFilters["pinned"] : "all", sort: values.sort || "updated-desc",
    }));
    setSelectedIds(new Set());
  }

  return <section className="page cluster-page-shell cluster-specialist-workspace cluster-library-workspace cluster-tool-page-v228 library-workspace-v217">
    <ToolPageHeader
      className="cluster-page-header"
      title="Library"
      description="Files, references, and project assets."
      metrics={[
        { label: "Items", value: facets.total },
        { label: "Folders", value: facets.byType.folder || 0 },
        { label: "Loaded", value: formatBytes(storageBytes) }
      ]}
      actions={<><ClusterInput ref={fileInput} type="file" multiple hidden onChange={uploadFiles} /><ClusterInput ref={modelBundleInput} type="file" multiple hidden onChange={uploadModelBundle} {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} /><ClusterButton variant="primary" disabled={uploading.active} onClick={() => fileInput.current?.click()}>{uploading.active ? "Uploading…" : "Upload files"}</ClusterButton><ClusterButton variant="secondary" onClick={() => setCreateDraft({ kind: "link", title: "", body: "", externalUrl: "", folderColor: FOLDER_COLORS[0], folderIcon: "folder" })}><LibraryIcon name="link" size={16} />Add link</ClusterButton><ClusterActionMenu label="More Library actions" items={[{ id: "upload-model-bundle", label: "Upload model bundle", description: "Import a model with its companion files.", onSelect: () => modelBundleInput.current?.click() }]} /></>}
    />
    {activeItem?.projectId ? <ProjectCollaborationStrip tool="library" projectId={activeItem.projectId} activity={`Library · ${activeItem.title}`} /> : null}
    <PinnedShelf items={pinnedItems} onOpen={(item) => item.type === "folder" ? void selectItem(item) : void openItemViewer(item)} />

    <section className={`library-browser-shell-v217${dropActive ? " is-drop-target-v531" : ""}`} onDragEnter={handleLibraryDragEnter} onDragOver={handleLibraryDragOver} onDragLeave={handleLibraryDragLeave} onDrop={handleLibraryDrop}>
      {dropActive ? <div className="library-drop-overlay-v531" aria-hidden="true"><span><LibraryIcon name="upload" size={28} /></span><strong>Drop files to upload</strong><small>{folderId ? `Into ${currentFolder?.title || "this folder"}` : "Into Library"}</small></div> : null}
      <div className="library-filterbar-v219">
        <div className="library-filter-primary-v219 cluster-dense-toolbar">
          <ClusterButton unstyled type="button" className={`library-explorer-toggle-v10${explorerCollapsed ? " is-collapsed" : ""}`} onClick={() => setExplorerCollapsed(!explorerCollapsed)} title={explorerCollapsed ? "Show Library Explorer" : "Hide Library Explorer"} aria-label={explorerCollapsed ? "Show Library Explorer" : "Hide Library Explorer"} aria-pressed={!explorerCollapsed}><LibraryIcon name="folder" size={17} /><span>Explorer</span></ClusterButton>
          <div className="library-search-v217"><LibraryIcon name="search" size={18} /><ClusterTextInput type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search · ${searchScopeLabel}`} aria-label={`Search Library · ${searchScopeLabel}`} />{query && <ClusterButton unstyled type="button" onClick={() => setQuery("")} aria-label="Clear search"><LibraryIcon name="close" size={16} /></ClusterButton>}</div>
          <ClusterSelect value={filters.projectId} onChange={(projectId) => setFilters((value) => ({ ...value, projectId }))} ariaLabel="Filter Library by project" options={[{ value: "", label: "All projects" }, ...projects.filter((project) => !project.archived).map((project) => ({ value: project.id, label: project.name }))]} />
          <ClusterSelect value={filters.mimeGroup} onChange={(mimeGroup) => setFilters((value) => ({ ...value, mimeGroup }))} ariaLabel="Filter Library by media type" options={[{ value: "all", label: "All files" }, { value: "image", label: "Images" }, { value: "video", label: "Video" }, { value: "audio", label: "Audio" }, { value: "pdf", label: "PDFs" }, { value: "text", label: "Text and code" }, { value: "model", label: "3D models" }, { value: "office", label: "Documents and Office" }, { value: "ebook", label: "E-books" }, { value: "archive", label: "Archives" }]} />
          <ClusterSelect value={filters.sort} onChange={(sort) => setFilters((value) => ({ ...value, sort }))} ariaLabel="Sort Library" options={[{ value: "updated-desc", label: "Recently updated" }, { value: "created-desc", label: "Recently added" }, { value: "title-asc", label: "Name A–Z" }, { value: "title-desc", label: "Name Z–A" }, { value: "size-desc", label: "Largest first" }, { value: "size-asc", label: "Smallest first" }, { value: "custom", label: "Custom order" }]} />
          <ClusterButton unstyled type="button" className={`library-filter-toggle-v219${showFilters ? " active" : ""}`} onClick={() => setShowFilters((value) => !value)}>Filters{activeFilterCount > 0 ? ` · ${activeFilterCount}` : ""}</ClusterButton>
          <div className="library-views-anchor-v22"><ClusterButton unstyled type="button" className={`library-saved-toggle-v21${showSavedViews ? " active" : ""}`} onClick={() => setShowSavedViews((value) => !value)} aria-expanded={showSavedViews} aria-haspopup="true" aria-label={showSavedViews ? "Hide saved views" : "Show saved views"} title="Saved Library views"><LibraryIcon name="star" size={16}/><span>Views</span></ClusterButton>
          {showSavedViews ? <div className="library-views-flyout-v22" role="region" aria-label="Saved Library views"><header><strong>Saved views</strong><ClusterButton size="compact" variant="quiet" onClick={() => setShowSavedViews(false)} aria-label="Close saved views"><LibraryIcon name="close" size={15}/></ClusterButton></header><SavedViewsToolbar scope="library.workspace" label="Library" current={savedLibraryView} autoRestore={false} onApply={(values) => { applySavedLibraryView(values); setShowSavedViews(false); }} /></div> : null}</div>
          <ClusterButton unstyled type="button" className={`library-pin-filter-v217${filters.pinned === "yes" ? " active" : ""}`} onClick={() => setFilters((value) => ({ ...value, pinned: value.pinned === "yes" ? "all" : "yes" }))} aria-label="Show pinned files"><LibraryIcon name="star" size={16} /></ClusterButton>
          <ClusterSegmentedControl value={layout} onChange={setLayout} label="Library layout" size="compact" options={[{ value: "grid", label: "Grid" }, { value: "compact-grid", label: "Compact" }, { value: "list", label: "List" }, { value: "details", label: "Details" }]} />
        </div>
        {showFilters && <div className="library-filter-advanced-v219">
          <ClusterSelect value={searchScope} onChange={(value) => setSearchScope(value as LibrarySearchScope)} ariaLabel="Library search scope" options={[{ value: "folder", label: "Search current folder" }, { value: "descendants", label: "Folder + subfolders" }, { value: "project", label: "Current project" }, { value: "library", label: "Entire Library" }]} />
          <ClusterSelect value={filters.type} onChange={(type) => setFilters((value) => ({ ...value, type }))} ariaLabel="Filter Library item type" options={[{ value: "all", label: "All item types" }, { value: "file", label: "Files" }, { value: "folder", label: "Folders" }, { value: "link", label: "Links" }, { value: "youtube-video", label: "YouTube videos" }, { value: "youtube-playlist", label: "YouTube playlists" }]} />
          <ClusterSelect value={filters.ownerId} onChange={(ownerId) => setFilters((value) => ({ ...value, ownerId }))} ariaLabel="Filter Library owner" options={[{ value: "", label: "All owners" }, ...users.map((user) => ({ value: user.id, label: userName(user) }))]} />
          <ClusterSelect value={filters.status} onChange={(status) => setFilters((value) => ({ ...value, status }))} ariaLabel="Filter Library status" options={[{ value: "active", label: "Active" }, { value: "all", label: "Any status" }, { value: "draft", label: "Draft" }, { value: "in-review", label: "In review" }, { value: "approved", label: "Approved" }, { value: "needs-update", label: "Needs update" }, { value: "deprecated", label: "Deprecated" }, { value: "archived", label: "Archived" }]} />
          <ClusterSelect value={filters.modified} onChange={(modified) => setFilters((value) => ({ ...value, modified }))} ariaLabel="Filter Library modification date" options={[{ value: "any", label: "Any time" }, { value: "day", label: "Past 24 hours" }, { value: "week", label: "Past week" }, { value: "month", label: "Past month" }, { value: "year", label: "Past year" }]} />
          <ClusterTextInput value={filters.tag} onChange={(event) => setFilters((value) => ({ ...value, tag: event.target.value }))} placeholder="Tag" aria-label="Filter Library by tag" />
          <ClusterSelect value={groupBy} onChange={(value) => setGroupBy(value as LibraryGroupMode)} ariaLabel="Group Library items" options={[{ value: "none", label: "No grouping" }, { value: "type", label: "Group by type" }, { value: "project", label: "Group by project" }, { value: "review", label: "Group by review state" }]} />
          <ClusterSelect value={filters.visibility} onChange={(visibility) => setFilters((value) => ({ ...value, visibility }))} ariaLabel="Filter Library visibility" options={[{ value: "all", label: "All visibility" }, { value: "internal", label: "Internal" }, { value: "project", label: "Project members" }, { value: "private", label: "Private" }]} />
          <ClusterButton unstyled type="button" className="library-clear-filters-v217" onClick={clearFilters} disabled={!activeFilterCount}>Clear filters</ClusterButton>
          {popularTags.length ? <div className="library-tag-shortcuts-v14" aria-label="Popular loaded tags"><span>Tags</span>{popularTags.map(([tag, count]) => <ClusterButton key={tag} size="compact" variant="quiet" selected={filters.tag === tag} onClick={() => setFilters((value) => ({ ...value, tag: value.tag === tag ? "" : tag }))}>{tag}<small>{count}</small></ClusterButton>)}</div> : null}
        </div>}
      </div>

      <ClusterResizableRail className="library-browser-grid-v429" label="Library Explorer" persistKey="library-folders" minWidth={240} defaultWidth={272} maxWidth={380} collapsed={explorerCollapsed} rail={<aside className="library-sidebar-v217" aria-label="Library Explorer">
        <header className="library-explorer-head-v10"><div><LibraryIcon name="folder" size={18} /><strong>Library Explorer</strong></div><ClusterIconButton label="Collapse Library Explorer" type="button" onClick={() => setExplorerCollapsed(true)}><LibraryIcon name="chevron" size={16} /></ClusterIconButton></header>
        <section className="library-explorer-section-v10">
          <ClusterButton unstyled type="button" className="library-explorer-section-head-v10" onClick={() => setViewsOpen(!viewsOpen)} aria-expanded={viewsOpen}><LibraryIcon name="chevron" size={14} className={viewsOpen ? "open" : ""} /><strong>Views</strong></ClusterButton>
          {viewsOpen ? <nav className="library-section-nav-v504" aria-label="Library views">{([ ["recent", "Recent"], ["favorites", "Favorites"], ["shared", "Shared with me"], ["created", "Created by me"], ["generated", "Generated"], ["trash", "Trash"] ] as Array<[LibrarySection, string]>).map(([section, label]) => <ClusterButton unstyled type="button" key={section} className={librarySection === section ? "active" : ""} onClick={() => openLibrarySection(section)}><LibraryIcon name={section === "favorites" ? "star" : section === "trash" ? "archive" : "file"} size={15} /><span>{label}</span></ClusterButton>)}</nav> : null}
        </section>
        <section className="library-explorer-section-v10 library-collections-v504">
          <div className="library-explorer-section-actions-v10"><ClusterButton unstyled type="button" className="library-explorer-section-head-v10" onClick={() => setCollectionsOpen(!collectionsOpen)} aria-expanded={collectionsOpen}><LibraryIcon name="chevron" size={14} className={collectionsOpen ? "open" : ""} /><strong>Collections</strong><small>{collections.length}</small></ClusterButton><ClusterIconButton label="Create collection" type="button" onClick={() => void createLibraryCollection("manual")}>+</ClusterIconButton></div>
          {collectionsOpen ? <><ClusterButton unstyled type="button" className="library-smart-collection-create-v504" onClick={() => void createLibraryCollection("smart")}><LibraryIcon name="search" size={14} /><span>Save current view</span><small>Smart</small></ClusterButton><nav aria-label="Library collections">{collections.map((collection) => <div key={collection.id} className={`library-collection-row-v10${activeCollection?.id === collection.id && librarySection === "collection" ? " active" : ""}`}><ClusterButton unstyled type="button" className="library-collection-open-v10" onClick={() => openCollection(collection)}><LibraryIcon name={collection.kind === "smart" ? "search" : "folder"} size={15} /><span>{collection.name}</span><small>{collection.kind === "smart" ? "Smart" : collection.itemCount ?? ""}</small></ClusterButton>{collection.accessRole === "owner" ? <ClusterActionMenu label={`Collection actions for ${collection.name}`} iconOnly items={[
  { id: "share", label: "Share collection", icon: "users", onSelect: () => openLibraryCollectionSharing(collection) },
  { id: "rename", label: "Rename", icon: "note", onSelect: () => renameLibraryCollection(collection) },
  ...(collection.kind === "smart" ? [{ id: "refresh-rules", label: "Update from current view", icon: "refresh" as const, description: "Replace this smart collection's rules with the filters and sorting currently shown.", onSelect: () => updateSmartCollectionFromCurrentView(collection) }] : []),
  { id: "remove", label: "Remove collection", icon: "trash", danger: true, separatorBefore: true, onSelect: () => deleteLibraryCollection(collection) },
]} /> : <small className="muted" title="Collection sharing does not grant access to its underlying files.">{collection.accessRole === "editor" ? "Edit" : "View"}</small>}</div>)}</nav></> : null}
        </section>
        <section className="library-explorer-section-v10">
          <div className="library-explorer-section-actions-v10"><ClusterButton unstyled type="button" className="library-explorer-section-head-v10" onClick={() => setFoldersOpen(!foldersOpen)} aria-expanded={foldersOpen}><LibraryIcon name="chevron" size={14} className={foldersOpen ? "open" : ""} /><strong>Folders</strong><small>{folders.length}</small></ClusterButton><ClusterIconButton label="Create folder" type="button" onClick={() => beginCreateFolder(folderId)}>+</ClusterIconButton></div>
          {foldersOpen ? <FolderTree folders={folders} files={treeFiles} activeId={folderId} showFiles={showTreeFiles} onShowFiles={setShowTreeFiles} onOpenFolder={(id) => { setLibrarySection("folder"); setFolderId(id); setActiveItem(null); setActiveId(null); }} onOpenItem={(item) => void selectItem(item)} onCreateFolder={beginCreateFolder} onManagePermissions={(item) => void openFolderPermissions(item)} /> : null}
        </section>
      </aside>}>
        <ClusterMasterDetail className="library-master-detail-v429" label="Library items and inspector" masterLabel="Library items" detailLabel="Library inspector" detailOpen={Boolean(activeItem)} onCloseDetail={libraryDetailHistory.closeDetail} detailSize="narrow" persistKey="library" master={<main className="library-main-v217">
          <nav className="library-breadcrumb-v217 library-breadcrumb-v14" aria-label="Library path">
            {refreshing ? <ClusterStatus state="loading" compact>Refreshing</ClusterStatus> : null}
            {librarySection === "folder" && currentFolder ? <ClusterIconButton label="Up one folder" title="Up one folder" size="compact" variant="quiet" onClick={() => { setFolderId(parentFolderId); setActiveItem(null); setActiveId(null); }}><LibraryIcon name="previous" size={15} /></ClusterIconButton> : null}
            <ClusterButton unstyled type="button" onClick={() => openLibrarySection("folder")}>Library</ClusterButton>
            {librarySection === "folder" ? <>{path.map((entry) => <span key={entry.id}>/<ClusterButton unstyled type="button" onClick={() => { setLibrarySection("folder"); setFolderId(entry.id); setActiveItem(null); setActiveId(null); }}>{entry.title}</ClusterButton></span>)}{currentFolder && !path.some((entry) => entry.id === currentFolder.id) && <span>/<ClusterButton unstyled type="button" onClick={() => void selectItem(currentFolder)}>{currentFolder.title}</ClusterButton></span>}</> : <span>/ <strong>{sectionLabel}</strong></span>}
            <em>{items.length} loaded{pagination.hasMore ? " · more available" : ""}</em>
            {items.length > 0 ? <ClusterButton size="compact" variant="quiet" disabled={bulkBusy || loading || loadingMore} onClick={selectLoadedLibraryItems} title={`Select up to ${MAX_LIBRARY_BULK_IDS} currently loaded items`}>Select loaded</ClusterButton> : null}
            <ClusterButton size="compact" variant="quiet" disabled={bulkBusy || loading || loadingMore || query.trim() !== deferredQuery || (librarySection === "collection" && !activeCollection)} busy={bulkBusy} onClick={() => void selectMatchingLibraryItems()} title={librarySection === "collection" ? "Select every accessible item in this collection across unloaded pages (maximum 200); collection access and item permissions are rechecked." : "Ask the server to select all accessible search matches (maximum 200). If more match, narrow your filters; no partial selection is applied."}>Select matching (max {MAX_LIBRARY_BULK_IDS})</ClusterButton>
            {(librarySection !== "collection" || (activeCollection && activeCollection.accessRole !== "viewer")) ? <ClusterActionMenu label={librarySection === "collection" ? "Background edits for Collection members" : "Background edits for all matching Library items"} items={[
              { id: "match-tag", label: "Tag matching items…", icon: "note", onSelect: () => void queueMatchingMetadata("tag") },
              { id: "match-untag", label: "Remove tag from matches…", icon: "note", onSelect: () => void queueMatchingMetadata("untag") },
              { id: "match-pin", label: "Pin all matches", icon: "star", onSelect: () => void queueMatchingMetadata("pin", true) },
              { id: "match-unpin", label: "Unpin all matches", icon: "star", onSelect: () => void queueMatchingMetadata("pin", false) },
              { id: "match-archive", label: "Archive matching files…", icon: "folder", separatorBefore: true, onSelect: () => void queueMatchingMetadata("archive") },
              { id: "match-unarchive", label: "Restore archived matching files…", icon: "refresh", onSelect: () => void queueMatchingMetadata("unarchive") },
            ]} /> : null}
            {currentUser.isAdmin ? <ClusterButton size="compact" variant="quiet" disabled={Boolean(orphanAudit && !["SUCCEEDED", "CANCELLED", "DEAD_LETTER"].includes(orphanAudit.status))} onClick={() => void startLibraryOrphanAudit()} title="Run a read-only Library storage orphan inventory. Nothing will be deleted or quarantined.">Audit storage</ClusterButton> : null}
            {librarySection === "folder" ? <ClusterActionMenu label={currentFolder ? `${currentFolder.title} folder actions` : "Library root actions"} iconOnly className="library-breadcrumb-actions-v14" items={[
              { id: "new-folder", label: currentFolder ? "New subfolder" : "New folder", icon: "plus", onSelect: () => beginCreateFolder(folderId) },
              ...(currentFolder ? [{ id: "permissions", label: "Folder permissions", icon: "lock" as const, onSelect: () => void openFolderPermissions(currentFolder) }] : []),
            ]} /> : null}
          </nav>
          {currentUser.isAdmin ? <LibraryUploadRecoveryPanel /> : null}
          {currentUser.isAdmin && orphanAudit ? <section role="status" aria-live="polite" className="library-background-bulk-status" aria-label="Read-only Library storage audit">
            <strong>Storage orphan audit: {orphanAudit.status.toLowerCase()} (read-only)</strong>
            <span> {orphanAudit.progress}% · {orphanAudit.message}</span>
            {orphanAudit.result ? <>
              <span>{orphanAudit.result.inspectedFiles} files inspected · {orphanAudit.result.protectedReferences} paths referenced · {orphanAudit.result.agedUnreferenced} aged unreferenced candidates ({formatBytes(orphanAudit.result.agedBytes)}) · {orphanAudit.result.recentUnreferenced} recent, not assessed for cleanup</span>
              <span>{orphanAudit.result.warning}</span>
              {orphanAudit.result.sample.length ? <ClusterDisclosureGroup title={`Review candidate sample (${orphanAudit.result.sample.length})`}><ul>{orphanAudit.result.sample.map((entry) => <li key={entry.relativePath}>{entry.relativePath} · {formatBytes(entry.sizeBytes)} <ClusterButton size="compact" variant="quiet" disabled={orphanAudit.status !== "SUCCEEDED" || orphanReviewBusy !== null} onClick={() => void reviewOrphanSample(entry.relativePath)}>{orphanReviewBusy === entry.relativePath ? "Checking…" : "Recheck evidence"}</ClusterButton></li>)}</ul></ClusterDisclosureGroup> : null}
              {orphanReview ? <div role="status"><strong>Candidate review: {orphanReview.relativePath}</strong><span> {orphanReview.status.replaceAll("_", " ")} · no deletion or quarantine is authorized</span><ul>{orphanReview.blockers.map((reason) => <li key={reason}>{reason.replaceAll("_", " ").toLowerCase()}</li>)}</ul></div> : null}
            </> : null}
            {["SUCCEEDED", "CANCELLED", "DEAD_LETTER"].includes(orphanAudit.status) ? <ClusterButton size="compact" variant="quiet" onClick={() => setOrphanAudit(null)}>Dismiss</ClusterButton> : null}
          </section> : null}
          {storageRepair ? <div role="status" aria-live="polite" className="library-background-bulk-status">
            <strong>Stored-file reconciliation: {storageRepair.status.toLowerCase()}</strong>
            <span> {storageRepair.progress}% · {storageRepair.message}</span>
            {storageRepair.status === "SUCCEEDED" && storageRepair.unresolved === 0 ? <span>All checked files reconciled.</span> : null}
            {storageRepair.status === "SUCCEEDED" && (storageRepair.unresolved ?? 0) > 0 ? <span>{storageRepair.unresolved} file paths need an administrator's attention. The move is already saved; do not repeat it.</span> : null}
            {["DEAD_LETTER", "CANCELLED"].includes(storageRepair.status) ? <span>Storage repair is incomplete. Ask an administrator to retry it; do not repeat the move.</span> : null}
            {["SUCCEEDED", "DEAD_LETTER", "CANCELLED"].includes(storageRepair.status) ? <ClusterButton size="compact" variant="quiet" onClick={() => setStorageRepair(null)}>Dismiss</ClusterButton> : null}
          </div> : null}
          {hierarchyLifecycleJob ? <div role="status" aria-live="polite" className="library-background-bulk-status">
            <strong>Hierarchy {hierarchyLifecycleJob.action}: {hierarchyLifecycleJob.status.toLowerCase()}</strong>
            <span> {hierarchyLifecycleJob.progress}% · {hierarchyLifecycleJob.changed} records changed · {hierarchyLifecycleJob.preserved} independently managed records preserved</span>
            <span> {hierarchyLifecycleJob.message}</span>
            {["CANCELLED", "DEAD_LETTER"].includes(hierarchyLifecycleJob.status) ? <span>Already committed roots retain their changes and provenance. Re-preview outstanding roots before retrying.</span> : null}
            {!["SUCCEEDED", "CANCELLED", "DEAD_LETTER"].includes(hierarchyLifecycleJob.status)
              ? <ClusterButton size="compact" variant="quiet" onClick={() => void cancelHierarchyLifecycle()}>Cancel remaining</ClusterButton>
              : <ClusterButton size="compact" variant="quiet" onClick={() => setHierarchyLifecycleJob(null)}>Dismiss</ClusterButton>}
          </div> : null}
          {hierarchyMoveJob ? <div role="status" aria-live="polite" className="library-background-bulk-status">
            <strong>Hierarchy move: {hierarchyMoveJob.status.toLowerCase()}</strong>
            <span> {hierarchyMoveJob.progress}% · {hierarchyMoveJob.moved} roots moved · {hierarchyMoveJob.skipped} unchanged</span>
            <span> {hierarchyMoveJob.message}</span>
            {hierarchyMoveJob.status === "SUCCEEDED" ? <span>Move committed. Stored-file reconciliation may still be running in the background.</span> : null}
            {["CANCELLED", "DEAD_LETTER"].includes(hierarchyMoveJob.status) ? <span>Only already committed roots were moved. Storage-repair jobs for those roots remain queued; review remaining selections before retrying.</span> : null}
            {!["SUCCEEDED", "CANCELLED", "DEAD_LETTER"].includes(hierarchyMoveJob.status)
              ? <ClusterButton size="compact" variant="quiet" onClick={() => void cancelHierarchyMove()}>Cancel remaining</ClusterButton>
              : <ClusterButton size="compact" variant="quiet" onClick={() => setHierarchyMoveJob(null)}>Dismiss</ClusterButton>}
          </div> : null}
          {backgroundBulkJob ? <div role="status" aria-live="polite" className="library-background-bulk-status">
            <strong>Library background operation: {backgroundBulkJob.status.toLowerCase()}</strong>
            <span> {backgroundBulkJob.progress}% · {backgroundBulkJob.changed} changed · {backgroundBulkJob.conflicted} conflicted · {backgroundBulkJob.denied} inaccessible · {backgroundBulkJob.blocked} blocked · {backgroundBulkJob.skipped} unchanged</span>
            <span> {backgroundBulkJob.message}</span>
            {!(["SUCCEEDED", "CANCELLED", "DEAD_LETTER"].includes(backgroundBulkJob.status)) ? <ClusterButton size="compact" variant="quiet" onClick={() => void cancelBackgroundBulk()}>Cancel remaining</ClusterButton> : <ClusterButton size="compact" variant="quiet" onClick={() => setBackgroundBulkJob(null)}>Dismiss</ClusterButton>}
          </div> : null}
          <ClusterBulkActionBar selectionCount={selectedIds.size} label="Selected Library item actions" onClear={() => { if (!bulkPendingRef.current) { matchingSelectionRef.current = null; setSelectedIds(new Set()); } }} className="library-bulk-v217">
            <ClusterButton size="compact" variant="quiet" disabled={bulkBusy} onClick={() => void copySelectedLibraryIds()} title="Copy selected Library item IDs">Copy IDs</ClusterButton>
            <ClusterButton size="compact" variant="quiet" disabled={bulkBusy} onClick={() => exportSelectedLibraryMetadata()} title="Export selected loaded Library metadata as CSV">Export CSV</ClusterButton>
            <ClusterSelect value={bulkFolderId} onChange={setBulkFolderId} ariaLabel="Move selected Library items" disabled={bulkBusy || selectedProtectedFolders.length > 0} options={[{ value: "", label: "Move to Library root" }, ...folders.filter((folder) => !selectedIds.has(folder.id)).map((folder) => ({ value: folder.id, label: folder.title }))]} />
            <ClusterButton size="compact" disabled={bulkBusy || selectedProtectedFolders.length > 0} busy={bulkBusy} title={selectedProtectedFolders.length ? "Managed folders cannot be moved." : undefined} onClick={() => void runBulk("move", { parentId: bulkFolderId || null })}>Move</ClusterButton>
            <ClusterActionMenu label="Organize selected Library items" triggerLabel="Organize" align="start" items={[
              { id: "bulk-rename", label: "Bulk rename…", icon: "note", disabled: bulkBusy || items.some((item) => selectedIds.has(item.id) && (item.type === "folder" || item.status === "trashed")), onSelect: () => { setRenameRule({ mode: "replace", text: "", replacement: "", start: 1, padding: 3 }); setRenamePreview(null); } },
              ...(currentUser.isAdmin ? [{ id: "bulk-governance", label: "Review retention / legal hold…", icon: "archive" as const, disabled: bulkBusy, onSelect: () => openBulkGovernance() }] : []),
              { id: "add-tag", label: "Add tag…", icon: "note", onSelect: () => bulkAddTag() },
              { id: "remove-tag", label: "Remove tag…", icon: "note", onSelect: () => bulkRemoveTag() },
              { id: "archive", label: "Archive selected", icon: "archive", separatorBefore: true, disabled: bulkBusy || librarySection === "trash" || selectedProtectedFolders.length > 0, onSelect: () => runBulk("archive") },
              { id: "restore", label: "Restore selected", icon: "refresh", disabled: bulkBusy || librarySection !== "trash" && !items.some((item) => selectedIds.has(item.id) && item.status === "archived"), onSelect: () => runBulk("restore") },
              ...collections.filter((collection) => collection.kind === "manual" && !collection.archived && collection.accessRole !== "viewer").map((collection) => ({ id: `collection-${collection.id}`, label: `Add to ${collection.name}`, icon: "folder" as const, separatorBefore: true, onSelect: () => addSelectedToCollection(collection) })),
              { id: "pin", label: "Pin", icon: "star", onSelect: () => runBulk("pin", { pinned: true }) },
              { id: "unpin", label: "Unpin", icon: "star", onSelect: () => runBulk("pin", { pinned: false }) },
              { id: "active", label: "Mark active", icon: "check", separatorBefore: true, onSelect: () => runBulk("status", { status: "active" }) },
              { id: "review", label: "Send to review", icon: "comment", onSelect: () => runBulk("status", { status: "in-review" }) },
              { id: "approved", label: "Mark approved", icon: "check", onSelect: () => runBulk("status", { status: "approved" }) },
            ]} />
            {librarySection === "collection" && activeCollection?.kind === "manual" && activeCollection.accessRole !== "viewer" ? <ClusterButton size="compact" variant="secondary" disabled={bulkBusy} onClick={() => void removeSelectedFromCollection()}>Remove from collection</ClusterButton> : null}
            <ClusterButton size="compact" variant={librarySection === "trash" ? "secondary" : "danger"} disabled={bulkBusy || (librarySection !== "trash" && selectedProtectedFolders.length > 0)} title={selectedProtectedFolders.length ? "Managed folders cannot be moved to Trash." : undefined} onClick={() => void runBulk(librarySection === "trash" ? "restore" : "trash")}>{librarySection === "trash" ? "Restore" : "Move to Trash"}</ClusterButton>
          </ClusterBulkActionBar>
          {reorderEnabled ? <div className="library-custom-order-note-v14" role="status"><ClusterIcon name="drag" width={15} height={15} /><span><strong>Custom order</strong>Folders and files share one manual sequence in this folder. Drag any loaded item before another item to save its position.</span></div> : null}
          {uploading.active && <div className="library-upload-v217"><div><strong>Transferring {uploading.current} of {uploading.total} · {uploading.percent}%</strong><span>{uploading.name}{uploading.message ? ` · ${uploading.message}` : ""}</span></div><progress className="ui-progress-v224" value={Math.max(0, uploading.percent)} max={100} aria-label="File transfer progress" /></div>}
          {status && <div className="status-box slim">{status}</div>}
          {error ? <RequestErrorState error={error} title={storageIssue ? "Library storage needs repair" : undefined} compact onRetry={() => void loadWorkspace(true, true)} actions={storageIssue ? <span className="muted">Close Cluster Server and run <code>ClusterServer.exe --repair</code>.</span> : undefined} /> : null}
          <div className="library-results-v217" aria-busy={loading || refreshing}>
            {loading ? ((layout === "grid" || layout === "compact-grid") ? <CardGridLoadingState label="Loading Library items" cards={8} /> : <TableLoadingState label="Loading Library items" rows={9} columns={6} compact />) : error && !items.length ? null : items.length === 0 ? (
              activeFilterCount > 0 ? <ClusterEmptyState kind="filtered" icon="search" className="library-empty-v217" title="No Library items match this view" description="Try clearing filters or opening another folder." actions={<><ClusterButton variant="secondary" onClick={clearFilters}>Clear filters</ClusterButton><ClusterButton variant="primary" onClick={() => fileInput.current?.click()}>Upload files</ClusterButton></>} />
              : currentFolder ? <ClusterEmptyState kind="empty" icon="folder" className="library-empty-v217" title="This folder is empty" description="Upload files or add a link when this folder has something worth keeping with the project." actions={<ClusterButton variant="primary" onClick={() => fileInput.current?.click()}>Upload files</ClusterButton>} />
              : <ClusterEmptyState kind="first-use" icon="library" className="library-empty-v217" title="Add the first Library item" description="Use Library for project files, references, links, media, and durable project context. Start with a file or link instead of building an empty taxonomy first." actions={<><ClusterButton variant="primary" onClick={() => fileInput.current?.click()}>Upload files</ClusterButton><ClusterButton variant="secondary" onClick={() => setCreateDraft({ kind: "link", title: "", body: "", externalUrl: "", folderColor: FOLDER_COLORS[0], folderIcon: "folder" })}>Add link</ClusterButton></>} />
            ) : <div className={`library-result-groups-v11 layout-${layout}`} data-grouped={groupBy !== "none" ? "true" : "false"}>{groupedItems.map((group) => <section key={group.key} className="library-result-group-v11">{group.label ? <header className="library-result-group__header-v11"><strong>{group.label}</strong><span>{group.items.length}</span></header> : null}{layout === "list" || layout === "details" ? <div role="table" aria-label={group.label ? `${group.label} Library items` : "Library items"} className={layout === "list" ? "library-table-v11 is-simple" : "library-table-v11 is-details"}><div className="library-list-head-v217" role="row"><span role="columnheader" aria-label="Selection" /><span role="columnheader">Name</span><span role="columnheader">Project</span><span role="columnheader">Type</span><span role="columnheader">Size</span><span role="columnheader">Modified</span></div><LibraryListRows items={group.items} activeId={activeId} selectedIds={selectedIds} onSelect={toggleSelection} onOpen={(item) => void selectItem(item)} onPreview={(item) => void openItemViewer(item)} reorderEnabled={reorderEnabled} onReorder={(sourceId, targetId) => void reorderLibraryItem(sourceId, targetId)} /></div> : <div className={`library-grid-v217${layout === "compact-grid" ? " is-compact-v11" : ""}`}>{group.items.map((item) => <LibraryGridCard key={item.id} item={item} active={activeId === item.id} selected={selectedIds.has(item.id)} onSelect={(checked) => toggleSelection(item, checked)} onOpen={() => void selectItem(item)} onPreview={() => void openItemViewer(item)} reorderEnabled={reorderEnabled} onReorder={(sourceId, targetId) => void reorderLibraryItem(sourceId, targetId)} />)}</div>}</section>)}</div>}
          </div>
          {pagination.hasMore && !loading ? <div ref={loadMoreSentinelRef} className="library-load-sentinel-v10" aria-live="polite"><span>{loadingMore ? "Loading more…" : "More items load as you scroll"}</span><ClusterButton unstyled type="button" className="library-load-more-v217" disabled={loadingMore} onClick={() => void loadWorkspace(false)}>{loadingMore ? "Loading…" : "Load more now"}</ClusterButton></div> : null}
        </main>}
        detail={<LibraryInspector item={activeItem} folders={folders} projects={projects} users={users} currentUser={currentUser} tab={inspectorTab} onTab={setInspectorTab} onSaved={handleSaved} onOpenFolder={(id) => { setFolderId(id); setActiveItem(null); setActiveId(null); }} onExpand={setViewerItem} onManagePermissions={(item) => void openFolderPermissions(item)} favorite={Boolean(activeItem && favoriteIds.has(activeItem.id))} onToggleFavorite={(item) => void toggleFavorite(item)} onClose={libraryDetailHistory.closeDetail} />} />
      </ClusterResizableRail>
    </section>

    <LibraryViewerModal
      item={viewerItem}
      items={viewerSequence}
      onSelect={setViewerItem}
      onClose={() => setViewerItem(null)}
      onPrevious={() => void navigateViewer(-1)}
      onNext={() => void navigateViewer(1)}
      hasPrevious={viewerIndex > 0}
      hasNext={viewerIndex >= 0 && viewerIndex < viewerSequence.length - 1}
      position={viewerIndex >= 0 ? viewerIndex + 1 : undefined}
      total={viewerIndex >= 0 ? viewerSequence.length : undefined}
    />
    {sharingCollection && <ClusterModal open onClose={() => { if (!sharingBusy) setSharingCollection(null); }} className="modal panel library-collection-sharing-vtd4" ariaLabel={`Share collection ${sharingCollection.name}`}>
      <div className="modal-header"><div><p className="eyebrow">Library · collection access</p><h2>Share {sharingCollection.name}</h2></div><ClusterIconButton label="Close collection sharing" disabled={sharingBusy} onClick={() => setSharingCollection(null)}><LibraryIcon name="close" size={20} /></ClusterIconButton></div>
      <p className="muted">Sharing lets people organize or browse this collection. It never gives them access to protected Library files, folders, or Personnel Records.</p>
      {sharingNotice && <p role="alert" className="error-box slim">{sharingNotice}</p>}
      {sharingLoading ? <p role="status">Loading collection access…</p> : <>
        <div className="library-collection-sharing-fields-vtd4">
          <label className="field"><span>Studio member</span><ClusterSelect ariaLabel="Collection sharing recipient" value={sharingUserId} disabled={sharingBusy || Boolean(sharingNotice)} onChange={setSharingUserId} options={[{ value: "", label: "Choose a person" }, ...users.filter((user) => user.id !== sharingCollection.ownerId && !sharingGrants.some((entry) => entry.userId === user.id)).map((user) => ({ value: user.id, label: userName(user) }))]} /></label>
          <label className="field"><span>Collection access</span><ClusterSelect ariaLabel="Collection sharing permission" value={sharingRole} disabled={sharingBusy || Boolean(sharingNotice)} onChange={(role) => setSharingRole(role as "viewer" | "editor")} options={[{ value: "viewer", label: "Viewer" }, { value: "editor", label: "Editor (manage collection items)" }]} /></label>
          <ClusterButton variant="primary" disabled={sharingBusy || Boolean(sharingNotice) || !sharingUserId} onClick={() => void changeLibraryCollectionGrant(sharingUserId, sharingRole)}>{sharingBusy ? "Saving…" : "Add person"}</ClusterButton>
        </div>
        <div className="library-permission-list-v270" aria-label="People with collection access">
          {sharingGrants.map((grant) => <div key={grant.userId} className="library-collection-sharing-person-vtd4">
            <span><strong>{grant.user.displayName || grant.user.username}</strong><small>@{grant.user.username}{grant.user.archived ? " · archived" : ""}</small></span>
            <ClusterSelect ariaLabel={`${grant.user.username} collection role`} value={grant.role} disabled={sharingBusy || Boolean(sharingNotice)} onChange={(role) => void changeLibraryCollectionGrant(grant.userId, role as "viewer" | "editor")} options={[{ value: "viewer", label: "Viewer" }, { value: "editor", label: "Editor" }]} />
            <ClusterIconButton label={`Revoke ${grant.user.username} collection access`} disabled={sharingBusy || Boolean(sharingNotice)} onClick={() => void changeLibraryCollectionGrant(grant.userId, null)}><LibraryIcon name="close" size={16} /></ClusterIconButton>
          </div>)}
          {!sharingGrants.length && <p className="muted">Private collection. Nobody else has been granted collection access.</p>}
        </div>
      </>}
      <div className="modal-actions"><ClusterButton variant="secondary" disabled={sharingBusy} onClick={() => setSharingCollection(null)}>Done</ClusterButton></div>
    </ClusterModal>}
    {permissionFolder && <ClusterModal open onClose={() => setPermissionFolder(null)} backdropClassName="library-permission-backdrop-v270" className="modal panel library-permission-dialog-v270" ariaLabel={`Folder access ${permissionFolder.title}`}>
      <div className="modal-header"><div><p className="eyebrow">Folder access</p><h2>{permissionFolder.title}</h2></div><ClusterIconButton label="Close folder permissions" type="button" onClick={() => setPermissionFolder(null)}><LibraryIcon name="close" size={22} /></ClusterIconButton></div>
      <p className="muted tight">Choose explicit folder grants. Effective access also includes ownership, inherited grants, Studio policy and administrative authority.</p>
      {permissionAccess?.roster && <section className="library-effective-access-v504"><div className="library-section-title-v504"><strong>Effective access</strong><span>{permissionAccess.roster.length} people</span></div>{permissionAccess.roster.map(({ user, explanation }) => <article key={user.id}><span><strong>{userName(user)}</strong><small>{explanation.effectiveAccess}</small></span><p>{explanation.contributors[0]?.detail || explanation.reasonCode}</p>{explanation.contributors.some((entry) => entry.inherited) && <em>Inherited</em>}</article>)}</section>}
      <div className="library-permission-list-v270">{permissionUsers.map((user) => <label key={user.id}><span><strong>{userName(user)}</strong><small>@{user.username}</small></span><ClusterSelect ariaLabel={`${userName(user)} folder access`} value={folderPermissions[user.id] || "none"} onChange={(access) => setFolderPermissions((current) => ({ ...current, [user.id]: access as FolderAccess }))} options={[{ value: "none", label: "No access" }, { value: "view", label: "View" }, { value: "contribute", label: "Contribute" }, { value: "edit", label: "Edit" }, { value: "manage", label: "Manage" }]} /></label>)}</div>
      {permissionMessage && <div className={permissionMessage.includes("saved") ? "status-box slim" : "error-box slim"}>{permissionMessage}</div>}
      <div className="modal-actions"><ClusterButton type="button" className="" onClick={() => setPermissionFolder(null)} variant="secondary">Cancel</ClusterButton><ClusterButton type="button" className="" onClick={() => void saveFolderPermissions()} disabled={permissionBusy} variant="primary">{permissionBusy ? "Saving…" : "Save permissions"}</ClusterButton></div>
    </ClusterModal>}
    {governanceSelected && <LibraryGovernanceBulkModal
      selected={governanceSelected}
      onClose={() => setGovernanceSelected(null)}
      isSelectionCurrent={() => governanceQueryRef.current === queryKey && selectedIdsLiveRef.current.size === governanceSelected.length &&
        governanceSelected.every((row) => selectedIdsLiveRef.current.has(row.id) && items.some((item) => item.id === row.id && item.revision === row.revision))}
      onChanged={(count) => {
        setGovernanceSelected(null); matchingSelectionRef.current = null; setSelectedIds(new Set());
        setStatus(`${count} Library item${count === 1 ? "" : "s"} received stronger governance protection.`);
        scheduleWorkspaceRevalidation();
      }} />}
    {renameRule && <ClusterModal open onClose={() => { if (!renameBusy) { setRenameRule(null); setRenamePreview(null); } }} className="modal panel library-bulk-rename-v533" ariaLabel="Bulk rename Library items">
      <div className="modal-header"><div><p className="eyebrow">Library · selected items</p><h2>Bulk rename {selectedIds.size} items</h2></div><ClusterIconButton label="Close bulk rename" type="button" disabled={renameBusy} onClick={() => { setRenameRule(null); setRenamePreview(null); }}><LibraryIcon name="close" size={20} /></ClusterIconButton></div>
      <p className="muted">Names only. No folders or underlying stored files are moved. Preview every new title before applying; concurrent changes cancel the batch.</p>
      <label className="field"><span>Rename operation</span><ClusterSelect ariaLabel="Bulk rename operation" value={renameRule.mode} disabled={renameBusy} onChange={(mode) => editBulkRenameRule({ mode: mode as LibraryBulkRenameMode })} options={[
        { value: "replace", label: "Find and replace" }, { value: "prefix", label: "Add prefix" },
        { value: "suffix", label: "Add suffix before extension" }, { value: "number", label: "Sequence numbers, keeping extensions" },
      ]} /></label>
      <label className="field"><span>{renameRule.mode === "replace" ? "Find exact text" : renameRule.mode === "prefix" ? "Prefix" : renameRule.mode === "suffix" ? "Suffix" : "Number prefix (optional)"}</span>
        <ClusterTextInput value={renameRule.text} maxLength={160} disabled={renameBusy} onChange={(event) => editBulkRenameRule({ text: event.target.value })} placeholder={renameRule.mode === "replace" ? "IMG_" : renameRule.mode === "number" ? "Asset_" : "Studio_"}/>
      </label>
      {renameRule.mode === "replace" ? <label className="field"><span>Replace with (may be empty)</span><ClusterTextInput value={renameRule.replacement} maxLength={160} disabled={renameBusy} onChange={(event) => editBulkRenameRule({ replacement: event.target.value })} /></label> : null}
      {renameRule.mode === "number" ? <div className="library-bulk-rename-numbers-v533">
        <label className="field"><span>Start</span><ClusterTextInput type="number" min={0} max={999999} value={String(renameRule.start)} disabled={renameBusy} onChange={(event) => editBulkRenameRule({ start: Number(event.target.value) })} /></label>
        <label className="field"><span>Minimum digits</span><ClusterTextInput type="number" min={1} max={8} value={String(renameRule.padding)} disabled={renameBusy} onChange={(event) => editBulkRenameRule({ padding: Number(event.target.value) })} /></label>
      </div> : null}
      {renamePreview ? <section className="library-bulk-rename-preview-v533"><strong>{renamePreview.changedCount} names will change · {renamePreview.renames.length} reviewed</strong>
        <div className="library-bulk-rename-lines-v533" role="table" aria-label="Full bulk rename preview">
          {renamePreview.renames.map((entry) => <div key={entry.id} role="row" className={entry.from === entry.to ? "unchanged" : ""}><span role="cell" title={entry.from}>{entry.from}</span><span aria-hidden="true">→</span><span role="cell" title={entry.to}>{entry.to}</span></div>)}
        </div>
      </section> : <p className="muted">A server-checked preview will list every selected item, including any names that stay unchanged.</p>}
      <div className="modal-actions">
        <ClusterButton type="button" variant="secondary" disabled={renameBusy} onClick={() => { setRenameRule(null); setRenamePreview(null); }}>Cancel</ClusterButton>
        <ClusterButton type="button" variant="secondary" disabled={renameBusy || (!renameRule.text && renameRule.mode !== "number")} onClick={() => void previewBulkRename()}>{renameBusy ? "Checking…" : "Preview names"}</ClusterButton>
        <ClusterButton type="button" variant="primary" disabled={renameBusy || !renamePreview || !renamePreview.changedCount} onClick={() => void applyBulkRename()}>Apply reviewed names</ClusterButton>
      </div>
    </ClusterModal>}
    {createDraft && <ClusterModal open onClose={() => setCreateDraft(null)} className="modal panel library-create-v217 library-link-create-v229" ariaLabel={createDraft.kind === "folder" ? "Create Library folder" : "Add Library item"}>
      <div className="modal-header"><div><p className="eyebrow">{createDraft.kind === "folder" ? `Create in ${currentFolder?.title || "Library"}` : "Add to Library"}</p><h2>{createDraft.kind === "folder" ? "New folder" : createDraft.kind === "youtube-video" ? "YouTube video" : createDraft.kind === "youtube-playlist" ? "YouTube playlist" : "Add link"}</h2></div><ClusterIconButton label="Close create dialog" type="button" onClick={() => setCreateDraft(null)}><LibraryIcon name="close" size={20} /></ClusterIconButton></div>
      {createDraft.kind !== "folder" && <div className="library-link-kind-v229" role="tablist" aria-label="Link type">
        {([['link','Web link','link'],['youtube-video','YouTube video','youtube'],['youtube-playlist','YouTube playlist','playlist']] as const).map(([kind,label,icon]) => <ClusterButton unstyled type="button" key={kind} className={createDraft.kind === kind ? "active" : ""} onClick={() => setCreateDraft((value) => value ? { ...value, kind } : value)}><LibraryIcon name={icon} size={18} /><span>{label}</span></ClusterButton>)}
      </div>}
      <label className="field"><span>Name</span><ClusterTextInput autoFocus value={createDraft.title} onChange={(event) => setCreateDraft((value) => value ? { ...value, title: event.target.value } : value)} placeholder={createDraft.kind === "folder" ? "Folder name" : "Display name"} /></label>
      {createDraft.kind !== "folder" && <label className="field"><span>{createDraft.kind === "youtube-playlist" ? "YouTube playlist URL" : createDraft.kind === "youtube-video" ? "YouTube video URL" : "URL"}</span><ClusterTextInput value={createDraft.externalUrl} onChange={(event) => setCreateDraft((value) => value ? { ...value, externalUrl: event.target.value } : value)} placeholder={createDraft.kind.startsWith("youtube-") ? "https://www.youtube.com/…" : "https://…"} /></label>}
      {createDraft.kind !== "folder" && <label className="field"><span>Description</span><ClusterTextArea value={createDraft.body} onChange={(event) => setCreateDraft((value) => value ? { ...value, body: event.target.value } : value)} placeholder="Why this belongs in the Library" /></label>}
      {createDraft.kind === "folder" && <FolderAppearancePicker color={createDraft.folderColor} icon={createDraft.folderIcon} onColor={(folderColor) => setCreateDraft((value) => value ? { ...value, folderColor } : value)} onIcon={(folderIcon) => setCreateDraft((value) => value ? { ...value, folderIcon } : value)} />}
      <div className="modal-actions"><ClusterButton type="button" className="" onClick={() => setCreateDraft(null)} variant="secondary">Cancel</ClusterButton><ClusterButton type="button" className="" onClick={() => void createItem()} disabled={!createDraft.title.trim() || (createDraft.kind !== "folder" && !createDraft.externalUrl.trim())} variant="primary">{createDraft.kind === "folder" ? "Create folder" : "Add to Library"}</ClusterButton></div>
    </ClusterModal>}
  </section>;
}
