// Stamps the release version into the source tree for a CI build.
// Version = <line>.<commit count of HEAD>, so every main commit is a newer
// release without anyone editing version numbers. Main only moves forward, so
// the count only grows. `line` (major.minor) in config/release-candidate.json
// is the only version anyone sets by hand. Committed files carry <line>.0.
//   node tools/scripts/cluster-stamp-release.mjs          stamp HEAD's version
//   node tools/scripts/cluster-stamp-release.mjs --print  print it only
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stableServerSequence } from "./cluster-server-release-sequence.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const file = (relative) => path.join(root, relative);
const readJson = (relative) => JSON.parse(fs.readFileSync(file(relative), "utf8"));
const writeJson = (relative, value) => fs.writeFileSync(file(relative), JSON.stringify(value, null, 2) + "\n");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();

export function releaseVersion() {
  const { line } = readJson("config/release-candidate.json");
  if (!/^[1-9][0-9]?\.(0|[1-9][0-9]*)$/.test(line || "")) throw new Error("config/release-candidate.json needs line: \"<major>.<minor>\"");
  if (git("rev-parse", "--is-shallow-repository") !== "false") throw new Error("Release versions need full history (checkout fetch-depth: 0)");
  const version = `${line}.${git("rev-list", "--count", "HEAD")}`;
  if (stableServerSequence(version) === null) throw new Error(`${version} is not a valid Server release`);
  return version;
}

// Every place the suite-version contract requires the version.
const SOURCE_FILES = [
  "apps/server/src/core/runtime-config.ts",
  "apps/host-go/main.go",
  "apps/server-launcher-go/main.go",
  "apps/workstation-go/main.go",
  "integrations/discord-bot/src/index.mjs",
  "integrations/discord-bot/src/register-commands.mjs",
  "packages/shared/src/index.ts",
];

// Every file stamp() writes; the packager allows exactly these to differ.
export function stampedFiles() {
  const { workspaces } = readJson("package.json");
  return [...SOURCE_FILES, "package.json", ...workspaces.map((w) => `${w}/package.json`), "package-lock.json",
    "config/release-candidate.json", "config/toolchain-versions.json", "config/distribution-profiles.json"];
}

export function stamp(version) {
  const app = readJson("package.json");
  const previous = app.version;
  const quoted = (text) => text.replaceAll(`"${previous}"`, `"${version}"`).replaceAll(`"${previous}-dev"`, `"${version}-dev"`).replaceAll(`/${previous}"`, `/${version}"`);
  for (const relative of SOURCE_FILES) fs.writeFileSync(file(relative), quoted(fs.readFileSync(file(relative), "utf8")));
  for (const workspace of [".", ...app.workspaces]) {
    const manifest = readJson(`${workspace}/package.json`);
    manifest.version = version;
    writeJson(`${workspace}/package.json`, manifest);
  }
  const lock = readJson("package-lock.json");
  lock.version = version;
  lock.packages[""].version = version;
  for (const workspace of app.workspaces) lock.packages[workspace].version = version;
  writeJson("package-lock.json", lock);
  const metadata = readJson("config/release-candidate.json");
  Object.assign(metadata, { release: version, sourceVersion: version, sequence: stableServerSequence(version) });
  writeJson("config/release-candidate.json", metadata);
  const toolchain = readJson("config/toolchain-versions.json");
  toolchain.cluster = version;
  writeJson("config/toolchain-versions.json", toolchain);
  const distribution = readJson("config/distribution-profiles.json");
  distribution.sourceVersion = version;
  writeJson("config/distribution-profiles.json", distribution);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const version = releaseVersion();
  if (!process.argv.includes("--print")) stamp(version);
  console.log(version);
}
