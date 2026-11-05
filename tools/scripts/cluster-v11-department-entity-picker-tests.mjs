import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const require=createRequire(import.meta.url);
const ts=require("typescript");
const read=path=>fs.readFileSync(root+"/"+path,"utf8");
function load(file){
  const mod={exports:{}};
  const result=ts.transpileModule(read(file),{
    fileName:file,reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
  });
  assert.equal(result.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0,file);
  vm.runInNewContext(result.outputText,{exports:mod.exports,module:mod},{filename:file});
  return mod.exports;
}
const {departmentLeadChoices,departmentParentChoices}=load("packages/renderer/src/features/settings/department-assignment-choices.ts");
const leads=[{id:"a",label:"Alice Smith",username:"alice"},{id:"b",label:"brady",username:"brady"}];
assert.deepEqual(Array.from(departmentLeadChoices(leads,"a"), x=>x.id),["a","b"]);
assert.equal(departmentLeadChoices(leads,"a")[0].meta,"@alice");
assert.equal(departmentLeadChoices(leads,"b")[1].meta,undefined);
const missing=departmentLeadChoices(leads,"archived-member");
assert.equal(missing[0].id,"archived-member");
assert.equal(missing[0].disabled,true);
assert.match(missing[0].label,/unavailable/i);
assert.deepEqual(Array.from(departmentLeadChoices([],""),x=>x.id),[]);
const departments=[{id:"root",name:"Studio"},{id:"child",name:"Engineering",parentId:"root"},{id:"grand",name:"Client",parentId:"child"}];
const excluded=new Set(["child","grand"]);
assert.deepEqual(Array.from(departmentParentChoices(departments,excluded,"root"),x=>x.id),["root"]);
const unknownParent=departmentParentChoices(departments,excluded,"child");
assert.equal(unknownParent[0].id,"child");
assert.equal(unknownParent[0].disabled,true);
assert.equal(unknownParent[1].id,"root");
assert.deepEqual(Array.from(excluded),["child","grand"]);
const manager=read("packages/renderer/src/features/settings/WorkforceDepartmentManager.tsx");
assert.match(manager,/import \{ ClusterEntityPicker \} from/);
assert.match(manager,/entities=\{departmentLeadChoices\(leadOptions, draft\.leadUserId\)\}/);
assert.match(manager,/entities=\{departmentParentChoices\(rows, invalidParents, draft\.parentId\)\}/);
assert.match(manager,/onChange=\{\(value\) => update\("leadUserId", value\)\}/);
assert.match(manager,/onChange=\{\(value\) => update\("parentId", value\)\}/);
assert.match(manager,/disabled=\{!canEdit \|\| saving \|\| loading \|\| leadLoading \|\| Boolean\(leadError\)/);
assert.match(manager,/expectedRevision: selected!\.revision/);
assert.match(manager,/const invalidParents = useMemo/);
assert.match(manager,/\/api\/departments\/lead-options/);
assert.match(manager,/useUnsavedChangesGuard/);
assert.doesNotMatch(manager,/<ClusterNativeSelect/);
const component=read("packages/renderer/src/components/ClusterEntityPicker.tsx");
assert.match(component,/ClusterCombobox/);
assert.match(component,/onSearchChange=/);
assert.match(component,/allowClear=/);
for(const file of ["packages/renderer/src/features/settings/WorkforceDepartmentManager.tsx","packages/renderer/src/components/ClusterEntityPicker.tsx"]){
  const result=ts.transpileModule(read(file),{
    fileName:file,reportDiagnostics:true,compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}
  });
  assert.equal(result.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0,file);
}
const css=read("packages/renderer/src/features/settings/workforce-department-manager.css");
assert.match(css,/studio-workforce-department-entity-field-v11/);
assert.match(css,/@media \(pointer: coarse\)/);
console.log("PASS department lead and parent selectors reuse authorized searchable entity picker with safe missing-selection fallback");
