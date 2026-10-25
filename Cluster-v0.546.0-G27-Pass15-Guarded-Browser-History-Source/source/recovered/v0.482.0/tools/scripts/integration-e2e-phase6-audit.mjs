import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const text = (file) => readFileSync(path.join(root, file), "utf8");
const e2e = text("tools/scripts/e2e-ci.mjs");
const pkg = JSON.parse(text("package.json"));
const contracts = text("packages/shared/src/api-contracts.ts");
const notes = text("RELEASE_NOTES_v0.422.0.md");
const docs = text("docs/PHASE6_E2E_FOUNDATION.md");
let passed = 0;
let failed = 0;
function check(name, ok) {
  if (ok) { passed += 1; console.log(`PASS ${name}`); }
  else { failed += 1; console.error(`FAIL ${name}`); }
}

check("production E2E uses isolated PostgreSQL schema", e2e.includes('schema", `cluster_e2e_${process.pid}_${Date.now()}`'));
check("production E2E requires built server and web output", e2e.includes('apps/server/dist/index.js') && e2e.includes('apps/web/dist/index.html'));
check("production E2E launches Chromium", e2e.includes('await chromium.launch({ headless: true })'));
check("production E2E has anonymous browser context", e2e.includes("anonymousContext") && e2e.includes("anonymousPage"));
check("production E2E has independent peer browser context", e2e.includes("peerContext") && e2e.includes("peerPage"));
check("anonymous API boundary is exercised", e2e.includes("unauthenticated API boundaries reject workspace access") && e2e.includes('"/api/me", "/api/projects", "/api/whiteboards"'));
check("shared renderer authentication is exercised", e2e.includes("authenticate through the shared renderer") && e2e.includes("Continue locally"));
check("logout/re-auth lifecycle is exercised", e2e.includes("session logout and re-authentication lifecycle is enforced") && e2e.includes('/api/auth/logout'));
check("revoked session is required to return 401", e2e.includes("Revoked session still accessed /api/me"));
check("owner permission decoration is asserted", e2e.includes("owner permission and mutation-origin contracts are enforced") && e2e.includes("me.body?.isAdmin"));
check("mutation CSRF/origin boundary is asserted", e2e.includes("Mutation without CSRF/origin protection") && e2e.includes("[403, 419]"));
check("project create provisions default board", e2e.includes("createDefaultBoard: true"));
check("project create provisions whiteboard", e2e.includes("createWhiteboard: true"));
check("project create provisions library folder", e2e.includes("createLibraryFolder: true"));
check("provisioned board is fetched", e2e.includes('authenticatedJson(page, `/api/boards/${boardId}`)'));
check("provisioned whiteboard is fetched", e2e.includes('authenticatedJson(page, `/api/whiteboards/${whiteboardId}`)'));
check("realtime helper sends heartbeat", e2e.includes('/api/collaboration/heartbeat'));
check("realtime helper records collaboration action", e2e.includes('/api/collaboration/action'));
check("realtime helper reads collaboration state", e2e.includes('/api/collaboration/state?tool='));
check("board realtime uses two client ids", e2e.includes("phase6-primary") && e2e.includes("phase6-peer"));
check("board presence requires two clients", e2e.includes("Board collaboration did not expose two client presences"));
check("board peer action propagation is asserted", e2e.includes("Board collaboration did not propagate peer action state"));
check("whiteboard realtime uses two client ids", e2e.includes("phase6-whiteboard-primary") && e2e.includes("phase6-whiteboard-peer"));
check("whiteboard presence requires two clients", e2e.includes("Whiteboard collaboration did not expose two client presences"));
check("whiteboard peer action propagation is asserted", e2e.includes("Whiteboard collaboration did not propagate peer action state"));
check("E2E report schema identifies Phase 6", e2e.includes('schema: 4') && e2e.includes('phase: "phase6-resilience"'));
check("E2E result is persisted", e2e.includes("production-e2e.json") && e2e.includes("report.passed"));
check("E2E command remains available", pkg.scripts?.["e2e:ci"] === "node tools/scripts/e2e-ci.mjs");
check("Phase 6 audit command is available", pkg.scripts?.["audit:integration-e2e-phase6"] === "node tools/scripts/integration-e2e-phase6-audit.mjs");
check("API contract advertises Phase 6 foundation", contracts.includes('version: "2026-08-02.63"') && contracts.includes('"integration-e2e-foundation-v1"'));
check("release notes identify Phase 6.1-6.16", notes.includes("Phase 6.1-6.16") && notes.includes("integration-e2e-foundation-v1"));
check("E2E documentation defines clean environment", docs.includes("isolated PostgreSQL schema") && docs.includes("built server and web artifacts"));
check("E2E documentation defines session lifecycle", docs.includes("logout") && docs.includes("re-authentication"));
check("E2E documentation defines permissions boundary", docs.includes("authorization") && docs.includes("CSRF"));
check("E2E documentation defines Board realtime", docs.includes("Board") && docs.includes("two browser clients"));
check("E2E documentation defines Whiteboard realtime", docs.includes("Whiteboard") && docs.includes("two browser clients"));
check("E2E documentation avoids claiming unavailable execution", docs.includes("requires a real PostgreSQL test database") && docs.includes("Playwright Chromium"));

console.log(`Phase 6 E2E foundation audit: ${passed}/${passed + failed} passed.`);
if (failed) process.exitCode = 1;
