import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerPeopleProvisioningPreviewRoutes } from "../../apps/server/dist/domains/users/people-provisioning-preview-routes.js";

const writes = [];
const inspected = [];
const settings = { studioRoleDefinitions: [
  { id: "artist", label: "Artist", enabled: true },
  { id: "retired", label: "Retired", enabled: false },
] };
const app = Fastify();
registerPeopleProvisioningPreviewRoutes({
  app,
  getCurrentUser: async (request) => request.headers["x-actor"] ? { id: request.headers["x-actor"] } : null,
  prisma: {
    workspaceMember: {
      async findFirst({where}) {
        return { workspaceId: "studio-a", role: where.userId === "owner" ? "owner" : where.userId === "admin" ? "admin" : "member" };
      },
    },
    user: {
      async findUnique({where}) {
        inspected.push(where.username);
        return where.username === "occupied" ? {id:"existing"} : null;
      },
      async create(data) { writes.push(data); throw new Error("preflight must never write"); },
    },
  },
  readSettings: async () => settings,
  normalizeAuthUsername: (value) => {
    const candidate = value.trim().toLowerCase();
    if (!/^[a-z0-9_.-]{3,32}$/.test(candidate)) throw new Error("Invalid username.");
    return candidate;
  },
  authorization: {
    configuredToolPermissionsForRole(role, subject) {
      return { projects: role === "owner" ? "manage" : subject.accountType === "guest" ? "none" : "view", people: role === "owner" ? "manage" : "none" };
    },
  },
});
const body = (input={}) => ({
  username: "provisioning_test",
  displayName: "Test Person",
  email: "person@example.org",
  accountType: "employee",
  role: "member",
  accessExpiresAt: null,
  ...input,
});
const run = (actor, input=body()) => app.inject({
  method: "POST", url: "/api/admin/users/provisioning-preview",
  headers: actor ? {"x-actor":actor} : {},
  payload: input,
});
let passed=0;
async function check(label, fn) { await fn();passed++;console.log("PASS", label); }
try {
  await check("Unauthenticated preview is rejected before identity lookup",async () => {
    const r = await run(null); assert.equal(r.statusCode,401); assert.equal(inspected.length,0);
  });
  await check("Ordinary workspace members cannot inspect provisioning policy",async () => {
    const r = await run("member"); assert.equal(r.statusCode,403); assert.equal(inspected.length,0);
  });
  await check("Invalid input is rejected without computing permissions or mutating",async () => {
    const r = await run("admin",body({accountType:"service",email:"invalid"}));
    assert.equal(r.statusCode,400);assert.equal(r.json().code,"PEOPLE_PROVISIONING_INPUT_INVALID");assert.equal(writes.length,0);
  });
  await check("Admin sees active regular role and initial credentials without grants",async () => {
    const r = await run("admin",body({role:"artist",username:"TEST_PERSON"}));
    assert.equal(r.statusCode,200);
    const d=r.json();assert.equal(d.ok,true);assert.equal(d.canCreate,true);
    assert.equal(d.username,"test_person");assert.equal(d.role.id,"artist");
    assert.equal(d.initialAccountState,"PASSWORD_CHANGE_REQUIRED");
    assert.equal(d.credentialMethod,"ONE_TIME_TEMPORARY_PASSWORD");
    assert.deepEqual(d.toolPermissions,[{tool:"people",level:"none"},{tool:"projects",level:"view"}]);
    assert.ok(d.limitations.some(x=>x.includes("No Project membership")));
    assert.equal("temporaryPassword" in d,false);
  });
  await check("Only owner can select privileged role, even in preflight",async () => {
    const denied=await run("admin",body({role:"owner"}));assert.equal(denied.statusCode,200);
    assert.equal(denied.json().canCreate,false);
    assert.ok(denied.json().blockers.some(x=>x.code==="ROLE_OWNER_REQUIRED"));
    assert.deepEqual(denied.json().toolPermissions,[]);
    const allowed=await run("owner",body({role:"owner"}));
    assert.equal(allowed.statusCode,200);assert.equal(allowed.json().canCreate,true);
  });
  await check("Disabled roles cannot be used and are not silently substituted",async () => {
    const r=await run("owner",body({role:"retired"}));
    assert.equal(r.json().canCreate,false);
    assert.ok(r.json().blockers.some(x=>x.code==="ROLE_NOT_ASSIGNABLE"));
  });
  await check("Username collision is reported but never reserves an identity",async () => {
    const r=await run("admin",body({username:"occupied"}));
    assert.equal(r.json().canCreate,false);
    assert.ok(r.json().blockers.some(x=>x.code==="USERNAME_TAKEN"));
  });
  await check("Temporary identities require a valid future expiration",async () => {
    const missing=await run("admin",body({accountType:"guest"}));
    assert.ok(missing.json().blockers.some(x=>x.code==="RETURN_EXPIRY_REQUIRED"));
    const expired=await run("admin",body({accountType:"contractor",accessExpiresAt:"2020-01-01T00:00:00.000Z"}));
    assert.ok(expired.json().blockers.some(x=>x.code==="RETURN_EXPIRY_INVALID"));
    const future=new Date(Date.now()+90*24*60*60*1000).toISOString();
    const valid=await run("admin",body({accountType:"guest",accessExpiresAt:future}));
    assert.equal(valid.json().canCreate,true);
    assert.equal(valid.json().toolPermissions.find(x=>x.tool==="projects").level,"none");
  });
  await check("Preview never writes an account, role, or grant",async () => {
    assert.equal(writes.length,0);
    assert.ok(inspected.length>0);
  });
  console.log(`Guided provisioning HTTP preflight: ${passed} checks passed.`);
} finally { await app.close(); }
