import assert from 'node:assert/strict';
import vm from 'node:vm';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js'))}})();
const code=ts.transpileModule(readFileSync(new URL('../../packages/renderer/src/core/delta-sync.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const pending=[];const meta=new Map();let owner={scope:'alice',generation:1};
const dispatched=[];const scheduled=[];const invalidated=[];
const api=(path)=>new Promise((resolve,reject)=>pending.push({path,resolve,reject}));
const offline={
  getOfflineScopeIdentity:()=>owner,
  readOfflineMeta:async(key,scope)=>meta.get(`${scope}:${key}`)??null,
  writeOfflineMeta:async(key,value,scope)=>{meta.set(`${scope}:${key}`,value)},
  clearOfflineReadScope:async(scope)=>{ for(const key of meta.keys())if(key.startsWith(`${scope}:`))meta.delete(key)},
};
const mod={exports:{}};
class ApiError extends Error{constructor(code){super(code);this.code=code}}
vm.runInNewContext(code,{module:mod,exports:mod.exports,require:name=>{
  if(name==='./api')return {ApiError,api,invalidateApiQueries:(...args)=>invalidated.push(['paths',...args]),invalidateApiQueryTags:(...args)=>invalidated.push(['tags',...args]),syncDeviceId:()=> 'device',resetSyncDeviceId:()=> 'next-device'};
  if(name==='./offline-storage')return offline;
  throw Error(`unknown dependency: ${name}`);
},window:{requestAnimationFrame:(fn)=>{scheduled.push(fn);return scheduled.length;},dispatchEvent:(event)=>dispatched.push(event),addEventListener:()=>{},removeEventListener:()=>{}},CustomEvent:class {constructor(type,data){this.type=type;this.detail=data.detail}},Map,Set,Promise,Error,Date,encodeURIComponent});
const pull=mod.exports.pullDeltaChanges;
let checks=0;const check=(name,fn)=>{fn();checks++;console.log('PASS',name)};
const spin=async(n=20)=>{for(let i=0;i<n;i++)await Promise.resolve()};
const result=(scope,entity)=>({ok:true,cursor:`cursor-${scope}`,changes:[{entityType:'project',entityId:entity}],hasMore:false});
const alicePull=pull();await spin();
check('Alice pull begins',()=>assert.equal(pending.length,1));
owner={scope:'bob',generation:2};
const bobPull=pull();await spin();
check('Bob starts a separate pull instead of adopting Alice promise',()=>assert.equal(pending.length,2));
const bobAgain=pull();await spin();
check('same account concurrent pull still coalesces',()=>assert.equal(pending.length,2));
pending[0].resolve(result('alice','private-A'));await assert.rejects(alicePull,/authenticated account changed/);
check('Alice cursor was not written under Bob',()=>assert.equal(meta.has('bob:delta-cursor:core'),false));
check('Alice delta did not invalidate Bob resources',()=>assert.equal(invalidated.length,0));
pending[1].resolve(result('bob','public-B'));await spin();
check('Bob library pull begins after his own core page',()=>assert.equal(pending.length,3));
pending[2].resolve({ok:true,cursor:'lib-bob',changes:[{entityType:'library_item',entityId:'B-asset'}],hasMore:false});
const bobResult=await bobPull;
await bobAgain;
check('Bob receives his own source result',()=>assert.equal(bobResult.changes,2));
check('Bob cursors stay in his scope',()=>{assert.equal(meta.get('bob:delta-cursor:core'),'cursor-bob');assert.equal(meta.get('bob:delta-cursor:library'),'lib-bob')});
check('Alice cursor was not persisted',()=>assert.equal(meta.has('alice:delta-cursor:core'),false));
check('authorized Bob changes schedule a delta notification',()=>assert.equal(scheduled.length,1));
owner={scope:'alice',generation:3};
scheduled.shift()();
check('queued animation frame drops Bob data after session change',()=>assert.equal(dispatched.length,0));
check('old callbacks cannot repaint a new account',()=>assert.equal(invalidated.length,1));
owner={scope:'anonymous',generation:4};
await assert.rejects(pull(),/authenticated account changed/);
check('anonymous context cannot start background delta sync',()=>assert.equal(pending.length,3));
console.log(`G27 P47 delta account isolation: ${checks}/${checks} assertions passed`);
