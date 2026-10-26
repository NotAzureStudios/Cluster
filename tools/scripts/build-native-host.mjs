import { existsSync, mkdirSync, statSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { buildGoBinary, requireSupportedGo } from "./go-toolchain.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const source = path.join(root, "apps", "host-go");
const bin = path.join(root, "bin");
const releaseVersion = process.env.CLUSTER_VERSION || JSON.parse(readFileSync(path.join(root, "config", "toolchain-versions.json"), "utf8")).cluster;
mkdirSync(bin, { recursive: true });
const current = process.platform === "win32" ? path.join(bin, "cluster-host.exe") : path.join(bin, "cluster-host");
function usable(file) { try { return existsSync(file) && statSync(file).size > 0; } catch { return false; } }
const version = requireSupportedGo({ allowPrebuilt: process.env.CLUSTER_ALLOW_PREBUILT_NATIVE === "1", prebuiltUsable: usable(current), label: "Cluster Host" });
if (!version) process.exit(0);
const flags = [`-X=main.version=${releaseVersion}`];
buildGoBinary({ source, goos: "windows", output: path.join(bin, "cluster-host.exe"), ldflags: flags });
buildGoBinary({ source, goos: "linux", output: path.join(bin, "cluster-host"), ldflags: flags });
console.log(`Cluster Host binaries built with ${version.raw}.`);
