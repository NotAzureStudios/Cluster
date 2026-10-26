import { mkdirSync, rmSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { buildGoBinary, requireSupportedGo } from "./go-toolchain.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const source = path.join(root, "apps", "server-launcher-go");
const bin = path.join(root, "bin");
const releaseVersion = process.env.CLUSTER_VERSION || JSON.parse(readFileSync(path.join(root, "config", "toolchain-versions.json"), "utf8")).cluster;
mkdirSync(bin, { recursive: true });
const version = requireSupportedGo({ label: "Cluster Server launcher" });
function build(goos, filename, { windowsGui = false } = {}) {
  const flags = [`-X=main.version=${releaseVersion}`];
  if (windowsGui) flags.push("-H=windowsgui");
  buildGoBinary({ source, goos, output: path.join(bin, filename), ldflags: flags });
}
rmSync(path.join(bin, "ClusterServerCLI.exe"), { force: true });
build("windows", "ClusterServer.exe", { windowsGui: true });
build("linux", "cluster-server");
console.log(`Cluster Server launchers built with ${version.raw}.`);
