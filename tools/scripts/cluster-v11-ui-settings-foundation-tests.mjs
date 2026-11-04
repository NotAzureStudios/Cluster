import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = (() => {
  try { return require("typescript"); } catch {
    return require(path.join(execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(), "typescript", "lib", "typescript.js"));
  }
})();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const helperPath = "packages/renderer/src/components/cluster-settings-interactions.ts";
const componentPath = "packages/renderer/src/components/ClusterSettingsPrimitives.tsx";
const cssPath = "packages/renderer/src/components/cluster-settings-primitives.css";
const accountPath = "packages/renderer/src/features/settings/AccountSettingsPage.tsx";
const studioPath = "packages/renderer/src/features/settings/StudioSettingsPage.tsx";
const serverPath = "packages/renderer/src/features/settings/ServerConfigPage.tsx";
const helper = read(helperPath);
const component = read(componentPath);
const css = read(cssPath);
const account = read(accountPath);
const studio = read(studioPath);
const server = read(serverPath);
let count = 0;
function test(name, f) { f(); count++; console.log("PASS", name); }
function compile(file, isTsx = false) {
  const result = ts.transpileModule(read(file), {
    fileName: file,
    reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: isTsx ? ts.JsxEmit.ReactJSX : undefined },
  });
  const errors = (result.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, ts.formatDiagnosticsWithColorAndContext(errors, {
    getCanonicalFileName: (fileName) => fileName, getCurrentDirectory: () => root, getNewLine: () => "\n",
  }));
  return result.outputText;
}
const module = { exports: {} };
vm.runInNewContext(compile(helperPath), { exports: module.exports, module }, { filename: helperPath });
const { nextSettingsChoiceIndex, displaySettingsReviewValue } = module.exports;
test("ArrowRight skips unavailable options", () => {
  assert.equal(nextSettingsChoiceIndex([{}, { disabled: true }, {}, {}], 0, "ArrowRight"), 2);
});
test("ArrowLeft skips unavailable options and wraps", () => {
  assert.equal(nextSettingsChoiceIndex([{}, { disabled: true }, {}, {}], 0, "ArrowLeft"), 3);
  assert.equal(nextSettingsChoiceIndex([{}, { disabled: true }, {}, {}], 2, "ArrowLeft"), 0);
});
test("ArrowUp and ArrowDown traverse the same roving selection", () => {
  assert.equal(nextSettingsChoiceIndex([{}, {}], 0, "ArrowUp"), 1);
  assert.equal(nextSettingsChoiceIndex([{}, {}], 1, "ArrowDown"), 0);
});
test("Home and End select first and last enabled options", () => {
  assert.equal(nextSettingsChoiceIndex([{ disabled: true }, {}, {}, { disabled: true }], 2, "Home"), 1);
  assert.equal(nextSettingsChoiceIndex([{ disabled: true }, {}, {}, { disabled: true }], 1, "End"), 2);
});
test("No enabled choices cannot be selected", () => {
  assert.equal(nextSettingsChoiceIndex([{ disabled: true }], 0, "Home"), -1);
  assert.equal(nextSettingsChoiceIndex([], 0, "ArrowRight"), -1);
});
test("Unrecognized keys do not trigger a selection", () => {
  assert.equal(nextSettingsChoiceIndex([{}, {}], 0, "Tab"), -1);
  assert.equal(nextSettingsChoiceIndex([{}, {}], 0, "Enter"), -1);
});
test("Selection starts from a valid index when the current option disappears", () => {
  assert.equal(nextSettingsChoiceIndex([{ disabled: true }, {}, {}], -1, "ArrowRight"), 1);
  assert.equal(nextSettingsChoiceIndex([{ disabled: true }, {}, {}], -1, "ArrowLeft"), 2);
});
test("Review values represent exact booleans and empty/unknown values", () => {
  assert.equal(displaySettingsReviewValue(true), "On");
  assert.equal(displaySettingsReviewValue(false), "Off");
  assert.equal(displaySettingsReviewValue(undefined), "Not provided");
  assert.equal(displaySettingsReviewValue(null), "Not set");
  assert.equal(displaySettingsReviewValue(" "), "Empty");
});
test("Sensitive values remain masked, including undefined and booleans", () => {
  for (const value of ["server-secret", 12345, true, null, undefined]) {
    assert.equal(displaySettingsReviewValue(value, true), "Protected value");
  }
});
test("Long unprotected values have a bounded visual footprint", () => {
  assert.equal(displaySettingsReviewValue("x".repeat(400)).length, 140);
});
test("All new TSX and affected source files parse", () => {
  for (const file of [componentPath, accountPath, studioPath, serverPath]) compile(file, true);
});
test("Choice cards use accessible single-selection radio semantics and keyboard navigation", () => {
  assert.match(component, /role="radiogroup"/);
  assert.match(component, /role="radio"/);
  assert.match(component, /aria-checked=\{selected\}/);
  assert.match(component, /tabIndex=\{!unavailable && index === focusIndex \? 0 : -1\}/);
  assert.match(component, /nextSettingsChoiceIndex\(options, index, event\.key\)/);
  assert.match(component, /disabled=\{unavailable\}/);
});
test("Settings row preserves native input labels when a control ID is supplied", () => {
  assert.match(component, /<label htmlFor=\{controlId\}>\{label\}<\/label>/);
});
test("Help is opt-in and has a keyboard-operable summary with a readable name", () => {
  assert.match(component, /<details className="cluster-settings-help-v11">/);
  assert.match(component, /aria-label=\{"Help for " \+ label\}/);
});
test("Change review is a native disclosure and explicitly not a server approval", () => {
  assert.match(component, /<details className=\{\("cluster-settings-change-review-v11 "/);
  assert.match(component, /This summary is not a validation or authorization result/);
});
test("Server configuration review only passes labels and impact, never secrets", () => {
  const start = server.indexOf("{changedFields.length > 0 && <ClusterSettingsChangeReview");
  const end = server.indexOf("/>}", start);
  assert.ok(start >= 0 && end > start);
  const segment = server.slice(start, end + 3);
  assert.match(segment, /id: String\(field\.key\), label: field\.label/);
  assert.doesNotMatch(segment, /settings\[field\.key\]|savedSettings\[field\.key\]|before:|after:/);
  assert.match(server, /requestSecurityPin/);
  assert.match(server, /expectedSettings/);
  assert.match(server, /NETWORK_DEPLOYMENT_PENDING/);
});
test("Account Appearance and Quiet Hours consume shared settings controls", () => {
  assert.match(account, /<ClusterSettingsChoiceGroup<AppTheme>/);
  assert.match(account, /<ClusterSettingsChoiceGroup<NonNullable<Settings\["interfaceDensity"\]>>/);
  assert.match(account, /<ClusterSettingsRow label="Quiet hours"/);
  assert.match(account, /<ClusterDisclosureGroup className="settings-component-gallery-v11"/);
});
test("Studio Identity uses accessible labels and retains the original save contract", () => {
  assert.match(studio, /<ClusterSettingsRow label="Studio \/ organization name" controlId="studio-name-field-v11"/);
  assert.match(studio, /<ClusterSettingsRow label="Studio timezone" controlId="studio-timezone-field-v11"/);
  assert.match(studio, /<ClusterNativeSelect id="studio-timezone-field-v11"/);
  assert.match(studio, /requestSecurityPin/);
});
test("Responsive controls support keyboard focus, coarse touch, reduced motion and responsive stacking", () => {
  assert.match(css, /:focus-visible/);
  assert.match(css, /@media \(pointer: coarse\)/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /@media \(max-width: 740px\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /:root\[data-motion="none"\]/);
  assert.doesNotMatch(css, /!important/);
});
test("Project roadmap inventories real cross-workspace consumers and an explicit certification gate", () => {
  const roadmap = read("docs/development/CLUSTER_1_1_UI_INTERACTIONS_ROADMAP.md");
  for (const label of ["Settings", "Management", "Boards", "Whiteboards", "Projects", "Calendar 2.0", "Library", "Studio Analytics", "QA", "Builds", "Desktop", "Runtime Certified"]) {
    assert.ok(roadmap.includes(label), label);
  }
});
console.log(count + "/" + count + " v1.1 UI settings foundation tests passed");
