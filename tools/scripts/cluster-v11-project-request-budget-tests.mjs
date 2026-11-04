import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const require=createRequire(import.meta.url);
const ts=require("typescript");
const read=(p)=>fs.readFileSync(path.join(root,p),"utf8");
const project=(p)=>"packages/renderer/src/features/projects/"+p;
const compiled=ts.transpileModule(read(project("project-request-budget.ts")),{
  fileName:"project-request-budget.ts",reportDiagnostics:true,
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
});
assert.equal((compiled.diagnostics||[]).filter((d)=>d.category===ts.DiagnosticCategory.Error).length,0);
const mod={exports:{}};
vm.runInNewContext(compiled.outputText,{module:mod,exports:mod.exports});
const {projectWorkspaceRequestPlan}=mod.exports;
let count=0;
function test(name,fn){fn();count++;console.log("PASS "+name);}
test("Project overview retains its Media, Overview and Control Center payloads",()=>{
 const plan=projectWorkspaceRequestPlan("overview");
 assert.deepEqual(Object.keys(plan),["media","dashboard","controlCenter","intelligence"]);
 assert.equal(plan.media,true);
 assert.equal(plan.dashboard,true);
 assert.equal(plan.controlCenter,true);
 assert.equal(plan.intelligence,false);
});
test("Control Center only reads its own heavyweight payload",()=>{
 const p=projectWorkspaceRequestPlan("control");
 assert.equal(p.media,false);
 assert.equal(p.dashboard,false);
 assert.equal(p.controlCenter,true);
 assert.equal(p.intelligence,false);
});
test("Intelligence is loaded only for Intelligence tab",()=>{
 for(const id of ["overview","plan","control","viewer","people","assets","qa","boards","tickets"]){
   assert.equal(projectWorkspaceRequestPlan(id).intelligence,false,id);
 }
 assert.equal(projectWorkspaceRequestPlan("intelligence").intelligence,true);
});
test("Asset, viewer, access and closeout paths retain Media consumers",()=>{
 for(const id of ["viewer","assets","access","closeout"]) assert.equal(projectWorkspaceRequestPlan(id).media,true,id);
});
test("Most Project tabs avoid Media, Dashboard and Control Center requests",()=>{
 for(const id of ["plan","boards","tickets","people","qa","builds","source","links","production","library","whiteboards"]){
   const p=projectWorkspaceRequestPlan(id);
   assert.equal(p.media,false,id);
   assert.equal(p.dashboard,false,id);
   assert.equal(p.controlCenter,false,id);
   assert.equal(p.intelligence,false,id);
 }
});
test("Only shared Snapshot and Users load during initial Project hydration",()=>{
 const source=read(project("useProjectDetailWorkspace.ts"));
 const begin=source.indexOf('  useEffect(() => {\n    if (!storedTabsState.hydrated)');
 const finish=source.indexOf('  useEffect(() => {\n    if (!projectId || !storedTabsState.hydrated || tabOwner');
 assert.ok(begin>=0&&finish>begin);
 const initial=source.slice(begin,finish);
 assert.ok(initial.includes("loadProjectSnapshot()"));
 assert.ok(initial.includes("loadProjectUsers()"));
 for(const forbidden of ["loadMedia()","loadProjectDashboard()","loadProjectControlCenter()","loadProjectIntelligence()"]){
   assert.equal(initial.includes(forbidden),false,forbidden);
 }
});
test("Current tab gates async requests and ignores stale Project owner after a switch",()=>{
 const source=read(project("useProjectDetailWorkspace.ts"));
 assert.ok(source.includes("const requestPlan = projectWorkspaceRequestPlan(tab);"));
 assert.ok(source.includes("tabRef.current !== tab"));
 assert.ok(source.includes("activeProjectRef.current === projectId"));
 for(const contract of ["requestPlan.media","requestPlan.dashboard","requestPlan.controlCenter","storedTabsState.hydrated"]){
   assert.ok(source.includes(contract),contract);
 }
});
test("Resource-change handling reloads Snapshot plus only active tab endpoints",()=>{
 const source=read(project("useProjectDetailWorkspace.ts"));
 const section=source.slice(source.indexOf("  useResourceChangeRefresh(async () =>"),source.indexOf("  useEffect(() => {\n    if (!storedTabsState.hydrated)"));
 assert.ok(section.includes("activeProjectRef.current !== projectId"));
 assert.ok(section.includes("projectWorkspaceRequestPlan(tabRef.current)"));
 assert.ok(section.includes("loadProjectSnapshot(true)"));
 for(const fn of ["loadMedia(true)","loadProjectDashboard(true)","loadProjectControlCenter(true)","loadProjectIntelligence(true)"]){
  assert.ok(section.includes(fn),fn);
 }
 assert.ok(section.includes("requestPlan.media ?"));
 assert.ok(section.includes("requestPlan.dashboard ?"));
 assert.ok(section.includes("requestPlan.controlCenter ?"));
 assert.ok(section.includes("requestPlan.intelligence ?"));
});
test("Worst-case and common-case request counts are explicit, without API additions",()=>{
 const total=(tab)=>2+Object.values(projectWorkspaceRequestPlan(tab)).filter(Boolean).length;
 assert.equal(total("overview"),5);
 assert.equal(total("control"),3);
 assert.equal(total("plan"),2);
 assert.equal(total("people"),2);
 assert.equal(total("intelligence"),3);
 assert.equal(total("viewer"),3);
 const source=read(project("project-request-budget.ts"));
 for(const forbidden of ["api(","fetch(","queryApi(","prisma.","setInterval("]){
  assert.equal(source.includes(forbidden),false,forbidden);
 }
});
for(const p of [project("useProjectDetailWorkspace.ts"),project("project-request-budget.ts")]){
 const ast=ts.createSourceFile(p,read(p),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
 assert.equal(ast.parseDiagnostics.length,0,p);
}
console.log(count+"/"+count+" Project request-budget checks passed");
