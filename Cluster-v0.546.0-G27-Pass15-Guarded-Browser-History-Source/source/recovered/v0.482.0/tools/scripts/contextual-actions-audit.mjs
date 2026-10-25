import { readFile } from "node:fs/promises";

const text = (file) => readFile(file, "utf8");
let passed = 0;
let total = 0;
function check(label, condition) {
  total += 1;
  if (!condition) { console.error(`FAIL  ${label}`); process.exitCode = 1; return; }
  passed += 1;
  console.log(`PASS  ${label}`);
}

const context = await text("packages/renderer/src/components/ClusterContextActions.tsx");
const primitiveCss = await text("packages/renderer/src/styles/design-system/primitives.css");
const tickets = await text("packages/renderer/src/features/tickets/TicketSystemPage.tsx");
const inbox = await text("packages/renderer/src/features/notifications/NotificationInboxPage.tsx");
const scheduler = await text("packages/renderer/src/features/time/TimeWorkspacePage.tsx");
const people = await text("packages/renderer/src/features/people/PeoplePages.tsx");
const admin = await text("packages/renderer/src/features/admin/AdminWorkspacePage.tsx");
const projectRow = await text("packages/renderer/src/features/projects/ProjectPortfolioItem.tsx");
const notificationRoute = await text("apps/server/src/domains/notifications/notification-routes.ts");
const notificationRepo = await text("apps/server/src/domains/notifications/notification-repository.ts");
const docs = await text("docs/CONTEXTUAL_ACTIONS_PHASE5.md");
const pkg = JSON.parse(await text("package.json"));
const packager = await text("tools/scripts/package-cluster-master.mjs");

check("ClusterActionMenu exists", context.includes("export function ClusterActionMenu"));
check("ClusterBulkActionBar exists", context.includes("export function ClusterBulkActionBar"));
check("ClusterUndoBar exists", context.includes("export function ClusterUndoBar"));
check("ClusterRowActions exists", context.includes("export function ClusterRowActions"));
check("action menu exposes menu semantics", context.includes('role="menu"') && context.includes('role="menuitem"') && context.includes('aria-haspopup'));
check("action menu supports keyboard traversal", ["ArrowDown", "ArrowUp", "Home", "End"].every((key) => context.includes(`\"${key}\"`)));
check("action menu Escape restores trigger focus", context.includes('event.key !== "Escape"') && context.includes("triggerRef.current?.focus()"));
check("action menu closes on outside pointer input", context.includes('document.addEventListener("pointerdown"'));
check("bulk bar is selection conditional", context.includes("if (selectionCount <= 0) return null"));
check("bulk bar announces selection count", context.includes('aria-live="polite"'));
check("undo bar uses shared controls", context.includes("<ClusterButton") && context.includes("<ClusterIconButton"));
check("contextual action CSS uses canonical surface tokens", primitiveCss.includes(".cluster-action-menu-v428") && primitiveCss.includes("var(--cluster-shadow-float)"));
const phaseCss = primitiveCss.slice(primitiveCss.indexOf("v0.428 contextual action hierarchy"));
check("Phase 5 primitive CSS adds no important overrides", !phaseCss.includes("!important"));
check("row actions preserve touch visibility", primitiveCss.includes("@media (hover: none)") && primitiveCss.includes(".cluster-row-actions-v428"));
check("Tickets keep New ticket primary", tickets.includes('variant="primary"') && tickets.includes("New ticket"));
check("Tickets move refresh/export into action menu", tickets.includes('label="More ticket actions"') && tickets.includes('id: "refresh"') && tickets.includes('id: "export"'));
check("Tickets use selection-only bulk bar", tickets.includes("<ClusterBulkActionBar") && tickets.includes('label="Selected ticket actions"'));
check("Tickets triage separates reject", tickets.includes('label="More triage actions"') && tickets.includes('id: "reject"') && tickets.includes("danger: true"));
check("Inbox uses contextual header actions", inbox.includes('label="More inbox actions"'));
check("Inbox uses canonical bulk bar", inbox.includes('label="Selected notification actions"'));
check("Inbox provides targeted Undo", inbox.includes("<ClusterUndoBar") && inbox.includes("restoreDismissed(lastDismissed.ids)"));
check("Inbox detail keeps Open direct", inbox.includes('variant="primary" onClick={() => open(selected)}>Open'));
check("Inbox destructive dismiss lives in menu", inbox.includes('label: "Dismiss notification"') && inbox.includes("separatorBefore: true"));
check("server restore supports targeted IDs", notificationRoute.includes("notificationStateMutationSchema.parse(request.body).ids") && notificationRepo.includes("restoreDismissed(userId: string, ids?: string[])"));
check("Scheduler keeps week navigation direct and refresh contextual", scheduler.includes('label="Previous week"') && scheduler.includes('label="Next week"') && scheduler.includes('label="More scheduler actions"'));
check("People profile keeps Edit profile primary", people.includes('variant="primary" onClick={onOpenSettings}>Edit profile'));
check("People refresh is contextual", people.includes('label="More people actions"'));
check("Admin Add person remains primary", admin.includes('variant="primary"') && admin.includes("Add person"));
check("Admin people refresh is contextual", admin.includes('label="More people management actions"'));
check("project rows use contextual row-action contract", projectRow.includes('data-cluster-context-row="true"') && projectRow.includes("<ClusterRowActions"));
check("Phase 5 docs prioritize frequency and error cost", docs.includes("usage frequency and error cost") && docs.includes("Primary work stays visible"));
check("Phase 5 docs prohibit fake broad undo", docs.includes("Do not fake Undo") && docs.includes("exact operation"));
check("aggregate audit includes contextual-action gate", String(pkg.scripts?.audit || "").includes("contextual-actions-audit.mjs"));
check("named contextual-action audit exists", String(pkg.scripts?.["audit:contextual-actions"] || "").includes("contextual-actions-audit.mjs"));
check("master packager invokes Phase 5 gate", packager.includes("contextual-actions-audit.mjs"));
check("master packager carries Phase 5 docs", packager.includes("docs/CONTEXTUAL_ACTIONS_PHASE5.md"));

console.log(`\nContextual actions audit: ${passed}/${total} passed.`);
if (passed !== total) process.exitCode = 1;
