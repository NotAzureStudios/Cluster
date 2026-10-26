import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript', 'lib', 'typescript.js')); } })();
const svcSource = fs.readFileSync('apps/server/src/app/server-services-settings-integrations.ts', 'utf8');
const routeSource = fs.readFileSync('apps/server/src/app/server-routes-configuration-integrations.ts', 'utf8');
const guardSource = fs.readFileSync('apps/server/src/core/server-config-preconditions.ts', 'utf8');
const service = ts.transpileModule(svcSource, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true}}).outputText;
const guard = ts.transpileModule(guardSource, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
const guardContext = { module: {exports: {}}, exports: {} }; guardContext.exports = guardContext.module.exports;
vm.runInNewContext(guard, guardContext);
const checkServerConfigPreconditions = guardContext.module.exports.checkServerConfigPreconditions;

let passed = 0;
async function check(name, fn) { try { await fn(); passed++; console.log(`PASS ${name}`); } catch(e) { console.error(`FAIL ${name}: ${e?.stack || e}`); process.exitCode = 1; } }
await check('admin route rechecks field preconditions under the publication lock', () => {
  assert.match(routeSource, /await saveSettings\(merged, \{ changedFields: requestedChanges, expectedSettings \}\)/);
  assert.match(routeSource, /error\?\.code === "SERVER_CONFIG_CONFLICT"/);
  assert.match(svcSource, /const rows = await tx\.appSetting\.findMany\(\)/);
  assert.match(svcSource, /checkServerConfigPreconditions\(\s*settingsForClient\(current\)/);
  assert.match(svcSource, /next = \{ \.\.\.current, \.\.\.options\.changedFields, appDisplayName: "Cluster" \}/);
});
await check('lock order preserves Studio writers and separately serializes server publication', () => {
  const start = svcSource.indexOf('async function saveSettings(');
  const publication = svcSource.slice(start, start+4200);
  assert.ok(publication.indexOf('pg_advisory_xact_lock(506, 1)') >= 0);
  assert.ok(publication.indexOf('pg_advisory_xact_lock(506, 2)') > publication.indexOf('pg_advisory_xact_lock(506, 1)'));
  assert.ok(publication.indexOf('await persistDatabaseSettings(next, tx)') < publication.indexOf('await prepareConfigPublication(CONFIG_FILE_PATH, afterBytes)'));
  assert.ok(publication.indexOf('await prepareConfigPublication(CONFIG_FILE_PATH, afterBytes)') < publication.indexOf('await durableReplaceFile(CONFIG_FILE_PATH, afterBytes)'));
  assert.match(publication, /isolationLevel: "ReadCommitted"/);
});

// Execute the real TS service with mocked PostgreSQL transactions and file IO.
// Transactions below commit a snapshot on success and roll back on failure;
// this is a deterministic contention fixture, NOT PostgreSQL runtime certification.
let db = new Map([['studioName', JSON.stringify('unchanged')]]);
const files = new Map([['/test/cluster.config.json', JSON.stringify({version:2, secretPolicy:'server-managed-only', settings:{serverHost:'127.0.0.1', serverPort:3000}})]]);
let concurrentQueue = Promise.resolve(), transactionCount=0, lockCount=0, failNextRename=false;
const fileService = {
  readFile: async (name) => {
    if (!files.has(name)) { const error = new Error('ENOENT'); error.code = 'ENOENT'; throw error; }
    return files.get(name);
  },
  open: async (name, flags) => {
    if (flags === 'wx') {
      assert.ok(!files.has(name), 'exclusive staging is mandatory');
      return {writeFile:async (body) => { files.set(name,String(body)); },sync:async()=>{},close:async()=>{}};
    }
    return {sync:async()=>{},close:async()=>{}};
  },
  rename: async (from,to) => {
    if (failNextRename) { failNextRename=false; throw new Error('simulated file publication failure'); }
    const bytes = files.get(from); files.set(to,bytes); files.delete(from);
  },
  chmod: async()=>{}, unlink:async(name)=>{files.delete(name)},
};
const journalSuffix = '.publication-journal.json';
let journalId = 0;
const publicationJournal = {
  SERVER_CONFIG_COMMIT_SETTING: '_internal.serverConfigPublicationId',
  serializeConfigPublication: (settings, encryptionKeyId) => JSON.stringify({version:2, secretPolicy:'server-managed-only', settings, encryptionKeyId}),
  hasPublicationJournal: async config => files.has(config+journalSuffix),
  prepareConfigPublication: async (config, after) => {
    assert.ok(!files.has(config+journalSuffix));
    const journal={id:`journal-${++journalId}`, before: files.get(config)??null, after};
    files.set(config+journalSuffix,JSON.stringify(journal));
    return journal;
  },
  durableReplaceFile: async (config, after) => {
    if(failNextRename){failNextRename=false;throw new Error('simulated file publication failure');}
    files.set(config,after);
  },
  recoverConfigPublication: async (config, committedId) => {
    const raw=files.get(config+journalSuffix);
    if(!raw) return 'none';
    const journal=JSON.parse(raw);
    assert.ok(files.get(config)===journal.before || files.get(config)===journal.after);
    if(committedId===journal.id){files.set(config,journal.after)}
    else if(journal.before===null){files.delete(config)}
    else {files.set(config,journal.before)}
    files.delete(config+journalSuffix);
    return committedId===journal.id?'committed':'rolled_back';
  }
};
const crypto = {
  BOOT_SECRET_SETTING_KEYS:new Set(),SENSITIVE_SETTING_KEYS:new Set(),
  decryptSettingStorageValue:(_k,v)=>v,encryptSettingStorageValue:(_k,v)=>v,
  shouldEncryptSetting:()=>false,encryptedValueNeedsRotation:()=>false,
  encryptionKeyId:()=>null, encryptionKeyConfigured:()=>false,
  previousEncryptionKeyIds:()=>[],
};
const sandbox = {module:{exports:{}},exports:{},console,process,require:(id)=> {
  if(id==='node:fs/promises')return {__esModule:true,default:fileService};
  if(id==='node:path')return {__esModule:true,default:path};
  if(id==='node:crypto')return {randomUUID:()=>`${Math.random()}`};
  if(id.includes('server-config-preconditions'))return {checkServerConfigPreconditions};
  if(id.includes('server-config-publication-journal'))return publicationJournal;
  if(id.includes('data-layout'))return {ensureClusterDataLayout:async()=>{}};
  if(id.includes('database-provider'))return {databaseProviderFromUrl:()=> 'postgresql',redactDatabaseUrl:()=>''};
  if(id.includes('setting-crypto'))return crypto;
  if(id.includes('secret-store'))return {describeSecret:()=>({fingerprint:null})};
  return {};
}};sandbox.exports=sandbox.module.exports;
vm.runInNewContext(service,sandbox,{filename:'server-settings-integration.cjs'});
const store = {
  $transaction: async (fn,{isolationLevel})=>{
    assert.equal(isolationLevel,'ReadCommitted'); transactionCount++;
    const run = concurrentQueue.then(async()=> {
      const copy = new Map(db);
      const api = {
        $queryRaw:async()=>{lockCount++;return [{locked:1}]},
        appSetting: {
          findMany:async({where}={})=>[...copy].filter(([key])=>!where?.key || key===where.key || (where.key.in&&where.key.in.includes(key))).map(([key,value])=>({key,value})),
          upsert:async({where,update,create})=>{copy.set(where.key,copy.has(where.key)?update.value:create.value)},
          deleteMany:async({where})=>{for(const k of where.key.in)copy.delete(k)},
        },
      };
      const result=await fn(api); db=copy; return result;
    });
    concurrentQueue = run.catch(()=>{});
    return run;
  },
};
const mkService = () => sandbox.module.exports.createSettingsIntegrationServices({
  CONFIG_FILE_PATH:'/test/cluster.config.json',DATA_LAYOUT:{storage:{domains:{}}},DATA_ROOT:'/test',
  SERVER_MANAGED_SETTING_KEYS:new Set(['serverHost','serverPort','databaseUrlOverride','redisUrlOverride']),
  MASKED_SECRET:'********',SERVER_MANAGED_ONLY:true,
  app:{log:{error:()=>{},warn:()=>{},info:()=>{}}},prisma:store,studioPermissionSettings:{},
});
const a = mkService(), b = mkService();
function projectedFile(){return JSON.parse(files.get('/test/cluster.config.json')).settings;}
function editor(changes, originals){return {changedFields:changes, expectedSettings:Object.fromEntries(Object.entries(originals).map(([k,v])=>[k,{exists:true,value:v}]))};}
await check('two simulated processes do not overwrite a same-field update', async () => {
  const original=projectedFile();
  const results=await Promise.allSettled([
    a.saveSettings({serverHost:'192.168.0.1'},editor({serverHost:'192.168.0.1'},{serverHost:original.serverHost})),
    b.saveSettings({serverHost:'192.168.0.2'},editor({serverHost:'192.168.0.2'},{serverHost:original.serverHost})),
  ]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(results.filter(x=>x.status==='rejected'&&x.reason.code==='SERVER_CONFIG_CONFLICT').length,1);
  assert.ok(['192.168.0.1','192.168.0.2'].includes(projectedFile().serverHost));
  assert.equal(projectedFile().serverPort,3000);
  assert.equal(JSON.parse(db.get('studioName')),'unchanged');
});
await check('independent edits merge against the freshest file state', async()=>{
  const before=projectedFile();
  await Promise.all([
    a.saveSettings({serverPort:4000},editor({serverPort:4000},{serverPort:before.serverPort})),
    b.saveSettings({serverHost:'0.0.0.0'},editor({serverHost:'0.0.0.0'},{serverHost:before.serverHost})),
  ]);
  assert.equal(projectedFile().serverPort,4000);
  assert.equal(projectedFile().serverHost,'0.0.0.0');
});
await check('failed file publication rolls back in-flight database settings', async()=>{
  const snapshot=new Map(db);const oldFile=files.get('/test/cluster.config.json');
  failNextRename=true;
  await assert.rejects(a.saveSettings({studioName:'bad',serverHost:'bad'},editor({studioName:'bad',serverHost:'bad'}, {studioName:'unchanged',serverHost:'0.0.0.0'})),/simulated file publication failure/);
  assert.deepEqual([...db],[...snapshot]);
  assert.equal(files.get('/test/cluster.config.json'),oldFile);
});
await check('masked credentials never replace a configured server secret', async()=>{
  const previous=JSON.parse(files.get('/test/cluster.config.json'));
  previous.settings.databaseUrlOverride='postgresql://private-configured-value';
  files.set('/test/cluster.config.json',JSON.stringify(previous));
  await a.saveSettings({},editor({databaseUrlOverride:'********'}, {databaseUrlOverride:'********'}));
  assert.equal(projectedFile().databaseUrlOverride,'postgresql://private-configured-value');
});
await check('committed results update both database and file on success', async()=>{
  await b.saveSettings({},editor({studioName:'good',serverPort:5555},{studioName:'unchanged',serverPort:4000}));
  assert.equal(JSON.parse(db.get('studioName')),'good');
  assert.equal(projectedFile().serverPort,5555);
  assert.equal(projectedFile().serverHost,'0.0.0.0');
  assert.ok(lockCount >= transactionCount*2);
});
console.log(`${passed}/7 server publication lock assertions passed`);
if(passed!==7)process.exitCode=1;
