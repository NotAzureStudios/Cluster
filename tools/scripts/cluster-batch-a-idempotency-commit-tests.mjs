#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const ts=require('typescript');
const code=ts.transpileModule(readFileSync('apps/server/src/core/idempotency.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
const module={exports:{}};
vm.runInNewContext(code,{module,exports:module.exports,require:name=> name==='./reliability-context.js'?{currentReliabilityContext:()=>null}:require(name),Buffer,Date,Set,Map,WeakMap,String,URLSearchParams,JSON,console}, {filename:'idempotency.ts'});
const {registerIdempotencyHooks}=module.exports;
const key='batch-a-retry-safe-key';
let checks=0;
async function check(name,fn){await fn();checks++;console.log('PASS '+name);}
const held=new Map();
let sequence=0;
const prisma={apiMutationReceipt:{
 create:async({data})=>{const compound=[data.userId,data.method,data.path,data.idempotencyKey].join('|');if(held.has(compound))throw Object.assign(new Error('Unique'),{code:'P2002'});const row={...data,id:String(++sequence)};held.set(compound,row);return row;},
 findFirst:async({where})=> held.get([where.userId,where.method,where.path,where.idempotencyKey].join('|')) || null,
 updateMany:async({where,data})=>{const row=[...held.values()].find(x=>x.id===where.id);if(row&&row.state===where.state){Object.assign(row,data);return{count:1}}return{count:0}},
 deleteMany:async()=>({count:0})
}};
const hooks=new Map();
const logger={error:()=>{},warn:()=>{}};
registerIdempotencyHooks({addHook:(name,cb)=>hooks.set(name,cb),log:logger},prisma);
function request(id,{userId='a',path='/api/packets/some-packet/releases',method='POST',body={kind:'release'}}={}){
 return {id,clusterUser:{id:userId},headers:{'x-cluster-idempotency-key':key},url:path,method,body,log:logger};
}
function reply({status=200,noStore=true}={}){
 const headers=new Map(noStore?[['cache-control','no-store']]:[]);
 return {statusCode:status,sent:false,headers,payload:null,getHeader:name=>headers.get(name.toLowerCase()),header(name,value){headers.set(name.toLowerCase(),value);return this},code(code){this.statusCode=code;return this},send(body){this.payload=body;this.sent=true;return this}};
}
await check('first mutation reserves one PostgreSQL receipt before work',async()=>{
 const req=request('1'),res=reply();await hooks.get('preHandler')(req,res);
 assert.equal(res.sent,false);assert.equal(held.size,1);
 await hooks.get('onSend')(req,res,JSON.stringify({ok:true,releaseId:'confidential'}));
 const saved=[...held.values()][0];
 assert.equal(saved.state,'complete'); assert.equal(saved.responsePayload,null);
 assert.equal(saved.statusCode,200);
});
await check('same authenticated intent confirms committed result without leaking private response',async()=>{
 const res=reply();await hooks.get('preHandler')(request('2'),res);
 assert.equal(res.statusCode,409); assert.equal(res.payload.code,'IDEMPOTENCY_ALREADY_COMMITTED');
 assert.equal(res.payload.retryable,false);
 assert.equal(res.headers.get('x-cluster-original-status'),'200');
 assert.ok(!JSON.stringify(res.payload).includes('confidential'));
});
await check('request fingerprint mismatch rejects key reuse',async()=>{
 const res=reply();await hooks.get('preHandler')(request('3',{body:{kind:'different'}}),res);
 assert.equal(res.statusCode,409);assert.equal(res.payload.code,'IDEMPOTENCY_KEY_REUSED');
});
await check('new request cannot replay an uncommitted claim',async()=>{
 const req=request('4',{path:'/api/packets/other/releases'}),res=reply();await hooks.get('preHandler')(req,res);
 const retry=reply();await hooks.get('preHandler')(request('5',{path:'/api/packets/other/releases'}),retry);
 assert.equal(retry.payload.code,'IDEMPOTENCY_IN_PROGRESS');
});
await check('server-error/no-store stays uncertain, never incorrectly claims a commit',async()=>{
 const req=request('6',{path:'/api/packets/error/releases'}),res=reply({status:503});await hooks.get('preHandler')(req,res);await hooks.get('onSend')(req,res,JSON.stringify({ok:false,code:'DISK_ERROR'}));
 const retry=reply();await hooks.get('preHandler')(request('7',{path:'/api/packets/error/releases'}),retry);
 assert.equal(retry.payload.code,'IDEMPOTENCY_RESULT_UNKNOWN');
});
await check('exact replay remains possible on deliberately public non-no-store response',async()=>{
 const req=request('8',{path:'/api/packets/public/releases'}),res=reply({noStore:false});await hooks.get('preHandler')(req,res);
 await hooks.get('onSend')(req,res,JSON.stringify({ok:true,value:3}));
 const retry=reply();await hooks.get('preHandler')(request('9',{path:'/api/packets/public/releases'}),retry);
 assert.equal(retry.statusCode,200);assert.equal(retry.headers.get('x-cluster-idempotency-replayed'),'true');assert.equal(retry.payload.value,3);
});
await check('receipt identity is user-scoped, not a global key collision',async()=>{
 const res=reply();await hooks.get('preHandler')(request('10',{userId:'b'}),res);
 assert.equal(res.sent,false);assert.equal(held.size,5);
});
console.log(`Durable idempotency commit/response privacy ${checks}/${checks} passed`);
