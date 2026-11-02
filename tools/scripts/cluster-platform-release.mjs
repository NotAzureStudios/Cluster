// Cluster distribution targets: build only the selected product, never another client's installer.
// Dependency-free --plan/--list; --build requires pinned, locked dependencies and native host tooling.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const catalog = JSON.parse(fs.readFileSync(path.join(root, "config/distribution-profiles.json"), "utf8"));
const meta = JSON.parse(fs.readFileSync(path.join(root, "config/release-candidate.json"), "utf8"));
const args = process.argv.slice(2);
function option(name, fallback = "") {
  const at = args.indexOf(name);
  if (at === -1) return fallback;
  if (at === args.length - 1 || args[at + 1].startsWith("--")) throw Error(`Missing value after ${name}`);
  return args[at + 1];
}
function assert(ok, message) { if (!ok) throw Error(message); }
function profileCheck(id, profile) {
  assert(/^[a-z][a-z0-9-]+$/.test(id), "Invalid profile ID");
  assert(["cluster-server", "cluster-desktop", "cluster-web"].includes(profile.product), "Invalid product");
  assert(["windows", "web"].includes(profile.platform), "Invalid platform");
  assert(["x64", "any"].includes(profile.arch), "Invalid architecture");
  assert(Array.isArray(profile.updateChannels) && profile.updateChannels.length, "Update channels required");
  assert(Array.isArray(profile.artifacts) && profile.artifacts.length, "Artifact paths required");
  assert(Array.isArray(profile.sourcePaths) && profile.sourcePaths.length, "Source paths required");
  for (const p of [...profile.sourcePaths, ...profile.artifacts]) {
    assert(!path.isAbsolute(p) && !p.includes("..") && !p.includes("\\") && !p.startsWith("/"), "Unsafe profile path: " + p);
  }
  if (profile.product === "cluster-server") {
    assert(id === "server-windows-x64" && !profile.includesDesktopApp && profile.requiresDatabase === true, "Server profile must exclude Desktop binary and own its database");
    assert(profile.updateChannels.join(",") === "main,development", "Server may update from main/development only");
  }
  if (profile.product === "cluster-desktop") {
    assert(id === "desktop-windows-x64" && !profile.includesServerRuntime && !profile.requiresDatabase, "Desktop must not package/install server services or database");
    assert(!profile.updateChannels.some(c => c === "main" || c === "development"), "Desktop must never consume server source branches");
  }
  if (profile.product === "cluster-web") assert(!profile.includesServerRuntime && !profile.requiresDatabase, "Web cannot bundle server runtime");
}
assert(catalog.schemaVersion === 1 && catalog.sourceVersion === meta.sourceVersion, "Release/profile versions must match");
for (const [id, p] of Object.entries(catalog.profiles)) profileCheck(id, p);
if (args.includes("--list")) {
  console.log(JSON.stringify({ profiles: Object.entries(catalog.profiles).map(([id, p]) => ({ id, product:p.product, installKind:p.installKind, channels:p.updateChannels })) }, null, 2));
  process.exit(0);
}
const id = option("--profile");
assert(id && Object.hasOwn(catalog.profiles, id), "Select --profile from: " + Object.keys(catalog.profiles).join(", "));
const profile = catalog.profiles[id];
const channel = option("--channel", profile.updateChannels[0]);
assert(profile.updateChannels.includes(channel), `Channel ${channel} is not valid for ${profile.product}`);
const artifactPaths = profile.artifacts.map(p => p.replaceAll("{version}", meta.sourceVersion));
const checkInputs = profile.sourcePaths.map(p => ({ path:p, exists:fs.existsSync(path.join(root, p)) }));
assert(checkInputs.every(x => x.exists), "Missing source paths: " + checkInputs.filter(x => !x.exists).map(x => x.path).join(", "));
const plan = {
  profile:id, product:profile.product, platform:profile.platform, architecture:profile.arch,
  installKind:profile.installKind, channel, sourceVersion:meta.sourceVersion,
  release:meta.release, command:`npm run ${profile.buildCommand}`,
  sourcePaths:profile.sourcePaths, expectedArtifacts:artifactPaths,
  installedServerRuntime:profile.product === "cluster-server",
  note:"A profile is a distribution target, not a Git branch. No update is trusted until its release manifest is signed and checked."
};
if (!args.includes("--build")) {
  console.log(JSON.stringify({ ...plan, built:false }, null, 2));
  process.exit(0);
}
assert(process.platform === "win32" || profile.platform === "web", "Native Windows packages require a Windows build runner");
const lock = path.join(root, "package-lock.json");
assert(fs.existsSync(lock), "1.0 release packaging requires a validated package-lock.json and npm ci; refusing nonreproducible release build");
const git = spawnSync("git", ["branch", "--show-current"], { cwd:root, encoding:"utf8" });
assert(git.status === 0, "Build requires a Git checkout with a traceable source ref");
const ref = git.stdout.trim();
assert(ref && !["HEAD"].includes(ref), "Release build requires a named Git branch");
if (channel === "main") assert(ref === "main", "Main-channel distribution must be built from reviewed main");
if (channel === "development" && profile.product === "cluster-server") assert(["development", "server/windows"].includes(ref), "Development server must be built from development/server/windows");
if (profile.product === "cluster-desktop") assert(["development", "client/desktop-qt", "main"].includes(ref), "Desktop build must come from its designated client branch or integrated source");
const gitsha = spawnSync("git", ["rev-parse", "HEAD"], { cwd:root, encoding:"utf8" });
assert(gitsha.status === 0 && /^[a-f0-9]{40}$/.test(gitsha.stdout.trim()), "Cannot identify immutable source commit");
const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", profile.buildCommand], { cwd:root, stdio:"inherit" });
if (result.error) throw result.error;
assert(result.status === 0, "Selected platform build failed");
const hashes = [];
for (const p of artifactPaths) {
  const abs = path.join(root, p);
  assert(fs.existsSync(abs) && fs.statSync(abs).isFile(), "Expected build artifact missing: " + p);
  const stat = fs.statSync(abs);
  assert(stat.size > 0, "Empty distribution artifact: " + p);
  if (p.endsWith(".exe")) {
    assert(fs.readFileSync(abs).subarray(0,2).toString("ascii") === "MZ", "Invalid Windows PE: " + p);
  }
  const hash = createHash("sha256");
  const stream = fs.openSync(abs, "r");
  try {
    const buffer = Buffer.alloc(1024*1024);
    for (;;) { const count = fs.readSync(stream, buffer, 0, buffer.length, null); if (!count) break; hash.update(buffer.subarray(0,count)); }
  } finally { fs.closeSync(stream); }
  hashes.push({ path:p, bytes:stat.size, sha256:hash.digest("hex") });
}
const receipt = { ...plan, sourceRef:ref, commit:gitsha.stdout.trim(), built:true, signed:false, certified:false, artifacts:hashes };
const target = path.join(root, "artifacts", "release-profiles", id, "build-receipt.json");
fs.mkdirSync(path.dirname(target), { recursive:true });
fs.writeFileSync(target, JSON.stringify(receipt,null,2)+"\n", { mode:0o600 });
console.log(JSON.stringify({ receipt:target, ...receipt }, null, 2));
