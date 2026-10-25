import assert from "node:assert/strict";
import test from "node:test";
import {
  booleanSetting,
  isLoopbackAddress,
  mutationOriginAllowedForRequest,
  safeUrl,
  validateCorsOrigins,
  validateDiscordWebhookUrl
} from "../../../apps/server/src/core/security.js";

test("boolean settings only accept explicit true and false values", () => {
  assert.equal(booleanSetting(true, false), true);
  assert.equal(booleanSetting(" TRUE ", false), true);
  assert.equal(booleanSetting("false", true), false);
  assert.equal(booleanSetting("yes", false), false);
  assert.equal(booleanSetting(undefined, true), true);
});

test("mutation origin checks reject cross-site requests and unknown origins", () => {
  const allowedOrigins = new Set(["https://cluster.example.com"]);
  const base = { enabled: true, method: "POST", pathname: "/api/projects", allowedOrigins };
  assert.equal(mutationOriginAllowedForRequest({ ...base, fetchSite: "cross-site", origin: "https://cluster.example.com" }), false);
  assert.equal(mutationOriginAllowedForRequest({ ...base, fetchSite: "same-origin", origin: "https://cluster.example.com" }), true);
  assert.equal(mutationOriginAllowedForRequest({ ...base, fetchSite: "same-site", origin: "https://evil.example.com" }), false);
  assert.equal(mutationOriginAllowedForRequest({ ...base, fetchSite: "same-origin" }), true);
  assert.equal(mutationOriginAllowedForRequest({ ...base }), false);
  assert.equal(mutationOriginAllowedForRequest({ ...base, clusterClientHeadersPresent: true }), true);
  assert.equal(mutationOriginAllowedForRequest({ ...base, method: "GET", origin: "https://evil.example.com" }), true);
  assert.equal(mutationOriginAllowedForRequest({ ...base, pathname: "/api/public/share/token", origin: "https://evil.example.com" }), false);
});

test("URL validation blocks unsafe protocols", () => {
  assert.equal(safeUrl("https://cluster.example.com/path", "URL"), "https://cluster.example.com/path");
  assert.throws(() => safeUrl("javascript:alert(1)", "URL"), /must use/);
  assert.throws(() => safeUrl("not a url", "URL"), /valid URL/);
});

test("Discord webhook validation only accepts webhook endpoints", () => {
  const valid = `https://discord.com/api/webhooks/123/${"test" + "-token"}`;
  assert.equal(validateDiscordWebhookUrl(valid), valid);
  assert.throws(() => validateDiscordWebhookUrl("https://discord.com/channels/123"), /webhook URL/);
  assert.throws(() => validateDiscordWebhookUrl("https://example.com/api/webhooks/123/token"), /webhook URL/);
});

test("CORS origins are normalized, deduplicated, and path-free", () => {
  assert.equal(
    validateCorsOrigins("https://cluster.example.com, https://cluster.example.com/\nhttp://localhost:3000"),
    "https://cluster.example.com, http://localhost:3000"
  );
  assert.throws(() => validateCorsOrigins("https://cluster.example.com/path"), /without paths/);
  assert.throws(() => validateCorsOrigins("file:///tmp/cluster"), /http\(s\)/);
});


test("loopback detection supports local setup without trusting arbitrary private networks", () => {
  assert.equal(isLoopbackAddress("127.0.0.1"), true);
  assert.equal(isLoopbackAddress("127.42.7.9"), true);
  assert.equal(isLoopbackAddress("::1"), true);
  assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackAddress("192.168.1.2"), false);
  assert.equal(isLoopbackAddress("10.0.0.2"), false);
});
