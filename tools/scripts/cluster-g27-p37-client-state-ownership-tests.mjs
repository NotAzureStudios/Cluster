import assert from 'node:assert/strict';
import vm from 'node:vm';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js'))}})();
const read=(p)=>readFileSync(new URL(`../../${p}`,import.meta.url),'utf8');
function load(source, dependencies={}) {
 const mod={exports:{}};
 const transpiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(transpiled,{exports:mod.exports,module:mod,require:(id)=>dependencies[id] ?? {},console,Promise},{filename:'test-module'});
 return mod.exports;
}
const policy=load(read('packages/renderer/src/core/user-state-ownership.ts'));
const alice={scope:'alice',generation:1}, bob={scope:'bob',generation:2}, aliceAgain={scope:'alice',generation:3};
let count=0;const check=(description,fn)=>{fn();console.log('PASS',description);count++};
check('same authenticated owner admitted to user state',()=>assert.equal(policy.mayApplyClientState('user',alice,{...alice}),true));
check('same authenticated owner admitted to studio state',()=>assert.equal(policy.mayApplyClientState('studio',alice,{...alice}),true));
check('other account rejected from user state',()=>assert.equal(policy.mayApplyClientState('user',alice,bob),false));
check('other account rejected from studio state',()=>assert.equal(policy.mayApplyClientState('studio',alice,bob),false));
check('A→B→A rejects old session',()=>assert.equal(policy.mayApplyClientState('user',alice,aliceAgain),false));
check('anonymous cannot write client-state',()=>assert.equal(policy.mayApplyClientState('studio',{scope:'anonymous',generation:0},{scope:'anonymous',generation:0}),false));
const offline=read('packages/renderer/src/core/offline-storage.ts');
check('scope epoch increments on actual account transitions',()=>assert.match(offline,/if \(next !== activeScope\) activeScopeGeneration \+= 1/));
check('scope identity exposes stable generation',()=>assert.match(offline,/return \{ scope: getOfflineScope\(\), generation: activeScopeGeneration \}/));
let current=alice;
let calls=[];let serverError=null;let deferred=null;
class ApiError extends Error {constructor(status){super('api');this.status=status}}
const service=load(read('packages/renderer/src/core/server-state.ts'),{
 './api':{ ApiError, mutateApi:async(...args)=>{calls.push(['mutate',...args]);if(deferred)return deferred; if(serverError)throw serverError;return {result:{record:{revision:12,payload:'ok'}}}},queryApi:async(...args)=>{calls.push(['query',...args]);return {record:{revision:13,payload:'ok'}}}},
 './offline-storage':{getOfflineScope:()=>current.scope,getOfflineScopeIdentity:()=>current},
 './user-state-ownership':policy,
 react:{useCallback:()=>{},useEffect:()=>{},useRef:()=>{},useState:()=>{}},
});
await (async()=>{
 check('cross-account queued write never reaches transport',()=>{});
 current=bob;calls=[];assert.equal(await service.writeServerState('user','search.saved',['A'],null,alice),null);assert.equal(calls.length,0);
 check('cross-account Studio write never reaches transport',()=>{});
 assert.equal(await service.writeServerState('studio','ops.sample',{private:true},null,alice),null);assert.equal(calls.length,0);
 current=aliceAgain;assert.equal(await service.writeServerState('user','search.saved',['A'],null,alice),null);assert.equal(calls.length,0);
 check('A→B→A old client-state write never reaches transport',()=>assert.equal(calls.length,0));
 current=alice;calls=[];serverError=null;
 const ok=await service.writeServerState('user','search.saved',['A'],null,alice);
 check('authorized write retains revision',()=>{assert.equal(ok.revision,12);assert.equal(calls.length,1)});
 serverError=new ApiError(409);calls=[];current=alice;
 const blockedRetry=service.writeServerState('user','search.saved',['A'],null,alice);
 // If the failed mutation has already initiated and identity changes before
 // its conflict handler, no fresh read or replay is permitted.
 current=bob;
 assert.equal(await blockedRetry,null);
 check('409 conflict after switch cannot fetch/replay under new account',()=>assert.equal(calls.filter(c=>c[0]==='query').length,0));
 serverError=null;current=alice;calls=[];
 let release;deferred=new Promise(r=>release=r);
 const inFlight=service.writeServerState('user','search.saved',['A'],null,alice);
 current=bob;release({result:{record:{revision:99,payload:'ok'}}});
 check('response from earlier account cannot update local revision',async()=>assert.equal(await inFlight,null));
 await inFlight;deferred=null;
})();
const source=read('packages/renderer/src/core/server-state.ts');
check('hook masks previous account value on render',()=>assert.match(source,/const effectiveValue = hydratedOwner !== stateOwnerKey \? initial\.current : value/));
check('read applies only to matching identity',()=>assert.match(source,/if \(!alive \|\| !mayApplyClientState\(scope, stateOwner, getOfflineScopeIdentity\(\)\)\) return/));
check('queued callback checks captured owner before starting',()=>assert.match(source,/const record = await writeServerState\(scope, key, resolved, revisionRef\.current, stateOwner, \(\) => \{/));
check('queued completion checks captured owner before revision update',()=>assert.match(source,/if \(!record \|\| !mayApplyClientState\(scope, stateOwner, getOfflineScopeIdentity\(\)\)\) return/));
check('local-only setters cannot be reused under another account',()=>assert.match(source,/const setLocal = useCallback[\s\S]*?if \(!mayApplyClientState\(scope, stateOwner, getOfflineScopeIdentity\(\)\)\) return/));
console.log(`G27 P37 Client-state ownership: ${count}/${count} checks passed`);
