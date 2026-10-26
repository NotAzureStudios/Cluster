import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import path from 'node:path';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js'))}})();
const root=new URL('../../',import.meta.url);
const source=readFileSync(new URL('../../packages/renderer/src/features/search/fresh-search-activation.ts',import.meta.url),'utf8');
const transpiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const module={exports:{}};
vm.runInNewContext(transpiled,{module,exports:module.exports},{filename:'fresh-search-activation.ts'});
const {freshSearchActivationMatch:check,reauthorizeSearchActivation:execute}=module.exports;
const hit={id:'card-7',kind:'card',title:'Private ticket',detail:'work',projectId:'project-4',boardId:'board-3',cardId:'card-7',resource:{kind:'card',id:'card-7',projectId:'project-4'}};
const expression='pending owner:alice',scope='all';
const payload=(results=[hit],meta={query:expression,scope})=>({users:[],projects:[],cards:[],results,meta});
let assertions=0;
function test(label,fn){fn();assertions++;console.log('PASS '+label)}
test('fresh same resource result navigable',()=>assert.equal(check(hit,payload(),expression,scope)?.id,'card-7'));
test('fresh descriptive updates allowed, original location retained',()=>assert.equal(check(hit,payload([{...hit,title:'Changed after rendering',detail:'fresh'}]),expression,scope)?.title,'Changed after rendering'));
test('revoked result missing fails closed',()=>assert.equal(check(hit,payload([]),expression,scope),null));
test('changed record ID fails closed',()=>assert.equal(check(hit,payload([{...hit,id:'card-8'}]),expression,scope),null));
test('changed record kind fails closed',()=>assert.equal(check(hit,payload([{...hit,kind:'ticket'}]),expression,scope),null));
test('changed project fails closed',()=>assert.equal(check(hit,payload([{...hit,projectId:'project-5'}]),expression,scope),null));
test('changed board fails closed',()=>assert.equal(check(hit,payload([{...hit,boardId:'board-9'}]),expression,scope),null));
test('changed card ID fails closed',()=>assert.equal(check(hit,payload([{...hit,cardId:'card-9'}]),expression,scope),null));
test('changed project tab fails closed',()=>assert.equal(check(hit,payload([{...hit,projectTab:'qa'}]),expression,scope),null));
test('changed canonical resource ID fails closed',()=>assert.equal(check(hit,payload([{...hit,resource:{...hit.resource,id:'card-9'}}]),expression,scope),null));
test('changed canonical resource kind fails closed',()=>assert.equal(check(hit,payload([{...hit,resource:{...hit.resource,kind:'project'}}]),expression,scope),null));
test('changed resource project fails closed',()=>assert.equal(check(hit,payload([{...hit,resource:{...hit.resource,projectId:'project-5'}}]),expression,scope),null));
test('no canonical destination fails closed',()=>assert.equal(check(hit,payload([{...hit,resource:null}]),expression,scope),null));
test('duplicate hits fail closed',()=>assert.equal(check(hit,payload([hit,hit]),expression,scope),null));
test('wrong query response fails closed',()=>assert.equal(check(hit,payload([hit],{query:'other',scope}),expression,scope),null));
test('wrong search scope fails closed',()=>assert.equal(check(hit,payload([hit],{query:expression,scope:'project'}),expression,scope),null));
test('missing server metadata fails closed',()=>assert.equal(check(hit,{results:[hit]},expression,scope),null));
test('missing result array fails closed',()=>assert.equal(check(hit,{meta:{query:expression,scope}},expression,scope),null));
test('null payload fails closed',()=>assert.equal(check(hit,null,expression,scope),null));
test('missing original kind/id fails closed',()=>assert.equal(check({...hit,id:''},payload(),expression,scope),null));
test('activity without canonical resource remains navigable',()=>{const activity={kind:'activity',id:'event-1',projectId:'project-4',title:'Change',detail:'activity'};assert.equal(check(activity,payload([activity]),expression,scope)?.id,'event-1')});
test('activity moving projects fails closed',()=>{const activity={kind:'activity',id:'event-1',projectId:'project-4',title:'Change',detail:'activity'};assert.equal(check(activity,payload([{...activity,projectId:'project-5'}]),expression,scope),null)});
test('ranking cap exclusion fails closed even if entity might exist elsewhere',()=>assert.equal(check(hit,payload(Array.from({length:40},(_,i)=>({...hit,id:`other-${i}`}))),expression,scope),null));
const palette=readFileSync(new URL('../../packages/renderer/src/features/search/CommandPalette.tsx',import.meta.url),'utf8');
test('selected remote item carries its original authorized identity',()=>assert.match(palette,/remoteSelection: result/));
test('stale response is not displayed for changed query or scope',()=>assert.match(palette,/remoteResults\.meta\?\.query === remoteTerm && remoteResults\.meta\?\.scope === parsed\.scope/));
test('activating remote item always reissues an uncached authorized search',()=>assert.match(palette,/queryApi<CommandSearchPayload>\(`\/api\/command\/search\?\$\{params\}`,[\s\S]*?force: true, persist: false, staleWhileRevalidate: false/));
test('normal search navigation goes through fresh admission',()=>assert.match(palette,/item\.remoteSelection \? \(\) => freshRemoteAction\(item, false\)/));
test('detached window search navigation goes through fresh admission',()=>assert.match(palette,/invokeCommand\(item, \(\) => freshRemoteAction\(item, true\)\)/));
test('navigation uses the new authorized result not the stale clicked item',()=>assert.match(palette,/const action = resultAction\(fresh\)/));
test('identity, session, query and permission changes invalidate inflight activation',()=>{assert.match(palette,/\[open, user\.id, permissionSignature, query, parsed\.scope, remoteTerm, searchEpoch, networkOnline\]/);assert.ok(palette.includes("isCurrent: () => liveActivationContextRef.current === contextAtClick"))});
test('fresh authorization failure never invokes the previous action',()=>assert.match(palette,/if \(!action\) return false/));
test('no renderer-generated grant or mutation endpoint',()=>{assert.doesNotMatch(source.slice(source.indexOf("export function")),/\bfetch\(|\bapi\(|grant|replay/i)});
const navigateCalls=[];
async function executeCase(selection, opts={}) {
  const log=[];
  const admitted=await execute({selected:selection, expression, scope,
    isCurrent:opts.isCurrent||(()=>true),
    load:async()=>{log.push('load');if(opts.error)throw Error('network');return opts.data||payload();},
    navigate:async fresh=>{log.push('navigate:'+fresh.title);return opts.navigationResult;},
  });
  return {admitted,log};
}
await (async()=>{
  const ok=await executeCase(hit);test('fresh authorization performs one navigation',()=>{assert.equal(ok.admitted,true);assert.deepEqual(ok.log,['load','navigate:Private ticket'])});
  const revocation=await executeCase(hit,{data:payload([])});test('revoked remote hit cannot navigate',()=>{assert.equal(revocation.admitted,false);assert.deepEqual(revocation.log,['load'])});
  const moved=await executeCase(hit,{data:payload([{...hit,boardId:'other-board'}])});test('moved remote hit cannot navigate',()=>{assert.equal(moved.admitted,false);assert.deepEqual(moved.log,['load'])});
  const network=await executeCase(hit,{error:true});test('network error cannot navigate',()=>{assert.equal(network.admitted,false);assert.deepEqual(network.log,['load'])});
  const falseAction=await executeCase(hit,{navigationResult:false});test('failed native window operation remains failed',()=>assert.equal(falseAction.admitted,false));
  const staleAtStart=await executeCase(hit,{isCurrent:()=>false});test('changed session before request skips server and navigation',()=>{assert.equal(staleAtStart.admitted,false);assert.deepEqual(staleAtStart.log,[])});
  let current=true, release;const gate=new Promise(resolve=>{release=resolve});const calls=[];
  const inflight=execute({selected:hit,expression,scope,isCurrent:()=>current,load:async()=>{calls.push('load');await gate;return payload()},navigate:async()=>{calls.push('navigate')}});
  current=false;release();const staleAfter=await inflight;
  test('session switch during reauthorization rejects navigation',()=>{assert.equal(staleAfter,false);assert.deepEqual(calls,['load'])});
})();
assert.equal(assertions,39);console.log(`${assertions}/${assertions} G27 P1 activation and tamper checks passed`);
