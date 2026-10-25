import { mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const root = path.resolve(import.meta.dirname, "../..");
const source = path.join(root, "apps", "server-launcher-go");
const bin = path.join(root, "bin");
mkdirSync(bin, { recursive: true });

function build(goos, filename, { windowsGui = false } = {}) {
  const linkerFlags = ["-s", "-w"];
  if (windowsGui) linkerFlags.push("-H=windowsgui");
  const result = spawnSync("go", ["build", "-trimpath", `-ldflags=${linkerFlags.join(" ")}`, "-o", path.join(bin, filename), "."], {
    cwd: source,
    stdio: "inherit",
    env: { ...process.env, GOOS: goos, GOARCH: "amd64", CGO_ENABLED: "0" },
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

rmSync(path.join(bin, "ClusterServerCLI.exe"), { force: true });
build("windows", "ClusterServer.exe", { windowsGui: true });
build("linux", "cluster-server");
console.log("Cluster Server launchers built: one Windows launcher with selectable native-interface/command-line modes, plus the Linux headless launcher.");
