import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['root', '-g'], {encoding:'utf8'}).trim(), 'typescript', 'lib', 'typescript.js')); } })();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
function loadTs(file, imports = {}) {
  const compiled = ts.transpileModule(read(file), { fileName: file, reportDiagnostics: true, compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true} });
  const errors = (compiled.diagnostics||[]).filter((d)=>d.category===ts.DiagnosticCategory.Error);
  assert.equal(errors.length,0,`${file}: ${errors.map((d)=>ts.flattenDiagnosticMessageText(d.messageText,' '))}`);
  const module={exports:{}}; vm.runInNewContext(compiled.outputText,{module,exports:module.exports,console,require:(id)=>{if (Object.hasOwn(imports,id)) return imports[id];throw new Error('Unexpected dependency '+id);}}, {filename:file});
  return module.exports;
}
let passed=0;
async function check(name,run){await run(); console.log('PASS '+name);passed++;}
const contracts=loadTs('packages/shared/src/tool-settings-contract.ts');
const {CLUSTER_TOOL_SETTING_KEYS,clusterToolSettingKeys,clusterToolSettingsPatch}=contracts;
const toolRoutes=read('apps/server/src/domains/admin/admin-tool-routes.ts');
const ui=read('packages/renderer/src/features/admin/AdminToolControls.tsx');
const teamRoutes=read('apps/server/src/domains/users/team-routes.ts');
const server=read('apps/server/src/app/cluster-server.ts');
const serviceSource=read('apps/server/src/app/server-services-settings-integrations.ts');
await check('one shared map covers the six manifest-declared configurable tools',()=>{
  const manifest=read('packages/shared/src/cluster-manifest.ts');
  const ids=[...manifest.matchAll(/^\s{2}(\w+):\s*\{[^\n]*adminConfigurable:\s*true/gm)].map(m=>m[1]).sort();
  assert.deepEqual(Object.keys(CLUSTER_TOOL_SETTING_KEYS).sort(),ids);
  for (const tool of ids) {
    const mapping=CLUSTER_TOOL_SETTING_KEYS[tool];
    assert(Object.keys(mapping).length>0);
    assert.equal(new Set(Object.values(mapping)).size,Object.keys(mapping).length,`Storage alias collision in ${tool}`);
    assert.equal(JSON.stringify(clusterToolSettingKeys(tool)),JSON.stringify([...new Set(Object.values(mapping))]));
  }
});
await check('unknown fields cannot fabricate persisted setting identities',()=>{
  const data=clusterToolSettingsPatch('scheduler',{enabled:false,timezone:'UTC',madeUpSetting:'danger'});
  assert.equal(data.schedulerEnabled,false);
  assert.equal(data.studioTimezone,'UTC');
  assert.equal(Object.hasOwn(data,'madeUpSetting'),false);
  assert.equal(clusterToolSettingsPatch('library',{sensitiveOfflineCachePolicy:'protected'}).librarySensitiveOfflineCachePolicy,'protected');
});
await check('server and renderer consume the same field map',()=>{
  assert.match(toolRoutes,/CLUSTER_TOOL_SETTING_KEYS\[tool\]/);
  assert.doesNotMatch(toolRoutes,/const prefixes: Record<AdminToolKey/);
  assert.match(read('packages/renderer/src/features/application/modules/tool-config-settings.ts'),/canonicalToolSettingsPatch/);
  assert.doesNotMatch(read('packages/renderer/src/features/application/modules/application-admin-workspaces.tsx'),/export function toolConfigSettingsPatch/);
});
await check('server validates full config but writes only CAS-selected fields',()=>{
  assert.match(toolRoutes,/expectedSettings: z\.record/);
  assert.match(toolRoutes,/Object\.prototype\.hasOwnProperty\.call\(expected, settingKey\)/);
  assert.match(toolRoutes,/await patchSettings\(patch, expected\)/);
  assert.match(toolRoutes,/TOOL_CONFIG_PRECONDITION_INVALID/);
  assert.match(toolRoutes,/TOOL_CONFIG_CONFLICT/);
  assert.match(toolRoutes,/code\(409\)/);
  assert.match(toolRoutes,/CLUSTER_TOOL_CONFIG_FIELDS\[tool\]/);
  assert.equal(JSON.stringify(contracts.CLUSTER_TOOL_CONFIG_FIELDS.library.sensitiveOfflineCachePolicy), JSON.stringify({ kind: 'enum', values: ['disabled','protected'] }));
});
await check('tool snapshot baselines come from DB truth and effective view is reconciled',()=>{
  assert.match(toolRoutes,/async function readToolConfigSnapshot/);
  assert.match(toolRoutes,/await readSettingPreconditions\(clusterToolSettingKeys\(tool\)\)/);
  assert.match(toolRoutes,/if \(entry\.exists\) authoritative\[key\] = entry\.value/);
  assert.match(toolRoutes,/expectedSettings: null/);
});
await check('editor keeps drafts and changes only touched keys',()=>{
  assert.match(ui,/function editedToolSettings\(/);
  assert.match(ui,/JSON\.stringify\(value\) === JSON\.stringify\(original\[field\]\)/);
  assert.match(ui,/body: JSON\.stringify\(\{ config: draft, expectedSettings, acknowledgeStudioChanges: studioChanges\.length > 0 \}\)/);
  assert.match(ui,/body: JSON\.stringify\(\{ config: nextConfig, expectedSettings \}\)/);
  assert.match(ui,/setDraft\(\(current\) => \(\{ \.\.\.current, enabled: result\.config\.enabled \}\)\)/);
});
await check('People profile definitions also require CAS and return useful conflicts',()=>{
  assert.match(teamRoutes,/app\.get\("\/api\/team\/profile-fields"/);
  assert.match(teamRoutes,/app\.put\("\/api\/team\/profile-fields"/);
  assert.match(teamRoutes,/await patchSettings\(\{ studioPeopleProfileFields: body\.fields \}, body\.expectedSettings\)/);
  assert.match(teamRoutes,/PROFILE_FIELDS_CONFLICT/);
  assert.match(teamRoutes,/private, no-store/);
  assert.match(server,/patchSettings, readSettingPreconditions \}\);/);
});
const rows=new Map([['known',JSON.stringify('original')],['storedNull',JSON.stringify(null)]]);
const appSetting={findMany:async({where}={})=>[...rows].filter(([key])=>!where?.key?.in||where.key.in.includes(key)).map(([key,value])=>({key,value})),upsert:async({where,create,update})=>rows.set(where.key,rows.has(where.key)?update.value:create.value)};
let tail=Promise.resolve();
const prisma={appSetting,$transaction:async(fn)=>{const run=tail.then(()=>fn({appSetting,$queryRaw:async()=>[{locked:1}]}));tail=run.catch(()=>undefined);return run;}};
const crypto={BOOT_SECRET_SETTING_KEYS:new Set(),SENSITIVE_SETTING_KEYS:new Set(),decryptSettingStorageValue:(_k,v)=>v,encryptSettingStorageValue:(_k,v)=>v,shouldEncryptSetting:()=>false,encryptedValueNeedsRotation:()=>false};
const module={exports:{}};
vm.runInNewContext(ts.transpileModule(serviceSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{module,exports:module.exports,console,process,require:(id)=>id==='node:fs/promises'?{__esModule:true,default:{readFile:async()=>{const e=new Error('ENOENT');e.code='ENOENT';throw e;}}}:id.includes('setting-crypto')?crypto:id.includes('server-config-publication-journal')?{hasPublicationJournal:async()=>false}:{}}, {filename:'server-services-settings-integrations.ts'});
const services=module.exports.createSettingsIntegrationServices({ CONFIG_FILE_PATH:'/missing',DATA_LAYOUT:{},DATA_ROOT:'/missing',SERVER_MANAGED_SETTING_KEYS:new Set(['serverHost']),app:{log:{error:()=>{}}},prisma,studioPermissionSettings:{} });
await check('database preconditions preserve absent versus null versus present',async()=>{
  const actual=await services.readSettingPreconditions(['known','storedNull','notYet']);
  assert.equal(actual.known.exists,true);assert.equal(actual.known.value,'original');
  assert.equal(actual.storedNull.exists,true);assert.equal(actual.storedNull.value,null);
  assert.equal(actual.notYet.exists,false);assert.equal(Object.hasOwn(actual.notYet,'value'),false);
});
await check('stale same-key settings edit conflicts; independent writes succeed',async()=>{
  const baseline=await services.readSettingPreconditions(['known','notYet']);
  await services.patchSettings({known:'admin A'}, {known:baseline.known});
  await assert.rejects(services.patchSettings({known:'admin B'},{known:baseline.known}),e=>e.code==='STUDIO_SETTINGS_CONFLICT');
  await services.patchSettings({notYet:'created separately'},{notYet:baseline.notYet});
  assert.equal(JSON.parse(rows.get('known')),'admin A');
  assert.equal(JSON.parse(rows.get('notYet')),'created separately');
});
console.log(`${passed}/${passed} Cluster TD1 Settings Authority tests passed.`);
