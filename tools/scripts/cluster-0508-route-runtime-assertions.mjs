import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(`${execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim()}/typescript`)}})();
let passed = 0;
function check(x, title) { assert.ok(x, title); passed++; console.log('PASS',title); }
function zStub() {
  const chain={trim(){return this},min(){return this},max(){return this},int(){return this},positive(){return this},default(){return this},optional(){return this},nullable(){return this},datetime(){return this},strict(){return this},extend(){return Object.create(this)},parse(v){return v}};
  return {object(){return Object.create(chain)},string(){return Object.create(chain)},number(){return Object.create(chain)},enum(){return Object.create(chain)},array(){return Object.create(chain)}};
}
let encrypted = new Map(), audits=[], adminAllowed=true, confirmation=true, allocationWrites=0;
const vaultRows=new Map();const routes=new Map();
const app={get:(name, fn)=>routes.set('GET '+name,fn),post:(name,fn)=>routes.set('POST '+name,fn),patch:(name,fn)=>routes.set('PATCH '+name,fn)};
const asset={id:'asset-1',title:'Editor seats',kind:'license',capacity:2,status:'active'};
const prisma={
  studioInventoryAsset:{findMany:async()=>[asset],findUnique:async()=>asset,create:async({data})=>({...asset,...data})},
  studioInventoryAllocation:{findMany:async()=>[],updateMany:async()=>({count:1})},
  studioInventoryKey:{findUnique:async()=>null},
  studioVaultSecret:{
    findMany:async()=>[...vaultRows.values()].map(({encryptedValue,...rest})=>rest),
    create:async({data})=>{vaultRows.set(data.id,data); const {encryptedValue,...rest}=data;return rest},
    findUnique:async({where})=>vaultRows.get(where.id),
    updateMany:async({where,data})=>{const row=vaultRows.get(where.id);if(!row||row.revokedAt||where.revision && row.revision!==where.revision)return {count:0};Object.assign(row,data,{revision:row.revision+1});return {count:1}}
  },
  $transaction:async(fn)=>fn({
    $queryRaw:async()=>[{id:asset.id}],
    studioInventoryAsset:{findUnique:async()=>asset},
    user:{findUnique:async()=>({id:'user-1',accountState:'ACTIVE',archived:false,accessExpiresAt:null})},
    studioInventoryAllocation:{findFirst:async()=>null,updateMany:async()=>({count:0}),aggregate:async()=>({_sum:{quantity:2}}),create:async({data})=>{allocationWrites++;return {id:'a1',...data}}}
  })
};
const mockRequire=(name)=>{
  if(name==='node:crypto')return crypto;
  if(name.endsWith('studio-inventory-approvals.js'))return {registerStudioInventoryApprovalRoutes:()=>{}};
  if(name==='zod')return {z:zStub()};
  if(name.endsWith('crypto-service.js')) return {clusterSecretFingerprint:(v)=>'sha256:'+crypto.createHash('sha256').update(v).digest('hex').slice(0,16)};
  if(name.endsWith('setting-crypto.js'))return {
    encryptionKeyConfigured:()=>true,
    encryptSecuritySecret:(purpose,value)=>{const token='vault-cipher:'+crypto.randomUUID();encrypted.set(token,{purpose,value});return token},
    decryptSecuritySecret:(purpose,token)=>{const row=encrypted.get(token);if(!row||row.purpose!==purpose)throw new Error('wrong AAD');return row.value}
  };
  throw new Error('Unknown import: '+name);
};
const source=fs.readFileSync('apps/server/src/domains/inventory/studio-inventory-vault-routes.ts','utf8');
const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const ctx={module:{exports:{}},exports:{},require:mockRequire,process,Buffer,Date,console};ctx.exports=ctx.module.exports;
vm.runInNewContext(js,ctx);
ctx.module.exports.registerStudioInventoryVaultRoutes({app,prisma,authorization:{requireAdmin:async()=>adminAllowed?{id:'admin'}:null},requireConfirmation:()=>confirmation,logSecurityEvent:async(a)=>{audits.push(a)}});
function reply() {return {status:200,code(n){this.status=n;return this},header(){return this},send(v){return v}}}
async function invoke(method,path,body,params={}){return routes.get(method+' '+path)({body,params},reply())}
check(routes.size===29,'Inventory, Vault and recipient routes registered');
adminAllowed=false;
check(await invoke('GET','/api/admin/vault/secrets')===undefined,'unauthorized users cannot enumerate Vault metadata');
adminAllowed=true;
const created=await invoke('POST','/api/admin/vault/secrets',{name:'Steam key',kind:'game_key',value:'VERY_PRIVATE_VALUE'});
check(created.ok && !JSON.stringify(created).includes('VERY_PRIVATE_VALUE'),'Vault creation response redacts secret material');
check(vaultRows.get(created.secret.id).encryptedValue!=='VERY_PRIVATE_VALUE','Vault stores encrypted rather than cleartext secret');
check(!(await invoke('GET','/api/admin/vault/secrets')).secrets[0].encryptedValue,'Vault listing omits ciphertext');
confirmation=false;
check(await invoke('POST','/api/admin/vault/secrets/:id/reveal',{}, {id:created.secret.id})===undefined,'unconfirmed reveal is denied');
confirmation=true;
const disclosed=await invoke('POST','/api/admin/vault/secrets/:id/reveal',{}, {id:created.secret.id});
check(disclosed.value==='VERY_PRIVATE_VALUE'&&audits.some(x=>x.event==='vault.secret_revealed'),'confirmed reveal audits and returns correct value');
const capacityError=await invoke('POST','/api/admin/inventory/assets/:id/allocations',{userId:'user-1',quantity:1},{id:'asset-1'});
check(capacityError.code==='INVENTORY_REVIEW_REQUIRED'&&allocationWrites===0,'direct digital seat issuance is denied without mutation');
const offboard=fs.readFileSync('apps/server/src/domains/studio-systems/studio-offboarding-routes.ts','utf8');
check(offboard.includes('inventoryPhysicalAllocationCount')&&offboard.includes('impact.inventoryPhysicalAllocationCount > 0'),'offboarding requires hardware-return disposition');
check(offboard.includes('tx.studioInventoryAllocation.updateMany')&&offboard.includes('inventoryAllocationsRevoked'),'offboarding revokes allocated seats in the identity transaction');
console.log(`${passed}/${passed} 0.508 Vault, Inventory and offboarding route assertions passed`);
