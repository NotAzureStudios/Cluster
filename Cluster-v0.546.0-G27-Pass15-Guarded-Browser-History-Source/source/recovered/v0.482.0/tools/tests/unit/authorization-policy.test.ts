import assert from "node:assert/strict";
import test from "node:test";
import { createAuthorizationService } from "../../../apps/server/src/domains/access/authorization.js";

function request() { return {} as any; }
function reply() {
  const state: any = { status: 200, body: null };
  return {
    state,
    code(value: number) { state.status = value; return this; },
    send(value: unknown) { state.body = value; return this; },
  } as any;
}

function serviceFor(user: any, role = "member", rules: any[] = []) {
  let currentUserCalls = 0;
  const service = createAuthorizationService({
    prisma: {
      accessRule: { findMany: async () => rules },
      project: { findUnique: async ({ where }: any) => where.id === "p1" ? { id: "p1", assignedUserIds: "[]", teamRoles: "{}", archived: false } : null },
    },
    authRequired: true,
    getCurrentUser: async () => { currentUserCalls += 1; return user; },
    decorateUserForClient: async (value: any) => ({ ...value, workspaceRole: role, isAdmin: false }),
    getStudioPermissionSettings: () => ({}),
    parseObject: (value: any) => typeof value === "string" ? JSON.parse(value || "{}") : (value || {}),
    parseLabels: (value: any) => Array.isArray(value) ? value : (typeof value === "string" ? JSON.parse(value || "[]") : []),
  });
  return { service, currentUserCalls: () => currentUserCalls };
}

test("resource access is capped by the owning tool permission", () => {
  const { service } = serviceFor({ id: "u1", toolPermissions: JSON.stringify({ projects: "none", files: "none" }), projectPermissions: JSON.stringify({ p1: "manage" }) });
  const project = { id: "p1", assignedUserIds: "[]", teamRoles: "{}" };
  assert.equal(service.hasTargetAccess({ id: "u1", toolPermissions: JSON.stringify({ files: "none" }), projectPermissions: JSON.stringify({ p1: "manage" }) }, "member", "file", "f1", project, [], "view"), false);
});

test("projectless resources no longer inherit an implicit view grant", () => {
  const { service } = serviceFor({ id: "u1" });
  const user = { id: "u1", toolPermissions: JSON.stringify({ library: "none" }) };
  assert.equal(service.hasTargetAccess(user, "member", "document", "d1", null, [], "view"), false);
});

test("deny rules override project and tool grants", () => {
  const { service } = serviceFor({ id: "u1" });
  const user = { id: "u1", toolPermissions: JSON.stringify({ files: "manage" }), projectPermissions: JSON.stringify({ p1: "manage" }) };
  const project = { id: "p1", assignedUserIds: "[]", teamRoles: "{}" };
  const rules = [{ status: "active", targetKind: "file", targetId: "f1", subjectKind: "member", subjectId: "u1", effect: "deny", level: "manage" }];
  assert.equal(service.hasTargetAccess(user, "member", "file", "f1", project, rules, "view"), false);
});

test("user-scoped resources distinguish self from manager access and cache identity", async () => {
  const user = { id: "u1", toolPermissions: JSON.stringify({ time: "edit" }) };
  const { service, currentUserCalls } = serviceFor(user);
  const req = request();
  const selfReply = reply();
  assert.ok(await service.requireUserScope(req, selfReply, { ownerUserId: "u1", tool: "time", minimum: "edit" }));
  const otherReply = reply();
  assert.equal(await service.requireUserScope(req, otherReply, { ownerUserId: "u2", tool: "time", minimum: "edit" }), null);
  assert.equal(otherReply.state.status, 403);
  assert.equal(currentUserCalls(), 1);
});
