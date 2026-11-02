import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

function source(path) { return readFileSync(path, "utf8"); }
async function loadTs(path) {
  const js = stripTypeScriptTypes(source(path).replace(/^import .*?;\r?\n/gm, ""), { mode: "strip" });
  return import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
}

const auth = await loadTs("apps/server/src/core/auth.ts");
const policy = await loadTs("apps/server/src/domains/auth/password-role-policy.ts");
assert.equal(auth.PASSWORD_MIN_LENGTH, 12);
assert.equal(auth.PRIVILEGED_PASSWORD_MIN_LENGTH, 1);
assert.equal(auth.PASSWORD_MAX_LENGTH, 1024);

const standard = "a".repeat(12);
assert.equal(auth.validateNewPassword(standard), standard);
for (const length of [0, 1, 8, 11]) {
  assert.throws(
    () => auth.validateNewPassword("x".repeat(length), { username: "member" }),
    /between 12 and 1024 characters/,
    "Regular users cannot set short passwords (" + length + ")"
  );
}
assert.equal(auth.validateNewPassword("a", {}, { allowPrivilegedShortPassword: true }), "a");
assert.throws(() => auth.validateNewPassword("", {}, { allowPrivilegedShortPassword: true }), /between 1 and 1024/);
assert.throws(() => auth.validateNewPassword("a".repeat(1025), {}, { allowPrivilegedShortPassword: true }), /between 1 and 1024/);
assert.throws(() => auth.validateNewPassword("a".repeat(1025)), /between 12 and 1024/);

const roles = new Map([
  ["owner-a", "owner"],
  ["admin-a", "admin"],
  ["member-a", "member"],
  ["contractor-a", "contractor"],
  ["guest-a", "guest"],
]);
const queries = [];
const prisma = {
  workspaceMember: {
    async findFirst({ where, select }) {
      queries.push({ where, select });
      assert.deepEqual(where.role.in, ["owner", "admin"]);
      assert.deepEqual(select, { id: true });
      return where.role.in.includes(roles.get(where.userId)) ? { id: "membership" } : null;
    },
  },
};
for (const userId of ["owner-a", "admin-a"]) {
  assert.equal(await policy.mayUsePrivilegedShortPassword(prisma, userId), true);
  const allowed = await policy.mayUsePrivilegedShortPassword(prisma, userId);
  assert.equal(auth.validateNewPassword("x", { username: userId }, { allowPrivilegedShortPassword: allowed }), "x");
}
for (const userId of ["member-a", "contractor-a", "guest-a", "missing-a", ""]) {
  const allowed = await policy.mayUsePrivilegedShortPassword(prisma, userId);
  assert.equal(allowed, false, userId + " cannot claim privileged password rules");
  assert.throws(() => auth.validateNewPassword("x", { username: userId }, { allowPrivilegedShortPassword: allowed }), /between 12 and 1024/);
}
assert.equal(queries.some(q => q.where.userId === ""), false, "missing user IDs must fail closed without a DB query");
await assert.rejects(() => policy.mayUsePrivilegedShortPassword({
  workspaceMember: { async findFirst() { throw new Error("database unavailable"); } },
}, "admin-a"), /database unavailable/, "DB errors must never grant a one-character exception");

const core = source("apps/server/src/domains/auth/auth-core-routes.ts");
const admin = source("apps/server/src/domains/auth/auth-admin-routes.ts");
const ui = source("packages/renderer/src/features/auth/AuthScreens.tsx");
assert.match(core, /privilegedMinimumLength: PRIVILEGED_PASSWORD_MIN_LENGTH/);
assert.match(core, /allowPrivilegedShortPassword: await mayUsePrivilegedShortPassword\(prisma, user\.id\)/);
assert.match(core, /password: z\.string\(\)\.min\(PRIVILEGED_PASSWORD_MIN_LENGTH\)/);
assert.match(admin, /allowPrivilegedShortPassword: await mayUsePrivilegedShortPassword\(prisma, target\.id\)/,
  "Admin setting a member's password must evaluate the TARGET role, never actor role");
assert.match(admin, /code: "PASSWORD_POLICY_REJECTED"/);
assert.match(ui, /minimumLength=\{\["owner", "admin"\]\.includes/);
assert.match(ui, /minLength=\{minimumLength\}/);
assert.doesNotMatch(ui, /Any non-empty password is accepted/);
console.log("PASS: member password minimum is 12; owners/admins retain 1; roles server-verified for both password writers");
