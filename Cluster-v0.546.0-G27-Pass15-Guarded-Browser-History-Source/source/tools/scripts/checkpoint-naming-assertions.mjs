import fs from "node:fs";
const naming = JSON.parse(fs.readFileSync("VERSION_NAMING_CONVENTION.json", "utf8"));
const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const checks = [
  ["public version is simple", /^\d+\.\d+$/.test(naming.displayVersion)],
  ["internal npm version stays SemVer", naming.internalSemver === `${naming.displayVersion}.0` && pkg.version === naming.internalSemver],
  ["next version increments naturally", naming.nextVersion === `${naming.displayVersion.split(".")[0]}.${Number(naming.displayVersion.split(".")[1]) + 1}`],
  ["artifact name stays short", naming.publicPackage === `Cluster-v${naming.displayVersion}.zip`],
  ["history retains original filenames", naming.historicalArtifactNamesRemainUnchanged === true],
];
for (const [name, ok] of checks) console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
if (checks.some(([,ok]) => !ok)) process.exit(1);
console.log(`${checks.length}/${checks.length} simple version naming assertions passed.`);
