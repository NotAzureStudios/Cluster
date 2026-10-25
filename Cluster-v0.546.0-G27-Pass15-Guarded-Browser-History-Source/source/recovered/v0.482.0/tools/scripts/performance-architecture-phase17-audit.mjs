import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const read = (relative) => readFile(path.join(root, relative), "utf8");
let passed = 0;
let total = 0;
function check(label, ok) {
  total += 1;
  if (!ok) { console.error(`FAIL  ${label}`); process.exitCode = 1; return; }
  passed += 1;
  console.log(`PASS  ${label}`);
}

const [perf, api, hooks, panel, worker, serverSearch, searchService, serverBudgets, load, bundle, vite, foundation, entries, tickets, library, board, microbench, runtimeGate, docs, pkgText, packager, notes, changelog, versions] = await Promise.all([
  read("packages/renderer/src/core/performance.ts"),
  read("packages/renderer/src/core/api.ts"),
  read("packages/renderer/src/features/shell/runtime-hooks.ts"),
  read("packages/renderer/src/features/operations/ClientPerformancePanel.tsx"),
  read("packages/renderer/src/features/search/search-worker.ts"),
  read("apps/server/src/domains/search/search-query-runtime.ts"),
  read("apps/server/src/domains/search/search-service.ts"),
  read("apps/server/src/core/performance-budgets.ts"),
  read("tools/scripts/performance-load-test.mjs"),
  read("tools/scripts/bundle-budget.mjs"),
  read("apps/web/vite.config.ts"),
  read("packages/renderer/src/features/application/modules/application-foundation.tsx"),
  read("packages/renderer/src/features/application/application-entrypoints.tsx"),
  read("packages/renderer/src/features/tickets/TicketSystemPage.tsx"),
  read("packages/renderer/src/features/library/LibraryWorkspacePage.tsx"),
  read("packages/renderer/src/features/boards/BoardWorkspacePage.tsx"),
  read("tools/scripts/performance-microbench-phase17.mjs"),
  read("tools/scripts/performance-runtime-gate-phase17.mjs"),
  read("docs/PERFORMANCE_ARCHITECTURE_PHASE17.md"),
  read("package.json"),
  read("tools/scripts/package-cluster-master.mjs"),
  read("RELEASE_NOTES_v0.440.0.md"),
  read("packages/renderer/src/features/changelog/data/cluster-changelog.ts"),
  read("config/toolchain-versions.json"),
]);

check("Client runtime budgets define route p95", perf.includes("routeP95Ms: { target: 900, warning: 1_500 }"));
check("Client runtime budgets define network p95", perf.includes("networkP95Ms: { target: 750, warning: 1_200 }"));
check("Client runtime budgets define search p95", perf.includes("searchP95Ms: { target: 120, warning: 200 }"));
check("Client runtime budgets define startup classes", perf.includes("coldFirstFrameMs") && perf.includes("warmFirstFrameMs") && perf.includes("reloadFirstFrameMs"));
check("Client runtime budgets define Web Vitals", perf.includes("fcpMs:") && perf.includes("lcpMs:") && perf.includes("inpMs:") && perf.includes("cls:"));
check("Client runtime budgets define renderer heap limits", perf.includes("heapUsedMiB") && perf.includes("heapUtilization"));
check("Client runtime budgets define cache effectiveness", perf.includes("cacheHitRate: { target: 0.55, warning: 0.35 }"));
check("Client runtime budgets define request chatter", perf.includes("requestRatePerMinute: { target: 90, warning: 150 }"));
check("Client runtime budgets define long-task rate", perf.includes("longTasksPerMinute: { target: 5, warning: 10 }"));
check("Unknown samples do not automatically pass", perf.includes('return "unknown"') && perf.includes("knownChecks.length"));
check("Client health exposes pass warn fail posture", perf.includes("ClientPerformanceHealthStatus") && perf.includes("failures") && perf.includes("warnings"));
check("Client report exports health posture", perf.includes("health: { status: healthStatus"));
check("Client report still exports bounded raw metrics", perf.includes("metrics: [...metrics]") && perf.includes("MAX_METRICS = 1_200"));

check("Eligible cache misses are recorded", api.includes('source: "miss", hit: false'));
check("Memory cache hits remain recorded", api.includes('source: "memory", hit: true'));
check("Inflight dedupe hits remain recorded", api.includes('source: "inflight", hit: true'));
check("Durable cache hits remain recorded", api.includes('source: "durable", hit: true'));
check("Cache effectiveness excludes explicit bypasses", perf.includes('metric.detail?.bypass !== true'));
check("Cache hit rate counts hit and miss samples", perf.includes("const cacheMisses") && perf.includes("cacheHits + cacheMisses"));

check("API transport remains canonical network timing source", api.includes('category: "network"') && api.includes("durationMs: endedAt - startedAt"));
check("Resource Timing excludes API double counting", perf.includes('resource.name.includes("/api/")') && perf.includes("return;"));
check("Resource Timing still measures slow assets", perf.includes("cacheLikely") && perf.includes('category: assetMatch[1]'));
check("Route transitions are classified as navigation", hooks.includes('category: "navigation"') && hooks.includes("name: `route ${routeKey}`"));
check("Route marks are cleared", hooks.includes("performance.clearMarks(markName)"));
check("Frame monitor suspends while hidden", perf.includes('document.visibilityState === "visible"') && perf.includes("frameHandle = 0; lastFrameAt = 0"));
check("Frame monitor resumes on visibility", perf.includes('document.addEventListener("visibilitychange", visibilityHandler)'));
check("Frame visibility handler is removed", perf.includes('document.removeEventListener("visibilitychange", visibilityHandler)'));

check("Client performance panel uses canonical buttons", panel.includes('import { ClusterButton }') && !panel.includes('<button type="button"'));
check("Client panel surfaces cache misses", panel.includes("summary.cache.misses"));
check("Client panel surfaces API chatter", panel.includes("API chatter") && panel.includes("requestRatePerMinute"));
check("Client panel surfaces long-task rate", panel.includes("Long tasks") && panel.includes("longTasksPerMinute"));
check("Client panel surfaces release health checks", panel.includes("Client release performance budgets") && panel.includes("knownChecks.map"));

check("Local search reuses bounded fuzzy token scores", worker.includes("fuzzyCache") && worker.includes("fuzzyCache.size < 20_000"));
check("Server search reuses bounded fuzzy token scores", serverSearch.includes("fuzzyCache") && serverSearch.includes("fuzzyCache.size < 20_000"));
check("Server search shares one fuzzy cache per query", searchService.includes("const fuzzyScoreCache = new Map<string, number>()") && searchService.includes("score(item, normalizedQuery, fuzzyScoreCache)"));
check("Exact token scoring exits before edit distance", worker.includes("if (candidate === queryToken) return 58") && serverSearch.includes("if (candidate === queryToken) return 62"));
check("Ordered token boost prefers exact indexes", worker.includes("const exactIndex = candidateTokens.findIndex") && serverSearch.includes("const exactIndex = candidateTokens.findIndex"));

check("Microbenchmark uses actual search worker", microbench.includes('search-worker.ts') && microbench.includes("ts.transpileModule"));
check("Microbenchmark defaults to 10k documents", microbench.includes("10_000"));
check("Microbenchmark has index budget", microbench.includes("CLUSTER_SEARCH_BENCH_INDEX_MS") && microbench.includes("2_500"));
check("Microbenchmark has p95 budget", microbench.includes("CLUSTER_SEARCH_BENCH_P95_MS") && microbench.includes("250"));
check("Microbenchmark has max budget", microbench.includes("CLUSTER_SEARCH_BENCH_MAX_MS") && microbench.includes("400"));
check("Microbenchmark verifies typo search", microbench.includes('"proejct"'));
check("Microbenchmark fails on regression", microbench.includes("process.exit(1)") && microbench.includes("Performance Phase 17 search microbenchmark: PASS"));

check("Runtime gate accepts client reports", runtimeGate.includes("CLUSTER_CLIENT_PERFORMANCE_REPORT"));
check("Runtime gate accepts server reports", runtimeGate.includes("CLUSTER_SERVER_PERFORMANCE_REPORT"));
check("Runtime gate can fail closed", runtimeGate.includes("CLUSTER_PERFORMANCE_REQUIRE_RUNTIME"));
check("Runtime gate rejects client fail checks", runtimeGate.includes('check.status === "fail"'));
check("Runtime gate requires representative client checks", runtimeGate.includes("CLUSTER_CLIENT_MIN_KNOWN_CHECKS"));

for (const key of ["requestP95Ms", "requestP99Ms", "requestErrorRate", "eventLoopP95Ms", "rssMiB", "heapUtilization", "databaseP95Ms", "databaseP99Ms", "postgresCacheHitRatio", "postgresIndexScanRatio", "postgresConnectionUtilization"]) check(`Server performance budget retains ${key}`, serverBudgets.includes(`${key}:`));
check("Load harness retains 10 25 50 user scenarios", load.includes("new Set([10, 25, 50])"));
check("Load harness remains read-only", load.includes('method: "GET"') && load.includes("delete|logout|reset|remove|purge"));
check("Load harness enforces p95 p99 error budgets", load.includes("CLUSTER_LOAD_P95_MS") && load.includes("CLUSTER_LOAD_P99_MS") && load.includes("CLUSTER_LOAD_ERROR_RATE"));
check("Bundle budget retains chunk and total budgets", bundle.includes("jsChunkBytes") && bundle.includes("totalJsBytes") && bundle.includes("assetCount"));
check("Bundle budget remains honest without built web", bundle.includes("unavailable (no built web tree"));
check("Heavy vendor chunks remain split", vite.includes('vendor-three') && vite.includes('vendor-pdf') && vite.includes('vendor-dnd') && vite.includes('vendor-react'));
check("Board workspace remains lazy", foundation.includes("LazyBoardWorkspacePage = lazy"));
check("Whiteboard and Timeline remain lazy", foundation.includes("LazyWhiteboardWorkspacePage = lazy") && foundation.includes("LazyTimelineWorkspacePage = lazy"));
check("Library and Time remain lazy", entries.includes("LazyLibraryWorkspacePage = lazy") && entries.includes("LazyTimeWorkspacePage = lazy"));
check("Tickets retain virtualization", tickets.includes("tickets-virtual-list-v296") && tickets.includes("scrollTop"));
check("Library retains virtualization", library.includes("library-virtual-list-v217") && library.includes("scrollTop"));
check("Board rendering remains bounded", board.includes("BOARD_CARD_RENDER_BATCH") && board.includes("visibleCards.slice(0, renderLimit)"));

check("Phase 17 documentation defines runtime budgets", docs.includes("Client runtime budgets") && docs.includes("API request chatter"));
check("Phase 17 documentation defines evidence ladder", docs.includes("Release evidence ladder") && docs.includes("performance-runtime-gate-phase17.mjs"));
check("Phase 17 docs retain source-only unattested boundary", docs.includes("source-only environment") && docs.includes("CLUSTER_PERFORMANCE_REQUIRE_RUNTIME=1"));
const pkg = JSON.parse(pkgText);
check("Aggregate audit includes Phase 17", String(pkg.scripts?.audit || "").includes("performance-architecture-phase17-audit.mjs"));
check("Named Phase 17 audit exists", String(pkg.scripts?.["audit:performance-architecture-phase17"] || "").includes("performance-architecture-phase17-audit.mjs"));
check("Microbenchmark script is exposed", String(pkg.scripts?.["performance:microbench"] || "").includes("performance-microbench-phase17.mjs"));
check("Runtime performance gate is exposed", String(pkg.scripts?.["performance:runtime-gate"] || "").includes("performance-runtime-gate-phase17.mjs"));
check("Master packager runs Phase 17 audit", packager.includes("performance-architecture-phase17-audit.mjs"));
check("Master packager runs search microbenchmark", packager.includes("performance-microbench-phase17.mjs"));
check("Master/source packages carry Phase 17 docs", packager.split("docs/PERFORMANCE_ARCHITECTURE_PHASE17.md").length >= 3);
check("Release notes identify Phase 17 capability", notes.includes("performance-architecture-phase17-v1"));
check("Release notes retain API contract", notes.includes("2026-08-02.63"));
check("Release notes retain production build foundation marker", notes.includes("production-build-foundation-v1"));
check("Changelog includes v0.440.0", changelog.includes('version: "v0.440.0"') && changelog.includes("Performance and architecture validation"));
check("Toolchain is at or beyond the 0.440.0 Phase 17 baseline", Number(JSON.parse(versions).cluster.split(".")[1] || 0) >= 440);

console.log(`\nPerformance & architecture Phase 17 audit: ${passed}/${total} passed.`);
if (passed !== total) process.exitCode = 1;
