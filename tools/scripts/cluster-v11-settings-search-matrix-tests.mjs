import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const ts = require("typescript");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const compile = (file) => {
  const result = ts.transpileModule(read(file), {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      ...(file.endsWith(".tsx") ? { jsx: ts.JsxEmit.ReactJSX } : {}) },
  });
  const errors = (result.diagnostics || []).filter((diag) => diag.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, file + " parsing failed: " + errors.map((diag) => diag.messageText).join("; "));
  return result.outputText;
};
function loadTs(file) {
  const mod = { exports: {} };
  vm.runInNewContext(compile(file), { exports: mod.exports, module: mod });
  return mod.exports;
}
let passed = 0;
function test(title, fn) { fn(); passed++; console.log("PASS", title); }

const searchHelper = loadTs("packages/renderer/src/components/cluster-settings-search.ts");
const entries = [
  { id: "theme", section: "appearance", label: "Theme", description: "Dark Light System", keywords: "colors" },
  { id: "quiet", section: "notifications", label: "Quiet hours", description: "Silence scheduled alerts", keywords: "time" },
  { id: "pin", section: "pin", label: "Security PIN", keywords: "protected keypad" },
  { id: "advanced", section: "accessibility", label: "Motion effects", keywords: "reduced transitions" },
];
test("multi-token search matches all terms including hidden controls", () => {
  assert.deepEqual(Array.from(searchHelper.findClusterSettings(entries, "quiet time"), (e) => e.id), ["quiet"]);
  assert.deepEqual(Array.from(searchHelper.findClusterSettings(entries, "protected pin"), (e) => e.id), ["pin"]);
  assert.deepEqual(Array.from(searchHelper.findClusterSettings(entries, "reduced motion"), (e) => e.id), ["advanced"]);
});
test("search ranks direct labels ahead of metadata and respects limits", () => {
  const more = [{ id: "keyword", section: "profile", label: "Account", keywords: "Theme" }, entries[0]];
  assert.deepEqual(Array.from(searchHelper.findClusterSettings(more, "theme", 1), e => e.id), ["theme"]);
  assert.equal(searchHelper.findClusterSettings(entries, "", 8).length, 0);
  assert.equal(searchHelper.findClusterSettings(entries, "unregistered option").length, 0);
});
test("search output is deterministic and source data is not mutated", () => {
  const first = searchHelper.findClusterSettings(entries, "theme");
  assert.equal(first[0], entries[0]);
  assert.equal(entries.length, 4);
});
test("section index includes Account settings and deep links to safe fixed anchors", () => {
  const index = read("packages/renderer/src/features/settings/account-settings-search.ts");
  for (const term of ["ACCOUNT_SETTINGS_SECTIONS", "Color theme", "Quiet hours", "Notification delivery by category",
    "Security PIN", "Accessibility", "project mutes", "Desktop", "My assigned forms"]) assert.ok(index.includes(term), term);
  assert.match(index, /targetId: "account-notification-delivery-v11"/);
  assert.match(index, /targetId: "account-quiet-hours-v11"/);
  assert.doesNotMatch(index, /fetch\(|queryApi\(|localStorage/);
});
test("Studio setting search includes only sections supplied by authorized navigation", () => {
  const builder = loadTs("packages/renderer/src/features/settings/studio-settings-search.ts").buildStudioSettingsSearchEntries;
  const identity = { key: "identity", label: "Identity", group: "Studio", meta: "Studio" };
  const qa = { key: "qa", label: "QA gates", group: "Delivery", meta: "blocking" };
  const scoped = builder([identity]);
  assert.deepEqual(Array.from(scoped, entry => entry.section), ["identity"]);
  assert.deepEqual(Array.from(builder([identity, qa]), entry => entry.section), ["identity", "qa"]);
  const studio = read("packages/renderer/src/features/settings/StudioSettingsPage.tsx");
  assert.match(studio, /<ClusterSettingsSearch label="Find studio settings"/);
  assert.match(studio, /buildStudioSettingsSearchEntries\(studioSections\)/);
  assert.match(studio, /onNavigate=\{\(entry\) => setSection\(entry.section\)\}/);
});
test("navigator supports true combobox semantics and keyboard selection", () => {
  const nav = read("packages/renderer/src/components/ClusterSettingsSearch.tsx");
  assert.match(nav, /role="combobox"/);
  assert.match(nav, /aria-autocomplete="list"/);
  assert.match(nav, /aria-activedescendant=/);
  assert.match(nav, /role="listbox"/);
  assert.match(nav, /role="option"/);
  assert.match(nav, /event.key === "ArrowDown"/);
  assert.match(nav, /event.key === "ArrowUp"/);
  assert.match(nav, /event.key === "Enter"/);
  assert.match(nav, /event.key === "Escape"/);
  assert.match(nav, /onNavigate\(entry\)/);
  assert.match(nav, /aria-live="polite"/);
  assert.doesNotMatch(nav, /fetch\(|queryApi\(|localStorage|setInterval|setTimeout/);
});
test("notification delivery matrix uses single-select native radio groups", () => {
  const matrix = read("packages/renderer/src/features/notifications/ClusterNotificationDeliveryMatrix.tsx");
  assert.match(matrix, /<table>/);
  assert.match(matrix, /scope="row"/);
  assert.match(matrix, /scope="col"/);
  assert.match(matrix, /type="radio"/);
  assert.match(matrix, /name=\{id \+ "-" \+ category\}/);
  assert.match(matrix, /checked=\{value\[category\] === option.value\}/);
  assert.match(matrix, /onChange=\{\(\) => onChange\(category, option.value\)\}/);
  assert.match(matrix, /NOTIFICATION_DELIVERY_OPTIONS\.map/);
  assert.match(matrix, /NOTIFICATION_CATEGORIES\.map/);
  assert.match(matrix, /nativePermissionReady/);
  assert.match(matrix, /aria-describedby=\{id \+ "-desc-" \+ category\}/);
  assert.ok(matrix.indexOf("<ClusterSettingsHelp") < matrix.indexOf('className="cluster-notification-matrix-scroll-v11"'), "mode help must not be clipped inside scrolling table");

  assert.doesNotMatch(matrix, /fetch\(|queryApi\(|setInterval/);
});
test("Account settings uses one primary save action, registered navigation, and existing mutation contract", () => {
  const source = read("packages/renderer/src/features/settings/AccountSettingsPage.tsx");
  assert.match(source, /<ClusterSettingsSearch/);
  assert.match(source, /entries=\{ACCOUNT_SETTINGS_SEARCH_ENTRIES\}/);
  assert.match(source, /setSection\(entry.section\)/);
  assert.match(source, /setSettingsSearchJump/);
  assert.match(source, /account-settings-section-focus-v11/);
  assert.match(source, /<ClusterNotificationDeliveryMatrix/);
  assert.match(source, /patch\("notificationCategoryDelivery", \{ \.\.\.notificationCategoryDelivery, \[category\]: nextMode \}\)/);
  assert.equal(source.includes("notification-type-row-v473"), false);
  assert.equal(source.includes("Save settings</ClusterButton>"), false);
  assert.match(source, /expectedFingerprint: preferencesFingerprintRef\.current/);
  assert.match(source, /accountSaveGateRef.current/);
  assert.match(source, /useUnsavedChangesGuard/);
});
test("responsive controls have keyboard focus, scroll access and touch targets", () => {
  const matrix = read("packages/renderer/src/features/notifications/cluster-notification-delivery-matrix.css");
  const search = read("packages/renderer/src/components/cluster-settings-search.css");
  assert.match(matrix, /overflow-x: auto/);
  assert.match(matrix, /:focus-visible/);
  assert.match(matrix, /min-height: 48px/);
  assert.match(search, /:focus-visible/);
  assert.match(search, /min-height: 44px/);
});
test("affected TS and TSX files parse", () => {
  for (const file of [
    "packages/renderer/src/components/ClusterSettingsSearch.tsx",
    "packages/renderer/src/features/notifications/ClusterNotificationDeliveryMatrix.tsx",
    "packages/renderer/src/features/settings/account-settings-search.ts",
    "packages/renderer/src/features/settings/studio-settings-search.ts",
    "packages/renderer/src/features/settings/StudioSettingsPage.tsx",
    "packages/renderer/src/features/settings/AccountSettingsPage.tsx",
  ]) compile(file);
});
console.log(passed + "/" + passed + " settings search and notification matrix regression tests passed");
