import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const root=path.resolve(import.meta.dirname,'../..');
const source=fs.readFileSync(path.join(root,'apps/server/src/core/acceleration/redis-protocol-safety.ts'),'utf8');
const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
assert.equal(output.diagnostics.filter(x=>x.category===ts.DiagnosticCategory.Error).length,0);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cluster-redis-rate-safety-'));
let n=0; const eq=(a,b,m)=>{assert.deepEqual(a,b,m);n++};
try {
 fs.writeFileSync(path.join(dir,'impl.cjs'),output.outputText);
 const {validatedRateLimitReply:decode,classifyRedisFailure:classify}=require(path.join(dir,'impl.cjs'));
 const good=[[1,10000],[2,9000],[99,1],["2","3000"],[2n,9999n]];
 for(const v of good) eq(decode(v,1,10000),{count:Number(v[0]),remainingTtl:Number(v[1])},'valid RESP integers');
 const invalid=[null,undefined,0,1,'OK','1,10000',{},[],[1],[1,10000,2],[0,10000],[-1,10000],[1,-1],[1,0],[1,-2],[1,10001],[1,Infinity],[Infinity,100],[NaN,100],[2.5,100],[2,'abc'],['1e309',100],[Number.MAX_SAFE_INTEGER+1,100],[1,new Date()],[1,{}]];
 for(const v of invalid) eq(decode(v,1,10000),null,'invalid / stale / unbounded Lua reply fails closed');
 eq(decode([1,100],2,10000),null,'count below request cost invalid');
 eq(decode([2,100],2,10000),{count:2,remainingTtl:100},'multi-token cost preserved');
 for(const [text,code] of [
  ['NOAUTH Authentication required. redis://admin:password@127.0.0.1:6379','REDIS_AUTH_FAILURE'],
  ['ETIMEDOUT redis://u:secret@host/?token=abc','REDIS_TIMEOUT'],
  ['ECONNREFUSED something secret','REDIS_UNREACHABLE'],
  ['ERR unknown command EVAL','REDIS_UNSUPPORTED_COMMAND'],
  ['Invalid rate-limit reply from redis://u:password@host','REDIS_INVALID_REPLY'],
  ['redis://u:password@host/?token=abc','REDIS_BACKEND_FAILURE']
 ]) { const result=classify(new Error(text));eq(result,code,'redacted category');eq(result.includes('secret')||result.includes('password')||result.includes('token'),false,'no sensitive error content'); }
 // Exercise the actual runtime method with an isolated mock command transport.
 const files=[
  ['apps/server/src/core/acceleration/cluster-acceleration-runtime.ts','acceleration/cluster-acceleration-runtime.js'],
  ['apps/server/src/core/acceleration/redis-protocol-safety.ts','acceleration/redis-protocol-safety.js'],
  ['apps/server/src/core/acceleration/redis-compatibility.ts','acceleration/redis-compatibility.js'],
  ['apps/server/src/core/bounded-cache.ts','bounded-cache.js'],
 ];
 for(const [srcName,outName] of files) {
  const target=path.join(dir,outName);fs.mkdirSync(path.dirname(target),{recursive:true});
  const translated=ts.transpileModule(fs.readFileSync(path.join(root,srcName),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
  fs.writeFileSync(target,translated.outputText);
 }
 const {ClusterAccelerationRuntime}=require(path.join(dir,'acceleration/cluster-acceleration-runtime.js'));
 const accel=new ClusterAccelerationRuntime({mode:'auto',redisUrl:'redis://127.0.0.1:6379'});
 const fake={isReady:true,async sendCommand(){return [1,9000]}};
 accel.command=fake;accel.subscriber={isReady:true};accel.redisSubscribed=true;accel.redisConnected=true;
 eq(accel.isDistributed(),true,'mock distributed backend available');
 const actual=await accel.consumeFixedWindow('auth:real',3,10000,1,1_000_000);
 eq(actual?.allowed,true,'valid backend grants request');
 eq(actual?.remaining,2,'remaining quota is accurate');
 const invalidReplies=[null,'OK',[1],[0,9000],[1,-1],[1,NaN],[1,Infinity],[99,12000]];
 for(const invalid of invalidReplies){
  accel.command={...fake,async sendCommand(){return invalid}};
  accel.redisConnected=true;
  eq(await accel.consumeFixedWindow('auth:real',3,10000,1,1_000_000),null,'malformed reply returns PostgreSQL fallback');
  eq(accel.snapshot().lastRedisError,'REDIS_INVALID_REPLY','malformed reply never publishes transport content');
 }
 accel.compatibilityCached={at:Date.now(),result:{status:'passed'}};
 accel.noteRedisError(new Error('backend failed redis://admin:password@example.com?token=secret'));
 eq(accel.compatibilityCached,null,'on failure previous compatibility evidence invalidated');
 eq(accel.snapshot().lastRedisError,'REDIS_BACKEND_FAILURE','no credentials in snapshot');
 const runtime=fs.readFileSync(path.join(root,'apps/server/src/core/acceleration/cluster-acceleration-runtime.ts'),'utf8');
 for(const snippet of ['validatedRateLimitReply(result, cost, ttl)','if (!validated)', 'return null; // PostgreSQL fallback','classifyRedisFailure(error)','this.compatibilityCached = null;']) {
   eq(runtime.includes(snippet),true,'runtime wired '+snippet);
 }
 eq(runtime.includes('Array.isArray(result) ? result[0] : cost'),false,'malformed Lua no longer assumes allowed cost');
 eq(runtime.includes('{ error, backend: "memory" }'),false,'raw connection errors excluded from logger');
 eq(runtime.includes('{ cause: error }'),false,'required-mode startup error does not leak raw cause');
 console.log(`${n}/${n} F4 P9 Redis rate-limit safety assertions passed`);
} finally {fs.rmSync(dir,{recursive:true,force:true});}
