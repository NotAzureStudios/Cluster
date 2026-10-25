import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const root=path.resolve(import.meta.dirname,'../..');
const src=fs.readFileSync(path.join(root,'apps/server/src/core/acceleration/redis-compatibility.ts'),'utf8');
const compiled=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
assert.equal(compiled.diagnostics.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cluster-redis-check-'));
let n=0;const eq=(a,b,m)=>{assert.deepEqual(a,b,m);n++};const yes=(b,m)=>{assert.ok(b,m);n++};
class FakeRedis {
 constructor({failEval=false,failPubsub=false,leakError=false}={}) {this.db=new Map();this.channels=new Map();this.failEval=failEval;this.failPubsub=failPubsub;this.leakError=leakError;this.commands=[];}
 async ping(){return 'PONG'}
 async set(key,value,opt={}){this.commands.push('SET');if(opt.NX && this.db.has(key))return null;this.db.set(key,{value,expires:Date.now()+Number(opt.PX||12000)});return 'OK'}
 async get(key){return this.db.get(key)?.value??null}
 async del(key){const keys=Array.isArray(key)?key:[key];let count=0;for(const k of keys){if(this.db.delete(k))count++}return count}
 async sendCommand(args){this.commands.push(args[0]);const [command,script,numKeys,key,...argv]=args;
  if(command==='PTTL'){const record=this.db.get(args[1]);return record?record.expires-Date.now():-2;}
  if(command==='EVAL'){
   if(this.leakError)throw new Error('redis://user:secret@example.com/0');
   if(this.failEval)throw new Error('unknown command EVAL');
   if(script.includes("redis.call('GET'")){const entry=this.db.get(key);if(!entry||entry.value!==argv[0])return 0;this.db.delete(key);return 1}
   if(script.includes("redis.call('INCRBY'")){const original=this.db.get(key);const current=Number(original?.value||0)+Number(argv[0]);this.db.set(key,{value:String(current),expires:original?.expires??(Date.now()+Number(argv[1]))});return [current, this.db.get(key).expires-Date.now()]}
  }
  throw new Error('Unsupported fake command '+command);
 }
 duplicate(){const store=this;let channel=null;return {async connect(){},async subscribe(name,cb){if(store.failPubsub)throw new Error('pubsub disabled');channel=name;store.channels.set(name,cb)},async unsubscribe(name){store.channels.delete(name)},async quit(){},disconnect(){}}}
 async publish(channel,message){this.commands.push('PUBLISH');const handler=this.channels.get(channel);if(handler)queueMicrotask(()=>handler(message));return handler?1:0}
}
try {
 fs.writeFileSync(path.join(dir,'redis-check.cjs'),compiled.outputText);
 const {runRedisProtocolCompatibility:check}=require(path.join(dir,'redis-check.cjs'));
 const client=new FakeRedis();
 const result=await check({command:client,prefix:'cluster:test',nonce:'abcdefgh12345678',now:()=>1000000});
 eq(result.status,'passed','supported commands fully pass');
 eq(result.checkedAt,new Date(1000000).toISOString(),'time stable');
 eq(result.steps.length,6,'all six commands checked');
 for(const [i,command] of ['PING','SET_GET_PTTL','SET_NX_PX','EVAL_LEASE','EVAL_RATE_LIMIT','PUBSUB'].entries()){
  eq(result.steps[i].command,command,'command '+command);
  eq(result.steps[i].ok,true,command+' supported');
  eq(result.steps[i].code,'SUPPORTED',command+' explicit supported code');
 }
 eq(client.db.size,0,'all temporary probe keys deleted');
 eq(client.channels.size,0,'temporary pubsub subscriber cleaned');
 yes(!JSON.stringify(result).includes('abcdefgh12345678'),'nonce not included in UI response');
 eq(result.backend,'configured-redis','backend not product identification');
 const noLua=await check({command:new FakeRedis({failEval:true}),prefix:'cluster',nonce:'bad12345'});
 eq(noLua.status,'failed','missing Lua compatibility blocks all-passed');
 eq(noLua.steps.filter(x=>!x.ok).length,2,'missing Lua identifies lease and limiter');
 eq(noLua.steps.at(-1).ok,true,'PubSub remains independent of Lua failure');
 const noPubsub=await check({command:new FakeRedis({failPubsub:true}),prefix:'cluster',nonce:'abcdefgh'});
 eq(noPubsub.status,'failed','PubSub failure blocks all-passed');
 eq(noPubsub.steps.at(-1).ok,false,'PubSub failure accurately reflected');
 const secret=await check({command:new FakeRedis({leakError:true}),prefix:'cluster',nonce:'abcdefgh'});
 eq(secret.status,'failed','error condition fails');
 eq(JSON.stringify(secret).includes('redis://user:secret'),false,'no credential-bearing errors in result');
 for(const step of secret.steps){yes(!step.code.includes('secret'),step.command+' generic errors')}
 const injected=new FakeRedis();
 await check({command:injected,prefix:'tenant:weird?@/../../',nonce:'abcdefgh'});
 eq(injected.db.size,0,'suspicious prefix cannot leave persistent keys');
 const routing=fs.readFileSync(path.join(root,'apps/server/src/app/server-routes-health-operations.ts'),'utf8');
 const part=routing.slice(routing.indexOf('app.post("/api/admin/operations/acceleration/compatibility-check"'),routing.indexOf('app.get("/api/admin/operations/performance"'));
 for(const phrase of ['requireAdminUserForRequest(request, reply)','z.object({}).strict().parse(request.body || {})','Cache-Control", "no-store"','checkConfiguredCompatibility()'])yes(part.includes(phrase),'admin on-demand route '+phrase);
 eq(part.includes('fetch('),false,'no arbitrary remote URL');
 const runtime=fs.readFileSync(path.join(root,'apps/server/src/core/acceleration/cluster-acceleration-runtime.ts'),'utf8');
 for(const phrase of ['async checkConfiguredCompatibility()', 'if (!snapshot.distributed || !this.command)','if (this.compatibilityPromise)','< 120_000','this.compatibilityCached = null','runRedisProtocolCompatibility({command, prefix:this.keyPrefix})'])yes(runtime.includes(phrase),'bounded runtime '+phrase);
 const ui=fs.readFileSync(path.join(root,'packages/renderer/src/features/admin/OperationsSystemsPanel.tsx'),'utf8');
 yes(ui.includes('Check configured backend'),'explicit check button');
 yes(ui.includes('does not identify the server product'),'product identification not implied');
 yes(ui.includes('/api/admin/operations/acceleration/compatibility-check'),'frontend wired');
 const fence=fs.readFileSync(path.join(root,'apps/server/src/core/runtime-access-state.ts'),'utf8');
 yes(fence.includes('if (input.mode === "maintenance")'),'POST mode gate still active');
 console.log(`${n}/${n} F4 P8 configured Redis compatibility assertions passed`);
}finally{fs.rmSync(dir,{recursive:true,force:true});}
