import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const root=path.resolve(import.meta.dirname,'../..');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cluster-f4p11-runtime-'));
let n=0;const eq=(a,b,m)=>{assert.deepEqual(a,b,m);n++};const yes=(b,m)=>{assert.ok(b,m);n++};
try {
 const sources=[
  ['apps/server/src/core/acceleration/cluster-acceleration-runtime.ts','acceleration/cluster-acceleration-runtime.js'],
  ['apps/server/src/core/acceleration/redis-protocol-safety.ts','acceleration/redis-protocol-safety.js'],
  ['apps/server/src/core/acceleration/redis-compatibility.ts','acceleration/redis-compatibility.js'],
  ['apps/server/src/core/bounded-cache.ts','bounded-cache.js']
 ];
 for(const [src,dst] of sources){
  const target=path.join(dir,dst);fs.mkdirSync(path.dirname(target),{recursive:true});
  fs.writeFileSync(target,ts.transpileModule(fs.readFileSync(path.join(root,src),'utf8'),{
   compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}
  }).outputText);
 }
 const redisDir=path.join(dir,'node_modules/@redis/client');fs.mkdirSync(redisDir,{recursive:true});
 fs.writeFileSync(path.join(redisDir,'index.js'),`const db=new Map(),channels=new Map();
 function makeClient(){const handlers={};return {
  isReady:false,
  on(name,cb){handlers[name]=cb;return this},
  duplicate(){return makeClient()},
  async connect(){this.isReady=true;handlers.ready?.();},
  async quit(){this.isReady=false;handlers.end?.();},
  disconnect(){this.isReady=false;handlers.end?.();},
  async ping(){return 'PONG'},
  async set(k,v,o={}){if(o.NX && db.has(k))return null;db.set(k,{value:v,ttl:Date.now()+Number(o.PX||10000)});return 'OK'},
  async get(k){return db.get(k)?.value??null},
  async del(keys){let n=0;for(const key of Array.isArray(keys)?keys:[keys]){if(db.delete(key))n++}return n},
  async subscribe(k,cb){channels.set(k,cb)},
  async unsubscribe(k){channels.delete(k)},
  async publish(k,m){const cb=channels.get(k);if(cb)queueMicrotask(()=>cb(m));return cb?1:0},
  async sendCommand(args){const [cmd,script,,key,...vals]=args;
   if(cmd==='PTTL')return (db.get(args[1])?.ttl||0)-Date.now();
   if(cmd!=='EVAL')throw Error('Unexpected command');
   if(process.env.CLUSTER_TEST_NO_LUA==='1')throw Error('ERR unknown command EVAL');
   if(script.includes("redis.call('GET'")){const item=db.get(key);if(!item||item.value!==vals[0])return 0;db.delete(key);return 1}
   const previous=db.get(key),count=Number(previous?.value||0)+Number(vals[0]);
   db.set(key,{value:String(count),ttl:previous?.ttl||Date.now()+Number(vals[1])});
   return [count,db.get(key).ttl-Date.now()];
  }
 }}
 module.exports={createClient:makeClient};`);
 const {ClusterAccelerationRuntime}=require(path.join(dir,'acceleration/cluster-acceleration-runtime.js'));
 process.env.CLUSTER_TEST_NO_LUA='0';
 const healthy=new ClusterAccelerationRuntime({redisUrl:'redis://127.0.0.1:6379',mode:'auto'});
 const started=await healthy.start();
 eq(started.distributed,true,'fully capable backend activates Redis');
 eq(started.activeBackend,'redis','healthy backend is distributed');
 const cached=await healthy.checkConfiguredCompatibility();
 eq(cached.cached,true,'first manual check uses verified connection evidence');
 await healthy.close();
 process.env.CLUSTER_TEST_NO_LUA='1';
 const fallback=new ClusterAccelerationRuntime({redisUrl:'redis://127.0.0.1:6379',mode:'auto'});
 const degraded=await fallback.start();
 eq(degraded.distributed,false,'unsupported Lua rejected automatically');
 eq(degraded.activeBackend,'memory','auto mode remains usable via memory fallback');
 eq(degraded.lastRedisError,'REDIS_UNSUPPORTED_COMMAND','unsupported commands classified without secrets');
 await fallback.close();
 const required=new ClusterAccelerationRuntime({redisUrl:'redis://127.0.0.1:6379',mode:'redis-required'});
 let threw=false;
 try { await required.start() } catch(error) {threw=true;yes(/required but unavailable/.test(error.message),'required backend refuses incompatible startup');yes(!('cause' in error),'no raw transport cause leaked')} 
 eq(threw,true,'incompatible required mode rejects startup');
 await required.close();
 process.env.CLUSTER_TEST_NO_LUA='0';
 console.log(`${n}/${n} F4 P11 live runtime simulation assertions passed (isolated fake RESP backend, not Garnet)`);
} finally {delete process.env.CLUSTER_TEST_NO_LUA;fs.rmSync(dir,{recursive:true,force:true});}
