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
console.log(`${checks}/${checks} platform release-profile checks passed`);
