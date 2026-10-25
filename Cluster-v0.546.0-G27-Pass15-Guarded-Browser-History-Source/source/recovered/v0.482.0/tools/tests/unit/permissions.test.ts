import assert from "node:assert/strict";
import test from "node:test";
import {
  canUseTool,
  defaultToolPermissionsForUser,
  getToolLevel,
  isExternalCollaborator,
  isUserAccessExpired
} from "../../../packages/renderer/src/core/permissions";

test("owners receive management access across tools", () => {
  const permissions = defaultToolPermissionsForUser({ workspaceRole: "owner" });
  assert.equal(permissions.projects, "manage");
  assert.equal(permissions.serverConfig, "manage");
});

test("external account types use restricted defaults", () => {
  const guest = { accountType: "guest" };
  assert.equal(isExternalCollaborator(guest), true);
  assert.equal(getToolLevel(guest, "team"), "none");
  assert.equal(getToolLevel(guest, "time"), "none");
  assert.equal(getToolLevel(guest, "qa"), "edit");
});

test("expired accounts lose access while administrators remain active", () => {
  const expiredAt = new Date(Date.now() - 60_000).toISOString();
  assert.equal(isUserAccessExpired({ accessExpiresAt: expiredAt }), true);
  assert.equal(canUseTool({ accessExpiresAt: expiredAt, toolPermissions: { boards: "manage" } }, "boards"), false);
  assert.equal(isUserAccessExpired({ accessExpiresAt: expiredAt, isAdmin: true }), false);
  assert.equal(canUseTool({ accessExpiresAt: expiredAt, isAdmin: true }, "serverConfig", "manage"), true);
});

test("explicit tool permissions respect minimum access levels", () => {
  const user = { toolPermissions: { boards: "view" as const } };
  assert.equal(canUseTool(user, "boards", "view"), true);
  assert.equal(canUseTool(user, "boards", "edit"), false);
});
