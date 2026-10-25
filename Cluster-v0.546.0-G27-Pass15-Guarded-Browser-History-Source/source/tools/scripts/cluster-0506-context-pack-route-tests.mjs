import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const ts = (()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js'))}})();
const compile = (filename) => ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function loadHelper(){const module={exports:{}};vm.runInNewContext(compile('apps/server/src/core/server-config-preconditions.ts'),{module,exports:module.exports});return module.exports;}
const helper=loadHelper();
const chain=()=>({min(){return this},max(){return this},optional(){return this},nullable(){return this}});const z={string:chain,boolean:chain,object:()=>({parse:(x)=>x}),unknown:chain};
function routes(deps){
 const handlers=new Map(),app={};
 for(const verb of ['get','post','delete'])app[verb]=(url,handle)=>handlers.set(`${verb.toUpperCase()} ${url}`,handle);
 const module={exports:{}};
 const mockRequire=(id)=>id==='zod'?{z}:id.endsWith('server-config-preconditions.js')?helper:id.endsWith('setting-crypto.js')?{encryptContextPackStorageValue:JSON.stringify}:id.endsWith('context-pack-policy.js')?{validateContextPackImport:x=>x,ContextPackValidationError:class ContextPackValidationError extends Error {}}:{};
 vm.runInNewContext(compile('apps/server/src/app/server-routes-context-packs.ts'),{module,exports:module.exports,require:mockRequire});
 module.exports.registerContextPackRoutes({app,...deps});return handlers;
}
const expectedRoutes=['GET /api/context-packs','POST /api/context-packs/from-settings','POST /api/context-packs/from-settings-with-secrets','POST /api/context-packs/import','GET /api/context-packs/:packId/export','POST /api/context-packs/:packId/secret-export','POST /api/context-packs/:packId/apply','DELETE /api/context-packs/:packId'];
let passed=0,total=0;
async function check(label,fn){total++;try{await fn();passed++;console.log(`PASS ${label}`)}catch(e){console.error(`FAIL ${label}: ${e.stack}`);process.exitCode=1}}
await check('unauthorized user cannot touch any Context Pack DB operation',async()=>{
 let hits=0,adminChecks=0;
 const handlers=routes({authorization:{requireAdmin:async()=>{adminChecks++;return null}},prisma:{contextPack:new Proxy({},{get:()=>async()=>{hits++;}})}});
 assert.equal(handlers.size,8);
 for(const route of expectedRoutes){const reply={header:()=>reply,code:()=>reply,send:()=>undefined};assert.equal(await handlers.get(route)({params:{packId:'p'}},reply),undefined);}
 assert.equal(adminChecks,8);assert.equal(hits,0);
});
await check('authorized Context Pack apply commits only selected settings',async()=>{
 let saved=null;const reports=[];
 const handlers=routes({authorization:{requireAdmin:async()=>({id:'owner'})},getCurrentUser:async()=>({id:'owner'}),prisma:{contextPack:{findUniqueOrThrow:async()=>({id:'p',payload:'{}',name:'Config'})}},parseContextPayload:()=>({settings:{}}),pickContextPackSettings:()=>({discordGuildId:'NEW'}),readSettings:async()=>({discordGuildId:'OLD',sessionDays:7,other:'untouched'}),settingsForClient:x=>x,saveSettings:async(...args)=>{saved=args},logActivity:async(x)=>{reports.push(x)}});
 const reply={code:(n)=>{throw Error(`unexpected status ${n}`)},send:()=>{throw Error('unexpected send')}};
 const result=await handlers.get('POST /api/context-packs/:packId/apply')({params:{packId:'p'}},reply);
 assert.equal(result.ok,true);assert.deepEqual(JSON.parse(JSON.stringify(saved[0])),{});assert.deepEqual(JSON.parse(JSON.stringify(saved[1])),{changedFields:{discordGuildId:'NEW'},expectedSettings:{discordGuildId:{exists:true,value:'OLD'}}});assert.equal(reports.length,1);
});
await check('stale Context Pack apply responds with 409 and no activity record',async()=>{
 let reports=0,status=null,body=null;
 const handlers=routes({authorization:{requireAdmin:async()=>({id:'owner'})},getCurrentUser:async()=>({id:'owner'}),prisma:{contextPack:{findUniqueOrThrow:async()=>({payload:'{}'})}},parseContextPayload:()=>({}),pickContextPackSettings:()=>({discordGuildId:'NEW'}),readSettings:async()=>({discordGuildId:'OLD'}),settingsForClient:x=>x,saveSettings:async()=>{const error=new Error('Another admin edited this setting');error.code='SERVER_CONFIG_CONFLICT';error.conflictingKeys=['discordGuildId'];throw error},logActivity:async()=>{reports++}});
 const reply={code:(n)=>{status=n;return reply},send:(x)=>{body=x;return x}};
 await handlers.get('POST /api/context-packs/:packId/apply')({params:{packId:'p'}},reply);
 assert.equal(status,409);assert.equal(body.code,'SERVER_CONFIG_CONFLICT');assert.equal(reports,0);
});
await check('empty Context Pack cannot trigger a storage rewrite',async()=>{
 let writes=0,status=null;
 const handlers=routes({authorization:{requireAdmin:async()=>({id:'owner'})},getCurrentUser:async()=>({id:'owner'}),prisma:{contextPack:{findUniqueOrThrow:async()=>({payload:'{}'})}},parseContextPayload:()=>({}),pickContextPackSettings:()=>({}),readSettings:async()=>({}),saveSettings:async()=>{writes++}});
 const reply={code:(n)=>{status=n;return reply},send:(x)=>x};
 await handlers.get('POST /api/context-packs/:packId/apply')({params:{packId:'p'}},reply);
 assert.equal(status,400);assert.equal(writes,0);
});
console.log(`${passed}/${total} Context Pack route behavior tests passed`);if(passed!==total)process.exitCode=1;
