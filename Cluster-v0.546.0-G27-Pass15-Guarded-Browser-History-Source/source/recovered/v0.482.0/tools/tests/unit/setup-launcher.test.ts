import assert from "node:assert/strict";
import test from "node:test";
import { hardenLocalEnvContent, readEnvValue, secretNeedsReplacement } from "../../scripts/initialize-local-env.mjs";
import { summarizeInstanceSetup } from "../../../apps/server/src/core/instance-setup.js";

test("setup summary requires an administrator when the database has no owner membership", () => {
  const status = summarizeInstanceSetup([
    { id: "user-1", username: "member", passwordHash: "hash", memberships: [{ workspaceId: "workspace-1", role: "member" }] },
  ], 1);
  assert.equal(status.setupRequired, true);
  assert.equal(status.reason, "NO_ADMINISTRATOR");
  assert.equal(status.passwordReadyAdministratorCount, 0);
});

test("setup summary detects the seeded passwordless owner failure mode", () => {
  const status = summarizeInstanceSetup([
    { id: "user-1", username: "duckey", passwordHash: null, accountState: "PASSWORD_CHANGE_REQUIRED", memberships: [{ workspaceId: "workspace-1", role: "owner" }] },
  ], 1);
  assert.equal(status.setupRequired, true);
  assert.equal(status.reason, "NO_ADMIN_PASSWORD");
  assert.equal(status.administratorCount, 1);
});

test("setup summary treats a usable owner password as ready", () => {
  const status = summarizeInstanceSetup([
    { id: "user-1", username: "owner", passwordHash: "$argon2id$example", accountState: "DISCORD_LINK_REQUIRED", memberships: [{ workspaceId: "workspace-1", role: "owner" }] },
  ], 1);
  assert.equal(status.setupRequired, false);
  assert.equal(status.reason, "READY");
  assert.equal(status.passwordReadyAdministratorCount, 1);
});

test("setup summary counts an administrator who must replace a temporary password", () => {
  const status = summarizeInstanceSetup([
    {
      id: "user-1",
      username: "owner",
      passwordHash: "$argon2id$temporary",
      accountState: "PASSWORD_CHANGE_REQUIRED",
      memberships: [{ workspaceId: "workspace-1", role: "owner" }],
    },
  ], 1);
  assert.equal(status.pendingAdministratorSetupCount, 1);
  assert.equal(status.setupRequired, false);
});

test("local environment hardening replaces placeholders with distinct secrets", () => {
  const result = hardenLocalEnvContent([
    'SESSION_SECRET="replace-with-at-least-32-random-bytes"',
    'CLUSTER_AUTH_SECRET="replace-with-a-distinct-32-byte-random-secret"',
    'CLUSTER_SECRET_KEY="change-me-before-hosting-use-a-long-random-secret"',
    "",
  ].join("\n"));
  const session = readEnvValue(result.content, "SESSION_SECRET");
  const auth = readEnvValue(result.content, "CLUSTER_AUTH_SECRET");
  const encryption = readEnvValue(result.content, "CLUSTER_SECRET_KEY");
  assert.ok(session && session.length >= 32);
  assert.ok(auth && auth.length >= 32);
  assert.ok(encryption && encryption.length >= 32);
  assert.equal(new Set([session, auth, encryption]).size, 3);
  assert.equal(readEnvValue(result.content, "CLUSTER_AUTO_SEED"), "false");
  assert.equal(readEnvValue(result.content, "CLUSTER_DEV_LOGIN"), "false");
});

test("local environment hardening preserves valid custom secrets", () => {
  const session = "s".repeat(48);
  const auth = "a".repeat(48);
  const encryption = "e".repeat(48);
  const result = hardenLocalEnvContent(`SESSION_SECRET=${session}\nCLUSTER_AUTH_SECRET=${auth}\nCLUSTER_SECRET_KEY=${encryption}\n`);
  assert.equal(readEnvValue(result.content, "SESSION_SECRET"), session);
  assert.equal(readEnvValue(result.content, "CLUSTER_AUTH_SECRET"), auth);
  assert.equal(readEnvValue(result.content, "CLUSTER_SECRET_KEY"), encryption);
});

test("weak or placeholder secrets are rejected", () => {
  assert.equal(secretNeedsReplacement("short"), true);
  assert.equal(secretNeedsReplacement("change-me-this-is-long-but-still-a-placeholder-value"), true);
  assert.equal(secretNeedsReplacement("x".repeat(48)), false);
});


test("existing encryption key is not silently rotated during launcher migration", () => {
  const legacy = "change-me-before-hosting-use-a-long-random-secret";
  const result = hardenLocalEnvContent(`SESSION_SECRET=${"s".repeat(48)}\nCLUSTER_AUTH_SECRET=${"a".repeat(48)}\nCLUSTER_SECRET_KEY=${legacy}\n`, { preserveEncryptionKey: true });
  assert.equal(readEnvValue(result.content, "CLUSTER_SECRET_KEY"), legacy);
  assert.equal(result.warnings.length, 1);
});

test("local environment hardening migrates legacy database locations", () => {
  const result = hardenLocalEnvContent('DATABASE_URL="file:../../../data/database/cluster.db"\n');
  assert.equal(readEnvValue(result.content, "DATABASE_URL"), "file:../../../data/system/database/cluster.db");
  assert.ok(result.updatedKeys.includes("DATABASE_URL"));
});
