import { existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { buildGoBinary, requireSupportedGo } from "./go-toolchain.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const source = path.join(root, "apps", "update-helper-go");
const bin = path.join(root, "bin");
mkdirSync(bin, { recursive: true });
const windows = path.join(bin, "cluster-update-helper.exe");
const linux = path.join(bin, "cluster-update-helper");
const current = process.platform === "win32" ? windows : linux;
function usable(file) { try { return existsSync(file) && statSync(file).size > 0; } catch { return false; } }
const version = requireSupportedGo({ allowPrebuilt: process.env.CLUSTER_ALLOW_PREBUILT_NATIVE === "1", prebuiltUsable: usable(current), label: "Cluster update verification helper" });
if (!version) process.exit(0);
buildGoBinary({ source, goos: "windows", output: windows });
buildGoBinary({ source, goos: "linux", output: linux });
console.log(`Cluster update verification helpers built with ${version.raw}.`);
