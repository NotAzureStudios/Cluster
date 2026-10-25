import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import path from 'node:path';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js'))}})();
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
function load(file){
 const mod={exports:{}};
 const output=ts.transpileModule(read(file),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(output,{module:mod,exports:mod.exports},{filename:file});
 return mod.exports;
}
const {resolveAuthorizedWorkspaceNavigation,exactWorkspaceNavigationIdentity}=load('packages/renderer/src/features/workflow/authorized-workspace-navigation.ts');
const {resolveAuthorizedCardNavigation}=load('packages/renderer/src/features/workflow/authorized-card-navigation.ts');
const project={screen:'project',projectId:'p1',projectTab:'builds',inspectScope:'build-artifact',inspectId:'artifact1'};
const board={screen:'board',projectId:'stale-p',boardId:'board1'};
const whiteboard={screen:'whiteboard',projectId:null,whiteboardId:'w1'};
const execute=async(target,{response,live=()=>true,fail=false}={})=>{
 const calls=[];
 const result=await resolveAuthorizedWorkspaceNavigation(target,{isCurrent:live,read:async(kind,id)=>{
  calls.push([kind,id]);if(fail) throw Error('401');return response===undefined ? {id,projectId:'p1'} : response;
 }});
 return {result,calls};
};
let passed=0;
const test=(description,assertion)=>{assertion();passed++;console.log('PASS '+description)};
let x=await execute(project,{response:{projectId:'p1'}});
test('project opens only after authorized snapshot confirms same identity',()=>{assert.equal(x.result?.projectId,'p1');assert.equal(x.result?.inspectId,'artifact1');assert.deepEqual(x.calls,[['project','p1']])});
x=await execute(project,{response:{projectId:'p2'}});
test('wrong project snapshot rejected',()=>assert.equal(x.result,null));
x=await execute(project,{response:null});
test('deleted project denied',()=>assert.equal(x.result,null));
x=await execute(board,{response:{id:'board1',projectId:'new-p'}});
test('moved Board follows current authorized Project',()=>{assert.equal(x.result?.boardId,'board1');assert.equal(x.result?.projectId,'new-p')});
x=await execute(board,{response:{id:'board1',projectId:null}});
test('Board moved to standalone clears stale Project',()=>assert.equal(x.result?.projectId,null));
x=await execute(whiteboard,{response:{id:'w1',projectId:'p2'}});
test('standalone Whiteboard moved into Project follows new placement',()=>assert.equal(x.result?.projectId,'p2'));
x=await execute(whiteboard,{response:{id:'w1',projectId:null}});
test('standalone Whiteboard stays standalone',()=>assert.equal(x.result?.projectId,null));
x=await execute(whiteboard,{response:{id:'other',projectId:null}});
test('wrong Whiteboard identity rejected',()=>assert.equal(x.result,null));
x=await execute(board,{response:{id:'board1'}});
test('missing owner field cannot impersonate standalone Board',()=>assert.equal(x.result,null));
x=await execute(board,{response:{id:'board1',projectId:{x:1}}});
test('malformed owner object denied',()=>assert.equal(x.result,null));
x=await execute(whiteboard,{response:{id:'w1',projectId:'bad/route'}});
test('malformed authoritative Project ID denied',()=>assert.equal(x.result,null));
x=await execute(board,{fail:true});
test('403 404 transport errors deny without navigation',()=>assert.equal(x.result,null));
x=await execute({...project,projectId:null});
test('Project without identity denied without HTTP request',()=>{assert.equal(x.result,null);assert.deepEqual(x.calls,[])});
x=await execute({...board,boardId:null});
test('Board inspector without identity denied without HTTP request',()=>{assert.equal(x.result,null);assert.deepEqual(x.calls,[])});
x=await execute({...whiteboard,whiteboardId:'../escape'});
test('pathlike Whiteboard IDs rejected without request',()=>{assert.equal(x.result,null);assert.deepEqual(x.calls,[])});
x=await execute({...whiteboard,whiteboardId:'w'.repeat(201)});
test('oversized target identity rejected without request',()=>assert.equal(x.result,null));
test('identity selector has no generic route fallback',()=>{assert.equal(exactWorkspaceNavigationIdentity({screen:'inbox'}),null);assert.equal(exactWorkspaceNavigationIdentity({screen:'board'}),null)});
x=await execute(board,{live:()=>false});
test('already stale session sends no resource requests',()=>{assert.equal(x.result,null);assert.deepEqual(x.calls,[])});
let resolveRequest, live=true;
const gate=new Promise(done=>resolveRequest=done);
const flight=resolveAuthorizedWorkspaceNavigation(board,{isCurrent:()=>live,read:async()=>{await gate;return {id:'board1',projectId:'p1'}}});
live=false;resolveRequest();
const staleResult=await flight;
test('stale async authorization cannot reopen prior workspace',()=>assert.equal(staleResult,null));
// Verify Card identity-only routes also respect a changed/current server location.
const card={screen:'board',projectId:'old',inspectScope:'card',inspectId:'c1'};
const cardResult=await resolveAuthorizedCardNavigation(card,{isCurrent:()=>true,read:async()=>({id:'c1',list:{board:{id:'currentBoard',projectId:'p2'}}})});
test('Card-only deep link resolves current authorized Board',()=>{assert.equal(cardResult?.boardId,'currentBoard');assert.equal(cardResult?.projectId,'p2')});
const rejectCard=await resolveAuthorizedCardNavigation({...card,inspectId:'bad/path'},{isCurrent:()=>true,read:async()=>{throw Error('should not fetch')}});
test('Card navigation rejects malformed OS identity before request',()=>assert.equal(rejectCard,null));
const shell=read('packages/renderer/src/features/application/ClusterApplication.tsx');
const shared=read('packages/shared/src/resource-address.ts');
const native=read('packages/renderer/src/features/workflow/desktop-deep-link-navigation.ts');
test('central shell integrates freshness check before committing workspace',()=>{
 assert.match(shell,/resolveAuthorizedWorkspaceNavigation\(incoming,\s*\{/);
 assert.match(shell,/kind === "project" \? `\/api\/projects\/\$\{encodeURIComponent\(id\)\}\/snapshot`/);
 assert.match(shell,/`\/api\/boards\/\$\{encodeURIComponent\(id\)\}`/);
 assert.match(shell,/`\/api\/whiteboards\/\$\{encodeURIComponent\(id\)\}`/);
 assert.match(shell,/force: true, persist: false, staleWhileRevalidate: false/);
});
test('authorization error leaves current URL and selection intact',()=>{
 const start=shell.indexOf('void resolveAuthorizedWorkspaceNavigation(incoming');
 const end=shell.indexOf('applyLinkedWork(resolved, sequence, navigationAttempt);',start);
 assert.ok(start>0 && end>start);
 assert.doesNotMatch(shell.slice(start,end),/setBoardId\(|setProjectId\(|window\.history\.replaceState/);
});
test('no Board/Whiteboard selection leaks from prior workspace',()=>{
 assert.match(shell,/setBoardId\(target\.boardId \|\| null\)/);
 assert.match(shell,/setWhiteboardId\(target\.whiteboardId \|\| null\)/);
});
test('native Card-only resource link joins authoritative Card resolver',()=>{
 assert.match(shared,/kind !== "card" && boardId/);
 assert.match(native,/boardId: target\.boardId \|\| null/);
 assert.match(shell,/resolveAuthorizedCardNavigation\(incoming/);
});
test('server resources authorize exact identity',()=>{
 assert.match(read('apps/server/src/domains/projects/project-routes.ts'),/get\("\/api\/projects\/:projectId\/snapshot"[\s\S]*?enforceTargetAccess\(request, reply, "project", project\.id, project, "view"\)/);
 assert.match(read('apps/server/src/domains/boards/board-routes.ts'),/get\("\/api\/boards\/:boardId"[\s\S]*?policy\.requireBoard\(request, reply, board, "view"\)/);
 assert.match(read('apps/server/src/app/server-routes-media-whiteboards.ts'),/get\("\/api\/whiteboards\/:whiteboardId"[\s\S]*?enforceTargetAccess\(request, reply, "whiteboard", whiteboard\.id, whiteboard\.project, "view"\)/);
});
assert.equal(passed,26);
console.log(`${passed}/${passed} G27 Pass 6 authorized-workspace navigation checks passed`);
