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

const primitive = await text("packages/renderer/src/components/ClusterMasterDetail.tsx");
const primitiveCss = await text("packages/renderer/src/styles/design-system/primitives.css");
const tickets = await text("packages/renderer/src/features/tickets/TicketSystemPage.tsx");
const inbox = await text("packages/renderer/src/features/notifications/NotificationInboxPage.tsx");
const people = await text("packages/renderer/src/features/people/PeoplePages.tsx");
const artifacts = await text("packages/renderer/src/features/projects/ProjectBuildArtifactWorkbench.tsx");
const qa = await text("packages/renderer/src/features/projects/ProjectQAPanel.tsx");
const library = await text("packages/renderer/src/features/library/LibraryWorkspacePage.tsx");
const admin = await text("packages/renderer/src/features/admin/AdminWorkspacePage.tsx");
const docs = await text("docs/MASTER_DETAIL_PHASE6.md");
const pkg = JSON.parse(await text("package.json"));
const packager = await text("tools/scripts/package-cluster-master.mjs");

check("ClusterMasterDetail exists", primitive.includes("export function ClusterMasterDetail"));
check("detail history hook exists", primitive.includes("export function useClusterDetailHistory"));
check("detail deep-link reader exists", primitive.includes("export function readClusterDetailSelection"));
check("history uses inspect query contract", primitive.includes('DETAIL_QUERY_KEY = "inspect"') && primitive.includes("URLSearchParams") === false && primitive.includes("searchParams"));
check("initial and popstate restore are supported", primitive.includes("restore();") && primitive.includes('addEventListener("popstate"'));
check("first inspector open pushes history", primitive.includes("window.history.pushState"));
check("record-to-record inspector changes replace history", primitive.includes("window.history.replaceState"));
check("close removes inspector without history.back", primitive.includes("detailUrl(scope, null)") && !primitive.includes("history.back"));
check("pane labels are explicit", primitive.includes("masterLabel") && primitive.includes("detailLabel") && primitive.includes("aria-label"));
check("mobile detail close uses shared icon button", primitive.includes("ClusterIconButton") && primitive.includes("cluster-detail-close-v429"));
check("master detail responsive overlay exists", primitiveCss.includes("v0.429 master/detail workflow") && primitiveCss.includes("position: fixed") && primitiveCss.includes("max-width: 900px"));
const phaseCss = primitiveCss.slice(primitiveCss.indexOf("v0.429 master/detail workflow"));
check("Phase 6 primitive CSS adds no important overrides", !phaseCss.includes("!important"));
check("Tickets use canonical master/detail", tickets.includes("<ClusterMasterDetail") && tickets.includes('useClusterDetailHistory("ticket"'));
check("Tickets keep project/board navigation explicit", tickets.includes(">Project</ClusterButton>") && tickets.includes(">Board</ClusterButton>"));
check("Inbox uses canonical master/detail", inbox.includes("notification-master-detail-v429") && inbox.includes('useClusterDetailHistory("notification"'));
check("Inbox target navigation remains explicit Open", inbox.includes('variant="primary" onClick={() => open(selected)}>Open'));
check("People use canonical master/detail", people.includes("people-layout-v244") && people.includes('useClusterDetailHistory("person"'));
check("People initial load can restore deep link", people.includes('readClusterDetailSelection("person")'));
check("Build artifacts use canonical inspector", artifacts.includes("build-workbench-grid-v309") && artifacts.includes('useClusterDetailHistory("build-artifact"'));
check("QA triage uses in-place inspector", qa.includes("project-qa-master-detail-v429") && qa.includes('useClusterDetailHistory("qa-report"'));
check("QA selection no longer navigates immediately", qa.includes("qaDetailHistory.openDetail(card.id)") && !qa.includes("key={card.id} onClick={()=>onOpenBoard(card.boardId)"));
check("QA inspector keeps explicit board escalation", qa.includes(">Open board</ClusterButton>"));
check("Library uses canonical results/inspector split", library.includes("library-master-detail-v429") && library.includes('useClusterDetailHistory("library-item"'));
check("Library restores detail from authoritative API", library.includes('api<LibraryItem>(`/api/knowledge/${id}`)'));
check("Admin retains in-place directory/detail management", admin.includes("user-admin-layout-v244") && admin.includes("user-admin-directory-v244") && admin.includes("user-admin-detail-v244"));
check("docs define collection-first inspection", docs.includes("Keep the collection visible for routine inspection"));
check("docs define deliberate escalation", docs.includes("Escalate deliberately") && docs.includes("Open board"));
check("docs prohibit unsafe history.back close", docs.includes("Do not use `history.back()`"));
check("docs preserve dedicated workspace exceptions", docs.includes("Full-workspace exceptions") && docs.includes("whiteboards"));
check("aggregate audit includes master-detail gate", String(pkg.scripts?.audit || "").includes("master-detail-audit.mjs"));
check("named master-detail audit exists", String(pkg.scripts?.["audit:master-detail"] || "").includes("master-detail-audit.mjs"));
check("master packager invokes Phase 6 gate", packager.includes("master-detail-audit.mjs"));
check("master packager carries Phase 6 docs", packager.includes("docs/MASTER_DETAIL_PHASE6.md"));

console.log(`\nMaster/detail audit: ${passed}/${total} passed.`);
if (passed !== total) process.exitCode = 1;
