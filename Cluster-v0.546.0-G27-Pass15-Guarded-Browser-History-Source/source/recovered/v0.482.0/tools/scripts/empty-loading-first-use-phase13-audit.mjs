import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const text = (relative) => readFile(path.join(root, relative), "utf8");
let passed = 0;
let total = 0;
function check(label, ok) {
  total += 1;
  if (!ok) { console.error(`FAIL  ${label}`); process.exitCode = 1; return; }
  passed += 1;
  console.log(`PASS  ${label}`);
}

const [emptyState, requestState, loadingState, projectPrimitive, projects, people, tickets, library, inbox, application, setup, myWork, primitives, skeletons, productionUi, docs, pkgText, packager, notes, changelog] = await Promise.all([
  text("packages/renderer/src/components/ClusterEmptyState.tsx"),
  text("packages/renderer/src/components/RequestState.tsx"),
  text("packages/renderer/src/components/LoadingState.tsx"),
  text("packages/renderer/src/features/projects/ProjectWorkspacePrimitives.tsx"),
  text("packages/renderer/src/features/projects/ProjectsPage.tsx"),
  text("packages/renderer/src/features/people/PeoplePages.tsx"),
  text("packages/renderer/src/features/tickets/TicketSystemPage.tsx"),
  text("packages/renderer/src/features/library/LibraryWorkspacePage.tsx"),
  text("packages/renderer/src/features/notifications/NotificationInboxPage.tsx"),
  text("packages/renderer/src/features/application/ClusterApplication.tsx"),
  text("packages/renderer/src/features/application/modules/application-shell.tsx"),
  text("packages/renderer/src/features/work/MyWorkPage.tsx"),
  text("packages/renderer/src/styles/design-system/primitives.css"),
  text("packages/renderer/src/styles/design-system/skeletons.css"),
  text("packages/renderer/src/styles/design-system/production-ui.css"),
  text("docs/EMPTY_LOADING_FIRST_USE_PHASE13.md"),
  text("package.json"),
  text("tools/scripts/package-cluster-master.mjs"),
  text("RELEASE_NOTES_v0.436.0.md"),
  text("packages/renderer/src/features/changelog/data/cluster-changelog.ts"),
]);

check("Canonical empty state defines five semantic kinds", emptyState.includes('"empty" | "first-use" | "filtered" | "restricted" | "offline"'));
check("Canonical empty state exports reusable component", emptyState.includes("export function ClusterEmptyState"));
check("Canonical empty state exposes semantic data marker", emptyState.includes("data-empty-kind={kind}"));
check("Canonical first-use icon exists", emptyState.includes('"first-use": "plus"'));
check("Canonical filtered icon exists", emptyState.includes('filtered: "search"'));
check("Canonical restricted icon exists", emptyState.includes('restricted: "warning"'));
check("Canonical offline icon exists", emptyState.includes('offline: "cloud-off"'));
check("Restricted/offline state keeps status semantics", emptyState.includes('kind === "offline" || kind === "restricted"'));
check("Request empty state delegates to canonical component", requestState.includes("<ClusterEmptyState") && requestState.includes("kind={kind}"));
check("Project empty state delegates to canonical component", projectPrimitive.includes("<ClusterEmptyState") && projectPrimitive.includes("kind={kind}"));

check("Table loading primitive exists", loadingState.includes("export function TableLoadingState"));
check("Inspector loading primitive exists", loadingState.includes("export function InspectorLoadingState"));
check("Table loading exposes bounded known geometry", loadingState.includes("Math.max(2, Math.min(7") && loadingState.includes("data-columns={safeColumns}") && skeletons.includes('data-columns="6"'));
check("Inspector loading exposes detail geometry", loadingState.includes("cluster-inspector-skeleton-v436"));
check("Skeleton styles retain reduced-motion boundary", skeletons.includes("prefers-reduced-motion"));

check("Projects distinguish first-use from filtered empty", projects.includes('kind="first-use"') && projects.includes('kind="filtered"'));
check("Projects first-use action is authorization-derived", projects.includes("actions={isAdmin ?") && projects.includes("A project owner or administrator"));
check("Projects filtered state offers clear filters", projects.includes('title="No projects match this view"') && projects.includes("Clear filters"));
check("People distinguish collection-empty from filtered", people.includes('kind="empty"') && people.includes('kind="filtered"') && people.includes("No people match this view"));
check("People use structural inspector loading", people.includes("<InspectorLoadingState"));
check("People empty inspector explains selection", people.includes('title="Select a person"'));
check("Tickets distinguish first-use from filtered", tickets.includes('kind="first-use"') && tickets.includes('kind="filtered"'));
check("Tickets filtered state clears the current view", tickets.includes("clearTicketFilters") && tickets.includes("Clear filters"));
check("Tickets empty inspector explains selection", tickets.includes('title="Select a ticket"'));
check("Library uses table skeleton for list layout", library.includes("<TableLoadingState") && library.includes('columns={6}'));
check("Library distinguishes filtered, folder-empty, and first-use", library.includes('kind="filtered"') && library.includes('title="This folder is empty"') && library.includes('kind="first-use"'));
check("Library filtered copy does not imply deletion", library.includes("Existing Library content has not been removed"));
check("Inbox distinguishes filtered from true empty", inbox.includes('kind={query || filter !== "all" ? "filtered" : "empty"}') && inbox.includes("Inbox is clear"));
check("Inbox empty inspector explains selection", inbox.includes('title="Select a notification"'));
check("Disabled tools use restricted semantics", application.includes('kind="restricted"') && application.includes("is disabled"));
check("Disabled tools explicitly preserve data", application.includes("Existing project data is not deleted"));
check("My Work distinguishes search miss from true empty", myWork.includes('kind={query ? "filtered" : "empty"}') && myWork.includes("Clear search"));
check("My Work empty states route back to Projects when useful", myWork.includes("Open Projects"));

// The setup flow has evolved since Phase 13. Preserve the original first-use guarantees
// without pinning later releases to the old 15-character password or connection-heavy wizard.
check("Setup validates owner account before progression", setup.includes("const accountReady = Boolean(") && setup.includes("form.ownerPassword.length > 0") && setup.includes("form.ownerPassword === form.ownerPasswordConfirm"));
check("Setup progress exposes current step", setup.includes('aria-current={step === index ? "step" : undefined}'));
check("Setup blocks later steps until owner account is valid", setup.includes("disabled={index > 0 && !accountReady}"));
check("Setup next action blocks invalid owner account", setup.includes("disabled={busy || !accountReady}"));
check("Setup calls secondary configuration optional", setup.includes("Everything except the owner username and password can be completed later") && setup.includes("<span>Optional</span>"));
check("Setup permits explicit optional-step skip", setup.includes(">Skip optional</button>"));
check("Setup identifies a non-blocking post-setup configuration path", setup.includes("Nothing optional here blocks launch") && setup.includes("fully configured from inside the app"));
check("Setup owner identity is presented once", setup.split("<h2>Owner account</h2>").length - 1 === 1 && setup.split("<span>Username</span>").length - 1 === 1);

const primitivePhase = primitives.slice(primitives.indexOf("/* Phase 13: canonical empty"));
const productionPhase = productionUi.slice(productionUi.indexOf("/* Phase 13 first-use guidance"));
check("Phase 13 primitive CSS marker exists", primitivePhase.startsWith("/* Phase 13: canonical empty"));
check("Phase 13 production CSS marker exists", productionPhase.startsWith("/* Phase 13 first-use guidance"));
check("Phase 13 CSS adds no important overrides", !`${primitivePhase}\n${productionPhase}`.includes("!important"));
check("Phase 13 CSS adds no gradients", !`${primitivePhase}\n${productionPhase}`.includes("gradient("));
check("Phase 13 CSS adds no backdrop filters", !`${primitivePhase}\n${productionPhase}`.includes("backdrop-filter"));
check("Phase 13 CSS adds no raw hex colors", !/#[0-9a-fA-F]{3,8}\b/.test(`${primitivePhase}\n${productionPhase}`));

check("Phase 13 docs define five state meanings", docs.includes("**first-use**") && docs.includes("**filtered**") && docs.includes("**restricted**") && docs.includes("**offline**"));
check("Phase 13 docs preserve stale-while-refresh", docs.includes("Phase 9 stale-while-refresh behavior remains authoritative"));
check("Phase 13 docs forbid permission-empty inference", docs.includes("permission restrictions do not prove that no data exists"));
check("Phase 13 docs define loading geometry", docs.includes("table skeletons") && docs.includes("inspector skeletons"));
check("Phase 13 docs define release-blocking gate", docs.includes("## Release-blocking boundary") && docs.includes("empty-loading-first-use-phase13-audit.mjs"));

const pkg = JSON.parse(pkgText);
check("Aggregate audit includes Phase 13 gate", String(pkg.scripts?.audit || "").includes("empty-loading-first-use-phase13-audit.mjs"));
check("Named Phase 13 audit exists", String(pkg.scripts?.["audit:empty-loading-first-use-phase13"] || "").includes("empty-loading-first-use-phase13-audit.mjs"));
check("Master packager invokes Phase 13 gate", packager.includes("empty-loading-first-use-phase13-audit.mjs"));
const docOccurrences = packager.split("docs/EMPTY_LOADING_FIRST_USE_PHASE13.md").length - 1;
check("Master and source packages carry Phase 13 docs", docOccurrences >= 2);
check("Phase 13 notes identify capability and API contract", notes.includes("empty-loading-first-use-phase13-v1") && notes.includes("2026-08-02.63"));
check("Changelog includes v0.436.0", changelog.includes('version: "v0.436.0"') && changelog.includes("Empty, loading, and first-use states"));

console.log(`\nEmpty, loading & first-use Phase 13 audit: ${passed}/${total} passed.`);
if (passed !== total) process.exitCode = 1;
