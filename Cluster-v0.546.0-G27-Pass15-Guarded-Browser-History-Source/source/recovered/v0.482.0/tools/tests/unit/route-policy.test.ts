import assert from "node:assert/strict";
import test from "node:test";
import { isAdminMutation, isPublicPath, routeMinimumLevel, routeToolForPath } from "../../../apps/server/src/domains/access/route-policy.js";

test("workflow routes authorize against their real capabilities", () => {
  assert.equal(routeToolForPath("/api/projects/p1/workflows/buildArtifact/a1"), "builds");
  assert.equal(routeToolForPath("/api/project-workflows/buildArtifact"), "builds");
  assert.equal(routeToolForPath("/api/projects/p1/workflows/qaPlan/q1"), "qa");
  assert.equal(routeToolForPath("/api/projects/p1/workflows/qaSession/q1"), "qa");
});

test("route policy is method aware and fails closed for public mutations", () => {
  assert.equal(isPublicPath("/api/public/share/abc", "GET"), true);
  assert.equal(isPublicPath("/api/public/share/abc", "HEAD"), true);
  assert.equal(isPublicPath("/api/public/share/abc", "POST"), false);
  assert.equal(isPublicPath("/api/meta/version", "POST"), false);
  assert.equal(isPublicPath("/health", "DELETE"), false);
});

test("privileged route families require elevated permissions", () => {
  assert.deepEqual(routeMinimumLevel("/api/gitea/repos", "POST"), { tool: "integrations", level: "manage" });
  assert.deepEqual(routeMinimumLevel("/api/server-config", "PUT"), { tool: "serverConfig", level: "manage" });
  assert.deepEqual(routeMinimumLevel("/api/project-files/f1", "PATCH"), { tool: "files", level: "edit" });
  assert.equal(isAdminMutation("/api/context-packs/p1/apply", "POST"), true);
  assert.equal(isAdminMutation("/api/admin/tools/files/actions/rebuild", "POST"), true);
});
