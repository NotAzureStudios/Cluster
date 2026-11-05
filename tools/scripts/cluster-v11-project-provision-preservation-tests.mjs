import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const worker = read("apps/server/src/domains/projects/project-provisioning.ts");
const direct = read("apps/server/src/domains/projects/project-routes.ts");
const create = read("packages/renderer/src/features/create/SharedCreateDrawer.tsx");
const projectModel = read("apps/server/prisma/schema.prisma");

let checks = 0;
function test(name, action) {
  try { action(); checks += 1; process.stdout.write("PASS " + name + "\n"); }
  catch (error) { throw new Error(name + ": " + error.message, { cause: error }); }
}

test("async Git failure cannot delete already-created project", () => {
  const begin = worker.indexOf('} else if (sourcePlan.shouldProvision) {');
  const end = worker.indexOf('} else stepReceipts.push({ id: "source", state: "skipped" });', begin);
  assert.ok(begin >= 0 && end > begin);
  const path = worker.slice(begin, end);
  assert.match(path, /PROJECT_SOURCE_PROVISION_FAILED/);
  assert.match(path, /projectId:\s*project\.id/);
  assert.match(path, /project and its Library were preserved/);
  assert.doesNotMatch(path, /project\.delete|libraryItem\.delete|folderPermission\.delete/);
});

test("durable provisioning key enables retrying exactly one project", () => {
  assert.match(worker, /project\.findUnique\(\{\s*where:\s*\{\s*provisioningKey:\s*request\.provisioningKey/);
  assert.match(worker, /provisioningKey:\s*request\.provisioningKey/);
  assert.match(worker, /if\s*\(!folder\)\s*folder\s*=\s*await input\.prisma\.libraryItem\.findFirst/);
  assert.match(worker, /const existed = Boolean\(folder\)/);
});

test("direct project creation preserves the project after optional Git failure", () => {
  const begin = direct.indexOf('    let provisionedSource: any = null;');
  const end = direct.indexOf('    await logActivity({ userId: user?.id, projectId: project.id, type: "created"', begin);
  assert.ok(begin >= 0 && end > begin);
  const source = direct.slice(begin, end);
  assert.match(source, /PROJECT_SOURCE_DEFERRED/);
  assert.doesNotMatch(source, /project\.delete|project\.deleteMany/);
  assert.match(source, /source-control provisioning failed; project preserved/);
});

test("Create retries the original failed operation rather than allocating a new project", () => {
  assert.match(create, /projectProvisionRetryId/);
  assert.match(create, /\/api\/projects\/provision\/\$\{encodeURIComponent\(projectProvisionRetryId\)\}\/retry/);
  assert.match(create, /setProjectProvisionRetryId\(operation\.id\)/);
  assert.match(create, /setProjectProvisionRetryId\(null\)/);
  assert.match(create, /Retry project setup/);
  assert.match(create, /setProjectProvisioningKey\(crypto\.randomUUID\(\)\)/);
});

test("orphan preservation: project/library schema uses SetNull, not cascade", () => {
  assert.match(projectModel, /project Project\?\s+@relation\(fields: \[projectId\], references: \[id\], onDelete: SetNull\)/);
  assert.match(worker, /Project workspace/);
});

console.log(checks + "/" + checks + " Project provisioning data-preservation checks passed");
