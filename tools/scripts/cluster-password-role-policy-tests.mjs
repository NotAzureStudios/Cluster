import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

const source = path => readFileSync(path, "utf8");
async function loadTs(path) {
  const js = stripTypeScriptTypes(source(path).replace(/^import .*?;\r?\n/gm, ""), { mode: "strip" });
  return import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
}

const auth = await loadTs("apps/server/src/core/auth.ts");
assert.equal(auth.PASSWORD_MIN_LENGTH, 12);
assert.equal(auth.PASSWORD_MAX_LENGTH, 1024);
assert.equal(auth.PRIVILEGED_PASSWORD_MIN_LENGTH, undefined, "No privileged bypass constant");
assert.equal(auth.validateNewPassword("a".repeat(12)), "a".repeat(12));
assert.equal(auth.validateNewPassword("a".repeat(1024)), "a".repeat(1024));

for (const identity of ["owner", "admin", "member", "contractor", "guest"]) {
  for (const length of [0, 1, 8, 11]) {
    assert.throws(
      () => auth.validateNewPassword("x".repeat(length), { username: identity }),
      /between 12 and 1024 characters/,
      identity + " cannot set a " + length + "-character password"
    );
  }
  assert.equal(auth.validateNewPassword("x".repeat(12), { username: identity }), "x".repeat(12));
}
assert.throws(() => auth.validateNewPassword("x".repeat(1025)), /between 12 and 1024/);
// JavaScript callers supplying the former third parameter must not reopen the bypass.
assert.throws(
  () => auth.validateNewPassword("x", { username: "owner" }, { allowPrivilegedShortPassword: true }),
  /between 12 and 1024/
);
assert.equal(auth.validateNewPassword("é".repeat(12)), "é".repeat(12), "NFC and Unicode codepoints remain supported");

const core = source("apps/server/src/domains/auth/auth-core-routes.ts");
const admin = source("apps/server/src/domains/auth/auth-admin-routes.ts");
const owner = source("apps/server/src/app/server-routes-setup.ts");
const ui = source("packages/renderer/src/features/auth/AuthScreens.tsx");
const wizard = source("packages/renderer/src/features/application/modules/ApplicationSetupWizard.tsx");

assert.match(core, /minimumLength: PASSWORD_MIN_LENGTH/);
assert.match(core, /password: z\.string\(\)\.min\(PASSWORD_MIN_LENGTH\)/);
assert.match(core, /validateNewPassword\(body\.password, user\)/);
assert.match(admin, /password: z\.string\(\)\.min\(PASSWORD_MIN_LENGTH\)/);
assert.match(admin, /validateNewPassword\(body\.password, target\)/);
assert.match(admin, /code: "PASSWORD_POLICY_REJECTED"/);
assert.match(owner, /ownerPassword: z\.string\(\)\.min\(PASSWORD_MIN_LENGTH\)/);
assert.match(owner, /validateNewPassword\(body\.ownerPassword, \{ username: ownerUsername, displayName: ownerUsername \}\)/);
assert.match(ui, /minimumLength=\{config\?\.passwordPolicy\.minimumLength \?\? 12\}/);
assert.match(ui, /minLength=\{minimumLength\}/);
assert.match(wizard, /minLength=\{12\}/);
assert.match(wizard, /\[\.\.\.form\.ownerPassword\.normalize\("NFC"\)\]\.length >= 12/);

for (const [label, text] of Object.entries({ core, admin, owner, ui, wizard, auth: source("apps/server/src/core/auth.ts") })) {
  assert.doesNotMatch(text, /PRIVILEGED_PASSWORD_MIN_LENGTH|mayUsePrivilegedShortPassword|privilegedMinimumLength|allowPrivilegedShortPassword|Owner passwords may be 1/, label + ": no privileged short-password branch");
}
console.log("PASS: one canonical 12-1024 password policy for Owner, admin, member, contractor, guest, and all account password writers");
