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

const [palette, ranking, worker, serverRuntime, serverBuilder, shell, application, projectWorkspace, css, docs, notes, pkgText, packager, contracts, privacy] = await Promise.all([
  text("packages/renderer/src/features/search/CommandPalette.tsx"),
  text("packages/renderer/src/features/search/search-ranking.ts"),
  text("packages/renderer/src/features/search/search-worker.ts"),
  text("apps/server/src/domains/search/search-query-runtime.ts"),
  text("apps/server/src/domains/search/search-index-builder.ts"),
  text("packages/renderer/src/features/application/modules/application-shell.tsx"),
  text("packages/renderer/src/features/application/ClusterApplication.tsx"),
  text("packages/renderer/src/features/projects/useProjectDetailWorkspace.ts"),
  text("packages/renderer/src/features/search/search.css"),
  text("docs/SEARCH_COMMAND_PHASE8.md"),
  text("RELEASE_NOTES_v0.431.0.md"),
  text("package.json"),
  text("tools/scripts/package-cluster-master.mjs"),
  text("packages/shared/src/api-contracts.ts"),
  text("apps/server/src/core/privacy-consent.ts"),
]);

check("palette defines stable result groups", palette.includes('type PaletteGroup = "context" | "matches" | "recent" | "navigation" | "actions" | "desktop"') && palette.includes("PALETTE_GROUP_LABELS"));
check("result grouping remains presentation-only", palette.includes('className="search-result-group-v431" role="presentation"') && palette.includes('role="option"'));
check("grouped result headers have production styling", css.includes(".search-result-group-v431") && css.includes("font-variant-numeric: tabular-nums"));
check("palette keyboard traversal includes home/end", palette.includes('event.key === "Home"') && palette.includes('event.key === "End"'));
check("palette keyboard traversal includes page jumps", palette.includes('event.key === "PageDown"') && palette.includes('event.key === "PageUp"'));

check("ranking has transposition-aware bounded edit distance", ranking.includes("previousPrevious") && ranking.includes("left[row - 1] === right[column - 2]"));
check("local worker has transposition-aware fuzzy scoring", worker.includes("previousPrevious") && worker.includes("boundedEditDistance"));
check("server search has transposition-aware fuzzy scoring", serverRuntime.includes("previousPrevious") && serverRuntime.includes("boundedEditDistance"));
check("renderer ranking supports title initials", ranking.includes("function initialsScore") && ranking.includes("initials.startsWith(query)"));
check("local worker supports title initials", worker.includes("function initialsScore") && worker.includes("initials.startsWith(query)"));
check("server search supports title initials", serverRuntime.includes("function initialsScore") && serverRuntime.includes('reason = "Title initials"'));
check("ordered token proximity is scored consistently", ranking.includes("orderedTokenBoost") && worker.includes("orderedTokenBoost") && serverRuntime.includes("orderedTokenBoost"));

check("server index stores fuzzy bigram postings", serverBuilder.includes('keys.add(`~${token.slice(index, index + 2)}`)'));
check("server query uses fuzzy postings before full scan", serverRuntime.includes("function fuzzyPosting") && serverRuntime.includes("|| fuzzyPosting(snapshot, token)"));
check("local index stores fuzzy bigram postings", worker.includes('keys.add(`~${token.slice(offset, offset + 2)}`)'));
check("local query uses fuzzy postings before full scan", worker.includes("function fuzzyPosting") && worker.includes("|| fuzzyPosting(token)"));
check("short fuzzy queries retain broad fallback", serverRuntime.includes("if (token.length < 4) return null") && worker.includes("if (token.length < 4) return null"));

check("search usage records bounded screen and project context", ranking.includes("screens?: Record<string, number>") && ranking.includes("projects?: Record<string, number>") && ranking.includes("slice(0, 12)"));
check("usage boost accepts search context", ranking.includes("searchUsageBoost(usage: SearchUsageMap, key: string, context?: SearchUsageContext)"));
check("usage recording accepts search context", ranking.includes("recordSearchUsage(userId: string, key: string, context?: SearchUsageContext)"));
check("command palette records contextual usage", palette.includes("recordSearchUsage(user.id, item.key, searchUsageContext)"));
check("taskbar records contextual usage", shell.includes("recordSearchUsage(user.id, row.id, { screen, projectId: activeProjectId || null })"));
check("privacy catalog still classifies local search usage as preferences", privacy.includes('pattern: "cluster-search-usage-*"') && privacy.includes('category: "preferences"'));

check("palette receives existing search preferences", application.includes("settings={appSettings}") && palette.includes('settings?: Pick<Settings, "userCommandSearchScope" | "userSearchContextAware">'));
check("workspace search preference affects command palette", palette.includes('preferredSearchScope === "workspace"') && palette.includes("workspaceOnly"));
check("workspace search preference affects taskbar", shell.includes('settings.userCommandSearchScope === "workspace" ? workspaceRows : searchRows'));
check("current-context preference strengthens ranking", palette.includes('preferredSearchScope === "current" ? 1.45 : 1') && shell.includes('settings.userCommandSearchScope === "current" ? 1.5 : 1'));
check("context-aware toggle gates contextual ranking", palette.includes("const contextAware = settings?.userSearchContextAware !== false") && palette.includes("const contextBoost = !contextAware"));

check("current project commands cover core workspaces", ["overview", "builds", "qa", "control", "library"].every((tab) => palette.includes(`["${tab}",`)));
check("same-project tab command is dispatched", palette.includes('new CustomEvent("cluster-project-tab-command"') && projectWorkspace.includes('addEventListener("cluster-project-tab-command"'));
check("project tab command is allowlisted", projectWorkspace.includes("PROJECT_WORKSPACE_TABS.has(detail.tab as ProjectWorkspaceTabId)"));

check("match eligibility is distinct from ranking boosts", palette.includes("const matched = !searchTerm") && palette.includes("item.authoritativeMatch === true") && palette.includes("relevance >= 0"));
check("remote indexed matches remain authoritative", palette.includes("authoritativeMatch: true"));
check("usage boost cannot rescue an unmatched local project", palette.includes("workerScore === undefined ? -1 : workerScore + usageBoost + contextBoost"));

check("Phase 8 documentation records local-only personalization", docs.includes("stays in the existing preference-storage boundary") && docs.includes("must never make an unrelated item survive a query"));
check("Phase 8 documentation records authorization boundary", docs.includes("Server authorization remains authoritative") && docs.includes("canViewProject"));
check("Phase 8 documentation defines release-blocking boundary", docs.includes("## Release-blocking boundary") && docs.includes("search-command-phase8-audit.mjs"));
check("Phase 8 release notes identify capability", notes.includes("search-command-phase8-v1") && notes.includes("API contract: unchanged from `2026-08-02.62`"));
check("server API contract remains unchanged", contracts.includes('version: "2026-08-02.63"'));

const pkg = JSON.parse(pkgText);
check("aggregate audit includes Phase 8 gate", String(pkg.scripts?.audit || "").includes("search-command-phase8-audit.mjs"));
check("named Phase 8 audit exists", String(pkg.scripts?.["audit:search-command-phase8"] || "").includes("search-command-phase8-audit.mjs"));
check("master packager invokes Phase 8 gate", packager.includes("search-command-phase8-audit.mjs"));
const packagedDocOccurrences = packager.split("docs/SEARCH_COMMAND_PHASE8.md").length - 1;
check("master and source packages carry Phase 8 docs", packagedDocOccurrences >= 2);

console.log(`\nSearch & command Phase 8 audit: ${passed}/${total} passed.`);
if (passed !== total) process.exitCode = 1;
