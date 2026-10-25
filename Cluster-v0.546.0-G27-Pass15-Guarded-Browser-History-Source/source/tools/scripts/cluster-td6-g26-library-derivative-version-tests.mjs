#!/usr/bin/env node
/** G26 source-version/authorization regression for Library preview discovery and streaming. */
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = require('typescript');
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('PASS G26 '+name); }
function load(filename, mocks={}) {
  const code = ts.transpileModule(readFileSync(filename,'utf8'), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
  const mod = {exports:{}};
  const fallback = new Proxy({}, {get(_,key){ if(key==='__esModule')return false; return (...args)=>({}); }});
  vm.runInNewContext(code,{module:mod,exports:mod.exports,require(name){return name in mocks ? mocks[name] : name.startsWith('node:') ? require(name) : fallback;},Buffer,Date,JSON,Number,Set,Map,Object,Array,Error,Promise,console}, {filename});
  return mod.exports;
}
const helper = load('apps/server/src/domains/library/library-derivative-version.ts');
const pathSafety = load('apps/server/src/domains/library/library-derivative-file-safety.ts');
const shaA = 'a'.repeat(64), shaB = 'b'.repeat(64);
const item = {id:'lib1',type:'file',fileName:'main.png',checksumSha256:shaA,lifecycleState:'active',title:'Preview'};
const ready = {id:'d1',itemId:'lib1',sourceChecksumSha256:shaA,status:'ready',storagePath:'valid',invalidatedAt:null,kind:'thumbnail'};
await test('current ready derivative is eligible',()=>{
 assert.equal(helper.libraryDerivativeIsDeliverable(item,ready),true);
 assert.equal(helper.libraryDerivativeClientState(item,ready).availabilityReason,null);
});
await test('old checksum invalidates otherwise-ready derivative',()=>{
 const state=helper.libraryDerivativeClientState(item,{...ready,sourceChecksumSha256:shaB});
 assert.equal(state.currentVersion,false);assert.equal(state.status,'stale');assert.equal(state.available,false);
 assert.equal(state.availabilityReason,'source-version-changed');
});
await test('checksum equivalence is case-insensitive but rejects malformed or absent checksums',()=>{
 assert.equal(helper.libraryDerivativeMatchesSource({...item,checksumSha256:'A'.repeat(64)},ready),true);
 assert.equal(helper.libraryDerivativeMatchesSource({...item,checksumSha256:null},ready),false);
 assert.equal(helper.libraryDerivativeMatchesSource(item,{...ready,sourceChecksumSha256:'not-a-checksum'}),false);
});
await test('metadata, missing storage, disabled and invalidated previews are not deliverable',()=>{
 for(const value of [{...ready,storagePath:null},{...ready,status:'deferred'},{...ready,invalidatedAt:new Date()}, {...ready,status:'failed'}]) assert.equal(helper.libraryDerivativeIsDeliverable(item,value),false);
});
await test('destroyed sources and folder sources never authorize previews',()=>{
 assert.equal(helper.libraryDerivativeMatchesSource({...item,lifecycleState:'destroyed'},ready),false);
 assert.equal(helper.libraryDerivativeMatchesSource({...item,type:'folder'},ready),false);
});
const viewer=load('apps/server/src/domains/media/viewable-resource.ts',{
 '@cluster/shared':{inferReviewMediumFromResource:()=> 'image',resolveViewableFormatSupport:()=>({support:'native',reason:null})},
 '../library/library-derivative-version.js':helper
});
await test('shared media viewer never advertises other-version preview URLs',()=>{
 const result=viewer.libraryItemViewableResource(item,[ready,{...ready,id:'old',sourceChecksumSha256:shaB},{...ready,id:'invalid',invalidatedAt:new Date()},{...ready,id:'failed',status:'failed'}]);
 assert.equal(result.derivatives.length,1);assert.equal(result.derivatives[0].id,'d1');
});
let copyrightHeld=false, accessAllowed=true, lastDelivery=null;
const temp=mkdtempSync(path.join(tmpdir(),'cluster-g26-derivatives-'));
const runtimeRoot=path.join(temp,'runtime');
const cacheRoot=path.join(runtimeRoot,'library-derivatives','lib1');mkdirSync(cacheRoot,{recursive:true});
const fullPath=path.join(cacheRoot,'thumb.png'); writeFileSync(fullPath,Buffer.from('correct-preview'));
try {
  const app={handlers:new Map(), get(url,fn){this.handlers.set('GET '+url,fn);},post(url,fn){this.handlers.set('POST '+url,fn);},put(){},delete(){},patch(){}};
  const zpart=new Proxy({}, {get(_o,k){return k==='parse'?(value)=>value:k==='optional'||k==='nullable'||k==='default'||k==='min'||k==='max'||k==='trim'||k==='regex'?()=>zpart:()=>zpart;}});
  const z=new Proxy({}, {get:()=>()=>zpart});
  const rows=[{...ready,storagePath:fullPath},{...ready,id:'old',sourceChecksumSha256:shaB,storagePath:fullPath}];
  const prisma={libraryItem:{findUnique:async()=>item},personnelRecordAttachment:{findFirst:async()=>null},libraryDerivative:{findMany:async()=>rows,findFirst:async({where})=>rows.find(r=>r.id===where.id)||null}};
  const fakeDelivery=(_req,_reply,config)=>{lastDelivery=config;return {streamed:true};};
  const routes=load('apps/server/src/domains/library/library-9e2-routes.ts',{
    'zod':{z},
    '../../core/uploads.js':{},
    '../media/resource-delivery.js':{sendStoredResource:fakeDelivery},
    '../../core/copyright-workflow.js':{isCopyrightResourceDisabled:async()=>copyrightHeld,copyrightDisabledResponse:(reply)=>reply.code(451).send({code:'COPYRIGHT_HOLD'})},
    './library-derivative-version.js':helper,
    './library-derivative-file-safety.js':pathSafety,
  });
  routes.registerLibrary9E2Routes({app,prisma,operationRuntime:{},collaborationRuntime:{},libraryAccess:{canAccessItem:async()=>accessAllowed},dataLayout:{runtimeRoot},storageRuntime:{},getCurrentUser:async()=>({id:'u1'}),decorateUserForClient:async()=>({isAdmin:false,workspaceRole:'member'}),hasToolPermission:()=>true,logActivity:async()=>{}});
  function reply(){return{statusCode:200,headers:{},body:null,code(status){this.statusCode=status;return this;},header(k,v){this.headers[k]=v;return this;},send(body){this.body=body;return this;}};}
  const list=app.handlers.get('GET /api/library/:itemId/derivatives');
  const file=app.handlers.get('GET /api/library/:itemId/derivatives/:derivativeId/file');
  await test('authorized discovery marks old preview stale without delivering its URL',async()=>{
    const r=reply(), result=await list({params:{itemId:'lib1'}},r);
    assert.equal(result.derivatives.length,2);
    assert.equal(result.derivatives[0].fileUrl,'/api/library/lib1/derivatives/d1/file');
    assert.equal(result.derivatives[1].status,'stale');assert.equal(result.derivatives[1].fileUrl,null);
    assert.equal(r.headers['Cache-Control'],'private, no-store');
  });
  await test('old source version is rejected by delivery before a stream is opened',async()=>{
    lastDelivery=null;const r=reply();await file({params:{itemId:'lib1',derivativeId:'old'}},r);
    assert.equal(r.statusCode,409);assert.equal(r.body.code,'LIBRARY_DERIVATIVE_SOURCE_CHANGED');assert.equal(lastDelivery,null);
  });
  await test('current version streams with no-store auth-aware caching',async()=>{
    lastDelivery=null;const result=await file({params:{itemId:'lib1',derivativeId:'d1'}},reply());
    assert.equal(result.streamed,true);assert.equal(lastDelivery.cacheControl,'private, no-store');
  });
  await test('copyright hold denies derivative discovery and delivery',async()=>{
    copyrightHeld=true;lastDelivery=null;
    const a=reply(),b=reply();await list({params:{itemId:'lib1'}},a);await file({params:{itemId:'lib1',derivativeId:'d1'}},b);
    assert.equal(a.statusCode,451);assert.equal(b.statusCode,451);assert.equal(lastDelivery,null);copyrightHeld=false;
  });
  await test('revoked ACL blocks stale URL delivery on each request',async()=>{
    accessAllowed=false;lastDelivery=null;
    const r=reply();await file({params:{itemId:'lib1',derivativeId:'d1'}},r);
    assert.equal(r.statusCode,403);assert.equal(lastDelivery,null);accessAllowed=true;
  });
  await test('regular managed cache files are allowed',async()=>{
    assert.equal(await pathSafety.validateManagedDerivativePath(path.join(runtimeRoot,'library-derivatives'),fullPath),fullPath);
  });
  await test('symlinked derivative bytes are denied',async()=>{
    const {symlinkSync}=require('node:fs');const other=path.join(temp,'secret.txt');writeFileSync(other,'sensitive');
    const linked=path.join(cacheRoot,'symlink.png');symlinkSync(other,linked);
    assert.equal(await pathSafety.validateManagedDerivativePath(path.join(runtimeRoot,'library-derivatives'),linked),null);
    const old=rows[0].storagePath;rows[0].storagePath=linked;const r=reply();await file({params:{itemId:'lib1',derivativeId:'d1'}},r);
    assert.equal(r.statusCode,409);rows[0].storagePath=old;
  });
  await test('symlinked parent cache directories are denied',async()=>{
    const {symlinkSync}=require('node:fs');const link=path.join(runtimeRoot,'library-derivatives','linked');symlinkSync(cacheRoot,link,'dir');
    assert.equal(await pathSafety.validateManagedDerivativePath(path.join(runtimeRoot,'library-derivatives'),path.join(link,'thumb.png')),null);
  });
  await test('cache path escape is denied even with current checksum',async()=>{
    const old=rows[0].storagePath;rows[0].storagePath=path.join(temp,'outside.png');
    const r=reply();await file({params:{itemId:'lib1',derivativeId:'d1'}},r);
    assert.equal(r.statusCode,409);assert.equal(r.body.code,'LIBRARY_DERIVATIVE_PATH_INVALID');rows[0].storagePath=old;
  });
} finally {rmSync(temp,{recursive:true,force:true});}
await test('derivative worker uses version-conditional preview text and pre-publication recheck',()=>{
 const code=readFileSync('apps/server/src/domains/library/library-9e2-jobs.ts','utf8');
 assert.match(code,/libraryItem\.updateMany\(\{ where: \{ id: item\.id, checksumSha256: parsed\.sourceChecksumSha256, revision: item\.revision \}/);
 assert.match(code,/const currentSource = await input\.prisma\.libraryItem\.findUnique/);
 assert.match(code,/currentSource\.revision !== item\.revision/);
});
console.log(`${passed}/${passed} G26 Library source-version checks passed`);
