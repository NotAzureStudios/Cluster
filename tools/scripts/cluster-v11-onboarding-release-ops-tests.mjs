import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = name => fs.readFileSync(path.join(root, name), "utf8");
const require = createRequire(import.meta.url);
const ts = require("typescript");
function load(name) {
  const compiled = ts.transpileModule(read(name), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(compiled, { module: mod, exports: mod.exports });
  return mod.exports;
}
const releases = load("packages/renderer/src/features/changelog/data/cluster-changelog.ts").CLUSTER_CHANGELOG;
assert.deepEqual(Array.from(releases, r => r.version), ["v1.0.5", "v1.0.4", "v1.0.2", "v1.0.1", "v1.0.0"]);
for (const r of releases) {
  assert.match(r.version, /^v[1-9]\d*\.\d+\.\d+$/);
  assert.equal(r.sourceUrl, "https://github.com/NotAzureStudios/Cluster/releases/tag/" + r.version);
  assert.ok(r.changes.every(x => !x.includes("release work, compatibility updates")));
}
const page = read("packages/renderer/src/features/changelog/ChangelogPage.tsx");
assert.match(page, /<details/);
assert.match(page, /release\.sourceUrl/);
assert.match(page, /APP_VERSION_LABEL/);
const guide = load("packages/renderer/src/features/people/account-first-sign-in-guide.ts").formatAccountFirstSignInGuide;
const message = guide({ username: "new-user", temporaryPassword: "TEMP-ONLY", signInUrl: "https://cluster.example/" });
assert.match(message, /Username: new-user/);
assert.match(message, /Temporary password: TEMP-ONLY/);
assert.match(message, /create your own permanent password/);
assert.doesNotMatch(message, /cluster\.example\/[^\n]*TEMP-ONLY/);
const people = read("packages/renderer/src/features/people/PeoplePages.tsx");
const handoff = read("packages/renderer/src/features/people/AccountCredentialHandoff.tsx");
assert.match(people, /<AccountCredentialHandoff/);
assert.match(people, /setIssuedCredential\(null\)/);
assert.match(people, /accountScopeRef\.current !== scope/);
assert.match(handoff, /dialog\.showModal\(\)/);
assert.match(handoff, /onCancel=\{\(event\) => event\.preventDefault\(\)\}/);
assert.doesNotMatch(handoff, /localStorage|sessionStorage|mailto:|fetch\(/);
const auth = read("apps/server/src/domains/auth/auth-core-routes.ts");
const userRoutes = read("apps/server/src/domains/users/user-directory-routes.ts");
assert.match(auth, /app\.post\("\/api\/auth\/session-password"/);
assert.match(userRoutes, /accountState: "PASSWORD_CHANGE_REQUIRED"/);
const diagnostic = load("packages/renderer/src/features/admin/background-task-evidence.ts");
assert.equal(diagnostic.classifyBackgroundTask({ consecutiveFailures: 2 }), "recent");
assert.equal(diagnostic.classifyBackgroundTask({ consecutiveFailures: 3 }), "warning");
assert.equal(diagnostic.classifyBackgroundTask({ consecutiveFailures: 8 }), "failed");
const rows = diagnostic.failingBackgroundTasks([{ name: "a", consecutiveFailures: 0 }, { name: "b", consecutiveFailures: 8 }]);
assert.deepEqual(Array.from(rows, x => x.name), ["b"]);
const masked = diagnostic.summarizeBackgroundTaskError("password:bad123 https://user:pass@host/?token=abcd");
assert.doesNotMatch(masked, /bad123|abcd|user:pass/);
const bearer = diagnostic.summarizeBackgroundTaskError("Authorization: Bearer abc123reallysecrettoken456");
assert.doesNotMatch(bearer, /abc123reallysecrettoken456/);
assert.match(diagnostic.summarizeBackgroundTaskError("-----BEGIN PRIVATE KEY-----"), /omitted/);
const inspector = read("packages/renderer/src/features/admin/ScheduledTaskDiagnosticsPanel.tsx");
assert.match(inspector, /"\/api\/admin\/operations\/health"/);
assert.match(inspector, /onClick=\{\(\) => void inspect\(\)\}/);
assert.doesNotMatch(inspector, /useVisibleRefresh|setInterval|useEffect/);
assert.match(read("packages/renderer/src/features/admin/BackgroundJobsPanel.tsx"), /<ScheduledTaskDiagnosticsPanel \/>/);
const route = read("apps/server/src/app/server-routes-health-operations.ts");
assert.match(route, /app\.get\("\/api\/admin\/operations\/health"/);
assert.match(route, /requireAdminUserForRequest\(request, reply\)/);
const health = read("apps/server/src/core/operational-health.ts");
assert.match(health, /consecutiveFailures >= 3/);
assert.match(health, /consecutiveFailures >= 8/);
for (const name of [
  "packages/renderer/src/features/changelog/ChangelogPage.tsx",
  "packages/renderer/src/features/people/AccountCredentialHandoff.tsx",
  "packages/renderer/src/features/people/PeoplePages.tsx",
  "packages/renderer/src/features/admin/ScheduledTaskDiagnosticsPanel.tsx",
  "packages/renderer/src/features/admin/BackgroundJobsPanel.tsx",
]) {
 const result = ts.transpileModule(read(name), { fileName: name, reportDiagnostics: true, compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
 assert.equal(result.diagnostics.filter(x => x.category === ts.DiagnosticCategory.Error).length, 0, name);
}
console.log("PASS published releases, first-login handoff, and background diagnostics");
