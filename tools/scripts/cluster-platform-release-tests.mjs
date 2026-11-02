import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const executable=path.join(root,"tools/scripts/cluster-platform-release.mjs");
const catalog=JSON.parse(fs.readFileSync(path.join(root,"config/distribution-profiles.json"),"utf8"));
let checks=0;
function check(ok, reason){assert.ok(ok,reason);checks++;}
function call(...args) {
 return spawnSync(process.execPath,[executable,...args],{cwd:root,encoding:"utf8"});
}
const list=call("--list");
check(list.status===0,list.stderr);
check(JSON.parse(list.stdout).profiles.length===4,"Must enumerate four supported distribution profiles");
for(const [id,p] of Object.entries(catalog.profiles)){
 for(const channel of p.updateChannels){
  const result=call("--profile",id,"--channel",channel);
  check(result.status===0,`${id}/${channel}: ${result.stderr}`);
  const plan=JSON.parse(result.stdout);
  check(plan.product===p.product && plan.channel===channel,"Profile selection must preserve platform/product/channel");
  check(plan.built===false && !plan.signed,"Planning must not claim a signed release");
 }
}
const server=catalog.profiles["server-windows-x64"];
const desktop=catalog.profiles["desktop-windows-x64"];
check(!server.includesDesktopApp,"Server installer must not contain standalone Desktop app");
check(!desktop.includesServerRuntime && desktop.requiresDatabase===false,"Desktop must not install PostgreSQL or server");
check(call("--profile","desktop-windows-x64","--channel","development").status!==0,"Desktop must reject server development channel");
check(call("--profile","desktop-windows-x64","--channel","main").status!==0,"Desktop must reject server main channel");
check(call("--profile","server-windows-x64","--channel","beta").status!==0,"Server must reject desktop beta channel");
check(call("--profile","not-an-install-target").status!==0,"Unknown install target must fail");
check(server.artifacts.every(p=>!p.includes("Desktop")),"Server artifacts cannot be Desktop bundles");
check(desktop.artifacts.every(p=>!p.includes("Cluster-Installer.exe")&&!p.includes("Server.exe")),"Desktop artifacts cannot be Server executables");
const builder=fs.readFileSync(executable,"utf8");
check(builder.includes('lockData.lockfileVersion >= 3') && builder.includes('lockData.packages?.[""]?.version === packageData.version'),"Release lockfile metadata must match manifest");
check(builder.includes('spawnSync(npmCommand, npmArgs(["ci", "--no-audit", "--no-fund"])'),"Release must perform clean npm ci, not reuse existing node_modules");
check(builder.indexOf('spawnSync(npmCommand, ["ci", "--no-audit", "--no-fund"]') < builder.indexOf('releaseCommand(npmCommand, npmArgs(["run", profile.buildCommand])'),"Locked install must precede selected build");
check(builder.includes('assert(install.status === 0, "Locked clean npm ci failed; refusing release build")'),"Failed clean install must block packaging");
check(builder.includes('if(profile.product==="cluster-server")'),"Windows server release has build-specific prerequisites");
for(const step of ["cluster-rc-native-checks.mjs","build-native-host.mjs","build-server-launcher.mjs","build-cluster-server-entry.mjs","build-update-helper.mjs","build-workstation-service.mjs"]) {
 check(builder.includes(step),"Windows release must compile native "+step);
}
check(builder.includes('npmArgs(["run","db:generate"])') && builder.includes('npmArgs(["run","build"])'),"Release must generate Prisma and compile Server/Web on build runner");
check(builder.indexOf('npmArgs(["run","build"])') < builder.indexOf('npmArgs(["run", profile.buildCommand])'),"Server/Web build must precede packaging");
check(builder.includes('process.version === "v" + toolchains.node.version'),"Release must require exact pinned Node runtime");
check(builder.includes('lockfileSha256 = createHash("sha256")') && builder.includes('lockfileSha256, built:true'),
  "Release build receipt must bind to the locked dependency graph");
check(builder.includes('const npmCommand = process.execPath') && builder.includes('const npmArgs = args => [npmCli, ...args]'),
  "Release npm commands must execute npm JavaScript CLI under pinned Node");
console.log(`${checks}/${checks} platform release-profile checks passed`);
