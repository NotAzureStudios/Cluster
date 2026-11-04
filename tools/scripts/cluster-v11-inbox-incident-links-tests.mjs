import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const ts = require("typescript");
const read = path => fs.readFileSync(root + "/" + path, "utf8");
const compile = file => {
  const result = ts.transpileModule(read(file), {
    fileName: file, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
      ...(file.endsWith(".tsx") ? { jsx: ts.JsxEmit.ReactJSX } : {}) },
  });
  assert.equal(result.diagnostics.filter(x => x.category === ts.DiagnosticCategory.Error).length, 0, file);
  return result.outputText;
};
function load(file, mocks = {}) {
  const mod = { exports: {} };
  const localRequire = id => {
    if (!Object.hasOwn(mocks, id)) throw new Error("Unexpected dependency: " + id);
    return mocks[id];
  };
  vm.runInNewContext(compile(file), { exports: mod.exports, module: mod, require: localRequire });
  return mod.exports;
}
const incident = load("packages/renderer/src/features/admin/incident-link.ts");
const navigation = load("packages/renderer/src/features/notifications/notification-navigation.ts", {
  "@cluster/shared": { clusterResourceAddressFromEntity: () => null },
  "../workflow/resource-navigation": { clusterResourceNavigation: () => null },
  "../admin/incident-link": incident,
});
let passed = 0;
function test(name, fn) { fn(); passed++; console.log("PASS", name); }

test("Incident inspector IDs are validated, allowing actual UUID/CUID shapes", () => {
  assert.equal(incident.incidentIdFromInspect("operations-incident:INC-12_ab.cd"), "INC-12_ab.cd");
  assert.equal(incident.incidentIdFromInspect("operations-incident:abc-123"), "abc-123");
  for (const value of ["operations-incident:", "ticket:abc", "operations-incident:../../etc", "operations-incident:id?x=1", "operations-incident:" + "a".repeat(201)]) {
    assert.equal(incident.incidentIdFromInspect(value), null, value);
  }
});

test("Real server incident alerts navigate to the exact Operations incident", () => {
  const item = {
    category: "system",
    entityType: "operations_incident",
    entityId: "INC-1234",
    resource: { kind: "operations_incident", id: "INC-1234" },
  };
  const target = navigation.notificationWorkNavigation(item);
  assert.deepEqual(JSON.parse(JSON.stringify(target)), {
    screen: "admin", inspectScope: "operations-incident", inspectId: "INC-1234",
  });
  assert.equal(navigation.notificationDesktopRoute(target), "admin/inspect/operations_incident/INC-1234");
});

test("Incident navigation also honors a resource-only notification and rejects unsupported IDs", () => {
  const sourceOnly = navigation.notificationWorkNavigation({
    category: "system", entityType: null, entityId: null,
    resource: { kind: "operations_incident", id: "abc-123" },
  });
  assert.equal(sourceOnly.inspectId, "abc-123");
  assert.equal(navigation.notificationWorkNavigation({
    category: "system", entityType: "operations_incident", entityId: "../evil",
  }), null);
});
test("Unknown object notifications do not silently open a different Project", () => {
  const target = navigation.notificationWorkNavigation({
    category: "system", entityType: "unknown_resource", entityId: "not-found", projectId: "projectA",
  });
  assert.equal(target, null);
});
test("Incident alerts are really created with the route identity being handled", () => {
  const source = read("apps/server/src/core/operations-incident-alert-routing.ts");
  assert.match(source, /entityType: "operations_incident", entityId: incident.id/);
  assert.match(source, /resourceKind: "operations_incident", resourceId: incident.id/);
});
test("Work-navigation resolves the admin incident section with explicit admin gate", () => {
  const application = read("packages/renderer/src/features/application/ClusterApplication.tsx");
  assert.match(application, /target.screen === "admin" && target.inspectScope === "operations-incident"/);
  assert.match(application, /if \(!activeUser\?\.isAdmin\) return/);
  assert.match(application, /setScreen\("admin", \{ section: "incidents" \}\)/);
  assert.match(application, /routeSection === "approvals" \|\| routeSection === "incidents"/);
});
test("Incident panel selects by route and listens to later same-screen navigation", () => {
  const panel = read("packages/renderer/src/features/admin/OperationsIncidentsPanel.tsx");
  assert.match(panel, /incidentIdFromInspect\(new URLSearchParams\(window.location.search\)\.get\("inspect"\)\)/);
  assert.match(panel, /cluster:inspector-state-changed/);
  assert.match(panel, /chooseIncident\(initial\)/);
  assert.match(panel, /api\/admin\/operations\/incidents\/\$\{encodeURIComponent\(id\)\}/);
});
test("Touched source files parse as valid TypeScript", () => {
  for (const file of [
    "packages/renderer/src/features/admin/incident-link.ts",
    "packages/renderer/src/features/notifications/notification-navigation.ts",
    "packages/renderer/src/features/application/ClusterApplication.tsx",
    "packages/renderer/src/features/admin/OperationsIncidentsPanel.tsx",
  ]) compile(file);
});
console.log(passed + "/" + passed + " Operations incident notification deep-link tests passed");
