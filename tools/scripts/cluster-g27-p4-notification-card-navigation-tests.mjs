import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js'))}})();
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const load=(name,inject={})=>{
 const {outputText}=ts.transpileModule(read(name),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
 const module={exports:{}};
 vm.runInNewContext(outputText,{module,exports:module.exports,require:(path)=>{
   if(Object.hasOwn(inject,path))return inject[path];
   throw Error(`Unexpected runtime import ${path}`);
 }},{filename:name});
 return module.exports;
};
const routing=load('packages/renderer/src/features/workflow/resource-navigation.ts');
const notifications=load('packages/renderer/src/features/notifications/notification-navigation.ts',{
 '@cluster/shared':{clusterResourceAddressFromEntity:({entityType,entityId,projectId})=>entityId?{kind:entityType,id:entityId,projectId}:null},
 '../workflow/resource-navigation':routing,
});
let total=0;
const test=(title,run)=>{run();total++;console.log('PASS '+title)};
const card={category:'work',projectId:'p1',cardId:'c1',entityType:'card',entityId:'c1',boardId:'b1',resource:{kind:'card',id:'c1',projectId:'p1'}};
test('canonical notification Card opens its exact owning Board',()=>{
 const dest=notifications.notificationWorkNavigation(card);
 assert.equal(dest.screen,'board'); assert.equal(dest.boardId,'b1');assert.equal(dest.projectId,'p1');assert.equal(dest.inspectScope,'card');assert.equal(dest.inspectId,'c1');
});
test('historical Card without Board retains exact Card inspector for fresh resolver',()=>{
 const dest=notifications.notificationWorkNavigation({...card,boardId:null});
 assert.equal(dest.screen,'board');assert.equal(dest.projectId,'p1');assert.equal(dest.boardId,null);assert.equal(dest.inspectId,'c1');
});
test('unknown Card retains ID and no stale Board even without Project',()=>{
 const dest=notifications.notificationWorkNavigation({...card,projectId:null,resource:{kind:'card',id:'c1'},boardId:null});
 assert.equal(dest.screen,'board');assert.equal(dest.boardId,null);assert.equal(dest.inspectId,'c1');
});
test('standalone Board Card opens by explicit Board identity',()=>{
 const dest=notifications.notificationWorkNavigation({...card,projectId:null,resource:{kind:'card',id:'c1'},boardId:'b1'});
 assert.equal(dest.screen,'board');assert.equal(dest.boardId,'b1');
});
test('invalid or oversize untrusted board ID is refused',()=>{
 for(const bad of ['../../settings','x'.repeat(201),' / / ', '\n', 'board#frag']){
  const dest=notifications.notificationWorkNavigation({...card,boardId:bad});
  assert.equal(dest.screen,'board');assert.equal(dest.boardId,null);
 }
});
test('Card entity fallback also uses explicit boardId',()=>{
 const dest=notifications.notificationWorkNavigation({...card,resource:null});
 assert.equal(dest.boardId,'b1');assert.equal(dest.inspectId,'c1');
});
test('notification native Desktop Card route uses exact Board and inspector',()=>{
 const dest=notifications.notificationWorkNavigation(card);
 assert.equal(notifications.notificationDesktopRoute(dest),'board/p1/b1/inspect/card/c1');
});
test('historical Card Desktop notification route remains Inbox without Board placement',()=>{
 const dest=notifications.notificationWorkNavigation({...card,boardId:null});
 assert.equal(notifications.notificationDesktopRoute(dest),'inbox');
});
test('non-Card board link still works without routing changes',()=>{
 const dest=notifications.notificationWorkNavigation({...card,resource:{kind:'board',id:'b1',projectId:'p1'}});
 assert.equal(dest.screen,'board');assert.equal(dest.boardId,'b1');
});
test('announcement recipient projection never opens administrative record',()=>{
 const dest=notifications.notificationWorkNavigation({...card,resource:{kind:'announcement',id:'a1'}});
 assert.equal(dest.screen,'inbox');
});
test('onboarding item retains private My Work inspector',()=>{
 const dest=notifications.notificationWorkNavigation({...card,entityType:'studio_onboarding_assignment',entityId:'onb123'});
 assert.equal(dest.screen,'mywork');assert.equal(dest.inspectId,'onb123');
});
test('project resources remain explicit Project routes',()=>{
 const dest=notifications.notificationWorkNavigation({...card,resource:{kind:'project',id:'p1'}});
 assert.equal(dest.screen,'project');assert.equal(dest.projectId,'p1');
});
test('notificationWorkSource never promotes an unrelated cardId over a valid source',()=>{
 const source=notifications.notificationWorkSource({...card,resource:{kind:'card',id:'real-card',projectId:'p1'},cardId:'wrong'});
 assert.equal(source.id,'real-card');
});
test('unknown identified activity resource stays in Inbox instead of opening an unrelated Project',()=>{
 const dest=notifications.notificationWorkNavigation({...card,resource:null,entityType:'unknown',entityId:'x',boardId:null});
 assert.equal(dest,null);
});
test('Cards without Board or project have no misleading native Board deep link',()=>{
 const dest=notifications.notificationWorkNavigation({...card,resource:{kind:'card',id:'c1'},projectId:null,boardId:null});
 assert.equal(notifications.notificationDesktopRoute(dest),'inbox');
});
assert.equal(total,15);
console.log(`${total}/${total} G27 Pass 4 Card navigation assertions passed`);
