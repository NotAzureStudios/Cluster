// Runtime checks for how a sign-in identifier is normalised and matched.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tsImport } from "tsx/esm/api";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
let passed = 0;
async function check(name, run) {
  await run();
  passed += 1;
  console.log(`PASS ${name}`);
}

const { normalizeLoginEmail, normalizePhoneLookup, looksLikeEmail } = await tsImport("../../packages/shared/src/login-identity.ts", import.meta.url);
const { applyUserIdentityNormalization } = await tsImport("../../apps/server/src/core/user-identity-normalization.ts", import.meta.url);

await check("one phone number written any way resolves to one key", () => {
  const same = ["+1 (555) 123-4567", "1-555-123-4567", "555 123 4567", "5551234567", "001 555 123 4567", "+1.555.123.4567"];
  const keys = new Set(same.map(normalizePhoneLookup));
  assert.equal(keys.size, 1, `expected one key, got ${[...keys].join(", ")}`);
  assert.equal([...keys][0], "5551234567");
});

await check("numbers too short to be a phone are not login identifiers", () => {
  for (const value of ["", "   ", "123", "555123", "abcdefg", null, undefined]) {
    assert.equal(normalizePhoneLookup(value), null, String(value));
  }
  // Six digits is not enough; seven is a local number.
  assert.equal(normalizePhoneLookup("123456"), null);
  assert.equal(normalizePhoneLookup("1234567"), "1234567");
});

await check("different numbers never share a key", () => {
  const keys = ["555 123 4567", "555 123 4568", "444 123 4567", "1234567"].map(normalizePhoneLookup);
  assert.equal(new Set(keys).size, keys.length);
});

await check("email is stored in one casing and rejected when malformed", () => {
  assert.equal(normalizeLoginEmail("  Alice@Studio.DEV "), "alice@studio.dev");
  for (const bad of ["", "alice", "alice@", "@studio.dev", "a@b@c.dev", "alice @studio.dev", null, `${"a".repeat(320)}@b.dev`]) {
    assert.equal(normalizeLoginEmail(bad), null, String(bad));
  }
  assert.ok(looksLikeEmail("alice@studio.dev") && !looksLikeEmail("5551234567"));
});

await check("every write path gets the derived columns", () => {
  const create = { username: "alice", email: " Alice@Studio.DEV ", phoneNumber: "+1 (555) 123-4567" };
  applyUserIdentityNormalization(create);
  assert.equal(create.email, "alice@studio.dev");
  assert.equal(create.phoneLookup, "5551234567");

  // Prisma's { set: value } form, as the profile editor sends.
  const update = { email: { set: "BOB@Studio.dev" }, phoneNumber: { set: "555-987-6543" } };
  applyUserIdentityNormalization(update);
  assert.equal(update.email, "bob@studio.dev");
  assert.equal(update.phoneLookup, "5559876543");

  // createMany arrays.
  const many = [{ phoneNumber: "5551112222" }, { email: "C@D.dev" }];
  applyUserIdentityNormalization(many);
  assert.equal(many[0].phoneLookup, "5551112222");
  assert.equal(many[1].email, "c@d.dev");

  // Clearing a number clears the key; untouched fields stay untouched.
  const cleared = { phoneNumber: null, displayName: "Alice" };
  applyUserIdentityNormalization(cleared);
  assert.equal(cleared.phoneLookup, null);
  assert.equal(cleared.displayName, "Alice");
  const other = { displayName: "Alice" };
  applyUserIdentityNormalization(other);
  assert.ok(!("phoneLookup" in other), "a write that does not touch the phone must not clear its key");

  // A caller cannot set a key that disagrees with the number.
  const forged = { phoneNumber: "5551234567", phoneLookup: "9999999999" };
  applyUserIdentityNormalization(forged);
  assert.equal(forged.phoneLookup, "5551234567");
});

await check("the login resolver uses indexed lookups, never a table scan", () => {
  const source = readFileSync(path.join(root, "apps/server/src/domains/auth/auth-core-routes.ts"), "utf8");
  const start = source.indexOf("async function resolveLoginIdentity");
  assert.ok(start > 0, "resolveLoginIdentity not found");
  const body = source.slice(start, source.indexOf("\n  }", start));
  assert.ok(!/findMany|take:/.test(body), "the resolver must not read a page of users and filter in memory");
  assert.equal((body.match(/findUnique/g) || []).length, 3, "username, email and phone are each one indexed lookup");
});

console.log(`${passed}/6 login identity checks passed`);
