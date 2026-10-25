import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript');}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript','lib','typescript.js'));}})();
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read=(name)=>fs.readFileSync(path.join(root,name),'utf8');
const filename='packages/shared/src/tool-settings-contract.ts';
const compiled=ts.transpileModule(read(filename),{fileName:filename,reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
assert.equal(compiled.diagnostics.filter(x=>x.category===ts.DiagnosticCategory.Error).length,0);
const mod={exports:{}};
vm.runInNewContext(compiled.outputText,{module:mod,exports:mod.exports,require,console});
const {CLUSTER_TOOL_SETTING_KEYS,clusterToolSettingProvenance,clusterToolSettingAuthority}=mod.exports;
let passed=0;
const check=(name,fn)=>{fn();passed++;console.log('PASS '+name);};
const baseline=(tool)=>Object.fromEntries(Object.values(CLUSTER_TOOL_SETTING_KEYS[tool]).map(key=>[key,{exists:false}]));
check('all six configurable tools expose exactly one origin per registered setting',()=>{
 for(const tool of Object.keys(CLUSTER_TOOL_SETTING_KEYS)) {
  const entries=clusterToolSettingProvenance(tool,baseline(tool));
  assert.equal(entries.length,Object.keys(CLUSTER_TOOL_SETTING_KEYS[tool]).length);
  assert.equal(new Set(entries.map(e=>e.persistedKey)).size,entries.length);
  for(const entry of entries) {
   assert.equal(entry.source,'resolved'); assert.equal(entry.scope,clusterToolSettingAuthority(tool,entry.field).scope);
  }
 }
});
check('stored JSON null, empty string and zero are saved values, not resolved defaults',()=>{
 const b=baseline('tickets');
 b.ticketsEnabled={exists:true,value:null}; b.ticketsAutoArchiveDays={exists:true,value:0}; b.ticketsDefaultQueue={exists:true,value:''};
 const byKey=Object.fromEntries(clusterToolSettingProvenance('tickets',b).map(e=>[e.persistedKey,e]));
 assert.equal(byKey.ticketsEnabled.source,'stored');
 assert.equal(byKey.ticketsAutoArchiveDays.source,'stored');
 assert.equal(byKey.ticketsDefaultQueue.source,'stored');
 assert.equal(byKey.ticketsRequireProject.source,'resolved');
});
check('studio-linked configuration keeps Studio provenance and true persisted identity',()=>{
 const b=baseline('scheduler'); b.studioTimezone={exists:true,value:'UTC'};
 const byField=Object.fromEntries(clusterToolSettingProvenance('scheduler',b).map(e=>[e.field,e]));
 assert.equal(byField.timezone.persistedKey,'studioTimezone');
 assert.equal(byField.timezone.scope,'studio');
 assert.equal(byField.timezone.source,'stored');
 assert.equal(byField.enabled.scope,'tool');
 assert.equal(byField.enabled.source,'resolved');
});
check('incomplete database-truth baseline fails closed instead of presenting invented provenance',()=>{
 assert.throws(()=>clusterToolSettingProvenance('calendar',{}),/Missing authoritative setting source/);
});
check('server returns the DB-derived provenance for GET and PUT without a second settings read',()=>{
 const code=read('apps/server/src/domains/admin/admin-tool-routes.ts');
 assert.match(code,/clusterToolSettingProvenance\(tool, expectedSettings\)/);
 assert.match(code,/config, expectedSettings, settingProvenance \} = await readToolConfigSnapshot/);
 assert.match(code,/return \{ config: adminToolSettings\(tool, authoritative\).*settingProvenance:/);
 assert.match(code,/return \{ ok: true, tool, \.\.\.latest,/);
});
check('editor shows origins, displays ownership and refreshes provenance after both save and quick toggle',()=>{
 const code=read('packages/renderer/src/features/admin/AdminToolControls.tsx');
 assert.match(code,/<ClusterDisclosureGroup className="hint-box slim" title="Setting sources"/);
 assert.match(code,/Resolved default/);
 assert.match(code,/Studio policy/);
 assert.equal((code.match(/settingProvenance: result\.settingProvenance/g)||[]).length,3);
 assert.match(code,/Project Calendar view inheritance and its personal-preference lock are managed below/);
 assert.match(code,/device-wide inheritance is not implemented/);
});
console.log(`${passed}/${passed} TD1 setting provenance checks passed`);
