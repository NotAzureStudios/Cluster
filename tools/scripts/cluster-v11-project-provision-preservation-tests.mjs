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

test("missing Git or required LFS fails before creating project/Library rows", () => {
  const preflightStart = worker.indexOf("if (sourcePlan.shouldProvision && !request.sourceRepositoryId)");
  const createStart = worker.indexOf("project = await input.prisma.project.create(");
  const preflight = worker.slice(preflightStart, createStart);
  assert.ok(preflightStart >= 0 && createStart > preflightStart, "preflight must precede project write");
  assert.match(preflight, /input\.gitRuntime\.inspect\?\.\(true\)/);
  assert.match(preflight, /PROJECT_SOURCE_RUNTIME_UNAVAILABLE/);
  assert.match(preflight, /PROJECT_SOURCE_LFS_UNAVAILABLE/);
  assert.match(preflight, /terminalJobFailure: true/);
  assert.match(preflight, /No project was created/);
});

test("an existing Git repository cannot be overwritten by project provisioning", () => {
  const source = read("apps/server/src/domains/source-control/git-repository-runtime.ts");
  const begin = source.indexOf("  async function initializeManagedRepository(");
  const end = source.indexOf("  async function deleteManagedRepository(", begin);
  assert.ok(begin >= 0 && end > begin);
  const provision = source.slice(begin, end);
  assert.match(provision, /await fs\.mkdir\(target\)/);
  assert.match(provision, /targetOwnedByThisAttempt = true/);
  assert.match(provision, /Repository storage already exists/);
  assert.match(provision, /if \(targetOwnedByThisAttempt\) await fs\.rm\(target/);
  assert.doesNotMatch(provision, /await fs\.rm\(target[^\n]*\n\s*await fs\.rm\(seed/);
  assert.match(provision, /await fs\.mkdtemp\(/);
  assert.match(provision, /if \(seed\) await fs\.rm\(seed/);
});

test("Git provisioning failure retains its database repository binding and ID", () => {
  const source = read("apps/server/src/domains/projects/project-source-provisioning.ts");
  assert.match(source, /existing\?\.repository\?\.healthState === "healthy" && existing\.repository\.headRevision/);
  assert.match(source, /let repository: any = existing\?\.repository \|\| null/);
  assert.match(source, /syncState: "error"/);
  assert.match(source, /healthState: "degraded"/);
  assert.doesNotMatch(source, /gitRuntime\.deleteManagedRepository\(/);
  assert.doesNotMatch(source, /sourceRepository\.delete\(/);
});

test("active manual publisher matches current monotonic stable release identity", () => {
  const release = JSON.parse(read("config/release-candidate.json"));
  const version = String(release.release || "");
  assert.match(version, /^1\.[1-9][0-9]*\.(0|[1-9][0-9]*)$/);
  assert.equal(release.sourceVersion, version);
  assert.equal(release.channel, "stable");
  const [major, minor, patch] = version.split(".").map(Number);
  assert.equal(major, 1);
  assert.equal(release.sequence, minor * 100000 + patch);
  const prefix = ".github/workflows/publish-cluster-" + version.replaceAll(".", "-");
  const candidates = [prefix + "-manual.yml", prefix + "-full.yml"];
  const present = candidates.filter((file) => fs.existsSync(path.join(root, file)));
  assert.equal(present.length, 1, "Exactly one current stable release publisher must exist");
  const workflow = read(present[0]);
  assert.ok(workflow.includes("head_branch == 'main'"), "Publisher must only accept main build events");
  assert.ok(workflow.includes("assert metadata['sequence']==" + release.sequence));
  assert.ok(workflow.includes('test "$(git rev-parse HEAD)" = "$SERVER_SHA"'));
  assert.ok(workflow.includes("gh release create v" + version));
  assert.ok(workflow.includes("SERVER_ARTIFACT: cluster-server-unsigned-windows-x64-"));
});

console.log(checks + "/" + checks + " Project provisioning data-preservation checks passed");
