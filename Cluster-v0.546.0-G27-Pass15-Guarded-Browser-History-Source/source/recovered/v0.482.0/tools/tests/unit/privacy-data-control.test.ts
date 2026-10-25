import assert from "node:assert/strict";
import test from "node:test";
import {
  boundedPrivacyRecords,
  privacyConnectedAccounts,
  privacyExportFilename,
  privacyProfileSnapshot,
} from "../../../apps/server/src/core/privacy-data-control.js";

test("privacy profile export never exposes credential hashes", () => {
  const snapshot = privacyProfileSnapshot({
    id: "user-1",
    username: "duckey",
    email: "user@example.test",
    passwordHash: "argon-secret",
    pinHash: "pin-secret",
    preferences: '{"theme":"dark"}',
    alternateEmails: '["alt@example.test"]',
    skills: '["UI"]',
  });
  assert.equal(snapshot.username, "duckey");
  assert.equal(snapshot.passwordConfigured, true);
  assert.equal(snapshot.pinConfigured, true);
  assert.equal("passwordHash" in snapshot, false);
  assert.equal("pinHash" in snapshot, false);
  assert.deepEqual(snapshot.preferences, { theme: "dark" });
  assert.deepEqual(snapshot.alternateEmails, ["alt@example.test"]);
});

test("connected Discord identity respects studio requirement", () => {
  const optional = privacyConnectedAccounts({ discordUserId: "42", discordUsername: "duck" }, false)[0];
  assert.equal(optional.linked, true);
  assert.equal(optional.canDisconnect, true);
  const required = privacyConnectedAccounts({ discordUserId: "42" }, true)[0];
  assert.equal(required.canDisconnect, false);
  assert.equal(required.requiredByStudio, true);
});

test("privacy exports bound each record collection", () => {
  const result = boundedPrivacyRecords([1, 2, 3], 2);
  assert.deepEqual(result.records, [1, 2]);
  assert.equal(result.truncated, true);
  assert.equal(boundedPrivacyRecords([1], 2).truncated, false);
});

test("privacy export filenames are filesystem-safe", () => {
  const filename = privacyExportFilename("../Duck User!?", new Date("2026-08-19T04:00:00.000Z"));
  assert.equal(filename, "cluster-data-Duck-User-2026-08-19.json");
  assert.doesNotMatch(filename, /\.\.|\//);
});
