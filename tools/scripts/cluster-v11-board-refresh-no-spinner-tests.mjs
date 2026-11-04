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
const appPath="packages/renderer/src/features/application/ClusterApplication.tsx";
const policyPath="packages/renderer/src/features/application/board-loading-policy.ts";
const compiled=ts.transpileModule(read(policyPath),{
  fileName:policyPath,reportDiagnostics:true,
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
});
assert.equal((compiled.diagnostics||[]).filter(x=>x.category===ts.DiagnosticCategory.Error).length,0);
const mod={exports:{}};
vm.runInNewContext(compiled.outputText,{module:mod,exports:mod.exports,Boolean});
const {boardNeedsBlockingLoading}=mod.exports;
let count=0;
function test(name,callback){callback();count++;console.log("PASS "+name);}

test("Initial Board navigation blocks only until exact ID arrives",()=>{
 assert.equal(boardNeedsBlockingLoading("b1",null,false,null),true);
 assert.equal(boardNeedsBlockingLoading("b1",null,true,null),true);
 assert.equal(boardNeedsBlockingLoading("b1","b1",false,null),false);
});
test("Routine same-Board refreshing preserves the existing visible Board",()=>{
 assert.equal(boardNeedsBlockingLoading("b1","b1",false,null),false);
 assert.equal(boardNeedsBlockingLoading("b1","b1",false,"b0"),false);
});
test("Switching Boards does not expose the previous Board's contents",()=>{
 assert.equal(boardNeedsBlockingLoading("b2","b1",false,null),true);
 assert.equal(boardNeedsBlockingLoading("b2","b1",true,null),true);
 assert.equal(boardNeedsBlockingLoading("b2","b2",false,null),false);
});
test("Error states show an error for that exact Board instead of an infinite spinner",()=>{
 assert.equal(boardNeedsBlockingLoading("b2",null,false,"b2"),false);
 assert.equal(boardNeedsBlockingLoading("b2","b1",false,"b2"),false);
 assert.equal(boardNeedsBlockingLoading("b3","b1",false,"b2"),true);
 assert.equal(boardNeedsBlockingLoading("b2",null,true,"b2"),true);
});
test("Board browser without a selected Board never gets an implicit spinner",()=>{
 assert.equal(boardNeedsBlockingLoading(null,null,false,null),false);
 assert.equal(boardNeedsBlockingLoading(null,"old",true,"old"),false);
});
test("App uses per-request serial, Board ID, user and screen guards for slow responses",()=>{
 const source=read(appPath);
 for(const line of [
  "const sequence = ++boardRequestSequence.current;",
  "sequence === boardRequestSequence.current",
  "activeBoardIdRef.current === id",
  "activeBoardUserRef.current === accountAtStart",
  'activeBoardScreenRef.current === "board"',
  "if (!stillCurrent()) return;",
  "if (stillCurrent()) setBoardLoading(false);",
 ]) assert.ok(source.includes(line),line);
});
test("Refreshing current Board does not replace UI with BoardLoadingState",()=>{
 const source=read(appPath);
 assert.ok(source.includes("const replacingBoard = loadedBoardRef.current?.id !== id;"));
 assert.ok(source.includes("if (replacingBoard) setBoardLoading(true);"));
 assert.ok(source.includes("boardNeedsBlockingLoading(boardId, board?.id || null, boardLoading, boardLoadErrorId)"));
 assert.ok(source.includes("boardLoadErrorId === boardId"));
 assert.ok(!source.includes("boardLoading && boardId ? ("));
});
test("Authentication and Board selector invalidate previous requests",()=>{
 const source=read(appPath);
 assert.ok((source.match(/boardRequestSequence\.current \+= 1/g)||[]).length>=2);
 assert.ok(source.includes("setBoardLoadErrorId(null)"));
 assert.ok(source.includes("if (user?.id && screen === \"board\" && boardId) void loadBoard(boardId)"));
 assert.ok(source.includes("[screen, boardId, user?.id]"));
});
test("User profile and presence changes never refetch the entire Projects list",()=>{
 const source=read(appPath);
 assert.ok(source.includes("if (user?.id && !signedOutKiosk) void loadProjects().catch("));
 assert.ok(source.includes("}, [user?.id, signedOutKiosk]);"));
 assert.ok(source.includes("if (user && !signedOutKiosk) void loadAppSettings();"));
 assert.ok(source.includes("}, [user, signedOutKiosk]);"));
 assert.ok(!source.includes("Promise.allSettled([loadAppSettings(), loadProjects()])"));
 assert.ok(source.includes('void loadProjects(true).catch(() => undefined);'));
});
test("API authority and navigation still use the same server endpoints",()=>{
 const source=read(appPath);
 assert.ok(source.includes('queryApi<Board>(`/api/boards/${id}`'));
 assert.ok(source.includes("loadBoard(boardId, true)"));
 assert.ok(source.includes("queryApi<Project[]>(\"/api/projects\""));
 for(const p of [appPath,policyPath]) {
  assert.equal(ts.createSourceFile(p,read(p),ts.ScriptTarget.Latest,true,p.endsWith(".tsx")?ts.ScriptKind.TSX:ts.ScriptKind.TS).parseDiagnostics.length,0,p);
 }
});
console.log(count+"/"+count+" Board refresh navigation checks passed");
