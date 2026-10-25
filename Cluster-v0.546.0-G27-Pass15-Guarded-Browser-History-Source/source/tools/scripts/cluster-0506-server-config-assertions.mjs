import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript','lib','typescript.js')); } })();
const helper = fs.readFileSync('apps/server/src/core/server-config-preconditions.ts','utf8');
const route = fs.readFileSync('apps/server/src/app/server-routes-configuration-integrations.ts','utf8');
const service = fs.readFileSync('apps/server/src/app/server-services-settings-integrations.ts','utf8');
const ui = fs.readFileSync('packages/renderer/src/features/settings/ServerConfigPage.tsx','utf8');
const sandbox = {module:{exports:{}},exports:{}};sandbox.exports=sandbox.module.exports;
vm.runInNewContext(ts.transpileModule(helper,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,sandbox);
const checkPreconditions = sandbox.module.exports.checkServerConfigPreconditions;
let pass = 0;
function check(name, fn){try{fn();pass++;console.log(`PASS ${name}`);}catch(e){console.error(`FAIL ${name}: ${e.stack}`);process.exitCode=1;}}
check('only changed fields sent, original server values retained',()=>{
 assert.match(ui,/const changedKeys = Object\.keys\(settings\)/);
 assert.match(ui,/loadedRawSettingsRef\.current = loaded/);
 assert.match(ui,/body: JSON\.stringify\(\{ \.\.\.changes, expectedSettings, securityPin: pin \}\)/);
 assert.doesNotMatch(ui,/body: JSON\.stringify\(\{ \.\.\.settings, appDisplayName:/);
});
check('security PIN and exact preconditions required server side',()=>{
 assert.match(route,/if \(!securityPin\?\.trim\(\)\)/);
 assert.match(route,/SERVER_CONFIG_PIN_REQUIRED/);
 assert.match(route,/await verifyUserPin\(user, securityPin, "apply_server_configuration", request\)/);
 assert.match(route,/SERVER_CONFIG_PRECONDITION_REQUIRED/);
});
check('read-only request fields are rejected',()=>{
 assert.match(route,/expectedSettings: z\.record/);
 assert.match(route,/\.strict\(\)\s*\.parse\(request\.body\)/);
 assert.match(route,/const \{ securityPin, expectedSettings, \.\.\.requestedChanges \} = body/);
});
check('server compares against fresh safe projected values',()=>{
 assert.match(route,/const existing = await readSettings\(true\)/);
 assert.match(route,/checkServerConfigPreconditions\(settingsForClient\(existing\), requestedChanges, expectedSettings\)/);
 assert.match(route,/SERVER_CONFIG_CONFLICT/);
});
check('conflict UI refreshes without overwriting the draft',()=>{
 assert.match(ui,/function refreshAfterServerConfigConflict/);
 assert.match(ui,/setSettings\(\{ \.\.\.newBaseline, \.\.\.edited \}\)/);
 assert.match(ui,/onRetry=\{serverConfigConflict \? undefined/);
 assert.match(ui,/reloadLabel="Refresh and review edits"/);
});
check('no response-derived metadata can leak into persistence',()=>{
 assert.match(route,/\.\.\.requestedChanges,\s*appDisplayName: "Cluster"/);
 assert.doesNotMatch(route,/\.\.\.body,\s*appDisplayName: "Cluster"/);
});
check('file save uses shared durable replacement with private temp + fsync + cleanup',()=>{
 const journalHelper=fs.readFileSync('apps/server/src/core/server-config-publication-journal.ts','utf8');
 assert.match(service,/await durableReplaceFile\(CONFIG_FILE_PATH, afterBytes\)/);
 assert.match(service,/await prepareConfigPublication\(CONFIG_FILE_PATH, afterBytes\)/);
 assert.match(journalHelper,/\.tmp-\$\{process\.pid\}-\$\{randomUUID\(\)\}/);
 assert.match(journalHelper,/fs\.open\(temporary, 'wx', 0o600\)/);
 assert.match(journalHelper,/await handle\.sync\(\)/);
 assert.match(journalHelper,/await fs\.rename\(temporary, filePath\)/);
 assert.match(journalHelper,/await fs\.unlink\(temporary\)/);
});
check('false and null are different from missing keys',()=>{
 const actual={a:null,b:false,c:''};
 assert.deepEqual(Array.from(checkPreconditions(actual,{a:1,b:true,c:'x'},{a:{exists:true,value:null},b:{exists:true,value:false},c:{exists:true,value:''}}).conflicts),[]);
 const result=checkPreconditions(actual,{a:1,b:true,c:'x'},{a:{exists:false},b:{exists:false},c:{exists:false}});
 assert.deepEqual(Array.from(result.conflicts),['a','b','c']);
});
check('independent fields pass even when other fields changed',()=>{
 const result=checkPreconditions({a:'someone changed',b:2},{b:3},{b:{exists:true,value:2}});
 assert.deepEqual(Array.from(result.conflicts),[]);
});
check('stale same-field edit causes conflict',()=>{
 const result=checkPreconditions({a:3},{a:4},{a:{exists:true,value:2}});
 assert.deepEqual(Array.from(result.conflicts),['a']);
});
check('new absent field has explicit absence precondition',()=>{
 assert.deepEqual(Array.from(checkPreconditions({}, {created:1},{created:{exists:false}}).conflicts),[]);
});
check('partial or extra preconditions rejected',()=>{
 assert.throws(()=>checkPreconditions({}, {a:1,b:2},{a:{exists:false}}));
 assert.throws(()=>checkPreconditions({}, {a:1},{a:{exists:false},b:{exists:false}}));
 assert.throws(()=>checkPreconditions({}, {a:1},{a:{exists:true}}));
 assert.throws(()=>checkPreconditions({}, {a:1},undefined));
});
check('prototype pollution keys rejected',()=>{
 assert.throws(()=>checkPreconditions({},JSON.parse('{"__proto__":1}'),JSON.parse('{"__proto__":{"exists":false}}')));
});
console.log(`${pass}/13 server-config assertions passed`);
if(pass !== 13) process.exitCode=1;
