import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
const root = path.resolve(import.meta.dirname, "../..");
const source = path.join(root, "apps", "host-go");
const bin = path.join(root, "bin");
mkdirSync(bin, { recursive: true });
const current = process.platform === "win32" ? path.join(bin, "cluster-host.exe") : path.join(bin, "cluster-host");
function usableBinary(file) {
  try { return existsSync(file) && statSync(file).size > 0; } catch { return false; }
}
if (spawnSync("go", ["version"], { stdio: "ignore" }).status !== 0) {
  if (usableBinary(current)) {
    console.log("Go is not installed; using the bundled Cluster Host binary.");
    process.exit(0);
  }
  console.error("The bundled Cluster Host binary is missing. Re-extract the complete Cluster server package; Go is only required for developer rebuilds.");
  process.exit(1);
}
function build(goos, output) {
  const result = spawnSync("go", ["build", "-trimpath", "-ldflags=-s -w", "-o", output, "."], { cwd: source, stdio: "inherit", env: { ...process.env, GOOS: goos, GOARCH: "amd64", CGO_ENABLED: "0" } });
  if (result.status !== 0) process.exit(result.status || 1);
}
build("windows", path.join(bin, "cluster-host.exe"));
build("linux", path.join(bin, "cluster-host"));
console.log("Cluster Host binaries built for Windows and Linux.");
