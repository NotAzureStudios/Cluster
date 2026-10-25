import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(`${execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim()}/typescript`)}})();
import crypto from 'node:crypto';

const read = (path) => fs.readFileSync(path, 'utf8');
const manifest = read('packages/shared/src/cluster-manifest.ts');
const app = read('packages/renderer/src/features/application/ClusterApplication.tsx');
const sidebar = read('packages/renderer/src/features/application/modules/ApplicationSidebar.tsx');
const workspace = read('packages/renderer/src/features/inventory/InventoryWorkspacePage.tsx');
const vaultUI = read('packages/renderer/src/features/inventory/VaultManager.tsx');
const studio = read('packages/renderer/src/features/settings/StudioSystemsSettingsSection.tsx');
const permissions = read('packages/renderer/src/core/permissions.ts');
const serverPolicy = read('apps/server/src/domains/access/request-policy.ts');
let passed = 0;
function check(label, fn) { fn(); passed++; console.log(`PASS ${label}`); }
check('Canonical Inventory and Vault routes with separate permission identities', () => {
  assert.match(manifest, /inventory: \{ label: "Inventory", group: "library", tool: "inventory"/);
  assert.match(manifest, /vault: \{ label: "Vault", group: "control", tool: "vault", adminOnly: true/);
});
check('Sidebar exposes Inventory as a primary resource and Vault as an admin workspace', () => {
  assert.match(manifest, /inventory: .*sidebar: \{ section: "library"/);
  assert.match(manifest, /vault: .*sidebar: \{ section: "administration"/);
  assert.match(sidebar, /const vault = section.routes.find/);
  assert.match(sidebar, /vault \? renderRouteLink/);
});
check('Both routes mount lazy workspaces, not Settings shortcuts', () => {
  assert.match(app, /isStandaloneToolRoute\(screen\) && <StandaloneToolRoute/);
  const registry = read('packages/renderer/src/features/application/modules/application-standalone-tool-registry.tsx');
  assert.match(registry, /inventory: \{/);
  assert.match(registry, /vault: \{/);
  assert.match(registry, /<Inventory isAdmin=\{isAdmin\} pinConfigured=\{pinConfigured\}/);
  assert.match(registry, /definition.adminOnly && !context.isAdmin/);
  assert.match(workspace, /MyInventoryLicensesPanel/);
  assert.match(workspace, /StudioInventoryPanel includeKeyPools=\{false\}/);
  assert.match(workspace, /StudioInventoryKeyPools people=\{people\}/);
  assert.doesNotMatch(studio, /<StudioVaultPanel|<StudioInventoryPanel/);
});
check('Vault uses server-side admin authorization and employee Inventory is separately scoped', () => {
  assert.match(serverPolicy, /path.startsWith\("\/api\/me\/inventory"\).*return "inventory"/);
  assert.match(serverPolicy, /path.startsWith\("\/api\/admin\/vault"\).*return "vault"/);
  assert.match(permissions, /inventory: "view", vault: "none"/);
});
check('Vault lifecycle UI avoids raw values in listing and uses privileged routes', () => {
  for (const endpoint of ['/api/admin/vault/secrets', '/reveal', '/rotation-requests', '/rotation-reviews', '/revoke']) assert.ok(vaultUI.includes(endpoint));
  for (const confirmation of ['REVEAL VAULT SECRET', 'ROTATE VAULT SECRET', 'REVOKE VAULT SECRET', 'UPDATE VAULT SECRET METADATA']) assert.ok(vaultUI.includes(confirmation));
  assert.match(vaultUI, /visibilitychange/);
  assert.match(vaultUI, /20_000/);
  assert.match(vaultUI, /setRevealed\(null\)/);
  assert.match(vaultUI, /expectedRevision: item.revision/);
});

// Execute the real Fastify route handlers against a deterministic in-memory Prisma mock.
const source = read('apps/server/src/domains/inventory/studio-inventory-vault-routes.ts');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const chain = { trim(){return this}, min(){return this}, max(){return this}, int(){return this}, positive(){return this}, default(){return this}, optional(){return this}, nullable(){return this}, datetime(){return this}, strict(){return this}, extend(){return Object.create(this)}, parse(value){return value} };
const z = { object(){return Object.create(chain)}, string(){return Object.create(chain)}, number(){return Object.create(chain)}, enum(){return Object.create(chain)}, array(){return Object.create(chain)} };
const requireMock = (name) => {
  if (name === 'node:crypto') return crypto;
  if(name.endsWith('studio-inventory-approvals.js'))return {registerStudioInventoryApprovalRoutes:()=>{}};
  if(name.endsWith('inventory-key-readiness.js'))return {registerInventoryKeyReadinessRoutes:()=>{}};
  if(name.endsWith('vault-reviewed-rotation.js'))return {registerVaultReviewedRotationRoutes:()=>{}};
  if (name === 'zod') return {z};
  if (name.endsWith('crypto-service.js')) return {clusterSecretFingerprint:(value)=>`sha:${value.length}`};
  if (name.endsWith('setting-crypto.js')) return {encryptSecuritySecret:(_purpose,value)=>`cipher:${value}`,decryptSecuritySecret:(_purpose,value)=>value.replace(/^cipher:/,''),encryptionKeyConfigured:()=>true};
  throw Error(name);
};
const ctx = {module:{exports:{}},require:requireMock,process,Buffer,Date,console};ctx.exports=ctx.module.exports;vm.runInNewContext(js,ctx);
const records = Array.from({length:207}, (_,i)=>({id:`vault-${String(i).padStart(3,'0')}`,name:i===201?'Searchable Production Token':`Secret ${i}`,kind:'integration',fingerprint:'abc123',revision:1,createdAt:new Date(Date.now()-i*1000),updatedAt:new Date(),expiresAt:null,revokedAt:null,encryptedValue:`cipher:value-${i}`}));
const inventoryKeys = new Set(['vault-206']);
const routes = new Map(), audits = [];
let isAdmin = true, canConfirm = true, auditThrows = false;
const prisma = {
  $queryRaw:async(_sql,id)=>records.some(row=>row.id===id)?[{id}]:[],
  $transaction:async(fn)=>{
    const before=structuredClone(records),auditBefore=audits.length;
    try{return await fn(prisma);}
    catch(error){records.splice(0,records.length,...before);audits.splice(auditBefore);throw error;}
  },
  studioInventoryKey:{findUnique:async({where})=>inventoryKeys.has(where.vaultSecretId)?{id:'pool-1'}:null},studioVaultSecret:{
  findMany:async({where={},cursor,skip=0,take=101})=>{
    let rows=records.filter(x=>!inventoryKeys.has(x.id));
    if (where.OR?.length){const q=String(where.OR[0].name.contains).toLowerCase();rows=rows.filter(x=>(x.name+' '+x.kind).toLowerCase().includes(q));}
    const start=cursor?rows.findIndex(x=>x.id===cursor.id)+skip:0;
    return rows.slice(start,start+take).map(({encryptedValue,...publicFields})=>publicFields);
  },
  findUnique:async({where,select})=>{const row=records.find(x=>x.id===where.id);if(!row)return null;return Object.fromEntries(Object.keys(select||{}).filter(k=>select[k]).map(k=>[k,row[k]]));},
  updateMany:async({where,data})=>{const r=records.find(x=>x.id===where.id&&(!where.revision||x.revision===where.revision)&&(!('revokedAt' in where)||where.revokedAt===rSafeRevoked(x)));if(!r)return {count:0};for(const [key,val] of Object.entries(data)){if(key==='revision')r.revision+=val.increment;else r[key]=val;}return {count:1};},
  create:async({data})=>{const row={...data,revision:1,revokedAt:null,createdAt:new Date(),updatedAt:new Date()};records.unshift(row);return row;},
}};
function rSafeRevoked(row) {return row.revokedAt;}
const fastify={get:(p,handler)=>routes.set(`GET ${p}`,handler),post:(p,handler)=>routes.set(`POST ${p}`,handler),patch:(p,handler)=>routes.set(`PATCH ${p}`,handler)};
ctx.module.exports.registerStudioInventoryVaultRoutes({app:fastify,prisma,authorization:{requireAdmin:async()=>isAdmin?{id:'owner'}:null},requireConfirmation:()=>canConfirm,logSecurityEvent:async(e)=>{audits.push(e);}, auditService:{recordSecurity:async(e)=>{if(auditThrows)return {ok:false};audits.push(e);return {ok:true};},
  recordSecurityInTransaction:async(_tx,e)=>{if(auditThrows)return {ok:false};audits.push(e);return {ok:true};}}});
async function invoke(method,path,{query={},body={},params={}}={}) {
 const handler=routes.get(`${method} ${path}`);assert.ok(handler,`Missing route ${method} ${path}`);
 const reply={status:200,headers:{},code(status){this.status=status;return this},header(k,v){this.headers[k]=v;return this},send(payload){return payload}};
 return {status:reply.status,response:await handler({query,body,params},reply),headers:reply.headers,getStatus(){return reply.status}};
}
let out=await invoke('GET','/api/admin/vault/secrets');
check('Vault first page excludes Inventory-owned keys and plaintext',()=>{assert.equal(out.response.secrets.length,100);assert.equal(out.response.nextCursor,'vault-099');assert.ok(out.response.secrets.every(x=>!('encryptedValue' in x)));assert.equal(out.headers['Cache-Control'],'no-store');});
out=await invoke('GET','/api/admin/vault/secrets',{query:{cursor:out.response.nextCursor}});
check('Vault supports server-side pagination',()=>{assert.equal(out.response.secrets.length,100);assert.equal(out.response.nextCursor,'vault-199');});
out=await invoke('GET','/api/admin/vault/secrets',{query:{q:'Production Token'}});
check('Vault search finds unloaded records without disclosing ciphertext',()=>{assert.equal(out.response.secrets.length,1);assert.equal(out.response.secrets[0].id,'vault-201');assert.ok(!('encryptedValue' in out.response.secrets[0]));});
isAdmin=false;out=await invoke('GET','/api/admin/vault/secrets');
check('Non-admin cannot enumerate Vault metadata',()=>assert.equal(out.response,undefined));isAdmin=true;
canConfirm=false;out=await invoke('POST','/api/admin/vault/secrets/:id/reveal',{params:{id:'vault-000'}});
check('Secret reveal requires privileged confirmation',()=>assert.equal(out.response,undefined));canConfirm=true;
auditThrows=true;out=await invoke('POST','/api/admin/vault/secrets/:id/reveal',{params:{id:'vault-000'}});assert.equal(out.getStatus(),503);
check('Failed security audit blocks plaintext disclosure',()=>assert.equal(audits.some(e=>e.event==='vault.secret_revealed'),false));auditThrows=false;
out=await invoke('POST','/api/admin/vault/secrets/:id/reveal',{params:{id:'vault-000'}});
check('Audited reveal discloses only an explicitly selected active secret',()=>{assert.equal(out.response.value,'value-0');assert.equal(out.headers['Cache-Control'],'no-store');assert.ok(audits.some(e=>e.event==='vault.secret_revealed'));});
out=await invoke('PATCH','/api/admin/vault/secrets/:id',{params:{id:'vault-001'},body:{name:'Fresh label',kind:'password',expiresAt:null,expectedRevision:8}});
check('Stale Vault metadata changes are rejected',()=>{assert.equal(out.getStatus(),409);assert.equal(records[1].name,'Secret 1');});
out=await invoke('PATCH','/api/admin/vault/secrets/:id',{params:{id:'vault-001'},body:{name:'Fresh label',kind:'password',expiresAt:null,expectedRevision:1}});
check('Vault metadata changes do not decrypt or replace secret values',()=>{assert.equal(out.response.secret.name,'Fresh label');assert.equal(records[1].encryptedValue,'cipher:value-1');assert.equal(records[1].revision,2);});
out=await invoke('POST','/api/admin/vault/secrets/:id/revoke',{params:{id:'vault-002'},body:{expectedRevision:7}});
check('Stale revocation is rejected',()=>{assert.equal(out.getStatus(),409);assert.equal(records[2].revokedAt,null);});
out=await invoke('POST','/api/admin/vault/secrets/:id/revoke',{params:{id:'vault-002'},body:{expectedRevision:1}});
check('Revision-qualified revocation succeeds once',()=>{assert.equal(out.response.ok,true);assert.ok(records[2].revokedAt);assert.equal(records[2].revision,2);});
out=await invoke('POST','/api/admin/vault/secrets/:id/reveal',{params:{id:'vault-002'}});
check('Revoked credentials cannot be disclosed',()=>assert.equal(out.getStatus(),404));
out=await invoke('PATCH','/api/admin/vault/secrets/:id',{params:{id:'vault-206'},body:{name:'Hijack',kind:'password',expiresAt:null,expectedRevision:1}});
check('Inventory key pool secrets reject generic Vault lifecycle operations',()=>assert.equal(out.getStatus(),409));
console.log(`${passed}/${passed} Inventory/Vault workspace checks passed`);
