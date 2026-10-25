import assert from "node:assert/strict";
import test from "node:test";
import {
  accountNextStep,
  accountStateAllowsWorkspace,
  generateTemporaryPassword,
  loginLockDurationMs,
  sessionRecentlyAuthenticated,
  hashPassword,
  nextAccountState,
  normalizeAuthUsername,
  validateNewPassword,
  validateProductionAuthConfiguration,
  verifyPassword
} from "../../../apps/server/src/core/auth.js";


test("login lockouts escalate, decay safely, and recent-auth windows are bounded", () => {
  const fifteenMinutes = 15 * 60 * 1000;
  assert.equal(loginLockDurationMs(7), 0);
  assert.equal(loginLockDurationMs(8), fifteenMinutes);
  assert.equal(loginLockDurationMs(9), fifteenMinutes);
  assert.equal(loginLockDurationMs(10), thirtyMinutes());
  assert.equal(loginLockDurationMs(100), 24 * 60 * 60 * 1000);
  const now = Date.now();
  assert.equal(sessionRecentlyAuthenticated(new Date(now - 5 * 60 * 1000), now), true);
  assert.equal(sessionRecentlyAuthenticated(new Date(now - 11 * 60 * 1000), now), false);
  assert.equal(sessionRecentlyAuthenticated(new Date(now + 1_000), now), false);
});

function thirtyMinutes() { return 30 * 60 * 1000; }

test("managed usernames normalize consistently and reject unsafe values", () => {
  assert.equal(normalizeAuthUsername("  Duckey.Dev  "), "duckey.dev");
  assert.throws(() => normalizeAuthUsername("a"), /3 to 32/);
  assert.throws(() => normalizeAuthUsername("bad name"), /letters, numbers/);
});

test("password policy accepts long passphrases and rejects account-derived values", () => {
  assert.equal(validateNewPassword("Mossy planets orbit quietly 47!", { username: "duckey", displayName: "Duckey" }), "Mossy planets orbit quietly 47!");
  assert.throws(() => validateNewPassword("too-short"), /between 15 and 128/);
  assert.throws(() => validateNewPassword("duckey has a very long password", { username: "duckey" }), /cannot contain/);
  assert.throws(() => validateNewPassword("cluster is definitely long enough"), /cannot contain/);
});

test("Argon2id hashes verify without storing the original password", async () => {
  const password = "Lunar teacups survive gravity 83!";
  const digest = await hashPassword(password);
  assert.match(digest, /^\$argon2id\$/);
  assert.equal(digest.includes(password), false);
  assert.equal(await verifyPassword(digest, password), true);
  assert.equal(await verifyPassword(digest, "wrong password"), false);
});

test("temporary passwords are high-entropy values accepted by the password policy", () => {
  const password = generateTemporaryPassword();
  assert.ok(password.length >= 15);
  assert.notEqual(generateTemporaryPassword(), password);
});

test("Discord linking is optional by default and remains enforceable by policy", () => {
  assert.equal(nextAccountState(null), "ACTIVE");
  assert.equal(nextAccountState(null, true), "DISCORD_LINK_REQUIRED");
  assert.equal(nextAccountState("123456789", true), "ACTIVE");
  assert.equal(accountStateAllowsWorkspace("ACTIVE"), true);
  assert.equal(accountStateAllowsWorkspace("DISCORD_LINK_REQUIRED"), true);
  assert.equal(accountStateAllowsWorkspace("DISCORD_LINK_REQUIRED", true), false);
  for (const state of ["PASSWORD_CHANGE_REQUIRED", "PASSWORD_RESET_REQUIRED", "SUSPENDED", "DISABLED"]) {
    assert.equal(accountStateAllowsWorkspace(state), false);
    assert.equal(accountStateAllowsWorkspace(state, true), false);
  }
  assert.equal(accountNextStep("PASSWORD_CHANGE_REQUIRED"), "SET_PASSWORD");
  assert.equal(accountNextStep("PASSWORD_RESET_REQUIRED"), "RESET_PASSWORD");
  assert.equal(accountNextStep("DISCORD_LINK_REQUIRED"), "NONE");
  assert.equal(accountNextStep("DISCORD_LINK_REQUIRED", true), "LINK_DISCORD");
});


test("production authentication configuration fails closed", () => {
  const secure = {
    nodeEnv: "production",
    sessionSecret: "s".repeat(32),
    authSecret: "a".repeat(32),
    authRequired: true,
    devLoginEnabled: false,
    sessionSecure: true,
    rateLimitEnabled: true,
    securityHeadersEnabled: true,
    requireMutationOrigin: true,
    requireDiscordLink: false,
    discordClientId: "client",
    discordClientSecret: "secret",
    discordRedirectUri: "https://cluster.example.com/api/auth/discord/callback",
    webOrigin: "https://cluster.example.com"
  };
  assert.doesNotThrow(() => validateProductionAuthConfiguration(secure));
  assert.throws(() => validateProductionAuthConfiguration({ ...secure, sessionSecret: "short" }), /SESSION_SECRET/);
  assert.throws(() => validateProductionAuthConfiguration({ ...secure, authSecret: secure.sessionSecret }), /distinct/);
  assert.throws(() => validateProductionAuthConfiguration({ ...secure, authRequired: false }), /cannot disable Cluster authentication/);
  assert.throws(() => validateProductionAuthConfiguration({ ...secure, devLoginEnabled: true }), /development login/);
  assert.throws(() => validateProductionAuthConfiguration({ ...secure, sessionSecure: false }), /secure session cookies/);
  assert.throws(() => validateProductionAuthConfiguration({ ...secure, rateLimitEnabled: false }), /rate limiting/);
  assert.doesNotThrow(() => validateProductionAuthConfiguration({ ...secure, discordClientId: "", discordClientSecret: "", discordRedirectUri: "" }));
  assert.throws(() => validateProductionAuthConfiguration({ ...secure, requireDiscordLink: true, discordClientSecret: "" }), /Discord OAuth/);
  assert.throws(() => validateProductionAuthConfiguration({ ...secure, webOrigin: "http://cluster.example.com" }), /WEB_ORIGIN must use HTTPS/);
});


test("managed Go host keeps production auth hardening while allowing private loopback HTTP", () => {
  const managed = {
    nodeEnv: "production",
    runtimeProfile: "managed-host" as const,
    listenHost: "127.0.0.1",
    sessionSecret: "s".repeat(32),
    authSecret: "a".repeat(32),
    authRequired: true,
    devLoginEnabled: false,
    sessionSecure: false,
    rateLimitEnabled: true,
    securityHeadersEnabled: true,
    requireMutationOrigin: true,
    requireDiscordLink: false,
    webOrigin: "http://127.0.0.1:3000"
  };
  assert.doesNotThrow(() => validateProductionAuthConfiguration(managed));
  assert.throws(() => validateProductionAuthConfiguration({ ...managed, listenHost: "0.0.0.0" }), /private API to bind to loopback/);
  assert.throws(() => validateProductionAuthConfiguration({ ...managed, webOrigin: "http://192.168.1.50:3000" }), /loopback HTTP/);
  assert.throws(() => validateProductionAuthConfiguration({ ...managed, authRequired: false }), /cannot disable Cluster authentication/);
});
