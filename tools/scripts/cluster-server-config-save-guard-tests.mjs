// Regression contracts for protected Server Config saves. Run without a live database.
import assert from "node:assert/strict";
import fs from "node:fs";

const page = fs.readFileSync("packages/renderer/src/features/settings/ServerConfigPage.tsx", "utf8");
const routes = fs.readFileSync("apps/server/src/app/server-routes-configuration-integrations.ts", "utf8");
const start = page.indexOf("  async function save(confirmation?");
const end = page.indexOf("  async function authorizePendingRestart()", start);
assert.ok(start >= 0 && end > start, "Server Config save handler should be present");
const handler = page.slice(start, end);
const noChanges = handler.indexOf('if (!selectedKeys.length)');
const pinPrompt = handler.indexOf('await requestSecurityPin(');
const restartPrompt = handler.indexOf('window.confirm("Save these settings and restart Cluster Server?');
const busyCheck = handler.indexOf('if (savingConfig && !pinOverride) return false;');
assert.ok(noChanges >= 0 && noChanges < pinPrompt, "No-op saves must not request PIN");
assert.ok(noChanges < restartPrompt, "No-op saves must not prompt for restart");
assert.ok(busyCheck >= 0 && busyCheck < pinPrompt, "Busy saves must not open another PIN dialog");
assert.match(handler, /if \(!changedKeys\.length\) \{\s*setStatus\("No server configuration changes to save\."\);\s*return false;/, "Draft cleared during PIN prompt must not look saved");
assert.ok(handler.includes("if (typed === expected) return await save(expected, pin, restartAfter);"), "Confirmation retry must remain pending through outer finally");
assert.ok(handler.includes('await api("/api/server-config"'), "Protected save must still use canonical API");
assert.ok(handler.includes("expectedSettings, securityPin: pin"), "CAS preconditions and PIN must remain on write");
assert.equal((routes.match(/code: "INVALID_DATABASE_URL_OVERRIDE"/g) || []).length, 2, "Both protected config routes must produce typed 400 for invalid PostgreSQL URLs");
assert.ok(routes.includes('return reply.code(400).send({ ok: false, code: "INVALID_DATABASE_URL_OVERRIDE"'), "Database URL error must not produce HTTP 500");
console.log("Server Config no-op/PIN/confirmation regression contracts: 10 passed.");
