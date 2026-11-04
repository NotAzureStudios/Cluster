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
const source="packages/renderer/src/core/date-time.ts";
const compiled=ts.transpileModule(read(source),{fileName:source,reportDiagnostics:true,
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
assert.equal((compiled.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
const mod={exports:{}};
vm.runInNewContext(compiled.outputText,{module:mod,exports:mod.exports,Date,Math,Number});
const {toLocalDateInput,addDays}=mod.exports;
const drawerPath="packages/renderer/src/features/create/SharedCreateDrawer.tsx";
let count=0;
function test(name,fn){fn();count++;console.log("PASS "+name);}
test("Shared default 'today' is the user's civil day in eastern and western timezones",()=>{
 const old=process.env.TZ;
 try{
  for(const zone of ["Asia/Tokyo","Pacific/Auckland","America/New_York","America/Los_Angeles"]){
   process.env.TZ=zone;
   const now=new Date(2026,10,4,0,2);
   assert.equal(toLocalDateInput(now),"2026-11-04",zone);
   if(zone==="Asia/Tokyo"||zone==="Pacific/Auckland"){
    assert.equal(now.toISOString().slice(0,10),"2026-11-03");
   }
  }
 }finally{if(old===undefined)delete process.env.TZ;else process.env.TZ=old;}
});
test("Leap day, New Year and DST date arithmetic never roll over through UTC",()=>{
 const old=process.env.TZ;
 try{
  for(const zone of ["Asia/Tokyo","America/New_York"]){
   process.env.TZ=zone;
   assert.equal(toLocalDateInput(new Date(2028,1,29)),"2028-02-29",zone);
   assert.equal(toLocalDateInput(addDays(new Date(2026,11,31),14)),"2027-01-14",zone);
   assert.equal(toLocalDateInput(addDays(new Date(2026,2,1),14)),"2026-03-15",zone);
  }
 }finally{if(old===undefined)delete process.env.TZ;else process.env.TZ=old;}
});
test("Non-finite date input has no fabricated civil day",()=>{
 assert.equal(toLocalDateInput(new Date(NaN)),"");
});
test("Shared Create Drawer initializes date and project start from local civil time",()=>{
 const source=read(drawerPath);
 assert.ok(source.includes("toLocalDateInput()"));
 assert.ok(source.includes("setDate(handoff?.date || toLocalDateInput());"));
 assert.ok(source.includes("setProjectStartDate(toLocalDateInput());"));
 assert.equal((source.match(/useState\(\(\) => toLocalDateInput\(\)\)/g)||[]).length,2);
 assert.ok(!source.includes("new Date().toISOString().slice(0, 10)"));
});
test("Meeting default end and fallback serialization preserve local date after 14 days",()=>{
 const source=read(drawerPath);
 assert.ok(source.includes("toLocalDateInput(addDays(new Date("));
 assert.ok(source.includes("meetingEndDate ||"));
 assert.ok(source.includes("handoff?.date || toLocalDateInput()"));
 assert.ok(!source.includes(".toISOString()\n        .slice(0, 10)"));
});
test("Shared creation honors an explicit supplied handoff date and 09:00 local start",()=>{
 const source=read(drawerPath);
 assert.ok(source.includes("setDate(handoff?.date || toLocalDateInput());"));
 assert.ok(source.includes("handoff?.date ? new Date("));
 assert.ok(source.includes("T09:00:00"));
 assert.ok(source.includes("setCalendarStartsAt(toDateTimeLocalInput(now.toISOString()))"));
});
test("No new request, mutable timestamp authority or compatibility branch",()=>{
 for(const forbidden of ["api(","fetch(","queryApi(","prisma.","localStorage"])assert.equal(read("packages/renderer/src/core/date-time.ts").includes(forbidden),false,forbidden);
 for(const file of [source,drawerPath]){
  assert.equal(ts.createSourceFile(file,read(file),ts.ScriptTarget.Latest,true,file.endsWith(".tsx")?ts.ScriptKind.TSX:ts.ScriptKind.TS).parseDiagnostics.length,0,file);
 }
});
console.log(count+"/"+count+" shared create civil-day checks passed");
