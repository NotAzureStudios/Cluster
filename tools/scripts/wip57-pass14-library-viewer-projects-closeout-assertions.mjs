import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const json = (rel) => JSON.parse(read(rel));

const pkg = json("package.json");
const library = read("packages/renderer/src/features/library/LibraryWorkspacePage.tsx");
const libraryCss = read("packages/renderer/src/features/library/library-workspace.css");
const libraryRoutes = read("apps/server/src/domains/library/library-routes.ts");
const video = read("packages/renderer/src/features/viewer/UnifiedVideoViewer.tsx");
const audio = read("packages/renderer/src/features/viewer/UnifiedAudioViewer.tsx");
const viewerSystem = read("packages/renderer/src/features/viewer/viewer-system-integration.ts");
const browserTransfers = read("packages/renderer/src/core/browser-download-transfers.ts");
const transferCenter = read("packages/renderer/src/features/shell/TaskbarTransferCenter.tsx");
const closeout = read("packages/renderer/src/features/projects/CloseoutPortalPanel.tsx");
const projectCss = read("packages/renderer/src/features/projects/project-operations.css");
const checklist = read("RC17_RUNTIME_TEST_CHECKLIST.md");

const checks = [
  ["Folder tree exposes contextual root/subfolder actions", library.includes("library-tree-folder-actions-v14") && library.includes("New subfolder") && library.includes("Folder permissions")],
  ["Folder creation carries an explicit parent authority", library.includes("parentId?: string | null") && library.includes("createDraft.parentId === undefined ? folderId : createDraft.parentId")],
  ["Context-created subfolders do not leak into an unrelated current result list", library.includes("explicitDifferentParent") && library.includes("if (!explicitDifferentParent) setItems")],
  ["Library breadcrumb provides explicit parent navigation", library.includes('label="Up one folder"') && library.includes("parentFolderId")],
  ["Loaded tags provide direct filter shortcuts", library.includes("popularTags") && library.includes("library-tag-shortcuts-v14")],
  ["Saved Library views expose the active search scope", library.includes('label="Library views"') && library.includes("Current scope: ${searchScopeLabel}")],
  ["Bulk organization exposes tag, pin, and canonical status actions", library.includes('runBulk("tag"') && library.includes('runBulk("pin"') && library.includes('runBulk("status"')],
  ["Server bulk authority accepts tag/status/pin", libraryRoutes.includes('z.enum(["move", "archive", "trash", "restore", "tag", "status", "pin"])')],
  ["Custom ordering explains a shared mixed-item sequence", library.includes("Folders and files share one manual sequence") && libraryRoutes.includes('orderBy: librarySort("custom")')],
  ["Pass 14 Library controls have DPI-safe wrapping/overflow styling", libraryCss.includes("WIP57 Pass 14 — Explorer organization") && libraryCss.includes("library-breadcrumb-v14") && libraryCss.includes("library-tree-folder-actions-v14")],
  ["Video viewer exposes missing-source Retry", video.includes('title="Video source unavailable"') && video.includes("onClick={onReload}>Retry")],
  ["Video viewer exposes timed-media playback errors", video.includes('snapshot.phase === "error"') && video.includes('title="Video playback failed"') && video.includes("snapshot.errorMessage")],
  ["Audio viewer exposes missing-source Retry", audio.includes('title="Audio source unavailable"') && audio.includes("onClick={onReload}>Retry")],
  ["Audio viewer exposes timed-media playback errors", audio.includes('snapshot.phase === "error"') && audio.includes('title="Audio playback failed"') && audio.includes("snapshot.errorMessage")],
  ["Browser download handoffs have a dedicated observable store", browserTransfers.includes("recordBrowserDownloadHandoff") && browserTransfers.includes("subscribeBrowserDownloads") && browserTransfers.includes('state: "handed-off"')],
  ["Viewer browser fallback records a Transfer Center handoff", viewerSystem.includes("recordBrowserDownloadHandoff") && viewerSystem.includes("return { native: false, transferId }")],
  ["Transfer Center shows browser handoffs without fake progress", transferCenter.includes("Browser download · handed to browser") && transferCenter.includes("Browser-managed progress is not available to Cluster")],
  ["Project closeout stages mirror canonical lifecycle", closeout.includes('["Readiness", "Submitted", "Verified", "Archived"]')],
  ["Project closeout surfaces next required actions", closeout.includes("closeout-next-actions-v14") && closeout.includes("nextBlockers") && closeout.includes("closeoutNextLabel")],
  ["Project closeout next actions reuse canonical manual-check mutation", closeout.includes("toggleManualCheck(item)") && closeout.includes("Mark ready")],
  ["Closeout hierarchy has narrow-width collision protection", projectCss.includes("WIP57 Pass 14 — closeout hierarchy") && projectCss.includes("closeout-next-actions-list-v14")],
  ["Pass 14 runtime checklist covers 100/125/150 scaling", checklist.includes("Pass 14 — Library operations") && checklist.includes("100%, 125%, and 150% Windows scaling")],
  ["Pass 14 assertions are wired into source-foundation verification", pkg.scripts?.["verify:source-foundation"]?.includes("wip57:pass14:assertions")],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
console.log(`\n${checks.length - failed.length}/${checks.length} WIP57 Pass 14 Library + Viewer + Projects Closeout assertions passed.`);
if (failed.length) process.exit(1);
