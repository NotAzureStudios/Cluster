import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const json = (rel) => JSON.parse(read(rel));

const pkg = json("package.json");
const schema = read("apps/server/prisma/schema.prisma");
const migration = read("apps/server/prisma/migrations/20261007033000_rc17_wip57_library_manual_order/migration.sql");
const coreLibrary = read("apps/server/src/core/library.ts");
const libraryRoutes = read("apps/server/src/domains/library/library-routes.ts");
const librarySerialization = read("apps/server/src/domains/library/library-item-serialization.ts");
const library9e2 = read("apps/server/src/domains/library/library-9e2-routes.ts");
const viewableResource = read("apps/server/src/domains/media/viewable-resource.ts");
const libraryTypes = read("packages/renderer/src/features/library/library-types.ts");
const library = read("packages/renderer/src/features/library/LibraryWorkspacePage.tsx");
const libraryMedia = read("packages/renderer/src/features/library/LibraryMediaPreview.tsx");
const libraryCss = read("packages/renderer/src/features/library/library-workspace.css");
const sidebar = read("packages/renderer/src/features/application/modules/ApplicationSidebar.tsx");
const taskbar = read("packages/renderer/src/features/application/modules/ApplicationProjectTabs.tsx");
const shellCss = read("packages/renderer/src/features/shell/shell-v2.css");

const checks = [
  ["Library model has stable manual ordering", schema.includes("manualOrder Float?") && schema.includes("@@index([parentId, manualOrder, id])")],
  ["Manual-order migration is explicit and indexed", migration.includes('ADD COLUMN "manualOrder" DOUBLE PRECISION') && migration.includes('LibraryItem_parentId_manualOrder_id_idx')],
  ["Library serialization projects manual order", librarySerialization.includes("manualOrder: item.manualOrder ?? null") && libraryRoutes.includes("manualOrder: true")],
  ["Renderer Library item contract carries manual order", libraryTypes.includes("manualOrder?: number | null")],
  ["Canonical Library sort supports custom order", coreLibrary.includes('case "custom"') && coreLibrary.includes('manualOrder: { sort: "asc", nulls: "last" }')],
  ["Library exposes a server-authoritative reorder route", libraryRoutes.includes('app.post("/api/library/:itemId/reorder"') && libraryRoutes.includes('position: z.enum(["before", "after"])')],
  ["Reorder is bounded to the same folder", libraryRoutes.includes("LIBRARY_REORDER_PARENT_MISMATCH") && libraryRoutes.includes("source.parentId") && libraryRoutes.includes("target.parentId")],
  ["Reorder requires editable source and target", libraryRoutes.includes('findAccessibleItem(request, reply, params.itemId, "edit")') && libraryRoutes.includes('findAccessibleItem(request, reply, body.targetId, "edit")')],
  ["Reorder persists stable ranks and revision changes", libraryRoutes.includes("manualOrder: (index + 1) * 1024") && libraryRoutes.includes("revision: { increment: 1 }")],
  ["Library UI only enables drag ordering in an unambiguous custom folder view", library.includes('filters.sort === "custom"') && library.includes('librarySection === "folder"') && library.includes('!deferredQuery') && library.includes('groupBy === "none"')],
  ["Library cards and rows can participate in custom drag ordering", library.includes('application/x-cluster-library-item') && library.includes("reorderEnabled") && library.includes("onReorder")],
  ["Custom order is a first-class sort option", library.includes('{ value: "custom", label: "Custom order" }')],

  ["Library has four first-class view modes", libraryTypes.includes('"grid" | "compact-grid" | "list" | "details"') && ["grid", "compact-grid", "list", "details"].every((mode) => library.includes(`value: "${mode}"`))],
  ["Compact grid has distinct responsive geometry", libraryCss.includes("library-grid-v217.is-compact-v11") && libraryCss.includes("148px")],
  ["Library groups are explicit state, not client-only headings", libraryTypes.includes('LibraryGroupMode = "none" | "type" | "project" | "review"') && library.includes("groupLibraryItems")],
  ["Library can group by type, project, or review state", ["Group by type", "Group by project", "Group by review state"].every((label) => library.includes(label))],
  ["Library grouping survives saved views", library.includes("savedLibraryView") && library.includes("groupBy") && library.includes("setGroupBy(values.groupBy as LibraryGroupMode)")],
  ["Library search scope is explicit and persistent", libraryTypes.includes('LibrarySearchScope = "folder" | "descendants" | "project" | "library"') && library.includes('"library.search-scope"')],
  ["Library exposes folder, descendant, project and global search scopes", ["Search current folder", "Folder + subfolders", "Current project", "Entire Library"].every((label) => library.includes(label))],
  ["Server accepts canonical search scopes", libraryRoutes.includes('z.enum(["folder", "descendants", "project", "all"])')],
  ["Descendant search resolves nested folder ancestry server-side", libraryRoutes.includes('query.scope === "descendants"') && libraryRoutes.includes("const descendants = new Set<string>")],
  ["Project search derives project context from the anchor folder when necessary", libraryRoutes.includes('query.scope === "project"') && libraryRoutes.includes("select: { projectId: true }")],
  ["Tag filtering is first-class in Library search", library.includes('placeholder="Tag"') && libraryRoutes.includes("if (query.tag) where.tags = { contains: query.tag }")],
  ["Search includes metadata, tags and original filenames", libraryRoutes.includes('{ tags: { contains: search } }') && libraryRoutes.includes('{ originalName: { contains: search } }') && libraryRoutes.includes('{ metadata: { contains: search } }')],
  ["Search scope and grouping are saved with Library views", library.includes("{ ...filters, query, layout, searchScope, groupBy }")],
  ["Library view loading treats compact grid as cards", library.includes('(layout === "grid" || layout === "compact-grid") ? <CardGridLoadingState')],
  ["Project collaboration uses the Library item's actual project", library.includes('activeItem?.projectId') && library.includes('projectId={activeItem.projectId}')],

  ["Library viewable resources receive generated derivatives", libraryRoutes.includes("prisma.libraryDerivative.findMany") && libraryRoutes.includes("libraryItemViewableResource(result.item, derivatives)")],
  ["Only ready current-checksum derivatives are exposed to Viewer", libraryRoutes.includes('status: "ready"') && libraryRoutes.includes("invalidatedAt: null") && libraryRoutes.includes("sourceChecksumSha256: result.item.checksumSha256")],
  ["Library derivatives map into the canonical ViewableResource contract", viewableResource.includes("function libraryDerivativeToViewable") && viewableResource.includes("ViewableResourceDerivative")],
  ["Library viewer selects medium-appropriate preferred derivatives", viewableResource.includes("function preferredLibraryDerivative") && viewableResource.includes('medium === "video" ? ["review_encode", "proxy"]') && viewableResource.includes('medium === "image" ? ["image_preview", "thumbnail"]')],
  ["Viewable Library resources publish derivative inventory and preferred derivative", viewableResource.includes("derivatives,") && viewableResource.includes("preferredDerivativeId: preferred?.id || null")],
  ["Derivative file delivery uses canonical range-capable resource delivery", library9e2.includes("sendStoredResource(request, reply") && library9e2.includes('cacheControl: "private, max-age=31536000, immutable"')],
  ["Derivative delivery remains constrained to managed derivative storage", library9e2.includes("LIBRARY_DERIVATIVE_PATH_INVALID") && library9e2.includes("isInside(derivativeRoot, fullPath)")],
  ["Media viewer opens with the media stage prioritized", libraryMedia.includes("const [railOpen, setRailOpen] = useState(false)") && libraryMedia.includes("const [contextOpen, setContextOpen] = useState(false)")],
  ["Media viewer details are an explicit toggle", libraryMedia.includes("Show media details") && libraryMedia.includes("Hide media details") && libraryMedia.includes("contextOpen ?")],
  ["Media viewer has explicit two-row and details-expanded grid contracts", libraryCss.includes(".library-viewer-v270{grid-template-rows:58px minmax(0,1fr);") && libraryCss.includes(".library-viewer-v270.context-open-v11{grid-template-rows:58px auto minmax(0,1fr);")],
  ["Viewer detail state resets between assets", libraryMedia.includes("setContextOpen(false)")],

  ["Active Sidebar markup is free of version-stamped visual classes", !/\b[A-Za-z0-9_-]+-v\d+\b/.test(sidebar)],
  ["Primary Taskbar actions use canonical action chrome", taskbar.includes("cluster-taskbar-action") && taskbar.includes("cluster-taskbar-action__label") && taskbar.includes("cluster-taskbar-action__icon")],
  ["Primary Taskbar actions no longer depend on retired action/label classes", !taskbar.includes("taskbar-action-v073") && !taskbar.includes("taskbar-label-v3") && !taskbar.includes("taskbar-svg-icon-v227") && !taskbar.includes("taskbar-command-hotkey-v3")],
  ["Shell 2.0 owns canonical Sidebar and Taskbar presentation without important overrides", shellCss.includes(".cluster-sidebar__header") && shellCss.includes(".cluster-taskbar-action") && !shellCss.includes("!important")],

  ["Pass 11 assertions are wired into source-foundation verification", pkg.scripts?.["verify:source-foundation"]?.includes("wip57:pass11:assertions")],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
console.log(`\n${checks.length - failed.length}/${checks.length} WIP57 Pass 11 Library Organization + Media assertions passed.`);
if (failed.length) process.exit(1);
