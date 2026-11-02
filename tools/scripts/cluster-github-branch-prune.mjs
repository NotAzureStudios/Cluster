// Cluster GitHub branch housekeeping. This script runs only in the private
// studio repository, under a GitHub Actions token with contents:write.
// Legacy deletion is an explicit one-time exact-SHA allowlist, not a wildcard.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const repository = "NotAzureStudios/Cluster";
const permanent = new Set(["main", "development"]);
const cleanupBranch = "chore/prune-retired-branches";
const retired = [
  { name: "ReleaseCanidate", sha: "5742ceb34345d55b401a4ec50f6808e37c5b658e", archive: "archive/ReleaseCanidate-original" },
  { name: "chore/git-migration-prep", sha: "1ffbebb50b9d6cf9d0417f1e80f987fdc04b35ba", pr: 1 },
  { name: "chore/repo-source-hygiene", sha: "93e1cf87c6461598d5f252978c79912a44ff2702", pr: 2 },
  { name: "chore/1.0-branch-organization", sha: "c7aadc2e0dddc1fac52ec181e5e4aaafde57d60b", pr: 3, archive: "archive/closed-pr-3-branch-organization" },
  { name: "client/desktop-qt", sha: "fbf8910bc1cf4b3a90969a3af876c5f4951069b9", pr: 6 },
  { name: "client/web", sha: "55a39cff9ccaa50a32e815dbefe9eba4030e46d9", pr: 7 },
  { name: "fix/rc-release-recovery-auth-closeout", sha: "589d5d8ad0a0e6e4af66e119407081b072dcd413", pr: 11 },
  { name: "fix/role-scoped-password-minimum", sha: "b7087b1f9867a86c49ffaed1e16a1540ef6c6e3e", pr: 13 },
  { name: "fix/transfer-api-background-noise", sha: "bd43ff0d397bc65c4e4d5a450120141932130f47", pr: 9 },
  { name: "fix/windows-server-panel-poll-budget", sha: "a3367224ce5a3eaeaa47138a41616f3fa4468d27", pr: 10 },
  { name: "platform/shared", sha: "17e452829e56c690ce0bc6924ee54a135e3f2034", pr: 4 },
  { name: "server/windows", sha: "c28a198cbfdc13bf716d38a51125e358b6075aad", pr: 5 },
];

function assert(condition, message) { if (!condition) throw new Error(message); }
function safeBranch(name) {
  return typeof name === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(name) &&
    !name.includes("..") && !name.includes("//") && !permanent.has(name);
}
function validateList() {
  const names = new Set();
  for (const item of retired) {
    assert(safeBranch(item.name), "Unsafe branch in cleanup allowlist");
    assert(!names.has(item.name), "Duplicate branch in cleanup allowlist");
    assert(/^[a-f0-9]{40}$/.test(item.sha), "Invalid pinned SHA");
    assert(item.pr || item.archive, "No preservation or PR evidence for branch");
    names.add(item.name);
  }
  assert(retired.length === 12, "Legacy cleanup count changed without review");
}
validateList();
if (process.argv.includes("--check")) {
  console.log("PASS: 12 pinned cleanup targets, protected branches excluded");
  process.exit(0);
}

assert(process.env.GITHUB_REPOSITORY === repository, "Refuse branch cleanup outside studio repository");
assert(process.env.GH_TOKEN, "GitHub Actions GH_TOKEN is missing");
const endpoint = "repos/" + repository + "/";

function request(args, allow404 = false) {
  const result = spawnSync("gh", ["api", ...args], {
    encoding: "utf8", timeout: 60_000, maxBuffer: 2 * 1024 * 1024,
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const message = String(result.stderr || "").trim();
    if (allow404 && /\b404\b/.test(message)) return null;
    throw new Error("GitHub request failed: " + message);
  }
  const output = String(result.stdout || "").trim();
  return output ? JSON.parse(output) : {};
}

function findBranch(name) {
  assert(safeBranch(name), "Unsafe branch target");
  return request([endpoint + "git/ref/heads/" + name], true);
}

function pull(number) {
  return request([endpoint + "pulls/" + number]);
}

function verifyPullForBranch(item) {
  if (!item.pr) return;
  const info = pull(item.pr);
  assert(info.head?.ref === item.name, "PR head does not match allowlisted branch: " + item.name);
  assert(info.head?.repo?.full_name === repository, "PR comes from a different repository");
  assert(info.head?.sha === item.sha, "PR head revision changed: " + item.name);
  if (item.pr === 3) {
    assert(info.state === "closed" && !info.merged, "Old branch-organization PR is not closed");
  } else {
    assert(info.merged === true && info.state === "closed", "Refuse deletion of an unmerged PR: " + item.name);
  }
}

function ensureArchive(tag, sha) {
  assert(tag.startsWith("archive/") && safeBranch(tag), "Unsafe archive tag name");
  const route = endpoint + "git/ref/tags/" + tag;
  let ref = request([route], true);
  if (!ref) {
    request(["--method", "POST", endpoint + "git/refs", "-f", "ref=refs/tags/" + tag, "-f", "sha=" + sha]);
    ref = request([route]);
  }
  assert(ref?.object?.sha === sha, "Archive tag does not match historical branch: " + tag);
  console.log("Retained historical commit in tag " + tag + " -> " + sha);
}

function removeExactBranch(name, sha) {
  const current = findBranch(name);
  if (!current) { console.log("Already absent: " + name); return; }
  assert(current.object?.sha === sha, "Branch changed since preflight, refuse deletion: " + name);
  request(["--method", "DELETE", endpoint + "git/refs/heads/" + name]);
  assert(!findBranch(name), "Branch deletion could not be verified: " + name);
  console.log("Pruned " + name);
}

function pruneHistorical() {
  // Full preflight BEFORE any writes, so a new commit or open PR does not
  // result in a misleading partial cleanup.
  for (const item of retired) {
    const current = findBranch(item.name);
    if (!current) continue;
    assert(current.object?.sha === item.sha, "Branch moved: " + item.name);
    verifyPullForBranch(item);
    if (item.archive) {
      const existing = request([endpoint + "git/ref/tags/" + item.archive], true);
      assert(!existing || existing.object?.sha === item.sha, "Conflicting archive tag: " + item.archive);
    }
  }
  for (const item of retired) if (item.archive) ensureArchive(item.archive, item.sha);
  for (const item of retired) removeExactBranch(item.name, item.sha);

  // The maintenance PR itself must not become a fifteenth abandoned branch.
  const all = request([endpoint + "pulls?state=closed&head=NotAzureStudios:" + cleanupBranch + "&per_page=30"]);
  const merged = all.find(p => p.head?.ref === cleanupBranch && p.merged_at && p.base?.ref === "development");
  if (merged) {
    const live = findBranch(cleanupBranch);
    if (live) {
      assert(live.object?.sha === merged.head.sha, "Cleanup PR branch changed after merging");
      removeExactBranch(cleanupBranch, merged.head.sha);
    }
  }
  console.log("Completed exact-SHA branch cleanup. main and development were never targeted.");
}

function pruneCompletedPullRequest() {
  const payload = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const source = payload.pull_request;
  if (!source?.merged || !source.number) return;
  const info = pull(source.number);
  assert(info.merged === true && info.state === "closed", "PR is not merged");
  if (info.head?.repo?.full_name !== repository || !["main", "development"].includes(info.base?.ref)) return;
  const name = info.head.ref;
  if (!safeBranch(name) || !/^(fix|feature|chore|import|client|server|platform)\//.test(name)) return;
  const current = findBranch(name);
  if (!current) { console.log("Merged PR branch already deleted: " + name); return; }
  if (current.object?.sha !== info.head.sha) {
    console.log("Branch advanced since PR merge; preserving: " + name);
    return;
  }
  removeExactBranch(name, info.head.sha);
}

const mode = process.argv[2];
if (mode === "--retired") pruneHistorical();
else if (mode === "--merged-pr") pruneCompletedPullRequest();
else throw new Error("Select --check, --retired or --merged-pr");
