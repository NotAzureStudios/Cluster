import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = file => fs.readFileSync(path.join(root,file),'utf8');
const validator = new Proxy({}, {get(_target,name) { if(name === 'parse') return input => input; return () => validator; }});
const z = new Proxy({}, {get: () => () => validator});
const src = read('apps/server/src/domains/users/user-preference-routes.ts');
const compiled=ts.transpileModule(src,{fileName:'user-preference-routes.ts',reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
assert.equal(compiled.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
const imports = {
  zod:{z}, 'node:crypto':require('node:crypto'), '@cluster/shared':{CLUSTER_CREATE_MODE_IDS:[]},
  '../../core/policy-acceptance.js':{policyAcceptanceStatus:async()=>null},
  './people-profile-contract.js':{}, './people-governance.js':{},
  '../../core/security-verification.js':{}, '../workforce/workforce-normalization.js':{},
  '../../core/security-pin-credential.js':{},
};
const module={exports:{}};
vm.runInNewContext(compiled.outputText,{module,exports:module.exports,console,require:id=>{
  if(Object.hasOwn(imports,id))return imports[id];
  throw new Error(`Unhandled import ${id}`);
}}, {filename:'user-preference-routes.ts'});
function fixture() {
  let row={id:'u-1',preferences:JSON.stringify({userCalendarDefaultView:'week',userShowHelpText:false}),personalAccentColor:'#57c1ff'};
  let currentSessionUser={...row}; // intentionally stale across other writes
  let deferredUpdate=null;
  const routes=new Map();
  const app=Object.fromEntries(['get','patch','post','put','delete'].map(method=>[method,(route,handler)=>routes.set(`${method.toUpperCase()} ${route}`,handler)]));
  const prisma={user:{
    async findUnique({where}) {return where.id===row?.id?{...row}:null;},
    async updateMany({where,data}) {
      if(deferredUpdate)await deferredUpdate();
      if(where.id!==row?.id || where.preferences!==row.preferences || where.personalAccentColor!==row.personalAccentColor)return {count:0};
      row={...row,...data};return {count:1};
    },
  },$transaction:async run=>run(prisma)};
  module.exports.registerUserPreferenceRoutes({app,prisma,
    getCurrentUser:async()=>currentSessionUser,
    decorateUserForClient:async user=>({...user}),
    normalizePersonalAccent:value=>value, verifyPassword:async()=>true,hashPassword:async()=>'',verifyUserPin:async()=>true,
    logSecurityEvent:async()=>{},readSettings:async()=>({}),
  });
  async function request(method,route,body) {
    const reply={status:200,code(status){this.status=status;return this;},send(result){this.response=result;return result;}};
    const result=await routes.get(`${method} ${route}`)({body},reply);
    return {status:reply.status,data:result ?? reply.response};
  }
  const get=()=>request('GET','/api/me/preferences');
  const patch=body=>request('PATCH','/api/me/preferences',body);
  return {get,patch,raw:()=>({...row}),externalUpdate:change=>{row={...row,...change};},setRace:fn=>{deferredUpdate=fn;},resetRace:()=>{deferredUpdate=null;}};
}
let passed=0;
async function check(label,fn){await fn();console.log('PASS',label);passed++;}
await check('GET returns a 64-character DB-truth revision and fresh preferences despite stale session',async()=>{
  const f=fixture();const first=await f.get();
  assert.match(first.data.fingerprint,/^[a-f0-9]{64}$/);
  f.externalUpdate({preferences:'{"userCalendarDefaultView":"day"}'});
  const second=await f.get();
  assert.notEqual(second.data.fingerprint,first.data.fingerprint);
  assert.equal(second.data.preferences.userCalendarDefaultView,'day');
});
await check('a stale Account Settings editor cannot overwrite an intervening edit made after load',async()=>{
  const f=fixture();const old=(await f.get()).data.fingerprint;
  assert.equal((await f.patch({preferences:{userCalendarDefaultView:'month'}})).status,200);
  const stale=await f.patch({expectedFingerprint:old,preferences:{userCalendarDefaultView:'agenda'}});
  assert.equal(stale.status,409);assert.equal(stale.data.code,'USER_PREFERENCES_CONFLICT');
  assert.equal(JSON.parse(f.raw().preferences).userCalendarDefaultView,'month');
});
await check('successful save returns a new revision usable for a second save',async()=>{
  const f=fixture(); const old=(await f.get()).data.fingerprint;
  const first=await f.patch({expectedFingerprint:old,preferences:{userShowHelpText:true}});
  assert.equal(first.status,200);assert.notEqual(first.data.fingerprint,old);
  const second=await f.patch({expectedFingerprint:first.data.fingerprint,preferences:{userCalendarDefaultView:'day'}});
  assert.equal(second.status,200);
});
await check('concurrent writes remain protected after correct read version',async()=>{
  const f=fixture();const version=(await f.get()).data.fingerprint;
  const responses=await Promise.all([
    f.patch({expectedFingerprint:version,preferences:{userShowHelpText:true}}),
    f.patch({expectedFingerprint:version,preferences:{userCalendarDefaultView:'month'}}),
  ]);
  assert.equal(responses.filter(x=>x.status===200).length,1);
  assert.equal(responses.filter(x=>x.status===409).length,1);
});
await check('accent-only changes invalidate stale editor revision',async()=>{
  const f=fixture();const version=(await f.get()).data.fingerprint;
  f.externalUpdate({personalAccentColor:'#000000'});
  assert.equal((await f.patch({expectedFingerprint:version,preferences:{userShowHelpText:true}})).status,409);
});
await check('accent-only race after fresh read cannot overwrite a newer accent',async()=>{
  const f=fixture();const version=(await f.get()).data.fingerprint;
  f.setRace(async()=>{f.resetRace();f.externalUpdate({personalAccentColor:'#091827'});});
  const result=await f.patch({expectedFingerprint:version,personalAccentColor:'#fefefe',preferences:{userShowHelpText:true}});
  assert.equal(result.status,409);
  assert.equal(f.raw().personalAccentColor,'#091827');
  assert.equal(JSON.parse(f.raw().preferences).userShowHelpText,false);
});
await check('small accent-only client also respects commit-time compare-and-swap',async()=>{
  const f=fixture();
  f.setRace(async()=>{f.resetRace();f.externalUpdate({personalAccentColor:'#010203'});});
  const result=await f.patch({personalAccentColor:'#123456'});
  assert.equal(result.status,409);
  assert.equal(f.raw().personalAccentColor,'#010203');
});
await check('small PATCH clients can safely change individual preferences without full-form revision',async()=>{
  const f=fixture();const result=await f.patch({preferences:{userShowHelpText:true}});
  assert.equal(result.status,200);
  assert.equal(JSON.parse(f.raw().preferences).userCalendarDefaultView,'week');
});
await check('database CAS rejects an in-flight concurrent write',async()=>{
  const f=fixture();const version=(await f.get()).data.fingerprint;
  f.setRace(async()=>{f.resetRace();f.externalUpdate({preferences:'{"userCalendarDefaultView":"agenda"}'});});
  const result=await f.patch({expectedFingerprint:version,preferences:{userCalendarDefaultView:'day'}});
  assert.equal(result.status,409);assert.equal(JSON.parse(f.raw().preferences).userCalendarDefaultView,'agenda');
});
await check('Account Settings passes original read fingerprint, refreshes after save and preserves draft on failure',async()=>{
  const ui=read('packages/renderer/src/features/settings/AccountSettingsPage.tsx');
  assert(ui.includes('preferencesFingerprintRef.current = preferenceResult.fingerprint'));
  assert(ui.includes('expectedFingerprint: preferencesFingerprintRef.current'));
  assert(ui.includes('if (!preferenceMutation.queued) preferencesFingerprintRef.current = preferenceResult.fingerprint'));
  assert(ui.includes('force: true, signal: controller.signal'));
  const beforeCatch=ui.slice(ui.indexOf('async function save()'),ui.indexOf('async function checkDesktopServer'));
  assert(beforeCatch.indexOf('await clearOfflineDraft(accountDraftKey)') < beforeCatch.indexOf('} catch (error)'));
  assert(!beforeCatch.slice(beforeCatch.indexOf('} catch (error)')).includes('clearOfflineDraft'));
});
console.log(`${passed}/${passed} TD1 Account Settings read-version checks passed`);
