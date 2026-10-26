import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript','lib','typescript.js'))}})();
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const source=fs.readFileSync(path.join(root,'apps/server/src/core/studio-settings-coordination.ts'),'utf8');
const transpiled=ts.transpileModule(source,{fileName:'studio-settings-coordination.ts',reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
assert.deepEqual(transpiled.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error),[]);
const mod={exports:{}};
vm.runInNewContext(transpiled.outputText,{module:mod,exports:mod.exports,Promise,console}, {filename:'studio-settings-coordination.ts'});
const {createStudioSettingsCoordination}=mod.exports;
let passed=0;
async function check(name,fn){await fn();passed++;console.log('PASS '+name)}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function make(overrides={}){
 const applied=[],published=[],warnings=[],reads=[];
 let database={calendarEnabled:true,libraryEnabled:true};
 const deps={
  readSettings:async(force)=>{reads.push(force);return {...database}},
  applyToolAvailability:(values,changed)=>applied.push({values:{...values},changed:changed?[...changed]:undefined}),
  publishChange:async payload=>{published.push(payload);return true},
  warn:(err,message)=>warnings.push({err,message}),...overrides,
 };
 const subject=createStudioSettingsCoordination(deps);
 return {subject,applied,published,warnings,reads,changeDatabase:value=>database={...value}};
}
await check('a committed write immediately applies local tool state',async()=>{
 const m=make();m.subject.committedLocally(['calendarEnabled'],{calendarEnabled:false});
 assert.equal(m.applied.length,1);assert.equal(m.applied[0].values.calendarEnabled,false);
 assert.equal(m.reads.length,0);await tick();assert.equal(m.published.length,1);
});
await check('coordination payload exposes no setting values or secret metadata',async()=>{
 const m=make();m.subject.committedLocally(['calendarEnabled','integrationSecret'],{calendarEnabled:false,integrationSecret:'secret!'});
 await tick();assert.equal(JSON.stringify(m.published),JSON.stringify([{kind:'committed'}]));
});
await check('a remote hint always refreshes from DB truth, never from event payload',async()=>{
 const m=make();m.changeDatabase({calendarEnabled:false});await m.subject.refreshFromDatabase();
 assert.equal(m.reads[0],true);assert.equal(m.applied[0].values.calendarEnabled,false);assert.equal(m.published.length,0);
});
await check('multiple hints while a refresh runs coalesce to one subsequent read',async()=>{
 let resolveFirst;let calls=0;const applied=[];
 const m=make({readSettings:async()=>{calls++;if(calls===1)return await new Promise(r=>resolveFirst=r);return {calendarEnabled:true}},applyToolAvailability:settings=>applied.push(settings.calendarEnabled)});
 const first=m.subject.refreshFromDatabase();
 const second=m.subject.refreshFromDatabase();m.subject.refreshFromDatabase();
 resolveFirst({calendarEnabled:false});await Promise.all([first,second]);
 assert.equal(calls,2);assert.equal(JSON.stringify(applied),JSON.stringify([false,true]));
});
await check('refresh failure does not make an infinite retry loop',async()=>{
 let count=0;const m=make({readSettings:async()=>{count++;throw new Error('db offline')}});
 await m.subject.refreshFromDatabase();assert.equal(count,1);assert.equal(m.warnings.length,1);
 await m.subject.refreshFromDatabase();assert.equal(count,2);
});
await check('failed coordination publication never makes a committed local write fail',async()=>{
 const m=make({publishChange:async()=>{throw Error('bus offline')}});
 assert.doesNotThrow(()=>m.subject.committedLocally(['libraryEnabled'],{libraryEnabled:false}));
 await tick();assert.equal(m.applied[0].values.libraryEnabled,false);assert.equal(m.warnings.length,1);
});
await check('undelivered coordination hints fall back safely',async()=>{
 const m=make({publishChange:async()=>false});m.subject.committedLocally(['libraryEnabled'],{libraryEnabled:false});
 await tick();assert.equal(m.warnings.length,1);
});
await check('no-op commits do not publish and shutdown stops pending work',async()=>{
 let unlock;const m=make({readSettings:async()=>new Promise(r=>unlock=r)});
 m.subject.committedLocally([],{});await tick();assert.equal(m.published.length,0);
 const pending=m.subject.refreshFromDatabase();m.subject.close();unlock({calendarEnabled:false});await pending;
 assert.equal(m.applied.length,0);await m.subject.refreshFromDatabase();assert.equal(m.applied.length,0);
 m.subject.committedLocally(['calendarEnabled'],{calendarEnabled:false});await tick();assert.equal(m.published.length,0);
});
await check('source uses existing coordination bus and retains periodic DB fallback',async()=>{
 const server=fs.readFileSync(path.join(root,'apps/server/src/app/cluster-server.ts'),'utf8');
 assert.match(server,/coordinationBus\.subscribe\("studio-settings\.changed"/);
 assert.match(server,/publishChange:\s*\(payload\)\s*=>\s*coordinationBus\.publish\("studio-settings\.changed"/);
 assert.match(server,/readSettings:\s*\(force\)\s*=>\s*readSettings\(force\)/);
 assert.match(server,/scheduleAdaptive\("studio-tool-availability-reconcile"/);
 assert.match(server,/settingsCoordination\?\.close\(\)/);
});
await check('valid zero-day Scheduler policy values remain effective rather than reverting to defaults',async()=>{
 const input=fs.readFileSync(path.join(root,'packages/shared/src/tool-settings-contract.ts'),'utf8');
 const result=ts.transpileModule(input,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
 const shared={exports:{}};
 vm.runInNewContext(result.outputText,{module:shared,exports:shared.exports},{filename:'tool-settings-contract.ts'});
 const resolve=shared.exports.clusterResolveToolConfig;
 const explicit=resolve('scheduler',{schedulerEditWindowDays:0,schedulerLockAfterDays:0});
 assert.equal(explicit.editWindowDays,0);assert.equal(explicit.lockAfterDays,0);
 const defaults=resolve('scheduler',{});
 assert.equal(defaults.editWindowDays,14);assert.equal(defaults.lockAfterDays,30);
 assert.equal(resolve('scheduler',{schedulerEditWindowDays:7,schedulerLockAfterDays:60}).lockAfterDays,60);
});
console.log(`${passed} distributed Settings tests passed`);
