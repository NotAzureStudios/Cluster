import assert from "node:assert/strict";
import test from "node:test";
import { csrfProtectionRequired, isUnsafeHttpMethod, recentAuthenticationRequired } from "../../../apps/server/src/core/session-security.js";

test("unsafe method classification is explicit", () => {
  assert.equal(isUnsafeHttpMethod("GET"), false);
  assert.equal(isUnsafeHttpMethod("HEAD"), false);
  assert.equal(isUnsafeHttpMethod("OPTIONS"), false);
  assert.equal(isUnsafeHttpMethod("POST"), true);
  assert.equal(isUnsafeHttpMethod("DELETE"), true);
});

test("CSRF protection covers authenticated mutations while leaving bootstrap endpoints usable", () => {
  assert.equal(csrfProtectionRequired("/api/projects", "POST"), true);
  assert.equal(csrfProtectionRequired("/api/auth/logout", "POST"), true);
  assert.equal(csrfProtectionRequired("/api/auth/reauth", "POST"), true);
  assert.equal(csrfProtectionRequired("/api/auth/login", "POST"), false);
  assert.equal(csrfProtectionRequired("/api/public/share/token", "POST"), true);
  assert.equal(csrfProtectionRequired("/api/projects", "GET"), false);
});

test("recent authentication is required for privileged mutations", () => {
  assert.equal(recentAuthenticationRequired("/api/admin/sessions/x", "DELETE", true), true);
  assert.equal(recentAuthenticationRequired("/api/server-config", "PUT", true), true);
  assert.equal(recentAuthenticationRequired("/api/settings", "PUT", true), true);
  assert.equal(recentAuthenticationRequired("/api/me/sessions/revoke-others", "POST", false), true);
  assert.equal(recentAuthenticationRequired("/api/admin/sessions/x", "DELETE", false), false);
  assert.equal(recentAuthenticationRequired("/api/projects/x", "PATCH", true), false);
});
