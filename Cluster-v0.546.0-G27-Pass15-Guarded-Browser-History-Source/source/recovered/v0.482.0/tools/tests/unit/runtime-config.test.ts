import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadRuntimeConfig } from "../../../apps/server/src/core/runtime-config";

function developmentEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "development",
    WEB_ORIGIN: "http://localhost:3000",
    ...overrides
  };
}

test("runtime config bounds malformed numeric values and honors operational toggles", () => {
  const config = loadRuntimeConfig({
    cwd: process.cwd(),
    env: developmentEnv({
      CLUSTER_BODY_LIMIT_BYTES: "not-a-number",
      CLUSTER_RATE_LIMIT_MAX: "-40",
      CLUSTER_SESSION_MAX_PER_USER: "99999",
      CLUSTER_ENABLE_REQUEST_LOGS: "false",
      CLUSTER_TRUST_PROXY: "true",
      PORT: "99999",
      CLUSTER_AUTO_SEED: "false"
    })
  });

  assert.equal(config.bodyLimit, 512 * 1024 * 1024);
  assert.equal(config.apiRateLimitMax, 10);
  assert.equal(config.sessionMaxPerUser, 100);
  assert.equal(config.disableRequestLogging, true);
  assert.equal(config.trustProxy, true);
  assert.equal(config.listenPort, 65_535);
  assert.equal(config.autoSeed, false);
  assert.equal(config.requireDiscordLink, false);
});


test("session defaults use the hardened v0.349 lifetime and cookie policy", () => {
  const development = loadRuntimeConfig({ cwd: process.cwd(), env: developmentEnv() });
  assert.equal(development.sessionDays, 7);
  assert.equal(development.sessionIdleHours, 12);
  assert.equal(development.sessionMaxPerUser, 5);
  assert.equal(development.sessionCookie, "cluster_session");

  const production = loadRuntimeConfig({
    cwd: process.cwd(),
    env: {
      NODE_ENV: "production",
      WEB_ORIGIN: "https://cluster.example.com",
      SESSION_SECRET: "session-secret-that-is-at-least-thirty-two-bytes",
      CLUSTER_AUTH_SECRET: "auth-secret-that-is-distinct-and-at-least-32-bytes",
      CLUSTER_SECRET_KEY: "storage-secret-that-is-distinct-and-at-least-32-bytes",
      CLUSTER_DEV_LOGIN: "false",
      CLUSTER_REQUIRE_AUTH: "true",
      SESSION_SECURE: "true",
      CLUSTER_RATE_LIMIT: "true",
      CLUSTER_SECURITY_HEADERS: "true",
      CLUSTER_REQUIRE_MUTATION_ORIGIN: "true"
    }
  });
  assert.equal(production.sessionCookie, "__Host-cluster_session");
});

test("Discord linking remains optional unless the runtime policy enables it", () => {
  const optional = loadRuntimeConfig({ cwd: process.cwd(), env: developmentEnv() });
  const required = loadRuntimeConfig({ cwd: process.cwd(), env: developmentEnv({ CLUSTER_REQUIRE_DISCORD_LINK: "true" }) });
  assert.equal(optional.requireDiscordLink, false);
  assert.equal(required.requireDiscordLink, true);
});

test("development receives local origins but production rejects loopback CORS entries", () => {
  const development = loadRuntimeConfig({ cwd: process.cwd(), env: developmentEnv() });
  assert.equal(development.configuredCorsOrigins.has("http://127.0.0.1:5173"), true);
  assert.equal(development.autoSeed, false);
  assert.equal(development.devLoginEnabled, false);

  assert.throws(() => loadRuntimeConfig({
    cwd: process.cwd(),
    env: {
      NODE_ENV: "production",
      WEB_ORIGIN: "https://cluster.example.com",
      CLUSTER_CORS_ORIGINS: "http://localhost:3000",
      SESSION_SECRET: "session-secret-that-is-at-least-thirty-two-bytes",
      CLUSTER_AUTH_SECRET: "auth-secret-that-is-distinct-and-at-least-32-bytes",
      CLUSTER_SECRET_KEY: "storage-secret-that-is-distinct-and-at-least-32-bytes",
      CLUSTER_DEV_LOGIN: "false",
      CLUSTER_REQUIRE_AUTH: "true",
      SESSION_SECURE: "true",
      CLUSTER_RATE_LIMIT: "true",
      CLUSTER_SECURITY_HEADERS: "true",
      CLUSTER_REQUIRE_MUTATION_ORIGIN: "true",
      DISCORD_CLIENT_ID: "client",
      DISCORD_CLIENT_SECRET: "secret",
      DISCORD_REDIRECT_URI: "https://cluster.example.com/api/auth/discord/callback"
    }
  }), /Production CORS origins cannot include loopback addresses/);
});

test("explicit insecure production cookie settings are rejected instead of silently overridden", () => {
  assert.throws(() => loadRuntimeConfig({
    cwd: process.cwd(),
    env: {
      NODE_ENV: "production",
      WEB_ORIGIN: "https://cluster.example.com",
      SESSION_SECRET: "session-secret-that-is-at-least-thirty-two-bytes",
      CLUSTER_AUTH_SECRET: "auth-secret-that-is-distinct-and-at-least-32-bytes",
      CLUSTER_SECRET_KEY: "storage-secret-that-is-distinct-and-at-least-32-bytes",
      CLUSTER_DEV_LOGIN: "false",
      CLUSTER_REQUIRE_AUTH: "true",
      SESSION_SECURE: "false",
      CLUSTER_RATE_LIMIT: "true",
      CLUSTER_SECURITY_HEADERS: "true",
      CLUSTER_REQUIRE_MUTATION_ORIGIN: "true",
      DISCORD_CLIENT_ID: "client",
      DISCORD_CLIENT_SECRET: "secret",
      DISCORD_REDIRECT_URI: "https://cluster.example.com/api/auth/discord/callback"
    }
  }), /Production requires secure session cookies/);
});



test("managed Go host uses a private production profile without explicit loopback CORS", () => {
  const config = loadRuntimeConfig({
    cwd: process.cwd(),
    env: {
      NODE_ENV: "production",
      CLUSTER_RUNTIME_PROFILE: "managed-host",
      CLUSTER_HOST_RUNTIME: "go",
      HOST: "127.0.0.1",
      WEB_ORIGIN: "http://127.0.0.1:3000",
      SESSION_SECRET: "session-secret-that-is-at-least-thirty-two-bytes",
      CLUSTER_AUTH_SECRET: "auth-secret-that-is-distinct-and-at-least-32-bytes",
      CLUSTER_SECRET_KEY: "storage-secret-that-is-distinct-and-at-least-32-bytes",
      CLUSTER_DEV_LOGIN: "false",
      CLUSTER_REQUIRE_AUTH: "true",
      SESSION_SECURE: "false",
      CLUSTER_RATE_LIMIT: "true",
      CLUSTER_SECURITY_HEADERS: "true",
      CLUSTER_REQUIRE_MUTATION_ORIGIN: "true"
    }
  });
  assert.equal(config.runtimeProfile, "managed-host");
  assert.equal(config.trustProxy, true);
  assert.equal(config.sessionSecure, false);
  assert.deepEqual([...config.configuredCorsOrigins], ["http://127.0.0.1:3000"]);
});

test("managed-host profile fails closed without the Go private-host boundary", () => {
  assert.throws(() => loadRuntimeConfig({
    cwd: process.cwd(),
    env: {
      NODE_ENV: "production",
      CLUSTER_RUNTIME_PROFILE: "managed-host",
      HOST: "127.0.0.1",
      WEB_ORIGIN: "http://127.0.0.1:3000"
    }
  }), /CLUSTER_HOST_RUNTIME=go/);
});

test("production requires a dedicated storage encryption key", () => {
  assert.throws(() => loadRuntimeConfig({
    cwd: process.cwd(),
    env: {
      NODE_ENV: "production",
      WEB_ORIGIN: "https://cluster.example.com",
      SESSION_SECRET: "session-secret-that-is-at-least-thirty-two-bytes",
      CLUSTER_AUTH_SECRET: "auth-secret-that-is-distinct-and-at-least-32-bytes",
      CLUSTER_DEV_LOGIN: "false",
      CLUSTER_REQUIRE_AUTH: "true",
      SESSION_SECURE: "true",
      CLUSTER_RATE_LIMIT: "true",
      CLUSTER_SECURITY_HEADERS: "true",
      CLUSTER_REQUIRE_MUTATION_ORIGIN: "true"
    }
  }), /Production requires CLUSTER_SECRET_KEY/);
});

test("production storage key must be distinct from session and auth keys", () => {
  const shared = "shared-secret-that-is-definitely-at-least-thirty-two-bytes";
  assert.throws(() => loadRuntimeConfig({
    cwd: process.cwd(),
    env: {
      NODE_ENV: "production",
      WEB_ORIGIN: "https://cluster.example.com",
      SESSION_SECRET: shared,
      CLUSTER_AUTH_SECRET: "auth-secret-that-is-distinct-and-at-least-32-bytes",
      CLUSTER_SECRET_KEY: shared,
      CLUSTER_DEV_LOGIN: "false",
      CLUSTER_REQUIRE_AUTH: "true",
      SESSION_SECURE: "true",
      CLUSTER_RATE_LIMIT: "true",
      CLUSTER_SECURITY_HEADERS: "true",
      CLUSTER_REQUIRE_MUTATION_ORIGIN: "true"
    }
  }), /distinct from SESSION_SECRET/);
});

test("malformed boot config is reported without crashing local startup", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cluster-config-test-"));
  const configPath = path.join(directory, "cluster.config.json");
  try {
    await writeFile(configPath, "{ definitely not json", "utf8");
    const config = loadRuntimeConfig({
      cwd: directory,
      env: developmentEnv({ CLUSTER_CONFIG_FILE: configPath })
    });
    assert.match(config.bootConfigWarning || "", /could not be read/);
    assert.deepEqual(config.bootSettings, {});
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
