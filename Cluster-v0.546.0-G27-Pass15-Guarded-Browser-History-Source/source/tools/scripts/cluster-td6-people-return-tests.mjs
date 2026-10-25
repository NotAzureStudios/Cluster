import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(`${execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()}/typescript`); } })();
const root = path.resolve(import.meta.dirname, '../..');
const read = file => fs.readFileSync(path.join(root,file),'utf8');
function compile(file, imports={}) {
  const js = ts.transpileModule(read(file), { compilerOptions: {target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const mod={exports:{}};
  new Function('require','module','exports',js)((name)=>{if(name in imports)return imports[name];throw Error('Unexpected import '+name);},mod,mod.exports);
  return mod.exports;
}
const eligibility=compile('apps/server/src/domains/studio-systems/studio-return-eligibility.ts');
const {requireReturnEligible,validateReturnAccessWindow}=eligibility;
let passed=0;
async function check(label,fn) {await fn();console.log('PASS',label);passed++;}
const when=new Date('2026-10-18T19:00:00Z');
const originalCase={id:'c1',subjectUserId:'u1',status:'completed',completedAt:when,revision:3,returnedAt:null,reason:'finished work',personnelRecordId:'pold',createdAt:when};
const originalUser={id:'u1',username:'alex',displayName:'Alex',archived:true,accountState:'DISABLED',accountType:'employee',accessExpiresAt:when,passwordHash:'old-hash',pinHash:'old-pin',discordUserId:'12345',toolPermissions:'{"library":"manage"}',projectPermissions:'{"p":"manage"}',authenticationGeneration:3,verificationGeneration:4,profileRevision:10};
await check('eligible completed case accepts archived, disabled person with no competing case',()=>{assert.equal(requireReturnEligible({caseRow:originalCase,subject:originalUser,latestCompletedCaseId:'c1',activeCaseCount:0,expectedRevision:3}),true);});
for(const [label,inputs,code] of [
  ['stale revision',{expectedRevision:4},'RETURN_CASE_STALE'],
  ['already returned',{caseRow:{...originalCase,returnedAt:when}},'RETURN_ALREADY_COMPLETED'],
  ['newer completed case',{latestCompletedCaseId:'c2'},'RETURN_NOT_LATEST_CASE'],
  ['active pending offboarding',{activeCaseCount:1},'RETURN_ACTIVE_OFFBOARDING'],
  ['not disabled',{subject:{...originalUser,accountState:'ACTIVE'}},'RETURN_ACCOUNT_STATE_CHANGED'],
  ['not archived',{subject:{...originalUser,archived:false}},'RETURN_ACCOUNT_STATE_CHANGED'],
  ['privacy erased',{subject:{...originalUser,accountState:'PRIVACY_ERASED'}},'RETURN_IDENTITY_UNAVAILABLE'],
  ['unfinished case',{caseRow:{...originalCase,status:'active'}},'RETURN_CASE_NOT_COMPLETED'],
]) await check('eligibility blocks '+label,()=>{
  const input={caseRow:originalCase,subject:originalUser,latestCompletedCaseId:'c1',activeCaseCount:0,expectedRevision:3,...inputs};
  assert.throws(()=>requireReturnEligible(input),x=>x.code===code);
});
await check('external accounts require a future expiration; employees can be indefinite',()=>{
  assert.throws(()=>validateReturnAccessWindow('contractor',null,when),x=>x.code==='RETURN_EXPIRY_REQUIRED');
  assert.throws(()=>validateReturnAccessWindow('guest',new Date('2026-10-17T00:00:00Z'),when),x=>x.code==='RETURN_EXPIRY_INVALID');
  validateReturnAccessWindow('contractor',new Date('2026-12-01T00:00:00Z'),when);
  validateReturnAccessWindow('employee',null,when);
});
const zChain=()=>new Proxy({parse:v=>v},{get:(t,k)=>k in t?t[k]:()=>zChain()});
const z={object:zChain,string:zChain,enum:zChain,number:zChain,literal:zChain,coerce:{date:zChain}};
const schemas={studioOffboardingCreateSchema:zChain(),studioOffboardingEquipmentSchema:zChain(),studioOffboardingPreviewSchema:zChain(),studioOffboardingExecuteSchema:zChain(),studioOffboardingCancelSchema:zChain(),studioOffboardingReturnSchema:zChain()};
const routesModule=compile('apps/server/src/domains/studio-systems/studio-offboarding-routes.ts',{
  '@cluster/shared':schemas,'zod':{z},'./studio-offboarding-revisions.js':{requireReviewedOffboardingRevision:()=>{}},'./studio-return-eligibility.js':eligibility,
  '../inventory/offboarding-credential-settlement.js':{settleOffboardingCredentials:async()=>({})},
  '../inventory/offboarding-credential-reconciliation.js':{inspectOffboardingCredentialClosure:async()=>({})},
  '../users/studio-access-renewal-closeout.js':{closePendingAccessRenewals:async()=>({count:0})},
});
const clone=x=>structuredClone(x);
function fixture({caseRow=originalCase,user=originalUser,otherCases=[],failCreate=false,actorAllowed=true}={}) {
  let state={cases:[clone(caseRow),...clone(otherCases)],user:clone(user),records:[],mutations:[],events:[]};
  const handlers=new Map();
  const app={get:(key,h)=>handlers.set('GET '+key,h),post:(key,h)=>handlers.set('POST '+key,h),patch:(key,h)=>handlers.set('PATCH '+key,h)};
  const now=new Date();
  function db(getState,setState) {
    const mapMany=(type)=>({
      updateMany:async({where,data})=>{ getState().mutations.push([type,'updateMany']); return {count:0}; },
      deleteMany:async()=>{getState().mutations.push([type,'deleteMany']);return {count:0};},
    });
    const stateModel={
      user:{
        findUnique:async({where})=>getState().user.id===where.id?clone(getState().user):null,
        updateMany:async({where,data})=>{
          const s=getState(),u=s.user;if(u.id!==where.id||u.archived!==where.archived||u.accountState!==where.accountState)return {count:0};
          for(const [key,val] of Object.entries(data))u[key]=val&&typeof val==='object'&&'increment' in val?(u[key]||0)+val.increment:val;
          return {count:1};
        },
      },
      studioOffboardingCase:{
        findUnique:async({where})=>clone(getState().cases.find(c=>c.id===where.id)||null),
        findFirst:async({where})=>{
          const list=getState().cases.filter(c=>c.subjectUserId===where.subjectUserId&&c.status==='completed').sort((a,b)=>new Date(b.completedAt)-new Date(a.completedAt));
          return clone(list[0]||null);
        },
        count:async({where})=>getState().cases.filter(c=>c.subjectUserId===where.subjectUserId&&where.status.in.includes(c.status)).length,
        updateMany:async({where,data})=>{
          const row=getState().cases.find(c=>c.id===where.id&&c.status===where.status&&c.revision===where.revision&&c.returnedAt===where.returnedAt);
          if(!row)return {count:0};
          Object.assign(row,{...data,revision:row.revision+1});return {count:1};
        },
        update:async({where,data})=>{const row=getState().cases.find(c=>c.id===where.id);Object.assign(row,data);return clone(row);},
      },
      personnelRecord:{create:async({data})=>{if(failCreate)throw Error('DATABASE_WRITE_FAILED');const record={id:'return-record-'+(getState().records.length+1),...data};getState().records.push(record);return record;}},
      $queryRaw:async()=>[{id:getState().user.id}],
    };
    for (const type of ['session','securityVerificationGrant','deviceRegistration','authenticator','authenticatorRecoveryCode','authenticatorChallenge','discordLinkChallenge'])stateModel[type]=mapMany(type);
    return stateModel;
  }
  const database=db(()=>state,s=>{state=s});
  database.$transaction=async(fn)=>{
    const original=state;let draft=clone(state);
    try {const value=await fn(db(()=>draft,s=>{draft=s}));state=draft;return value;}catch(err){state=original;throw err;}
  };
  routesModule.registerStudioOffboardingRoutes({app,prisma:database,authorization:{requireTool:async()=>actorAllowed,requireAdmin:async()=>actorAllowed},getCurrentUser:async()=>({id:'owner-1'}),logActivity:async e=>state.events.push(e),logSecurityEvent:async e=>state.events.push(e)});
  async function request(method='GET',suffix='return-preview',body={}) {
    const route=handlers.get(`${method} /api/studio-systems/offboarding/:caseId/${suffix}`);
    assert.ok(route,'route '+method+suffix);
    const reply={status:200,body:null,code(n){this.status=n;return this;},send(body){this.body=body;return body;}};
    const result=await route({params:{caseId:caseRow.id},body,query:{}},reply);
    return {status:reply.status,body:reply.body||result};
  }
  return {request,view:()=>state};
}
await check('preview contains no secret access and discloses explicit non-restoration',async()=>{
  const f=fixture();const result=await f.request();assert.equal(result.body.expectedRevision,3);
  assert.ok(result.body.willNotRestore.includes('project_memberships'));assert.ok(!JSON.stringify(result.body).includes('old-hash'));
});
await check('atomic return preserves person ID, revokes secrets, writes confidential personnel evidence',async()=>{
  const f=fixture();const r=await f.request('POST','return',{expectedRevision:3,confirmation:'RETURN',reason:'Return for approved project',accountType:'contractor',accessExpiresAt:new Date('2026-12-01T00:00:00Z')});
  assert.equal(r.body.ok,true);assert.equal(r.body.needsPermissions,true);assert.equal(r.body.accountState,'DISABLED');
  const s=f.view();assert.equal(s.user.id,'u1');assert.equal(s.user.archived,false);assert.equal(s.user.accountState,'DISABLED');assert.equal(s.user.passwordHash,null);assert.equal(s.user.discordUserId,null);assert.equal(s.user.pinHash,null);
  assert.equal(s.user.toolPermissions,'{}');assert.equal(s.user.projectPermissions,'{}');assert.equal(s.user.authenticationGeneration,4);assert.equal(s.user.profileRevision,11);
  assert.equal(s.records.length,1);assert.equal(s.records[0].recordType,'return_to_studio');assert.equal(s.records[0].classification,'confidential');
  assert.equal(s.records[0].sourceKind,'studio_offboarding_return');assert.equal(s.cases[0].returnPersonnelRecordId,s.records[0].id);
  assert.ok(s.mutations.some(([name])=>name==='session'));assert.ok(s.mutations.some(([name])=>name==='authenticator'));
  assert.equal(s.events.length,2);
  const repeat=await f.request('POST','return',{expectedRevision:3,confirmation:'RETURN',reason:'Return for approved project',accountType:'employee',accessExpiresAt:null});
  assert.equal(repeat.status,409);assert.equal(repeat.body.code,'RETURN_ALREADY_COMPLETED');assert.equal(f.view().records.length,1);
});
await check('transaction failure rolls back user, case and return provenance together',async()=>{
  const f=fixture({failCreate:true});await assert.rejects(f.request('POST','return',{expectedRevision:3,confirmation:'RETURN',reason:'Approved work engagement',accountType:'employee',accessExpiresAt:null}),/DATABASE_WRITE_FAILED/);
  assert.equal(f.view().user.archived,true);assert.equal(f.view().cases[0].returnedAt,null);assert.equal(f.view().records.length,0);
});
await check('returning an older completed case is rejected without modifying access',async()=>{
  const f=fixture({otherCases:[{...originalCase,id:'c2',completedAt:new Date('2026-10-19T00:00:00Z')}]});const x=await f.request();assert.equal(x.status,409);assert.equal(x.body.code,'RETURN_NOT_LATEST_CASE');assert.equal(f.view().user.archived,true);
});
await check('active competing case blocks return',async()=>{
  const f=fixture({otherCases:[{...originalCase,id:'c2',status:'planned'}]});const x=await f.request();assert.equal(x.status,409);assert.equal(x.body.code,'RETURN_ACTIVE_OFFBOARDING');
});
await check('revoked People administrative authority blocks return',async()=>{
  const f=fixture({actorAllowed:false});const x=await f.request();assert.equal(x.body,undefined);assert.equal(f.view().cases[0].returnedAt,null);
});
await check('profile editor and auth endpoints no longer bypass archived identity lifecycle',()=>{
  const directory=read('apps/server/src/domains/users/user-directory-routes.ts');const admin=read('apps/server/src/domains/auth/auth-admin-routes.ts');const discord=read('apps/server/src/domains/auth/auth-discord-routes.ts');const ui=read('packages/renderer/src/features/people/PeoplePages.tsx');
  assert.ok(directory.includes('body.archived !== undefined || fresh.archived'));
  assert.ok(admin.match(/PEOPLE_LIFECYCLE_GOVERNED/g).length>=3);
  assert.ok(discord.includes('liveIdentity.archived'));
  assert.ok(!ui.includes('toggleProfileArchive'));
});
await check('return is wired through Forms-independent shared schema, reviewer UI and immutable offboarding case',()=>{
  const shared=read('packages/shared/src/studio-systems-contracts.ts');const panel=read('packages/renderer/src/features/settings/StudioOffboardingPanel.tsx');const prisma=read('apps/server/prisma/schema.prisma');
  assert.ok(shared.includes('studioOffboardingReturnSchema'));assert.ok(shared.includes('z.literal("RETURN")'));
  assert.ok(panel.includes('/return-preview'));assert.ok(panel.includes('Confirm governed return'));
  assert.ok(prisma.includes('returnedAt               DateTime?'));
});
console.log(`${passed}/${passed} TD6 F08 return-to-studio checks passed`);
