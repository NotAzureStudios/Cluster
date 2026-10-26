import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js'))}})();
const compile=(name)=>ts.transpileModule(readFileSync(new URL(name,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const module={exports:{}};
vm.runInNewContext(compile('../../packages/renderer/src/core/api/auth-context.ts'),{module,exports:module.exports,Set,Array});
const id=module.exports.authenticatedUserIdFromResponse;
const current=module.exports.isCurrentAccountRequest;
let count=0;
function check(name,fn){fn();console.log('PASS',name);count++}
check('direct /me account accepted',()=>assert.equal(id('/api/me',{id:'user-A'}),'user-A'));
check('nested /me account accepted',()=>assert.equal(id('/api/me',{user:{id:'user-A'}}),'user-A'));
check('valid completed login accepted',()=>assert.equal(id('/api/auth/login',{ok:true,user:{id:'user-B'}}),'user-B'));
check('MFA login pending rejected',()=>assert.equal(id('/api/auth/login',{ok:true,mfaRequired:true,challenge:'mfa-token'}),null));
check('authentication factor cannot masquerade as user',()=>assert.equal(id('/api/auth/mfa/passkeys/enroll/verify',{ok:true,id:'factor-ID'}),null));
check('reauth challenge cannot masquerade as user',()=>assert.equal(id('/api/auth/reauth/passkey/start',{ok:true,id:'challenge-ID'}),null));
check('session returned ID is not user identity',()=>assert.equal(id('/api/auth/desktop-session-code',{ok:true,id:'session-ID'}),null));
check('MFA recovery record is not user',()=>assert.equal(id('/api/auth/mfa/recovery/regenerate',{ok:true,id:'recovery-ID'}),null));
check('preferences record is not user',()=>assert.equal(id('/api/me/preferences',{id:'preferences-ID',user:{id:'user-A'}}),null));
check('auth completion requires nested user',()=>assert.equal(id('/api/auth/login',{ok:true,id:'factor-id'}),null));
check('auth completion requires success',()=>assert.equal(id('/api/auth/login',{ok:false,user:{id:'user-A'}}),null));
check('revoked response never binds',()=>assert.equal(id('/api/me',{id:'user-A',currentSessionRevoked:true}),null));
check('resource responses cannot bind',()=>assert.equal(id('/api/projects',{id:'project-ID'}),null));
check('A → B → A is not the same request generation',()=>assert.equal(current({scope:'A',generation:1},{scope:'A',generation:3}),false));
check('matching scope and generation is current',()=>assert.equal(current({scope:'A',generation:5},{scope:'A',generation:5}),true));
check('different user ID is never current',()=>assert.equal(current({scope:'A',generation:5},{scope:'B',generation:5}),false));

// Run the real transport with a controlled asynchronous API. No HTTP and no
// source-only assumptions about request ordering.
const transportModule={exports:{}};
let identity={scope:'anonymous',generation:0};
const setScope=(scope)=>{if(scope!==identity.scope)identity={scope,generation:identity.generation+1}};
let invalidations=0;
const requests=[];
const FakeApiError=class extends Error {constructor(msg,status,payload,requestId,code){super(msg);this.status=status;this.code=code;this.payload=payload}};
const deps={
 '@cluster/shared':{clusterErrorDefinition:()=>null},
 '@cluster/api-client':{ClusterApiClientError:class extends Error {},clusterApiFetch:(path,options)=>new Promise((resolve,reject)=>requests.push({path,options,resolve,reject}))},
 '../cohesion-events':{emitClusterCohesionEvent:()=>{}},
 '../performance':{recordPerformanceMetric:()=>{}},
 '../reauthentication':{requestReauthentication:async()=>true},
 '../session-lifecycle':{shouldInvalidateAuthenticatedClientForError:({status})=>status===401},
 '../offline-storage':{getOfflineScopeIdentity:()=>identity,setOfflineScope:setScope,resumeAuthenticationPausedOfflineWork:async()=>{}},
 './auth-context':module.exports,
 './config':{API_TIMEOUT_MS:100000,installationDeviceId:()=> 'device-X'},
 './errors':{ApiError:FakeApiError,apiOperationLabel:()=>'',},
 './cache':{invalidateAuthenticatedClientState:async()=>{invalidations++;setScope('anonymous')}},
 './mutation-cache':{invalidateMutationCache:()=>{}},
};
vm.runInNewContext(compile('../../packages/renderer/src/core/api/transport.ts'),{
 module:transportModule,exports:transportModule.exports,
 require:name=>{assert(name in deps,`Unknown import ${name}`);return deps[name]},
 Headers,AbortController,AbortSignal,FormData,Blob,DOMException,Date,Promise,Error,Set,Map,
 URLSearchParams,performance,CustomEvent:class {},setTimeout,clearTimeout,
});
const api=transportModule.exports.api;
function response(body,status=200){return {ok:status<400,status,headers:{get:()=>null},text:async()=>JSON.stringify(body)}};
const tick=async()=>{for(let i=0;i<10;i++)await Promise.resolve()};
const staleMe=api('/api/me'); await tick();
check('first /me request started',()=>assert.equal(requests.length,1));
const login=api('/api/auth/login',{method:'POST',body:'{}'}); await tick();
requests[1].resolve(response({ok:true,user:{id:'new-user'}}));await login;
check('successful login establishes user',()=>assert.equal(identity.scope,'new-user'));
requests[0].resolve(response({id:'old-user'}));
await assert.rejects(staleMe,(err)=>err.code==='AUTH_CONTEXT_CHANGED');
check('slow /me cannot restore previous user',()=>assert.equal(identity.scope,'new-user'));
const pendingLogout=api('/api/auth/logout',{method:'POST',body:'{}'}); await tick();
setScope('next-user');
requests[2].resolve(response({ok:true,signedOut:true}));
await assert.rejects(pendingLogout,(err)=>err.code==='AUTH_CONTEXT_CHANGED');
check('late logout does not invalidate newer session',()=>{assert.equal(identity.scope,'next-user');assert.equal(invalidations,0)});
const failing=api('/api/projects');await tick();
setScope('third-user');
requests[3].resolve(response({ok:false,code:'AUTH_REQUIRED'},401));
await assert.rejects(failing,()=>true);
check('stale authentication error does not clear new session',()=>{assert.equal(identity.scope,'third-user');assert.equal(invalidations,0)});
const fakeFactor=api('/api/auth/mfa/factors/factor-X',{method:'DELETE',body:'{}'});await tick();
requests[4].resolve(response({ok:true,id:'factor-X'}));await fakeFactor;
check('successful unrelated auth route does not establish factor ID as user',()=>assert.equal(identity.scope,'third-user'));
console.log(`G27 P46 transport session ownership: ${count}/${count} assertions passed`);
