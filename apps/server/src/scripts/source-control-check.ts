/* Source control against real Git and Git LFS: a managed Unreal repository,
   a working copy, non-ASCII asset names, push, review merge, and two commits
   queued on one checkout. Run: npm run -w apps/server source-control:check */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createGitRepositoryRuntime } from "../domains/source-control/git-repository-runtime.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "cluster-gitrt-"));
const rt = createGitRepositoryRuntime({ repositoriesRoot: path.join(root, "repos"), workspacesRoot: path.join(root, "ws") });
const ok = (cond: unknown, msg: string) => { if (!cond) { console.error("FAIL", msg); process.exitCode = 1; } else console.log("PASS", msg); };

const init = await rt.initializeManagedRepository({ repositoryId: "r1", defaultBranch: "main", projectName: "Azure Archipelago", lfs: true, ignoreTemplate: "unreal" });
ok(init.mirrorState === "ready", "managed Unreal repository initialized with LFS");
const mirror = path.join(root, "repos", "r1.git");
const attrs = execFileSync("git", ["--git-dir", mirror, "show", "main:.gitattributes"]).toString();
ok(attrs.includes("*.uasset filter=lfs diff=lfs merge=lfs -text lockable"), ".gitattributes marks uasset lockable");

const wc = await rt.prepareWorkingCopy({ workingCopyId: "wc1", repositoryId: "r1", repositoryPath: mirror, branchName: "feature/hero", baseBranch: "main", createBranch: true, lfs: true });
ok(wc.branchName === "feature/hero", "working copy on new branch");
const wcPath = path.join(root, "ws", "wc1");
const names = ["Content/Characters/Hero Mesh.uasset", "Content/Props/Café Table.uasset", "Content/UI/タイトル.umap"];
for (const name of names) { await fs.mkdir(path.dirname(path.join(wcPath, name)), { recursive: true }); await fs.writeFile(path.join(wcPath, name), "binary-" + name.repeat(200)); }
const commit = await rt.commitWorkingCopy({ workingCopyId: "wc1", message: "Hero assets", authorName: "Brady", authorEmail: "brady@example.invalid" });
const committed = commit.committedPaths.map((row) => row.path).sort();
ok(JSON.stringify(committed) === JSON.stringify([...names].sort()), `committed exact paths: ${JSON.stringify(committed)}`);
const pointer = execFileSync("git", ["-C", wcPath, "cat-file", "-p", "HEAD:Content/Characters/Hero Mesh.uasset"]).toString();
ok(pointer.startsWith("version https://git-lfs"), "uasset stored as LFS pointer");

await rt.pushWorkingCopy({ workingCopyId: "wc1", branchName: "feature/hero" });
const merge = await rt.evaluateMerge({ repositoryId: "r1", repositoryPath: mirror, sourceBranch: "feature/hero", targetBranch: "main" });
ok(merge.sourceAhead === 1 && !merge.conflicts && merge.filesChanged === 3, `merge evaluation ${JSON.stringify({ ahead: merge.sourceAhead, files: merge.filesChanged, conflicts: merge.conflicts })}`);
const merged = await rt.mergeReview({ operationId: "op1", repositoryId: "r1", repositoryPath: mirror, sourceBranch: "feature/hero", targetBranch: "main", expectedSourceRevision: merge.sourceRevision, expectedTargetRevision: merge.targetRevision, authorName: "Brady", title: "Merge hero" });
ok(execFileSync("git", ["--git-dir", mirror, "rev-parse", "main"]).toString().trim() === merged.mergedRevision, "review merged into main");

// Two commits queued on the same working copy at once must not collide on index.lock.
await fs.writeFile(path.join(wcPath, "Content", "A.uasset"), "a");
const first = rt.commitWorkingCopy({ workingCopyId: "wc1", message: "A", authorName: "Brady" });
await fs.writeFile(path.join(wcPath, "Content", "B.uasset"), "b");
const second = rt.commitWorkingCopy({ workingCopyId: "wc1", message: "B", authorName: "Brady" }).catch((error: Error) => error);
const results = await Promise.all([first.catch((error: Error) => error), second]);
const errors = results.filter((r) => r instanceof Error).map((r) => (r as Error).message);
ok(!errors.some((m) => m.includes("index.lock")), `concurrent commits serialized (${errors.join(" | ") || "no errors"})`);

// Native repositories have no provider API: branches, history and per-file
// changes come from the bare repository itself.
await fs.rename(path.join(wcPath, "Content", "Props", "Café Table.uasset"), path.join(wcPath, "Content", "Props", "Café Table 2.uasset"));
await rt.commitWorkingCopy({ workingCopyId: "wc1", message: "Rename table\n\nBody line", authorName: "Brady" });
await rt.pushWorkingCopy({ workingCopyId: "wc1", branchName: "feature/hero" });
const history = await rt.readLocalHistory({ repositoryId: "r1", repositoryPath: mirror, defaultBranch: "main", detailed: 5 });
ok(history.defaultBranch === "main" && history.branches.some((b) => b.name === "feature/hero") && history.branches.find((b) => b.isDefault)?.name === "main", `local branches ${JSON.stringify(history.branches.map((b) => b.name))}`);
ok(history.commits[0]?.revision === merged.mergedRevision && history.commits.length === 3 && history.commits.some((c) => c.message === "Initialize Cluster project repository"), "default-branch history starts at the merge and includes both parents");
const heroChanges = Object.values(history.changes).flat().map((c) => `${c.changeType}:${c.path}`);
ok(heroChanges.includes("added:Content/UI/タイトル.umap"), `non-ASCII paths in changes (${heroChanges.length} rows)`);
const featureHistory = await rt.readLocalHistory({ repositoryId: "r1", repositoryPath: mirror, defaultBranch: "feature/hero", detailed: 1 });
const rename = featureHistory.changes[featureHistory.commits[0].revision]?.[0];
ok(featureHistory.commits[0].message === "Rename table\n\nBody line" && rename?.changeType === "renamed" && rename.previousPath === "Content/Props/Café Table.uasset" && rename.path === "Content/Props/Café Table 2.uasset", `rename detected ${JSON.stringify(rename)}`);

await fs.rm(root, { recursive: true, force: true });
