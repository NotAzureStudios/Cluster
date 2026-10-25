import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js'))}})();
const app=readFileSync(new URL('../../packages/renderer/src/features/application/ClusterApplication.tsx',import.meta.url),'utf8');
const src=ts.createSourceFile('ClusterApplication.tsx',app,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let fn;
function visit(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='loadBoard')fn=node;ts.forEachChild(node,visit)}visit(src);
assert.ok(fn,'missing actual Board fetch controller');
const compiled=ts.transpileModule('exports.handler='+fn.getText(src)+';',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
let passed=0;const check=(name,doCheck)=>{doCheck();passed++;console.log('PASS '+name)};
function mock({boardId='a',userId='u1',screen='board'}={}){
 const calls=[],pending=[];
 const context={boardId,userId,screen};const sequence={current:0};const module={exports:{}};
 const options={module,exports:module.exports,boardId,user:{id:userId},
   boardReadSequenceRef:sequence,boardReadContextRef:{current:context},
   encodeURIComponent,
   queryApi:(url,opts)=>{calls.push(['api',url,opts]);return new Promise((resolve,reject)=>pending.push({url,resolve,reject}))},
   setBoard:value=>calls.push(['board',value]),setBoardLoadError:value=>calls.push(['error',value]),
   setBoardLoading:value=>calls.push(['loading',value]),
 };
 vm.runInNewContext(compiled,options,{filename:'ClusterApplication.loadBoard.ts'});
 return {load:module.exports.handler,calls,pending,context,sequence,options};
}
let t=mock();let a=t.load('a');
check('current Board read begins with loading status and cleared errors',()=>assert.deepEqual(t.calls.map(x=>x[0]),['loading','error','api']));
check('Board read uses encoded ID and uncached permission-checked API',()=>{
 assert.equal(t.pending[0].url,'/api/boards/a');assert.equal(t.calls.find(c=>c[0]==='api')[2].force,true);
 assert.equal(t.calls.find(c=>c[0]==='api')[2].persist,false);
});
t.pending[0].resolve({id:'a',title:'Alpha'});await a;
check('authorized current response updates Board and ends loading',()=>{assert.deepEqual(t.calls.find(x=>x[0]==='board')[1],{id:'a',title:'Alpha'});assert.equal(t.calls.at(-1)[0],'loading');assert.equal(t.calls.at(-1)[1],false)});
t=mock();a=t.load('a');t.context.boardId='b';let b=t.load('b');
t.pending[1].resolve({id:'b',title:'Beta'});await b;t.pending[0].resolve({id:'a',title:'Obsolete'});await a;
check('late older Board response never replaces newly selected Board',()=>assert.deepEqual(t.calls.filter(x=>x[0]==='board').map(x=>x[1].id),['b']));
check('late older Board response cannot cancel new Board loading state',()=>assert.equal(t.calls.filter(x=>x[0]==='loading'&&x[1]===false).length,1));
t=mock();a=t.load('a');t.context.boardId='b';b=t.load('b');t.pending[1].resolve({id:'b'});await b;t.pending[0].reject(Error('old connection'));await a;
check('late network error cannot clear the newer authorized Board',()=>assert.deepEqual(t.calls.filter(x=>x[0]==='board').map(x=>x[1]?.id),['b']));
check('late network error cannot display an obsolete error',()=>assert.equal(t.calls.filter(x=>x[0]==='error'&&x[1] instanceof Error).length,0));
t=mock();a=t.load('a');t.context.userId='u2';t.sequence.current++;t.pending[0].resolve({id:'a'});await a;
check('session change prevents previous account Board response from painting UI',()=>assert.equal(t.calls.some(x=>x[0]==='board'),false));
t=mock();a=t.load('a');t.context.userId='u2';t.pending[0].resolve({id:'a'});await a;
check('account identity change blocks old Board even before explicit cleanup completes',()=>assert.equal(t.calls.some(x=>x[0]==='board'),false));
t=mock();a=t.load('a');t.context.screen='projects';t.pending[0].resolve({id:'a'});await a;
check('moving away from Boards prevents obsolete response from restoring Board view',()=>assert.equal(t.calls.some(x=>x[0]==='board'),false));
t=mock();a=t.load('a');t.context.boardId=null;await t.load(null);t.pending[0].resolve({id:'a'});await a;
check('clearing Board selection cancels in-flight read and empties Board view',()=>assert.deepEqual(t.calls.filter(x=>x[0]==='board').map(x=>x[1]),[null]));
t=mock();a=t.load('a');t.pending[0].reject(Error('forbidden'));await a;
check('current Board access denial clears stale Board and preserves useful error',()=>{
 assert.equal(t.calls.filter(x=>x[0]==='board').at(-1)[1],null);
 assert.equal(t.calls.filter(x=>x[0]==='error').at(-1)[1].message,'forbidden');
});
t=mock();t.context.boardId='not-current';await t.load('a');
check('no network request or data mutation for unselected Board identity',()=>assert.equal(t.calls.length,0));
t=mock({boardId:'ab:cd'});a=t.load('ab:cd');
check('Board ID is URL encoded without changing canonical identity',()=>assert.equal(t.pending[0].url,'/api/boards/ab%3Acd'));
t.pending[0].resolve({id:'ab:cd'});await a;
t=mock();a=t.load('a');b=t.load('a');t.pending[1].resolve({id:'a',revision:2});await b;t.pending[0].resolve({id:'a',revision:1});await a;
check('same Board overlapping refreshes keep only latest revision result',()=>assert.deepEqual(t.calls.filter(x=>x[0]==='board').map(x=>x[1].revision),[2]));
check('session reset explicitly invalidates pending Board request generations',()=>assert.match(app,/clearAuthenticatedUiState = useCallback[\s\S]*?\+\+boardReadSequenceRef\.current/));
check('render-time context includes selected Board ID and current authenticated identity',()=>assert.match(app,/boardReadContextRef\.current = \{ boardId, userId: user\?\.id \|\| null, screen \}/));
assert.equal(passed,17);
console.log(`${passed}/${passed} G27 Pass 14 Board response identity and race checks passed`);
