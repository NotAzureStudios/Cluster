import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js'))}})();
const read=(name)=>readFileSync(new URL(`../../${name}`,import.meta.url),'utf8');
const transpile=(source,deps)=>{const mod={exports:{}};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:mod.exports,module:mod,require:id=>deps[id]||{},Promise});return mod.exports};
const policy=transpile(read('packages/renderer/src/core/user-state-ownership.ts'),{});
const owner={scope:'alice',generation:0};
let response={queued:false,result:{record:{revision:7,payload:'good'}}}, failure=null, updates=[];
const fakeReact={
 useState:(fallback)=>[fallback,fn=>updates.push(fn)],
 useRef:(fallback)=>({current:fallback}),
 useEffect:(effect)=>effect(),
 useCallback:(callback)=>callback,
};
const service=transpile(read('packages/renderer/src/core/server-state.ts'),{
 './api':{
  ApiError:class extends Error{},
  mutateApi:async()=>{if(failure)throw failure;return response},
  queryApi:async()=>({record:null}),
 },
 './offline-storage':{getOfflineScopeIdentity:()=>owner},
 './user-state-ownership':policy,
 react:fakeReact,
});
let count=0;const check=(name,fn)=>{fn();count++;console.log('PASS',name)};
let queued=false;
response={queued:true};
const queuedResult=await service.writeServerState('user','prefs',[1],null,owner,()=>{queued=true});
check('offline queued write signals pending sync instead of fake server revision',()=>{assert.equal(queuedResult,null);assert.equal(queued,true)});
response={queued:false,result:{record:{revision:8,payload:'ok'}}};queued=false;
const saved=await service.writeServerState('user','prefs',[1],null,owner,()=>{queued=true});
check('committed write returns authoritative revision',()=>{assert.equal(saved.revision,8);assert.equal(queued,false)});
const [value,persist,meta]=service.useServerState('user','prefs',{});
check('new feedback contract exposes queue, saving and error',()=>{assert.equal(typeof meta.queued,'boolean');assert.equal(meta.error,null);assert.equal(typeof meta.saving,'boolean')});
failure=Error('server down');updates=[];
persist({foo:true});
// Flush the promise queue and rejection handler. In Node strict unhandled mode,
// an uncaught rejected write would terminate this script.
for(let i=0;i<25;i++)await Promise.resolve();
// Complete the queued async chain before inspecting callback state.
await new Promise(resolve=>setImmediate(resolve));
check('failed queued preference save is handled rather than unhandled',()=>assert.ok(updates.some(u=>typeof u==='string' && u.includes('Could not save preferences'))));
const source=read('packages/renderer/src/core/server-state.ts');
check('offline queue does not pretend to be an acknowledged server save',()=>assert.match(source,/if \(result\.queued\) \{\s+onQueued\?\.\(\);\s+return null;/));
check('write failure has attached catch and owner guard',()=>assert.match(source,/\.catch\(\(\) => \{[\s\S]*?Handle the rejection here rather than leaving an unobserved promise/));
check('new save clears old errors',()=>assert.match(source,/setSaving\(true\);\s+setWriteError\(null\)/));
check('successful server commit clears pending offline status',()=>assert.match(source,/setQueued\(false\);\s+revisionRef\.current = record\.revision/));
check('queue/error visibility tied to current account',()=>assert.match(source,/queued: hydratedOwner === stateOwnerKey && queued,[\s\S]*?error: hydratedOwner === stateOwnerKey \? writeError : null/));
const palette=read('packages/renderer/src/features/search/CommandPalette.tsx');
check('Search uses client-state delivery feedback for saved and recent queries',()=>assert.match(palette,/savedSearchState\.error \|\| recentSearchState\.error/));
check('Search shows queued preferences rather than false save success',()=>assert.match(palette,/Search preference changes are queued for synchronization/));
check('Search feedback is an accessible live status',()=>assert.match(palette,/className="search-client-state-feedback-v546"[\s\S]*?aria-live="polite"/));
console.log(`G27 P40 Client-state feedback: ${count}/${count} checks passed`);
