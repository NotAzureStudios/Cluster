#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url), ts = require('typescript');
const source = file => readFileSync(file,'utf8');
const file='apps/server/src/domains/inventory/inventory-key-readiness.ts';
const code=ts.transpileModule(source(file),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
const shape={trim(){return this},min(){return this},max(){return this},optional(){return this},strict(){return this},parse(x){return x}};
const module={exports:{}};
vm.runInNewContext(code,{module,exports:module.exports,require:n=>n==='zod'?{z:{string:()=>shape,object:()=>shape}}:require(n),Date,Set,Map,Error,console},{filename:file});
const {keyCustodyReason,inspectPoolKeyCustody,registerInventoryKeyReadinessRoutes}=module.exports;
const now=new Date('2026-11-08T12:00:00.000Z');
const past=new Date('2026-11-07T12:00:00.000Z'),future=new Date('2026-11-20T12:00:00.000Z');
const key={expiresAt:future,secret:{revokedAt:null,expiresAt:future}}, user={archived:false,accountState:'ACTIVE',accessExpiresAt:future};
let checked=0;
async function check(name,fn){await fn();checked++; console.log('PASS G26 Batch D custody '+name)}
await check('normal assigned key has no known custody blocker, not blanket reveal authorization',()=>assert.equal(keyCustodyReason(key,'active',user,now),'no_known_custody_blocker'));
await check('closed pool blocks key custody',()=>assert.equal(keyCustodyReason(key,'closed',user,now),'pool_closed'));
await check('expired assigned key is unavailable',()=>assert.equal(keyCustodyReason({...key,expiresAt:past},'active',user,now),'key_expired'));
await check('revoked Vault secret blocks custody',()=>assert.equal(keyCustodyReason({...key,secret:{...key.secret,revokedAt:past}},'active',user,now),'vault_revoked'));
await check('expired Vault secret blocks custody',()=>assert.equal(keyCustodyReason({...key,secret:{...key.secret,expiresAt:past}},'active',user,now),'vault_expired'));
await check('missing recipient is reported',()=>assert.equal(keyCustodyReason(key,'active',null,now),'recipient_missing'));
await check('archived and disabled recipients are blocked',()=>{assert.equal(keyCustodyReason(key,'active',{...user,archived:true},now),'recipient_inactive'); assert.equal(keyCustodyReason(key,'active',{...user,accountState:'DISABLED'},now),'recipient_inactive')});
await check('expired recipient access blocks custody',()=>assert.equal(keyCustodyReason(key,'active',{...user,accessExpiresAt:past},now),'recipient_inactive'));
const rows=Array.from({length:51},(_,i)=>({id:`k-${String(i).padStart(4,'0')}`,userId:i===1?'gone':'u1',revision:1,expiresAt:future,firstRevealedAt:null,secret:{revokedAt:null,expiresAt:future}}));
const db={studioInventoryKeyPool:{findUnique:async()=>({id:'pool1',title:'Game keys',status:'active'})},
  studioInventoryKey:{findMany:async(q)=>{assert.equal(q.where.poolId,'pool1'); assert.equal(q.where.status,'assigned');assert.equal(q.take,51);return rows.filter(r=>!q.where.id||r.id>q.where.id.gt).slice(0,51)}},
  user:{findMany:async(q)=>{assert.ok(q.select.accountState); assert.equal(q.take,50); return [{id:'u1',...user}]}}};
await check('bounded page returns exactly 50 without exposing Vault material',async()=>{const x=await inspectPoolKeyCustody(db,'pool1',undefined,now);assert.equal(x.cases.length,50);assert.equal(x.nextCursor,'k-0049');assert.equal(x.hasGlobalCounts,false);assert.equal(x.containsVaultSecrets,false);assert.equal(x.revealsAuthorized,false);assert.equal(x.cases[1].reason,'recipient_missing');assert.doesNotMatch(JSON.stringify(x),/vaultSecretId|fingerprint|encryptedValue|ciphertext/)});
await check('cursor advances without repeating already counted keys',async()=>{const x=await inspectPoolKeyCustody(db,'pool1','k-0049',now);assert.equal(x.cases.length,1);assert.equal(x.cases[0].keyId,'k-0050');assert.equal(x.nextCursor,null)});
await check('non-admin cannot reach custody projection',async()=>{const handlers=new Map();registerInventoryKeyReadinessRoutes({app:{get:(p,f)=>handlers.set(p,f)},prisma:db,admin:async()=>null});const reply={header(){throw new Error('unauthorized access continued')}};assert.equal(await handlers.get('/api/admin/inventory/key-pools/:id/custody-review')({params:{id:'pool1'},query:{}},reply),undefined)});
await check('authorized route applies no-store and enforces pool-scoped result',async()=>{const handlers=new Map();registerInventoryKeyReadinessRoutes({app:{get:(p,f)=>handlers.set(p,f)},prisma:db,admin:async()=>({id:'admin'})});const reply={headers:{},header(k,v){this.headers[k]=v}};const value=await handlers.get('/api/admin/inventory/key-pools/:id/custody-review')({params:{id:'pool1'},query:{}},reply);assert.equal(value.ok,true);assert.equal(reply.headers['Cache-Control'],'private, no-store')});
await check('UI loads on demand with selection fencing, no polling or secret values',()=>{const ui=source('packages/renderer/src/features/inventory/InventoryKeyCustodyReview.tsx');assert.match(ui,/sequence\.current/);assert.match(ui,/Inspect assigned keys/);assert.match(ui,/custody-review/);assert.doesNotMatch(ui,/setInterval\(/);assert.match(source('packages/renderer/src/features/settings/StudioInventoryVaultPanel.tsx'),/InventoryKeyCustodyReview poolId=/)});
await check('route is wired to canonical Inventory/Vault security module',()=>assert.match(source('apps/server/src/domains/inventory/studio-inventory-vault-routes.ts'),/registerInventoryKeyReadinessRoutes\(\{ app, prisma, admin \}\)/));
console.log(`G26 Batch D custody: ${checked}/${checked} passed`);
