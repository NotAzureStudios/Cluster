import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(import.meta.url);
const ts = require("typescript");
const postcss = require("postcss");
const read = (p) => fs.readFileSync(path.join(root,p),"utf8");
const board = (p) => "packages/renderer/src/features/boards/" + p;
const helper = board("board-selection-projection.ts");
const compiled = ts.transpileModule(read(helper), {
  fileName: helper,reportDiagnostics:true,
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
});
assert.equal((compiled.diagnostics || []).filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
const module = {exports:{}};
vm.runInNewContext(compiled.outputText,{module,exports:module.exports,Set});
const {pruneBoardSelection,addVisibleBoardSelection,removeVisibleBoardSelection,countVisibleBoardSelection}=module.exports;
const names = (set) => Array.from(set);
let count=0;
function test(name,fn){fn();count++;console.log("PASS "+name);}

test("Select visible is additive across changing filters",()=>{
 const initial=new Set(["outside-1","a"]);
 const after=addVisibleBoardSelection(initial,["a","b","c"]);
 assert.deepEqual(names(after),["outside-1","a","b","c"]);
 assert.deepEqual(names(initial),["outside-1","a"]);
 assert.equal(countVisibleBoardSelection(after,["a","b","c"]),3);
});
test("Selected-count equality never implies the visible set is selected",()=>{
 const current=new Set(["outside-1","outside-2"]);
 const view=["a","b"];
 assert.equal(current.size,view.length);
 assert.equal(countVisibleBoardSelection(current,view),0);
 assert.deepEqual(names(addVisibleBoardSelection(current,view)),["outside-1","outside-2","a","b"]);
});
test("Deselect visible preserves hidden filtered selections",()=>{
 const current=new Set(["outside","a","b","c"]);
 assert.deepEqual(names(removeVisibleBoardSelection(current,["a","b"])),["outside","c"]);
 assert.deepEqual(names(current),["outside","a","b","c"]);
 assert.equal(countVisibleBoardSelection(current,["a","b"]),2);
});
test("Changed Board cannot carry stale selection to next Board",()=>{
 const old=new Set(["old","shared"]);
 const nextBoard=new Set(["shared","new"]);
 assert.deepEqual(names(pruneBoardSelection(old,nextBoard)),["shared"]);
 assert.deepEqual(names(pruneBoardSelection(old,new Set())),[]);
});
test("Unchanged operations retain Set identity to avoid extra React renders",()=>{
 const selection=new Set(["a","b"]);
 assert.equal(pruneBoardSelection(selection,new Set(["a","b","c"])),selection);
 assert.equal(addVisibleBoardSelection(selection,["a"]),selection);
 assert.equal(removeVisibleBoardSelection(selection,["not-visible"]),selection);
});
test("Many Cards work without per-Card React mutations or requests",()=>{
 const view=Array.from({length:20000},(_,i)=>"c"+i);
 const current=new Set(["elsewhere"]);
 const added=addVisibleBoardSelection(current,view);
 assert.equal(added.size,20001);
 assert.equal(countVisibleBoardSelection(added,view),20000);
 assert.deepEqual(names(removeVisibleBoardSelection(added,view)),["elsewhere"]);
 for(const expression of ["api(","queryApi(","fetch(","prisma."]) assert.equal(read(helper).includes(expression),false,expression);
});
test("Board selection scope and bulk mutation use actual current Board Cards",()=>{
 const page=read(board("BoardWorkspacePage.tsx"));
 for(const needle of [
  "pruneBoardSelection(current, currentBoardIds)",
  "addVisibleBoardSelection(current, visibleCardIds)",
  "removeVisibleBoardSelection(current, visibleCardIds)",
  "countVisibleBoardSelection(selectedCardIds, visibleCardIds)",
  "selectedCards.length - visibleSelectedCount",
  'selectionCount={selectedCards.length}',
  'disabled={bulkBusy || !visibleCardIds.length || visibleSelectedCount === visibleCardIds.length}',
  'setSelectedCardIds(new Set([...outcome.failures.map((failure) => failure.id), ...outcome.remainingIds]))',
 ]) assert.ok(page.includes(needle),needle);
 assert.ok(!page.includes("selectedCardIds.size === visibleRows.length"));
 assert.ok(!page.includes("setSelectedCardIds(new Set(visibleRows.map("));
});
test("Discoverable Select visible and Deselect visible have informative counts",()=>{
 const page=read(board("BoardWorkspacePage.tsx"));
 assert.ok(page.includes("Select visible"));
 assert.ok(page.includes("Deselect visible"));
 assert.ok(page.includes("selected outside current filters"));
 assert.ok(page.includes("visibleCardIds.length - visibleSelectedCount"));
 assert.ok(page.includes("Deselect ${visibleSelectedCount} Cards in the current filtered view"));
});
test("Selection controls remain touch friendly and accessible",()=>{
 const css=read(board("board-workspace.css"));
 assert.ok(postcss.parse(css).nodes.length);
 for(const term of ["board-select-visible-v11","board-selection-hidden-v11","@media(pointer:coarse)","min-height:44px"]) assert.ok(css.includes(term),term);
 for(const file of [helper,board("BoardWorkspacePage.tsx")]){
 const sf=ts.createSourceFile(file,read(file),ts.ScriptTarget.Latest,true,file.endsWith(".tsx")?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 assert.equal(sf.parseDiagnostics.length,0,file);
 }
});
console.log(count+"/"+count+" Board selection scope checks passed");
