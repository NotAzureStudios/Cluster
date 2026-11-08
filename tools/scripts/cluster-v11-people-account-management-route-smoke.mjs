// Compiled Fastify route smoke, no network or database required.
// Verifies authorization order, typed filters, page cursors and workspace-safe
// response projection. Live PostgreSQL acceptance is a separate release gate.
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerPeopleAccountManagementRoutes } from "../../apps/server/dist/domains/users/people-account-management-routes.js";

const calls = { count: [], rows: [] };
const stamp = new Date("2026-11-08T17:00:00.000Z");
const sample = (id, workspaceId) => ({
  id, username: id, displayName: "Test " + id, preferredName: null, email: id + "@example.invalid",
  accountType: "employee", accountState: "PASSWORD_CHANGE_REQUIRED",
  archived: false, accessExpiresAt: null, createdAt: stamp, updatedAt: stamp, lastSeenAt: null,
  memberships: [{ role: "member" }],
  employment: {
    workspaceId,
    department: { name: "Sensitive department" },
    jobRole: { name: "Internal specialist" },
    manager: { id: "manager", username: "manager", displayName: "Confidential manager" },
  },
});
let rows = [sample("account-1","foreign-workspace")];
const prisma = {
  workspaceMember: {
    async findFirst({ where }) {
      const role = where.userId === "admin" ? "admin" : where.userId === "owner" ? "owner" : "member";
      return { workspaceId: "studio-a", role };
    },
  },
  user: {
    async count({where}) { calls.count.push(where); return rows.length; },
    async findMany(args) { calls.rows.push(args); return rows; },
  },
};
const app = Fastify();
registerPeopleAccountManagementRoutes({
  app, prisma,
  getCurrentUser: async (request) => {
    const id = request.headers["x-test-actor"];
    return id ? { id } : null;
  },
});
const request = (actor, path = "/api/admin/users/management") => app.inject({
  method: "GET", url: path, headers: actor ? { "x-test-actor": actor } : {},
});
let count = 0;
async function check(name, callback) {
  await callback(); count++; console.log("PASS",name);
}
try {
  await check("Anonymous callers get 401 without a private query",async()=>{
    const res = await request(null);
    assert.equal(res.statusCode,401);assert.equal(calls.rows.length,0);
  });
  await check("Ordinary workspace members get 403 without a private query",async()=>{
    const res = await request("member");
    assert.equal(res.statusCode,403);assert.equal(calls.rows.length,0);
  });
  await check("Invalid account filters or cursors get 400",async()=>{
    assert.equal((await request("admin","/api/admin/users/management?status=illegal")).statusCode,400);
    const invalid = await request("admin","/api/admin/users/management?cursor=invalid");
    assert.equal(invalid.statusCode,400);assert.equal(invalid.json().code,"PEOPLE_ACCOUNT_CURSOR_INVALID");
    assert.equal(calls.rows.length,0);
  });
  await check("Server returns the exact scoped role/type/state query and pagination limit",async()=>{
    const res = await request("admin","/api/admin/users/management?status=setup&role=member&accountType=employee&search=Test&limit=1");
    assert.equal(res.statusCode,200);
    const where = calls.count.at(-1);
    assert.deepEqual(where.memberships,{some:{workspaceId:"studio-a",role:"member"}});
    assert.equal(where.accountType,"employee");
    assert.ok(where.accountState.in.includes("PASSWORD_CHANGE_REQUIRED"));
    assert.equal(where.OR.length,4);
    assert.equal(calls.rows.at(-1).take,2);
    assert.equal(calls.rows.at(-1).select.memberships.where.workspaceId,"studio-a");
    assert.equal(res.json().total,1);
  });
  await check("Cross-workspace employment identity is not disclosed",async()=>{
    const res = await request("owner");
    assert.equal(res.statusCode,200);
    const person = res.json().items[0];
    assert.equal(person.department,null);
    assert.equal(person.jobTitle,null);
    assert.equal(person.manager,null);
    assert.equal(person.username,"account-1");
    assert.equal("passwordHash" in person,false);
    assert.equal("toolPermissions" in person,false);
  });
  await check("Same-workspace workforce details may be shown to admins",async()=>{
    rows = [sample("account-2","studio-a")];
    const res = await request("admin");
    assert.equal(res.statusCode,200);
    assert.equal(res.json().items[0].department,"Sensitive department");
  });
  await check("Pagination emits a usable next cursor and applies seek",async()=>{
    rows = [sample("account-1","studio-a"), sample("account-2","studio-a")];
    const first = await request("owner","/api/admin/users/management?limit=1");
    assert.equal(first.statusCode,200);assert.equal(first.json().hasMore,true);
    const cursor = encodeURIComponent(first.json().nextCursor);
    const next = await request("owner","/api/admin/users/management?limit=1&cursor="+cursor);
    assert.equal(next.statusCode,200);
    assert.equal(calls.rows.at(-1).where.AND.length,2);
  });
  console.log(`People account management HTTP smoke: ${count} checks passed.`);
} finally { await app.close(); }
