import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  decryptBootSettingStorageValue,
  decryptSettingStorageValue,
  encryptedValueNeedsRotation,
  encryptBootSettingStorageValue,
  encryptionKeyId,
  encryptSettingStorageValue,
  isEncryptedValue,
  validateSecretEncryptionConfiguration,
} from "../../../apps/server/src/core/setting-crypto.js";

const OLD_KEY = "old-storage-key-that-is-long-enough-for-cluster-rotation-001";
const NEW_KEY = "new-storage-key-that-is-long-enough-for-cluster-rotation-002";

function legacyV1Encrypt(raw: string, aad: string, secret: string) {
  const key = crypto.createHash("sha256").update(`cluster-settings:${secret}`).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const encrypted = Buffer.concat([cipher.update(raw, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

test("sensitive settings use v2 authenticated encryption without plaintext leakage", () => {
  const env = { NODE_ENV: "production", CLUSTER_SECRET_KEY: NEW_KEY } as NodeJS.ProcessEnv;
  const raw = JSON.stringify("gitea-super-secret-token");
  const encrypted = encryptSettingStorageValue("giteaToken", raw, env);
  assert.match(encrypted, /^enc:v2:[0-9a-f]{16}:/);
  assert.equal(encrypted.includes("gitea-super-secret-token"), false);
  assert.equal(isEncryptedValue(encrypted), true);
  assert.equal(decryptSettingStorageValue("giteaToken", encrypted, env), raw);
  assert.equal(encryptedValueNeedsRotation(encrypted, env), false);
  assert.ok(encryptionKeyId(env));
});

test("previous storage keys decrypt old ciphertext and mark it for rotation", () => {
  const oldEnv = { NODE_ENV: "production", CLUSTER_SECRET_KEY: OLD_KEY } as NodeJS.ProcessEnv;
  const rotatedEnv = {
    NODE_ENV: "production",
    CLUSTER_SECRET_KEY: NEW_KEY,
    CLUSTER_SECRET_KEY_PREVIOUS: OLD_KEY,
  } as NodeJS.ProcessEnv;
  const raw = JSON.stringify("discord-token-before-rotation");
  const oldCiphertext = encryptSettingStorageValue("discordBotToken", raw, oldEnv);
  assert.equal(decryptSettingStorageValue("discordBotToken", oldCiphertext, rotatedEnv), raw);
  assert.equal(encryptedValueNeedsRotation(oldCiphertext, rotatedEnv), true);
  const rotated = encryptSettingStorageValue("discordBotToken", raw, rotatedEnv);
  assert.equal(encryptedValueNeedsRotation(rotated, rotatedEnv), false);
  assert.equal(rotated.includes("discord-token-before-rotation"), false);
});

test("protected boot database URL is encrypted independently of ordinary settings", () => {
  const env = { NODE_ENV: "production", CLUSTER_SECRET_KEY: NEW_KEY } as NodeJS.ProcessEnv;
  const raw = JSON.stringify("postgresql://cluster:password@db.internal:5432/cluster");
  const encrypted = encryptBootSettingStorageValue("databaseUrlOverride", raw, env);
  assert.match(encrypted, /^enc:v2:/);
  assert.equal(encrypted.includes("password"), false);
  assert.equal(decryptBootSettingStorageValue("databaseUrlOverride", encrypted, env), raw);
});

test("production storage key configuration fails closed", () => {
  assert.throws(() => validateSecretEncryptionConfiguration({
    nodeEnv: "production",
    env: { NODE_ENV: "production" },
    sessionSecret: "session-secret-that-is-at-least-thirty-two-bytes",
    authSecret: "auth-secret-that-is-at-least-thirty-two-bytes",
  }), /Production requires CLUSTER_SECRET_KEY/);

  assert.throws(() => validateSecretEncryptionConfiguration({
    nodeEnv: "production",
    env: { NODE_ENV: "production", CLUSTER_SECRET_KEY: NEW_KEY },
    sessionSecret: NEW_KEY,
    authSecret: "auth-secret-that-is-at-least-thirty-two-bytes",
  }), /distinct from SESSION_SECRET/);

  assert.throws(() => validateSecretEncryptionConfiguration({
    nodeEnv: "production",
    env: { NODE_ENV: "production", CLUSTER_SECRET_KEY: NEW_KEY, CLUSTER_SECRET_KEY_PREVIOUS: "short" },
    sessionSecret: "session-secret-that-is-at-least-thirty-two-bytes",
    authSecret: "auth-secret-that-is-at-least-thirty-two-bytes",
  }), /CLUSTER_SECRET_KEY_PREVIOUS/);
});

test("legacy v1 ciphertext remains decryptable during migration", () => {
  const raw = JSON.stringify("legacy-webhook-secret");
  const legacy = legacyV1Encrypt(raw, "setting:discordWebhookUrl", OLD_KEY);
  const env = {
    NODE_ENV: "production",
    CLUSTER_SECRET_KEY: NEW_KEY,
    CLUSTER_SECRET_KEY_PREVIOUS: OLD_KEY,
  } as NodeJS.ProcessEnv;
  assert.equal(decryptSettingStorageValue("discordWebhookUrl", legacy, env), raw);
  assert.equal(encryptedValueNeedsRotation(legacy, env), true);
});

test("plaintext protected values are always migration candidates", () => {
  assert.equal(encryptedValueNeedsRotation(JSON.stringify("plaintext"), {
    NODE_ENV: "production",
    CLUSTER_SECRET_KEY: NEW_KEY,
  } as NodeJS.ProcessEnv), true);
});
