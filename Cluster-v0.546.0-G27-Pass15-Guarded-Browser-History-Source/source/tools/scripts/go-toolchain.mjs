import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "../..");
const versions = JSON.parse(readFileSync(path.join(root, "config", "toolchain-versions.json"), "utf8"));
export const MINIMUM_GO_VERSION = String(versions.go.minimum || "1.27.1");
export const RECOMMENDED_GO_VERSION = String(versions.go.recommended || MINIMUM_GO_VERSION);

function parseVersion(value) {
  const match = String(value || "").match(/(?:go)?(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3] || 0) };
}

function compareVersions(a, b) {
  const aa = typeof a === "string" ? parseVersion(a) : a;
  const bb = typeof b === "string" ? parseVersion(b) : b;
  if (!aa || !bb) return -1;
  return (aa.major - bb.major) || (aa.minor - bb.minor) || (aa.patch - bb.patch);
}

export function detectGoVersion() {
  const result = spawnSync("go", ["version"], { encoding: "utf8", env: { ...process.env, GOTOOLCHAIN: "local" } });
  if (result.status !== 0) return null;
  const text = String(result.stdout || result.stderr || "");
  const match = text.match(/go(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3] || 0), raw: match[0] };
}

export function isSupportedGo(version) {
  return compareVersions(version, MINIMUM_GO_VERSION) >= 0;
}

export function requireSupportedGo({ allowPrebuilt = false, prebuiltUsable = false, label = "Cluster native helper" } = {}) {
  const version = detectGoVersion();
  if (isSupportedGo(version)) return version;
  if (allowPrebuilt && prebuiltUsable) {
    console.warn(`${label}: Go ${MINIMUM_GO_VERSION}+ is unavailable; using an explicitly allowed prebuilt binary.`);
    return null;
  }
  console.error(`${label}: official rebuilds require Go ${MINIMUM_GO_VERSION}+ (recommended ${RECOMMENDED_GO_VERSION}). Found ${version?.raw || "no Go toolchain"}.`);
  console.error("Cluster release builds use GOTOOLCHAIN=local and never silently download a compiler.");
  process.exit(1);
}

export function buildGoBinary({ source, goos, output, ldflags = [], extraEnv = {} }) {
  const linkerFlags = ["-s", "-w", ...ldflags].join(" ");
  const result = spawnSync("go", ["build", "-buildvcs=false", "-trimpath", `-ldflags=${linkerFlags}`, "-o", output, "."], {
    cwd: source,
    stdio: "inherit",
    env: { ...process.env, GOOS: goos, GOARCH: "amd64", CGO_ENABLED: "0", GOTOOLCHAIN: "local", ...extraEnv },
  });
  if (result.status !== 0) process.exit(result.status || 1);
}
