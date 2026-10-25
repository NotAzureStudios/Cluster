import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const checks = [];
function check(label, ok, detail = "") { checks.push({ label, ok, detail }); }
async function text(relative) { return readFile(path.join(root, relative), "utf8"); }
async function files(directory) {
  const base = path.join(root, directory); const out = [];
  for (const entry of await readdir(base, { withFileTypes: true })) {
    const absolute = path.join(base, entry.name);
    if (entry.isDirectory()) out.push(...await files(path.relative(root, absolute)));
    else if (/\.(?:ts|tsx)$/.test(entry.name)) out.push(path.relative(root, absolute).replaceAll("\\", "/"));
  }
  return out;
}
const manifest = JSON.parse(await text("config/ux-consistency-surfaces.json"));
const baseline = JSON.parse(await text("config/ux-debt-baseline.json"));
const designTokens = await text("packages/renderer/src/styles/design-system/tokens.css");
const primitives = await text("packages/renderer/src/styles/design-system/primitives.css");
const shell = await text("packages/renderer/src/features/application/ClusterApplication.tsx");
const appRoot = await text("packages/renderer/src/App.tsx");
const palette = await text("packages/renderer/src/features/search/CommandPalette.tsx");
const runtimeStyleContract = await text("packages/renderer/src/core/runtime-style.ts");
const loadingStates = await text("packages/renderer/src/components/LoadingState.tsx");
const skeletonStyles = await text("packages/renderer/src/styles/design-system/skeletons.css");
const serverStatus = await text("packages/renderer/src/components/AppVersionFooter.tsx");
const operationalStatus = await text("packages/renderer/src/components/operational-status.ts");
const healthRoutes = await text("apps/server/src/app/server-routes-health-operations.ts");
const rendererFiles = await files("packages/renderer/src");
let nativeDialogs = 0, inlineStyles = 0, buttonsWithoutType = 0;
for (const relative of rendererFiles) {
  const source = await text(relative);
  nativeDialogs += (source.match(/\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/g) || []).length;
  inlineStyles += (source.match(/style=\{\{/g) || []).length;
  for (const match of source.matchAll(/<button\b[^>]*>/g)) if (!/\btype\s*=/.test(match[0])) buttonsWithoutType++;
}
check("UX surface manifest covers at least 15 high-use surfaces", Array.isArray(manifest.surfaces) && manifest.surfaces.length >= 15);
for (const surface of manifest.surfaces || []) {
  let source = ""; let size = 0;
  try { source = await text(surface.file); size = (await stat(path.join(root, surface.file))).size; } catch {}
  check(`UX surface exists: ${surface.id}`, Boolean(source));
  check(`UX surface marker remains reachable: ${surface.id}`, source.toLowerCase().includes(String(surface.marker).toLowerCase()));
  check(`UX surface stays within renderer file budget: ${surface.id}`, size > 0 && size <= 180 * 1024, `${size} bytes`);
}
check("semantic design tokens retain focus, status, spacing, and typography contracts", ["--cluster-focus-ring", "--space-3", "--cluster-font-sans", "--cluster-success"].every((marker) => designTokens.includes(marker)));
check("shared primitives retain button, field, dialog, and focus-visible contracts", [".button", "input:not", '[role="dialog"]', ":focus-visible"].every((marker) => primitives.includes(marker)));
check("global shell keeps skip-link and main-content focus target", appRoot.includes("skip-link-v204") && shell.includes("cluster-main-content"));
check("command palette remains a modal dialog with keyboard escape behavior", palette.includes('role="dialog"') && palette.includes('aria-modal="true"') && palette.includes("Escape"));
check("native browser dialog debt does not increase", nativeDialogs <= baseline.nativeDialogCallsMaximum, `${nativeDialogs}/${baseline.nativeDialogCallsMaximum}`);
check("inline style-object debt does not increase", inlineStyles <= baseline.inlineStyleObjectMaximum, `${inlineStyles}/${baseline.inlineStyleObjectMaximum}`);
check("implicit button-type debt does not increase", buttonsWithoutType <= baseline.buttonWithoutExplicitTypeMaximum, `${buttonsWithoutType}/${baseline.buttonWithoutExplicitTypeMaximum}`);
check("runtime-calculated styles use a reviewed property allowlist", runtimeStyleContract.includes("ALLOWED_PROPERTIES") && runtimeStyleContract.includes("key.startsWith(\"--\")") && runtimeStyleContract.includes("Unsupported runtime style property"));
check("shared skeleton system covers list, settings, policy, cards, and workspace loading", ["LoadingState", "CardGridLoadingState", "SettingsLoadingState", "PolicyLoadingState", "WorkspaceLoadingState"].every((marker) => loadingStates.includes(marker)) && skeletonStyles.includes("prefers-reduced-motion"));
check("sidebar server status exposes live operational posture", serverStatus.includes("server-status-popover-v390") && serverStatus.includes("API p95") && serverStatus.includes("Event loop p95") && serverStatus.includes("deriveServerOperationalStatus") && operationalStatus.includes('label: "Version conflict"'));
check("public health signals stay aggregate while detailed health stays admin-only", healthRoutes.includes("signals: operational.checks.map") && healthRoutes.includes('app.get("/api/admin/operations/health"'));
const failures = checks.filter((item) => !item.ok);
for (const item of checks) console.log(`${item.ok ? "PASS" : "FAIL"}  ${item.label}${item.detail ? ` (${item.detail})` : ""}`);
console.log(`\nCluster UX consistency audit: ${checks.length - failures.length}/${checks.length} passed.`);
if (failures.length) process.exit(1);
