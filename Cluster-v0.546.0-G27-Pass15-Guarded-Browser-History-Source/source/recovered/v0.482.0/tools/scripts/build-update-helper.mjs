import { existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "../..");
const source = path.join(root, "apps", "update-helper-go");
const bin = path.join(root, "bin");
mkdirSync(bin, { recursive: true });

function usable(file) {
  try { return existsSync(file) && statSync(file).size > 0; } catch { return false; }
}
function build(goos, output) {
  const result = spawnSync("go", ["build", "-trimpath", "-ldflags=-s -w", "-o", output, "."], {
    cwd: source,
    stdio: "inherit",
    env: { ...process.env, GOOS: goos, GOARCH: "amd64", CGO_ENABLED: "0" },
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

const windows = path.join(bin, "cluster-update-helper.exe");
const linux = path.join(bin, "cluster-update-helper");
if (spawnSync("go", ["version"], { stdio: "ignore" }).status !== 0) {
  const required = process.platform === "win32" ? windows : linux;
  if (usable(required)) {
    console.log("Go is unavailable; using the bundled Cluster update verification helper.");
    process.exit(0);
  }
  console.error("The bundled update verification helper is missing. Go 1.23+ is required only for developer rebuilds.");
  process.exit(1);
}
build("windows", windows);
build("linux", linux);
console.log("Cluster update verification helpers built for Windows and Linux.");
