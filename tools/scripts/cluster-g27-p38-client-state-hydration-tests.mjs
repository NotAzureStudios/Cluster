import assert from 'node:assert/strict';
import vm from 'node:vm';
import path from 'node:path';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js'))}})();
const read=(name)=>readFileSync(new URL(`../../${name}`,import.meta.url),'utf8');
const compile=(code,deps)=>{const mod={exports:{}};vm.runInNewContext(ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:mod.exports,module:mod,require:(id)=>deps[id]||{},Promise});return mod.exports};
const policy=compile(read('packages/renderer/src/core/user-state-ownership.ts'),{});
const origin={scope:'alice',generation:1}, other={scope:'bob',generation:2};
let owner=origin, releaseRead=null, queries=0, changes=[];
const react={
 useRef:(initial)=>({current:initial}),
 useState:(initial)=>[initial,(next)=>changes.push(next)],
 useEffect:(fn)=>fn(),
 useCallback:(fn)=>fn,
};
const api={
 ApiError: class extends Error {},
 queryApi:()=>{queries++;return new Promise(resolve=>{releaseRead=resolve})},
 mutateApi:async()=>({result:{record:{revision:5,payload:'saved'}}}),
};
const state=compile(read('packages/renderer/src/core/server-state.ts'),{'react':react,'./api':api,'./offline-storage':{getOfflineScopeIdentity:()=>owner},'./user-state-ownership':policy});
let count=0;const check=(name,fn)=>{fn();count++;console.log('PASS',name)};
const fallback={label:'default'}, selected={label:'local change'}, old={label:'stale read'};
const [value,setValue,meta]=state.useServerState('user','search.saved',fallback);
check('initial value starts with safe fallback',()=>assert.equal(value,fallback));
check('server hydration starts a single read',()=>assert.equal(queries,1));
setValue(selected);
releaseRead({record:{payload:old,revision:12}});
await Promise.resolve();await Promise.resolve();
check('initial response cannot overwrite newer local mutation',()=>assert.ok(!changes.includes(old)));
check('local value was accepted immediately',()=>assert.ok(changes.includes(selected)));
const src=read('packages/renderer/src/core/server-state.ts');
check('hydration generation captured before read',()=>assert.match(src,/const hydrationVersion = localChangeVersionRef\.current/));
check('read response checks local edits',()=>assert.match(src,/if \(localChangeVersionRef\.current !== hydrationVersion\) return/));
check('local setter invalidates pending hydration',()=>assert.match(src,/const setLocal = useCallback[\s\S]*?localChangeVersionRef\.current \+= 1/));
check('persistent setter invalidates pending hydration',()=>assert.match(src,/const persist = useCallback[\s\S]*?localChangeVersionRef\.current \+= 1/));
owner={scope:'anonymous',generation:2};let release;
const next=state.readServerState('user','search.saved',fallback);
check('cross-owner read returns fallback without calling server',()=>assert.equal(queries,1));
assert.equal(await next,fallback);
owner=origin;
const future=state.readServerState('user','search.saved',fallback);
check('direct read starts under authenticated identity',()=>assert.equal(queries,2));
owner=other;releaseRead({record:{payload:old,revision:12}});
check('direct read resolved after switching accounts returns fallback',()=>{});
assert.equal(await future,fallback);
console.log(`G27 P38 Client-state hydration: ${count}/${count} checks passed`);
