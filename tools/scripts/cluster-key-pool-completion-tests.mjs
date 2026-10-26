import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(`${execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim()}/typescript`)}})();
import vm from 'node:vm';

const source = fs.readFileSync('apps/server/src/domains/inventory/studio-inventory-vault-routes.ts','utf8');
const ui = fs.readFileSync('packages/renderer/src/features/settings/StudioInventoryVaultPanel.tsx','utf8');
const schema = fs.readFileSync('apps/server/prisma/schema.prisma','utf8');
const migration = fs.readFileSync('apps/server/prisma/migrations/20261010192000_inventory_commercial_key_pools/migration.sql','utf8');
const zChain={regex(){return this},trim(){return this},min(){return this},max(){return this},int(){return this},positive(){return this},default(){return this},optional(){return this},nullable(){return this},datetime(){return this},strict(){return this},extend(){return Object.create(this)},parse(v){return v}};
const z={object(){return Object.create(zChain)},array(){return Object.create(zChain)},string(){return Object.create(zChain)},number(){return Object.create(zChain)},enum(){return Object.create(zChain)}};
const fakeEncrypt=(purpose,value)=>`sealed:${purpose}:${Buffer.from(value).toString('base64')}`;
const fakeDecrypt=(purpose,blob)=>{const prefix=`sealed:${purpose}:`;assert.ok(blob.startsWith(prefix),'Secret must be encrypted for matching Vault id');return Buffer.from(blob.slice(prefix.length),'base64').toString()};
const finger=(value,purpose)=>crypto.createHash('sha256').update(`${purpose}:${value}`).digest('hex');
const mocks=name=>{
  if(name==='node:crypto')return crypto;
  if(name==='zod')return {z};
  if(name.endsWith('/crypto-service.js'))return {clusterSecretFingerprint:finger};
  if(name.endsWith('studio-inventory-approvals.js'))return {registerStudioInventoryApprovalRoutes:()=>{}};
  if(name.endsWith('inventory-key-readiness.js'))return {registerInventoryKeyReadinessRoutes:()=>{}};
  if(name.endsWith('vault-reviewed-rotation.js'))return {registerVaultReviewedRotationRoutes:()=>{}};if(name.endsWith('/setting-crypto.js'))return {encryptSecuritySecret:fakeEncrypt,decryptSecuritySecret:fakeDecrypt,encryptionKeyConfigured:()=>true};
  throw Error(`Unexpected module ${name}`);
};
const transpiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const ctx={module:{exports:{}},require:mocks,Date,Buffer,process,console};ctx.exports=ctx.module.exports;vm.runInNewContext(transpiled,ctx);
const routes=new Map(),audits=[];
let pools=[],keys=[],vault=[],authorized=true,confirmed=true,seq=0,failVault=false,activeAs="user-1",pinAccepted=true,auditAvailable=true;
const users={'user-1':{id:'user-1',archived:false,accountState:'ACTIVE',accessExpiresAt:null},'user-2':{id:'user-2',archived:true,accountState:'ACTIVE',accessExpiresAt:null}};
const select=(row,projection)=>Object.fromEntries(Object.entries(projection).filter(([,v])=>v===true).map(([k])=>[k,row[k]]));
const poolResult=row=>({...row,_count:{keys:keys.filter(k=>k.poolId===row.id).length}});
const pRepo={
  findMany:async()=>pools.map(poolResult),
  findUnique:async({where})=>{const p=pools.find(x=>x.id===where.id);return p?poolResult(p):null},
  create:async({data})=>{const p={id:`pool-${++seq}`,status:'active',revision:1,createdAt:new Date(),updatedAt:new Date(),...data};pools.push(p);return poolResult(p)},
  updateMany:async({where,data})=>{const p=pools.find(x=>x.id===where.id && x.revision===where.revision && (where.status===undefined||x.status===where.status));if(!p)return {count:0};if(data.status)p.status=data.status;p.revision+=Number(data.revision?.increment||0);return {count:1}}
};
const kRepo={
  findMany:async({where,cursor,skip,take,select:projection})=>{let rows=keys.filter(x=>(where.poolId===undefined||x.poolId===where.poolId)&&(where.userId===undefined||x.userId===where.userId)).sort((a,b)=>a.id.localeCompare(b.id));if(cursor){const pos=rows.findIndex(x=>x.id===cursor.id);rows=rows.slice(pos+skip)}return rows.slice(0,take).map(row=>({...select(row,projection), ...(projection.pool ? {pool:select(pools.find(p=>p.id===row.poolId),projection.pool.select)} : {})}))},
  findFirst:async({where})=>{const k=keys.find(x=>(where.poolId===undefined||x.poolId===where.poolId) && (where.userId===undefined||x.userId===where.userId) && (where.id===undefined || x.id===where.id) && (where.status===undefined||x.status===where.status) && (where.revision===undefined||x.revision===where.revision) && (where.fingerprint?.in===undefined||where.fingerprint.in.includes(x.fingerprint)));return k?{...k,pool:{status:pools.find(p=>p.id===k.poolId)?.status}}:null},
  findUnique:async({where})=>{const k=keys.find(x=>x.vaultSecretId===where.vaultSecretId);return k?{...k}:null},
  create:async({data})=>{if(keys.some(k=>k.poolId===data.poolId&&k.fingerprint===data.fingerprint))throw Error('duplicate fingerprint');const key={status:'available',revision:1,createdAt:new Date(),...data};keys.push(key);return {...key}},
  updateMany:async({where,data})=>{const k=keys.find(x=>x.id===where.id && x.poolId===where.poolId && x.status===where.status && x.revision===where.revision);if(!k)return {count:0};Object.assign(k,Object.fromEntries(Object.entries(data).filter(([name])=>name!=="revision")));k.revision+=Number(data.revision?.increment||0);return {count:1}}
};
const vRepo={
  create:async({data})=>{if(failVault)throw Error('simulated storage failure');vault.push({...data,revokedAt:null,revision:1});return {...data}},
  findUnique:async({where})=>{const v=vault.find(x=>x.id===where.id);return v?{...v}:null},
  updateMany:async({where,data})=>{let n=0;for(const v of vault)if(v.id===where.id && v.revokedAt===null){Object.assign(v,data);v.revision+=Number(data.revision?.increment||0);n++}return {count:n}},
  findMany:async()=>vault.map(({encryptedValue,...record})=>record)
};
const assetRows=[{id:'asset-1',title:'QA laptop',kind:'equipment',provider:'Studio',status:'active'}];
const allocationRows=[{id:'alloc-1',assetId:'asset-1',userId:'user-1',quantity:1,status:'active',assignedAt:new Date(),revokedAt:null},{id:'alloc-2',assetId:'asset-1',userId:'user-2',quantity:1,status:'active',assignedAt:new Date(),revokedAt:null}];
const allocationRepo={findMany:async({where,cursor,skip=0,take,select:projection})=>{let rows=allocationRows.filter(r=>r.userId===where.userId).sort((a,b)=>a.id.localeCompare(b.id));if(cursor){const at=rows.findIndex(r=>r.id===cursor.id);rows=rows.slice(at+skip)}return rows.slice(0,take).map(row=>({...select(row,projection),asset:select(assetRows.find(asset=>asset.id===row.assetId),projection.asset.select)}))}};
const db={studioInventoryAllocation:allocationRepo,studioInventoryKeyPool:pRepo,studioInventoryKey:kRepo,studioVaultSecret:vRepo,user:{findUnique:async({where})=>users[where.id]||null},$queryRaw:async()=>pools.length?[{id:pools[0].id}]:[],
  $transaction:async fn=>{const before=structuredClone({pools,keys,vault});try{return await fn(db)}catch(e){pools=before.pools;keys=before.keys;vault=before.vault;throw e}}
};
const app={get:(url,fn)=>routes.set(`GET ${url}`,fn),post:(url,fn)=>routes.set(`POST ${url}`,fn),patch:(url,fn)=>routes.set(`PATCH ${url}`,fn)};
ctx.module.exports.registerStudioInventoryVaultRoutes({app,prisma:db,authorization:{requireAdmin:async()=>authorized?{id:'admin'}:null},requireConfirmation:()=>confirmed,logSecurityEvent:async ({request, ...event})=>audits.push({...event, requestId:request?.id||null}),
  getCurrentUser:async()=>activeAs?users[activeAs]||null:null,
  verifyUserPin:async(_user,pin,purpose)=>{assert.equal(purpose,'reveal_assigned_inventory_key');if(!pinAccepted||pin!=='1234')throw Error('Incorrect PIN')},
  auditService:{recordSecurity:async event=>{if(!auditAvailable)return {ok:false};audits.push(event);return {ok:true}}},
});
async function call(method,url,body={},params={},query={}){const fn=routes.get(`${method} ${url}`);assert.ok(fn,`${method} ${url}`);const reply={status:200,code(n){this.status=n;return this},header(k,v){assert.equal(k,'Cache-Control');assert.equal(v,'no-store');return this},send(obj){return obj}};const response=await fn({body,params,query},reply);return {status:reply.status,response};}
let count=0;function check(name,fn){fn();count++;console.log(`PASS ${name}`)}
check('Inventory registers protected recipient routes',()=>assert.equal(routes.size,29));
let x=await call('POST','/api/admin/inventory/key-pools',{title:'Studio QA',kind:'game_key',provider:'Steam'});
const id=x.response.pool.id;
check('create pool',()=>{assert.equal(x.status,201);assert.equal(x.response.pool.revision,1)});
x=await call('POST','/api/admin/inventory/key-pools/:id/import',{expectedRevision:1,values:['AAA-111','BBB-222']},{id});
check('transactional import',()=>{assert.equal(x.status,201);assert.equal(x.response.imported,2);assert.equal(vault.length,2);assert.equal(keys.length,2);assert.ok(!JSON.stringify(x).includes('AAA-111'))});
let row=keys[0];
x=await call('GET','/api/admin/inventory/key-pools/:id/keys',{}, {id});
check('public key list omits plaintext and Vault references',()=>{assert.equal(x.response.keys.length,2);assert.ok(!JSON.stringify(x).includes('AAA-111'));assert.ok(!JSON.stringify(x).includes('encryptedValue'));assert.ok(!JSON.stringify(x).includes('vaultSecretId'));assert.ok(!JSON.stringify(x).includes('fingerprint'))});
x=await call('POST','/api/admin/inventory/key-pools/:id/import',{expectedRevision:2,values:['AAA-111']},{id});
check('duplicate key rejected',()=>{assert.equal(x.status,409);assert.equal(x.response.code,'DUPLICATE_KEYS_IN_POOL');assert.equal(vault.length,2)});
x=await call('POST','/api/admin/inventory/key-pools/:id/import',{expectedRevision:2,values:['DUP-KEY','DUP-KEY']},{id});
check('duplicates inside a single batch reject the entire import',()=>{assert.equal(x.status,409);assert.equal(vault.length,2)});
x=await call('POST','/api/admin/inventory/key-pools/:id/import',{expectedRevision:1,values:['CCC-333']},{id});
check('stale pool import rejected',()=>{assert.equal(x.status,409);assert.equal(keys.length,2)});
failVault=true;await assert.rejects(call('POST','/api/admin/inventory/key-pools/:id/import',{expectedRevision:2,values:['DDD-444']},{id}));failVault=false;
check('failed Vault write rolls back Inventory rows',()=>{assert.equal(keys.length,2);assert.equal(pools[0].revision,2)});
x=await call('POST','/api/admin/inventory/key-pools/:id/keys/:keyId/assign',{expectedRevision:1,userId:'user-2'},{id,keyId:row.id});
check('direct key assignment requires independent review',()=>{assert.equal(x.status,409);assert.equal(x.response.code,'INVENTORY_REVIEW_REQUIRED');assert.equal(keys[0].status,'available')});
x=await call('POST','/api/admin/inventory/key-pools/:id/keys/:keyId/assign',{expectedRevision:1,userId:'user-1'},{id,keyId:row.id});
check('eligible recipient still cannot bypass reviewed issuance',()=>{assert.equal(x.response.code,'INVENTORY_REVIEW_REQUIRED');assert.equal(keys[0].status,'available')});
// The new G02 route harness separately executes the real reviewed assignment.
// Seed the already-authorized state here to retain legacy reveal/revoke tests.
keys[0].status='assigned';keys[0].userId='user-1';keys[0].revision=2;keys[0].assignedAt=new Date();
let delivered=await call('GET','/api/me/inventory/keys');
const custody=await call('GET','/api/me/inventory/allocations');
check('recipient can browse own asset custody without other user data',()=>{assert.equal(custody.response.allocations.length,1);assert.equal(custody.response.allocations[0].asset.title,'QA laptop');assert.ok(!JSON.stringify(custody.response).includes('user-2'))});
check('recipient list shows only own assignment metadata',()=>{assert.equal(delivered.response.keys.length,1);assert.equal(delivered.response.keys[0].pool.title,'Studio QA');for(const secret of ['AAA-111','sealed:','vaultSecretId','fingerprint'])assert.ok(!JSON.stringify(delivered.response).includes(secret),secret)});
activeAs='user-2';
delivered=await call('GET','/api/me/inventory/keys');
check('inactive users cannot browse personal keys',()=>assert.equal(delivered.status,403));
const deniedCustody=await call('GET','/api/me/inventory/allocations');
check('inactive users cannot browse custody information',()=>assert.equal(deniedCustody.status,403));
activeAs=null;
delivered=await call('GET','/api/me/inventory/keys');
check('signed-out user cannot enumerate recipient keys',()=>assert.equal(delivered.status,401));
const anonymousCustody=await call('GET','/api/me/inventory/allocations');
check('signed-out users cannot enumerate custody',()=>assert.equal(anonymousCustody.status,401));
activeAs='user-1';
let recipient=await call('POST','/api/me/inventory/keys/:id/reveal',{expectedRevision:2,pin:'1234'},{id:keys[1].id});
check('other unassigned key cannot be revealed by guessing its id',()=>assert.equal(recipient.status,404));
recipient=await call('POST','/api/me/inventory/keys/:id/reveal',{expectedRevision:1,pin:'1234'},{id:keys[0].id});
check('stale key version cannot reveal',()=>assert.equal(recipient.status,404));
pinAccepted=false;
recipient=await call('POST','/api/me/inventory/keys/:id/reveal',{expectedRevision:2,pin:'1234'},{id:keys[0].id});
check('incorrect PIN blocks reveal',()=>{assert.equal(recipient.status,403);assert.ok(!JSON.stringify(recipient).includes('AAA-111'))});
pinAccepted=true;auditAvailable=false;
recipient=await call('POST','/api/me/inventory/keys/:id/reveal',{expectedRevision:2,pin:'1234'},{id:keys[0].id});
check('audit failure blocks plaintext disclosure',()=>{assert.equal(recipient.status,503);assert.ok(!JSON.stringify(recipient).includes('AAA-111'))});
auditAvailable=true;
recipient=await call('POST','/api/me/inventory/keys/:id/reveal',{expectedRevision:2,pin:'1234'},{id:keys[0].id});
check('correct PIN and persisted audit deliver only owned secret',()=>{assert.equal(recipient.response.value,'AAA-111');assert.ok(audits.some(a=>a.event==='inventory.recipient_key_revealed' && a.metadata.keyId===keys[0].id));assert.ok(!JSON.stringify(audits).includes('AAA-111'))});
const originalPoolStatus=pools[0].status;
pools[0].status='closed';
recipient=await call('POST','/api/me/inventory/keys/:id/reveal',{expectedRevision:2,pin:'1234'},{id:keys[0].id});
check('closed pool cannot disclose assigned secret',()=>assert.equal(recipient.status,404));
pools[0].status=originalPoolStatus;
const originalRevocation=vault[0].revokedAt;
vault[0].revokedAt=new Date();
recipient=await call('POST','/api/me/inventory/keys/:id/reveal',{expectedRevision:2,pin:'1234'},{id:keys[0].id});
check('Vault revocation blocks recipient reveal',()=>assert.equal(recipient.status,404));
vault[0].revokedAt=originalRevocation;
x=await call('POST','/api/admin/inventory/key-pools/:id/keys/:keyId/assign',{expectedRevision:1,userId:'user-1'},{id,keyId:row.id});
check('stale/double key assignment rejected',()=>{assert.equal(x.status,409);assert.equal(keys[0].userId,'user-1')});
x=await call('POST','/api/admin/inventory/key-pools/:id/keys/:keyId/reveal',{expectedRevision:2},{id,keyId:row.id});
check('privileged reveal audited and scoped',()=>{assert.equal(x.response.value,'AAA-111');assert.ok(audits.some(a=>a.event==='inventory.key_revealed'));assert.ok(!JSON.stringify(audits).includes('AAA-111'))});
x=await call('POST','/api/admin/vault/secrets/:id/reveal',{}, {id:row.vaultSecretId});
check('generic Vault cannot bypass Inventory reveal checks',()=>{assert.equal(x.status,409);assert.equal(x.response.code,'INVENTORY_KEYS_USE_POOL_REVEAL')});
x=await call('POST','/api/admin/vault/secrets/:id/rotate',{value:'NEW',expectedRevision:1}, {id:row.vaultSecretId});
check('generic Vault rotation cannot desynchronize pooled key',()=>assert.equal(x.status,409));
x=await call('POST','/api/admin/inventory/key-pools/:id/keys/:keyId/decision',{expectedRevision:2,decision:'redeemed',reason:'Claimed in Steam'},{id,keyId:row.id});
check('redeemed key permanently closes assignment',()=>{assert.equal(x.response.ok,true);assert.equal(keys[0].status,'redeemed')});
x=await call('POST','/api/admin/inventory/key-pools/:id/keys/:keyId/reveal',{expectedRevision:3},{id,keyId:row.id});
check('redeemed key cannot be revealed',()=>assert.equal(x.status,404));
recipient=await call('POST','/api/me/inventory/keys/:id/reveal',{expectedRevision:3,pin:'1234'},{id:keys[0].id});
check('recipient cannot reveal a redeemed key',()=>assert.equal(recipient.status,404));
row=keys[1];
x=await call('POST','/api/admin/inventory/key-pools/:id/keys/:keyId/decision',{expectedRevision:1,decision:'revoked',reason:'Key expired'},{id,keyId:row.id});
check('unassigned key revocation revokes Vault source',()=>{assert.equal(x.response.ok,true);assert.equal(keys[1].status,'revoked');assert.ok(vault[1].revokedAt)});
x=await call('POST','/api/admin/vault/secrets/:id/revoke',{}, {id:row.vaultSecretId});
check('generic Vault revoke cannot conflict with pool lifecycle',()=>assert.equal(x.status,409));
confirmed=false;
x=await call('POST','/api/admin/inventory/key-pools/:id/import',{expectedRevision:2,values:['XYZ']},{id});
check('import requires privileged confirmation',()=>{assert.equal(x.response,undefined);assert.equal(vault.length,2)});
confirmed=true;
x=await call('POST','/api/admin/inventory/key-pools/:id/lifecycle',{expectedRevision:2,status:'closed'},{id});
check('pool can be closed',()=>{assert.equal(x.response.ok,true);assert.equal(pools[0].status,'closed')});
x=await call('POST','/api/admin/inventory/key-pools/:id/import',{expectedRevision:3,values:['XYZ']},{id});
check('closed pool cannot import',()=>assert.equal(x.status,409));
// Pagination is supported beyond the initial 100 individual key records.
const extras=Array.from({length:105},(_,n)=>({ id:`extra-${String(n).padStart(3,'0')}`, poolId:id, status:'available',revision:1,createdAt:new Date() }));
keys.push(...extras);
x=await call('GET','/api/admin/inventory/key-pools/:id/keys',{}, {id});
check('key paging exposes only the first 100',()=>{assert.equal(x.response.keys.length,100);assert.ok(x.response.nextCursor)});
const follow=await call('GET','/api/admin/inventory/key-pools/:id/keys',{}, {id},{cursor:x.response.nextCursor});
check('key paging retrieves remaining records',()=>{assert.equal(follow.response.keys.length,7);assert.equal(follow.response.nextCursor,null)});
const bytes=JSON.stringify(x);
const extraOwn=Array.from({length:55},(_,i)=>({id:`own-${String(i).padStart(3,'0')}`,poolId:id,userId:'user-1',status:'assigned',revision:1,assignedAt:new Date(),closedAt:null,createdAt:new Date()}));
keys.push(...extraOwn);
const ownPage=await call('GET','/api/me/inventory/keys');
check('recipient keys paginate at 50 without exposing all records',()=>{assert.equal(ownPage.response.keys.length,50);assert.ok(ownPage.response.nextCursor);assert.ok(!JSON.stringify(ownPage.response).includes('vaultSecretId'))});
const ownNext=await call('GET','/api/me/inventory/keys',{}, {},{cursor:ownPage.response.nextCursor});
check('recipient pagination reaches remaining own keys',()=>{assert.ok(ownNext.response.keys.length>0);assert.equal(ownNext.response.nextCursor,null)});
keys.splice(keys.length-extraOwn.length,extraOwn.length);
check('recipient view conceals values on background and expiry',()=>{const panel=fs.readFileSync('packages/renderer/src/features/settings/MyInventoryLicensesPanel.tsx','utf8');assert.ok(panel.includes('visibilitychange'));assert.ok(panel.includes('20_000'));assert.ok(panel.includes('requestSecurityPin'))});
check('recipient panel and account navigation are wired',()=>{const panel=fs.readFileSync('packages/renderer/src/features/settings/MyInventoryLicensesPanel.tsx','utf8');const account=fs.readFileSync('packages/renderer/src/features/settings/AccountSettingsPage.tsx','utf8');for(const value of ['My licenses','Reveal with PIN','Copy key','Hide now','Load more licenses','Load more assets','Assigned equipment & license seats'])assert.ok(panel.includes(value),value);assert.ok(account.includes('MyInventoryLicensesPanel'))});
check('UI provides full pool workflow',()=>{for(const text of ['Create key pool','Confirm encrypted import','Assign key','Reveal assigned key','Mark redeemed','Revoke key','Load more keys','20_000'])assert.ok(ui.includes(text),text)});
check('schema and migration link Inventory to Vault',()=>{for(const text of ['model StudioInventoryKeyPool','model StudioInventoryKey','vaultSecretId','@@unique([poolId, fingerprint])'])assert.ok(schema.includes(text),text);assert.ok(migration.includes('FOREIGN KEY ("vaultSecretId")'))});
authorized=false;
x=await call('GET','/api/admin/inventory/key-pools');
check('non-admin cannot enumerate key pools',()=>assert.equal(x.response,undefined));
console.log(`${count}/${count} key-pool behavior checks passed`);
