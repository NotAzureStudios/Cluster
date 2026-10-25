import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';

const root = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
let ts;
try { ts = require('typescript'); } catch {
  const binary = execFileSync('which', ['tsc'], {encoding:'utf8'}).trim();
  ts = require(resolve(join(binary, '..', '..', 'lib', 'typescript.js')));
}
const source = (p) => readFileSync(join(root,p),'utf8');
function load(file, imports={}) {
  const js=ts.transpileModule(source(file),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  vm.runInNewContext(js,{module,exports:module.exports,require:(name)=>Object.hasOwn(imports,name)? imports[name]:require(name),
    Intl,Date,Promise,Error,Set,Map,Object,Array,String,Boolean,Number,JSON,console,Buffer}, {filename:file});
  return module.exports;
}
const config=load('apps/server/src/core/setup-configuration.ts');
let passed=0;
async function test(name,fn){await fn();console.log(`PASS ${name}`);passed++;}
const revision=[{key:'studioName',before:null,after:'Fresh Studio'}, {key:'defaultCreateStarterBoard',before:false,after:true}];
await test('validates exact safe revision fields including an originally absent value',()=>{
  const parsed=config.parseSafeConfigurationRevisionChanges(revision);
  assert.equal(parsed.length,2);assert.equal(parsed[0].before,null);
  const planned=config.planSafeConfigurationRollback(revision,{studioName:'Fresh Studio',defaultCreateStarterBoard:true});
  assert.equal(planned.conflictingKeys.length,0);
  assert.equal(planned.changes[0].after,null);
  assert.equal(planned.changes[1].after,false);
});
await test('rejects duplicated keys, unknown keys and suspicious revision contents',()=>{
  for(const value of [[], [...revision, revision[0]], [{key:'discordBotToken',before:null,after:'SECRET'}], [{key:'studioName',before:null,after:'x', credential:'injected'}], [{key:'studioTimezone',before:null,after:'Not/A/Timezone'}], [{key:'defaultCreateStarterBoard',before:null,after:'true'}], [{key:'studioName',before:'A',after:'A'}]]) {
    assert.throws(()=>config.parseSafeConfigurationRevisionChanges(value));
  }
});
await test('explicit stored null is not mistaken for an absent original override',()=>{
  const entry=[{key:'studioName',before:'Fresh Studio',after:null}];
  assert.equal(config.planSafeConfigurationRollback(entry,{}).conflictingKeys.length,0);
  assert.equal(config.planSafeConfigurationRollback(entry,{studioName:null}).conflictingKeys.length,1);
});
await test('detects later configuration edits instead of silently overwriting them',()=>{
  const plan=config.planSafeConfigurationRollback(revision,{studioName:'Changed later',defaultCreateStarterBoard:true});
  assert.equal(JSON.stringify(plan.conflictingKeys),JSON.stringify(['studioName']));
  assert.equal(plan.changes.length,1);
});

// Execute actual Fastify registration handlers with a small transactional,
// all-or-nothing DB stub. No real PostgreSQL or generated Prisma is claimed.
const schema=new Proxy({}, {get(_t,key){if(key==='parse')return value=>value;return ()=>schema;}});
const z=new Proxy({}, {get(){return ()=>schema;}});
const {registerSetupRoutes}=load('apps/server/src/app/server-routes-setup.ts',{
  zod:{z},'../core/auth.js':{}, '../core/security.js':{isLoopbackAddress:()=>true},
  '../core/instance-setup.js':{inspectInstanceSetup:async()=>({setupRequired:false})},
  '../core/setup-configuration.js':config,
  '../core/security-audit-store.js':{appendSecurityAuditEvent:async (_tx, event)=>{if(forceAuditFailure)throw new Error('DB_AUDIT_FAILED');audits.push(event);}},
  '../core/setup-guidance.js':{ownerSecurityReadiness:()=>({passkeysReady:true,recoveryReady:true,ownerCount:1,missingPasskeys:0,missingRecovery:0}), SETUP_GUIDES:{}},
});
const handlers=new Map();
let authorized=true, forceWriteFailure=false, forceAuditFailure=false, refreshes=0, audits=[];
const initial=new Map([['studioName','Fresh Studio'],['defaultCreateStarterBoard',true],['studioTimezone','UTC'],['discordBotToken','DO_NOT_TOUCH']]);
let values=new Map(initial), revisions=new Map([['rev-old',{id:'rev-old',requestedJson:JSON.stringify({studioName:'Fresh Studio',defaultCreateStarterBoard:true}),changesJson:JSON.stringify(revision),createdAt:new Date()}]]);
let next=0;
function models(settings,history){return {
  appSetting:{
    findMany:async ({where})=>[...settings].filter(([key])=>where.key.in.includes(key)).map(([key,value])=>({key,value:JSON.stringify(value)})),
    upsert:async ({where,create,update})=>{if(forceWriteFailure)throw new Error('DB_WRITE_FAILED');settings.set(where.key,JSON.parse((settings.has(where.key)?update:create).value));},
    deleteMany:async ({where})=>{if(forceWriteFailure)throw new Error('DB_WRITE_FAILED');settings.delete(where.key);},
  },
  studioConfigurationRevision:{
    findUnique:async ({where})=>history.get(where.id)??null,
    findMany:async ()=>[...history.values()].map(r=>({...r,actorUserId:'admin'})),
    create:async ({data})=>{const id=`rev-new-${++next}`;history.set(id,{id,...data,createdAt:new Date()});return {id};},
  },
  $queryRaw:async()=>[{locked:1}],
}};
const prisma={...models(values,revisions),$transaction:async(callback)=>{
  const txValues=new Map(values),txRevisions=new Map(revisions);
  const result=await callback(models(txValues,txRevisions));
  values=txValues;revisions=txRevisions;Object.assign(prisma,models(values,revisions));
  return result;
}};
registerSetupRoutes({
  app:{get:(path,fn)=>handlers.set('GET '+path,fn),post:(path,fn)=>handlers.set('POST '+path,fn),patch:(path,fn)=>handlers.set('PATCH '+path,fn)},
  prisma,readSettings:async(force)=>{if(force)refreshes++;const resolved=Object.fromEntries(values);if(!Object.hasOwn(resolved,'studioName'))resolved.studioName='Cluster Default';return resolved;},
  requireAdminUserForRequest:async()=>authorized?{id:'admin'}:null,
  logSecurityEvent:async(e)=>audits.push(e),getSetupStatus:async()=>({}),
});
const preview=handlers.get('POST /api/admin/setup/configuration/revisions/:revisionId/rollback/preview');
const apply=handlers.get('POST /api/admin/setup/configuration/revisions/:revisionId/rollback/apply');
const historyEndpoint=handlers.get('GET /api/admin/setup/configuration/revisions');
assert.ok(preview && apply);
function response(){return {status:200,headers:{},code(n){this.status=n;return this;},header(k,v){this.headers[k]=v;return this;},send(v){return v;}};}
const params={revisionId:'rev-old'};
let previousPreview; let rollbackRevisionId;
await test('unprivileged callers cannot preview or execute rollback',async()=>{
  authorized=false;
  assert.equal(await preview({params,body:{}},response()),undefined);
  assert.equal(await apply({params,body:{previewId:'f',reason:'required explanation'}},response()),undefined);
  authorized=true;
});
await test('admin receives no-store rollback diff without exposing unrelated settings',async()=>{
  const reply=response();previousPreview=await preview({params,body:{}},reply);
  assert.equal(reply.headers['Cache-Control'],'no-store');
  assert.equal(previousPreview.changes.length,2);
  assert.match(previousPreview.previewId,/^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(previousPreview).includes('DO_NOT_TOUCH'),false);
});
await test('a stale reviewed rollback cannot overwrite an intervening edit',async()=>{
  values.set('studioName','Updated by another admin');
  const rejectResponse=response();const failure=await apply({params,body:{previewId:previousPreview.previewId,reason:'restore outdated defaults'}},rejectResponse);
  assert.equal(rejectResponse.status,409);assert.equal(failure.code,'CONFIGURATION_ROLLBACK_STALE');
  assert.equal(values.get('studioName'),'Updated by another admin');
  values.set('studioName','Fresh Studio');
});
await test('unknown revision returns 404 and tampered historical changes fail closed',async()=>{
  const out=response();const absent=await preview({params:{revisionId:'missing'},body:{}},out);
  assert.equal(out.status,404);assert.equal(absent.ok,false);
  revisions.set('bad',{id:'bad',requestedJson:'{}',createdAt:new Date(),changesJson:JSON.stringify([{key:'serverJwtSecret',before:null,after:'PRIVATE'}])});
  const fail=response();const invalid=await preview({params:{revisionId:'bad'},body:{}},fail);
  assert.equal(fail.status,409);assert.equal(invalid.code,'CONFIGURATION_REVISION_INVALID');
});
await test('database failure rolls back every field and creates no history entry',async()=>{
  forceWriteFailure=true;const originalCount=revisions.size;
  await assert.rejects(()=>apply({params,body:{previewId:previousPreview.previewId,reason:'revert full original config'}},response()),/DB_WRITE_FAILED/);
  forceWriteFailure=false;
  assert.equal(values.get('studioName'),'Fresh Studio');assert.equal(values.get('defaultCreateStarterBoard'),true);
  assert.equal(revisions.size,originalCount);
});
await test('failed security-audit append rolls back settings and new revision together',async()=>{
  forceAuditFailure=true;const before=revisions.size;
  await assert.rejects(()=>apply({params,body:{previewId:previousPreview.previewId,reason:'revert settings with audit'}},response()),/DB_AUDIT_FAILED/);
  forceAuditFailure=false;
  assert.equal(values.get('studioName'),'Fresh Studio');assert.equal(values.get('defaultCreateStarterBoard'),true);
  assert.equal(revisions.size,before);
});
await test('rollback deletes previously absent override and commits all fields with revision and audit',async()=>{
  const result=await apply({params,body:{previewId:previousPreview.previewId,reason:'restore initial studio defaults'}},response());
  assert.equal(result.ok,true);assert.equal(result.applied,2); rollbackRevisionId=result.revisionId;
  assert.equal(values.has('studioName'),false);assert.equal(values.get('defaultCreateStarterBoard'),false);
  assert.equal(values.get('studioTimezone'),'UTC');assert.equal(values.get('discordBotToken'),'DO_NOT_TOUCH');
  assert.equal(revisions.size,3);assert.equal(audits.at(-1).event,'instance.configuration_rolled_back');
  assert.equal(audits.at(-1).metadata.reason,'restore initial studio defaults');
  assert.equal(refreshes>0,true);
  const row=revisions.get(result.revisionId);
  assert.equal(JSON.parse(row.requestedJson).studioName,undefined);
  assert.equal(JSON.parse(row.changesJson)[0].after,null);
});
await test('rollback history remains parseable and a duplicate apply is refused',async()=>{
  const data=await historyEndpoint({},response());
  assert.ok(data.revisions.some(r=>r.requested.defaultCreateStarterBoard===false));
  const again=response();const outcome=await apply({params,body:{previewId:previousPreview.previewId,reason:'replay a stale rollback'}},again);
  assert.equal(again.status,409);assert.equal(outcome.ok,false);
});
await test('after deletion, import preview uses actual missing row not resolved default',async()=>{
  const b={format:'clusterconfig',schemaVersion:1,settings:{studioName:'Another Studio'}};
  const examined=await handlers.get('POST /api/admin/setup/configuration/preview')({body:{configuration:b}},response());
  assert.equal(examined.changes[0].before,null);
  assert.equal(examined.changes[0].after,'Another Studio');
});
await test('a rollback revision itself can be reversed through another explicit preview',async()=>{
  const rev={revisionId:rollbackRevisionId};
  const inspected=await preview({params:rev,body:{}},response());
  assert.equal(inspected.changes.length,2);
  assert.equal(inspected.changes[0].before,null);
  assert.equal(inspected.changes[0].after,'Fresh Studio');
  const reverted=await apply({params:rev,body:{previewId:inspected.previewId,reason:'restore prior studio configuration'}},response());
  assert.equal(reverted.applied,2);
  assert.equal(values.get('studioName'),'Fresh Studio');
  assert.equal(values.get('defaultCreateStarterBoard'),true);
});
await test('safe import also rolls back atomically if audit persistence fails',async()=>{
  const bundle={format:'clusterconfig',schemaVersion:1,settings:{studioName:'A completely new studio'}};
  const inspected=await handlers.get('POST /api/admin/setup/configuration/preview')({body:{configuration:bundle}},response());
  assert.equal(inspected.changes.length,1);
  const originalCount=revisions.size;
  forceAuditFailure=true;
  await assert.rejects(()=>handlers.get('POST /api/admin/setup/configuration/apply')({body:{configuration:bundle,previewId:inspected.previewId}},response()),/DB_AUDIT_FAILED/);
  forceAuditFailure=false;
  assert.equal(values.get('studioName'),'Fresh Studio');
  assert.equal(revisions.size,originalCount);
  const finished=await handlers.get('POST /api/admin/setup/configuration/apply')({body:{configuration:bundle,previewId:inspected.previewId}},response());
  assert.equal(finished.applied,1);
  assert.equal(values.get('studioName'),'A completely new studio');
  assert.equal(audits.at(-1).event,'instance.configuration_imported');
  assert.equal(JSON.stringify(audits.at(-1)).includes('DO_NOT_TOUCH'),false);
});
await test('renderer requires explicit review, reason and fresh preview before rollback',()=>{
  const ui=source('packages/renderer/src/features/admin/AdminSetupChecklist.tsx');
  assert.match(ui,/Preview rollback/);assert.match(ui,/Apply reviewed rollback/);
  assert.match(ui,/rollbackReason\.trim\(\)\.length < 12/);
  assert.match(ui,/setRollbackPreview\(null\); \/\/ Never permit replay/);
  assert.match(ui,/setRollbackPreview\(null\); setFeedback/);
});
console.log(`G27 configuration recovery: ${passed}/${passed} checks passed`);
