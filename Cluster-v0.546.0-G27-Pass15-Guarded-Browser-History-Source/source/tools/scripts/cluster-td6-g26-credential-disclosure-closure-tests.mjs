#!/usr/bin/env node
// G26 security regression: exercise actual route handlers, not a duplicate
// implementation of the disclosure policy. Only I/O dependencies are mocked.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(`${execFileSync('npm', ['root', '-g'], {encoding:'utf8'}).trim()}/typescript`); } })();
const shape = { trim(){return this}, min(){return this}, max(){return this}, int(){return this}, positive(){return this},
  default(){return this}, optional(){return this}, nullable(){return this}, datetime(){return this}, strict(){return this},
  extend(){return this}, parse(v){return v} };
const z = Object.fromEntries(['object','array','string','number','enum'].map(k => [k, () => Object.create(shape)]));
const src = readFileSync('apps/server/src/domains/inventory/studio-inventory-vault-routes.ts','utf8');
const js = ts.transpileModule(src,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const mod = {exports:{}};
new Function('require','module','exports',js)((name) => {
  if(name==='node:crypto')return require('node:crypto');
  if(name==='zod')return {z};
  if(name.endsWith('studio-inventory-approvals.js'))return {registerStudioInventoryApprovalRoutes:()=>{}};
  if(name.endsWith('inventory-key-readiness.js'))return {registerInventoryKeyReadinessRoutes:()=>{}};
  if(name.endsWith('vault-reviewed-rotation.js'))return {registerVaultReviewedRotationRoutes:()=>{}};
  if(name.endsWith('crypto-service.js'))return {clusterSecretFingerprint:()=> 'fingerprint'};
  if(name.endsWith('setting-crypto.js'))return {decryptSecuritySecret:(_,value)=>value.replace('sealed:',''),encryptSecuritySecret:()=>'',encryptionKeyConfigured:()=>true};
  throw Error(`Unexpected dependency ${name}`);
},mod,mod.exports);
function fixture({auditEnabled=true, auditOnWrite=()=>{}, actorIsAdmin=true}={}) {
  const routes=new Map(), audits=[];
  const user={id:'recipient', accountState:'ACTIVE',archived:false,accessExpiresAt:null};
  const key={id:'key1',poolId:'pool1',userId:'recipient',status:'assigned',revision:3,vaultSecretId:'credential1',firstRevealedAt:null,expiresAt:null};
  const pool={status:'active'};
  const secret={id:'credential1',encryptedValue:'sealed:license-plaintext',revokedAt:null,revision:5,expiresAt:null};
  const standalone={id:'standalone',encryptedValue:'sealed:vault-plaintext',revokedAt:null,revision:7,expiresAt:null};
  const db={
    user:{findUnique:async({where})=>where.id===user.id?{...user}:null},
    studioInventoryKey:{
      findUnique:async({where})=>where.vaultSecretId==='credential1'?{id:'key1'}:null,
      findFirst:async({where})=> where.id===key.id && (!where.poolId||where.poolId===key.poolId) &&
       (!where.userId||where.userId===key.userId) && (!where.status||where.status===key.status) &&
       (!where.revision||where.revision===key.revision) &&
       (!where.firstRevealedAt || (where.firstRevealedAt.not===null && key.firstRevealedAt))?
        {...key,pool:{...pool}}:null,
      updateMany:async({where,data})=>{if(key.id!==where.id||key.status!==where.status || key.revision!==where.revision||
         (where.userId && where.userId!==key.userId)) return {count:0};
        if (where.firstRevealedAt===null && key.firstRevealedAt) return {count:0};
        Object.assign(key,data);return {count:1};},
    },
    studioVaultSecret:{findUnique:async({where,select})=>{
      const row=where.id===standalone.id?standalone:where.id===secret.id?secret:null;
      return row?Object.fromEntries(Object.entries(select||{}).filter(([,yes])=>yes===true).map(([name])=>[name,row[name]])):null;
    }},
  };
  const app={get:(path,fn)=>routes.set(`GET ${path}`,fn),post:(path,fn)=>routes.set(`POST ${path}`,fn),patch:(path,fn)=>routes.set(`PATCH ${path}`,fn)};
  const auditService = auditEnabled ? {recordSecurity:async event=>{audits.push(event);return await auditOnWrite({key,pool,secret,standalone,user,event});}} : undefined;
  mod.exports.registerStudioInventoryVaultRoutes({app,prisma:db,authorization:{requireAdmin:async()=>actorIsAdmin?{id:'admin'}:null},
    requireConfirmation:()=>true,logSecurityEvent:async()=>{},getCurrentUser:async()=>user,verifyUserPin:async()=>{},auditService});
  async function invoke(url,body={},params={}){
    const fn=routes.get(`POST ${url}`);assert.ok(fn,url);
    const reply={status:200,code(status){this.status=status;return this},header(){return this},send(body){return body}};
    const response=await fn({id:'request-1',params,body},reply);return {status:reply.status,response};
  }
  const recipient=()=>invoke('/api/me/inventory/keys/:id/reveal',{expectedRevision:3,pin:'1234'},{id:'key1'});
  const keyAdmin=()=>invoke('/api/admin/inventory/key-pools/:id/keys/:keyId/reveal',{expectedRevision:3},{id:'pool1',keyId:'key1'});
  const vaultAdmin=()=>invoke('/api/admin/vault/secrets/:id/reveal',{}, {id:'standalone'});
  return {recipient,keyAdmin,vaultAdmin, key,pool,secret,standalone,user,audits};
}
let checks=0;
async function check(name,run){await run();checks++;console.log(`PASS credential closure ${name}`);}
await check('recipient reveal requires durable audit success, not just attempted write',async()=>{
  const f=fixture({auditOnWrite:()=>({ok:false})});const r=await f.recipient();
  assert.equal(r.status,503);assert.equal(r.response.code,'KEY_REVEAL_AUDIT_UNAVAILABLE');assert.equal(f.key.firstRevealedAt,null);
});
await check('admin key reveal blocks audit write failure',async()=>{
  const f=fixture({auditOnWrite:()=>({ok:false})});const r=await f.keyAdmin();
  assert.equal(r.status,503);assert.equal(r.response.code,'KEY_REVEAL_AUDIT_UNAVAILABLE');assert.equal(f.key.firstRevealedAt,null);
});
await check('Vault reveal blocks silent audit failure',async()=>{
  const f=fixture({auditOnWrite:()=>({ok:false})});const r=await f.vaultAdmin();
  assert.equal(r.status,503);assert.equal(r.response.code,'VAULT_REVEAL_AUDIT_UNAVAILABLE');
});
await check('missing audit service denies secret instead of falling back to logs',async()=>{
  const f=fixture({auditEnabled:false});assert.equal((await f.vaultAdmin()).status,503);
  assert.equal((await f.recipient()).status,503);assert.equal((await f.keyAdmin()).status,503);
});
await check('throwing audit provider denies disclosure',async()=>{
  const f=fixture({auditOnWrite:()=>{throw new Error('Audit datastore is offline');}});
  assert.equal((await f.vaultAdmin()).status,503);
});
await check('recipient revocation while audit writes denies disclosed bytes',async()=>{
  const f=fixture({auditOnWrite:({key})=>{key.status='revoked';return {ok:true};}});
  const r=await f.recipient();assert.equal(r.status,404);assert.ok(!JSON.stringify(r).includes('license-plaintext'));
});
await check('recipient suspension while audit writes denies disclosed bytes',async()=>{
  const f=fixture({auditOnWrite:({user})=>{user.accountState='SUSPENDED';return {ok:true};}});
  const r=await f.recipient();assert.equal(r.status,404);assert.ok(!JSON.stringify(r).includes('license-plaintext'));
});
await check('pool closure while audit writes denies disclosed bytes',async()=>{
  const f=fixture({auditOnWrite:({pool})=>{pool.status='closed';return {ok:true};}});
  const r=await f.keyAdmin();assert.equal(r.status,404);assert.ok(!JSON.stringify(r).includes('license-plaintext'));
});
await check('Vault key revocation while audit writes denies disclosed bytes',async()=>{
  const f=fixture({auditOnWrite:({secret})=>{secret.revokedAt=new Date();return {ok:true};}});
  const r=await f.keyAdmin();assert.equal(r.status,404);
});
await check('standalone Vault revocation while audit writes denies disclosed bytes',async()=>{
  const f=fixture({auditOnWrite:({standalone})=>{standalone.revokedAt=new Date();return {ok:true};}});
  const r=await f.vaultAdmin();assert.equal(r.status,404);
});
await check('standalone Vault rotation while audit writes denies prior bytes',async()=>{
  const f=fixture({auditOnWrite:({standalone})=>{standalone.encryptedValue='sealed:replacement';standalone.revision++;return {ok:true};}});
  const r=await f.vaultAdmin();assert.equal(r.status,404);assert.ok(!JSON.stringify(r).includes('vault-plaintext'));
});
await check('password-setup accounts cannot reveal assigned keys',async()=>{
  for(const state of ['PASSWORD_CHANGE_REQUIRED','PASSWORD_RESET_REQUIRED','INVITED','PENDING','LOCKED']){
    const f=fixture(); f.user.accountState=state;
    const r=await f.recipient(); assert.equal(r.status,403, state);
    assert.equal(f.audits.length,0);
    assert.equal(f.key.firstRevealedAt,null);
  }
});
await check('admin may not reveal keys assigned to a non-active recipient',async()=>{
  for(const state of ['PASSWORD_CHANGE_REQUIRED','PASSWORD_RESET_REQUIRED','PENDING']){
    const f=fixture(); f.user.accountState=state;
    const r=await f.keyAdmin();assert.equal(r.status,409,state);
    assert.equal(f.audits.length,0);
  }
});
await check('custody inspection treats all non-active account states as blocked',async()=>{
  const source=readFileSync('apps/server/src/domains/inventory/inventory-key-readiness.ts','utf8');
  const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const mod={exports:{}};
  new Function('require','module','exports',compiled)((name)=>{
    if(name==='zod')return {z};throw Error(name);
  },mod,mod.exports);
  const now=new Date();
  for(const state of ['PASSWORD_CHANGE_REQUIRED','PASSWORD_RESET_REQUIRED','INVITED','SUSPENDED','DISABLED']){
    assert.equal(mod.exports.keyCustodyReason({secret:{}},'active',{accountState:state},now),'recipient_inactive');
  }
  assert.equal(mod.exports.keyCustodyReason({secret:{}},'active',{accountState:'ACTIVE'},now),'no_known_custody_blocker');
});
await check('successful credential reveal returns only current sealed plaintext and audited ID',async()=>{
  for (const [kind,expected] of [['recipient','license-plaintext'],['keyAdmin','license-plaintext'],['vaultAdmin','vault-plaintext']]){
    const f=fixture({auditOnWrite:()=>({ok:true})}); const r=await f[kind]();
    assert.equal(r.status,200); assert.equal(r.response.value,expected);
    assert.equal(f.audits.length,1);assert.ok(!JSON.stringify(f.audits).includes(expected));
  }
});
console.log(`G26 credential disclosure closure: ${checks}/${checks} passed`);
