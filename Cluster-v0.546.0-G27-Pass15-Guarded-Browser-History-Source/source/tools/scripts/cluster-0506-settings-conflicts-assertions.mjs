import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const require = createRequire(import.meta.url);
const compiler = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['root','-g'], {encoding:'utf8'}).trim(), 'typescript', 'lib','typescript.js')); } })();
const source = fs.readFileSync('apps/server/src/app/server-services-settings-integrations.ts','utf8');
const route = fs.readFileSync('apps/server/src/app/server-routes-configuration-integrations.ts','utf8');
const ui = fs.readFileSync('packages/renderer/src/features/settings/StudioSettingsPage.tsx','utf8');
let passed = 0;
async function check(label, fn) { try { await fn(); passed++; console.log(`PASS ${label}`); } catch (error) { process.exitCode=1; console.error(`FAIL ${label}: ${error?.stack||error}`); } }
const output = compiler.transpileModule(source,{compilerOptions:{module:compiler.ModuleKind.CommonJS,target:compiler.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
const rows = new Map([
 ['studioName', JSON.stringify('Initial')],
 ['anEmpty', JSON.stringify(null)],
 ['another', JSON.stringify('Keep me')],
]);
let transactions=0, locks=0, tail=Promise.resolve();
const appSetting={
 findMany: async ({where}={})=>[...rows].filter(([key])=>!where?.key?.in||where.key.in.includes(key)).map(([key,value])=>({key,value})),
 upsert: async ({where,update,create})=>rows.set(where.key,rows.has(where.key)?update.value:create.value),
 deleteMany: async ()=>{},
};
const prisma={appSetting,contextPack:{findMany:async()=>[]},$transaction:async(fn,opts)=>{
 assert.equal(opts.isolationLevel,'Serializable'); transactions++;
 const run=tail.then(()=>fn({appSetting,$queryRaw:async()=>{locks++;return [{locked:1}]}}));
 tail=run.catch(()=>undefined); return run;
}};
const cryptoMock={BOOT_SECRET_SETTING_KEYS:new Set(),SENSITIVE_SETTING_KEYS:new Set(),decryptSettingStorageValue:(_k,v)=>v,encryptSettingStorageValue:(_k,v)=>v,shouldEncryptSetting:()=>false,encryptedValueNeedsRotation:()=>false};
const fsMock={readFile:async()=>{const e=new Error('ENOENT');e.code='ENOENT';throw e}};
const sandbox={module:{exports:{}},exports:{},console,process,require:(id)=>id==='node:fs/promises'?{__esModule:true,default:fsMock}:id.includes('setting-crypto')?cryptoMock:id.includes('server-config-publication-journal')?{hasPublicationJournal:async()=>false}:{}};
sandbox.exports=sandbox.module.exports;
vm.runInNewContext(output,sandbox,{filename:'studio-setting-service.cjs'});
const services=sandbox.module.exports.createSettingsIntegrationServices({
 CONFIG_FILE_PATH:'/no-file',DATA_LAYOUT:{},DATA_ROOT:'/missing',SERVER_MANAGED_SETTING_KEYS:new Set(['serverHost','discordBotToken']),
 app:{log:{error:()=>{}}},prisma,studioPermissionSettings:{}
});
await check('route requires full expected-field preconditions before patch',()=>{
 assert.match(route,/expectedSettings: z\.record\(z\.object\(/);
 assert.match(route,/STUDIO_SETTINGS_PRECONDITION_REQUIRED/);
 assert.match(route,/await patchSettings\(safeBody, expectedSettings\)/);
});
await check('route returns explicit 409 with conflicting keys',()=>{
 assert.match(route,/code\(409\)/);
 assert.match(route,/code: "STUDIO_SETTINGS_CONFLICT"/);
 assert.match(route,/conflictingKeys:/);
});
await check('editor remembers raw server values apart from defaults',()=>{
 assert.match(ui,/loadedRawSettingsRef\.current = loaded/);
 assert.match(ui,/exists: false/);
 assert.match(ui,/expectedSettings,/);
 assert.match(ui,/loadedRawSettingsRef\.current = \{ \.\.\.loadedRawSettingsRef\.current, \.\.\.changedSettings \}/);
});
await check('conflict refresh forces network truth and preserves only changed draft fields',()=>{
 assert.match(ui,/force: loadAttempt > 0, persist: false/);
 assert.match(ui,/function refreshAfterConflict\(\)/);
 assert.match(ui,/conflictDraftRef\.current = overrides/);
 assert.match(ui,/const recoveredSettings = pendingConflictDraft \|\| recoveredDraft\?\.value\?\.settings/);
 assert.match(ui,/onRetry=\{settingsConflict \? undefined : \(\) => void save\(\)\}/);
 assert.match(ui,/onReload=\{settingsConflict \? refreshAfterConflict : undefined\}/);
});
await check('matching present-value expected state is accepted',async()=>{
 await services.patchSettings({studioName:'Edited'}, {studioName:{exists:true,value:'Initial'}});
 assert.equal(JSON.parse(rows.get('studioName')),'Edited');
});
await check('stale update rejects without changing stored value',async()=>{
 await assert.rejects(services.patchSettings({studioName:'Stale'},{studioName:{exists:true,value:'Initial'}}),e=>e.code==='STUDIO_SETTINGS_CONFLICT'&&e.conflictingKeys.includes('studioName'));
 assert.equal(JSON.parse(rows.get('studioName')),'Edited');
});
await check('two simultaneous editors cannot overwrite same setting',async()=>{
 const expected={studioName:{exists:true,value:'Edited'}};
 const settled=await Promise.allSettled([services.patchSettings({studioName:'Alice'},expected),services.patchSettings({studioName:'Bob'},expected)]);
 assert.equal(settled.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(settled.filter(x=>x.status==='rejected'&&x.reason?.code==='STUDIO_SETTINGS_CONFLICT').length,1);
 assert.ok(['Alice','Bob'].includes(JSON.parse(rows.get('studioName'))));
});
await check('unrelated edits remain independent',async()=>{
 await services.patchSettings({another:'Still safe'},{another:{exists:true,value:'Keep me'}});
 assert.equal(JSON.parse(rows.get('another')),'Still safe');
});
await check('missing and stored null are distinct states',async()=>{
 await assert.rejects(services.patchSettings({anEmpty:'x'},{anEmpty:{exists:false}}),e=>e.code==='STUDIO_SETTINGS_CONFLICT');
 await services.patchSettings({anEmpty:'now exists'},{anEmpty:{exists:true,value:null}});
 await services.patchSettings({newKey:'first'},{newKey:{exists:false}});
 await assert.rejects(services.patchSettings({newKey:'second'},{newKey:{exists:false}}),e=>e.code==='STUDIO_SETTINGS_CONFLICT');
});
await check('bad expected-key sets and malformed expectations are rejected',async()=>{
 await assert.rejects(services.patchSettings({studioName:'bad'},{}),/every selected field/);
 await assert.rejects(services.patchSettings({studioName:'bad'},{studioName:{exists:true}}),/must declare/);
 await assert.rejects(services.patchSettings({studioName:'bad'},{studioName:{exists:false},another:{exists:false}}),/every selected field/);
});
await check('unconditional existing tool writers remain supported',async()=>{
 await services.patchSettings({another:'Tool settings writer'});
 assert.equal(JSON.parse(rows.get('another')),'Tool settings writer');
 assert.ok(transactions>=10&&locks>=10);
});
console.log(`${passed}/11 v0.506 same-field conflict assertions passed.`);
