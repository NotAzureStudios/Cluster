// v1.1 department lead picker: real handler behavior and source integration.
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const routeSource = fs.readFileSync("apps/server/src/domains/departments/department-routes.ts", "utf8");
const manager = fs.readFileSync("packages/renderer/src/features/settings/WorkforceDepartmentManager.tsx", "utf8");
const workforce = fs.readFileSync("apps/server/src/domains/workforce/workforce-routes.ts", "utf8");

const compiled = routeSource
  .replace(/^import[^\n]+\n/m, "")
  .replace(/: any/g, "")
  .replace("export function registerDepartmentRoutes", "function registerDepartmentRoutes");
const registerDepartmentRoutes = vm.runInNewContext(compiled + "\nregisterDepartmentRoutes", {
  createDepartmentService: () => ({ list: async () => [] }),
});

const handlers = new Map();
let authorized = true;
let viewer = { user: { id: "viewer-1" } };
let membership = { workspaceId: "studio-A" };
let roster = [
  { id: "person-1", username: "alpha", displayName: "Alpha", preferredName: "Al" },
  { id: "person-2", username: "beta", displayName: "Beta", preferredName: null },
];
let rosterQueries = 0;
let lastRosterQuery;
registerDepartmentRoutes({
  app: { get(path, handler) { handlers.set(path, handler); } },
  authorization: {
    async requireTool(_request, _reply, tool, level) {
      assert.equal(tool, "people"); assert.equal(level, "view");
      return authorized;
    },
    async identityForRequest() { return viewer; },
  },
  prisma: {
    workspaceMember: { async findFirst(query) {
      assert.equal(query.where.userId, viewer.user.id);
      assert.deepEqual(Object.keys(query.select), ["workspaceId"]);
      return membership;
    } },
    user: { async findMany(query) {
      rosterQueries += 1;
      lastRosterQuery = query;
      return roster;
    } },
  },
});
const leadRoute = handlers.get("/api/departments/lead-options");
assert.equal(typeof leadRoute, "function", "registered lead route");
assert.equal(typeof handlers.get("/api/departments"), "function", "existing directory remains");

function reply() {
  return {
    status: 200, payload: null,
    code(value) { this.status = value; return this; },
    send(value) { this.payload = value; return value; },
  };
}
let count = 2;
const deny = reply();
authorized = false;
assert.equal(await leadRoute({}, deny), undefined);
assert.equal(rosterQueries, 0, "unauthorized user did not read roster");
count += 1;

authorized = true;
viewer = null;
const anonymous = reply();
assert.equal((await leadRoute({}, anonymous)).code, "AUTH_REQUIRED");
assert.equal(anonymous.status, 401);
assert.equal(rosterQueries, 0);
count += 1;

viewer = { user: { id: "viewer-1" } };
membership = null;
const outside = reply();
assert.equal((await leadRoute({}, outside)).code, "WORKSPACE_ACCESS_DENIED");
assert.equal(outside.status, 403);
assert.equal(rosterQueries, 0);
count += 1;

membership = { workspaceId: "studio-A" };
const result = await leadRoute({}, reply());
assert.equal(result.workspaceId, "studio-A");
assert.equal(result.people.length, 2);
assert.equal(result.people[0].label, "Al");
assert.equal(result.people[1].label, "Beta");
assert.equal(result.people[0].username, "alpha");
assert.equal(lastRosterQuery.where.archived, false);
assert.equal(lastRosterQuery.where.memberships.some.workspaceId, "studio-A");
assert.equal(lastRosterQuery.take, 2001);
assert.deepEqual(Object.keys(lastRosterQuery.select).sort(), ["displayName","id","preferredName","username"]);
count += 8;

roster = Array.from({ length: 2001 }, (_, i) => ({ id: String(i), username: String(i) }));
const overflow = reply();
assert.equal((await leadRoute({}, overflow)).code, "DEPARTMENT_LEAD_DIRECTORY_LIMIT");
assert.equal(overflow.status, 409);
count += 2;

const choose = manager.slice(manager.indexOf("async function choose("), manager.indexOf("async function beginCreate("));
assert.ok(choose.includes("if (saving ||"), "read-only viewers can navigate");
assert.ok(!choose.includes("!canEdit"), "navigation not blocked by edit permission");
count += 2;

assert.ok(manager.includes('queryApi<LeadDirectory>("/api/departments/lead-options"'), "single narrow roster request");
assert.ok(!manager.includes('queryApi<LeadDirectory>("/api/workforce/context"'), "no large workforce query");
assert.ok(manager.includes('leadUserId: draft.leadUserId || null'), "selected leader saved on creation and update");
assert.ok(manager.includes("expectedRevision: selected!.revision"), "optimistic revision retained");
assert.ok(manager.includes('disabled={!canEdit || saving || loading || leadLoading || Boolean(leadError)'), "lead editor blocked on read-only or loading");
assert.ok(manager.includes("entities={departmentLeadChoices(leadOptions, draft.leadUserId)}") && fs.readFileSync("packages/renderer/src/features/settings/department-assignment-choices.ts", "utf8").includes("Existing lead unavailable"), "missing lead remains represented by the shared searchable entity picker");
assert.ok(manager.includes("setLeadError("), "fetch failures explained");
assert.ok(manager.includes("return () => { cancelled = true; }"), "unmounted roster loads ignored");
assert.ok(workforce.includes('code: "DEPARTMENT_LEAD_INVALID"'), "server checks lead membership on update");
assert.ok(workforce.includes('where: { id: body.leadUserId, archived: false, memberships: { some: { workspaceId } } }'), "server checks lead membership on creation");
count += 10;

console.log(`v1.1 department lead management: ${count} runtime/source checks passed.`);
