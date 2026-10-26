import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = (()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js'))}})();
const read=(name)=>readFileSync(new URL('../../'+name,import.meta.url),'utf8');
const load=(name)=>{
 const module={exports:{}};
 vm.runInNewContext(ts.transpileModule(read(name),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports},{filename:name});
 return module.exports;
};
const owner=load('packages/renderer/src/features/notifications/inbox-request-ownership.ts');
const nav=load('packages/renderer/src/features/workflow/authorized-project-extra-navigation.ts');
let count=0;
async function check(name,fn){await fn();count++;console.log(`PASS ${name}`)}
await check('Inbox read generations accept only latest request',async()=>{
 const state=owner.createInboxRequestOwnership();const first=state.beginRead();const second=state.beginRead();
 assert.equal(state.isCurrent(first),false);assert.equal(state.isCurrent(second),true);
});
await check('Mutations invalidate all preceding reads without marking a new one stale',async()=>{
 const state=owner.createInboxRequestOwnership();const first=state.beginRead();state.invalidate();
 assert.equal(state.isCurrent(first),false);const next=state.beginRead();assert.equal(state.isCurrent(next),true);
});
await check('Stale failures, unmount, and optimistic mutations use ownership guard in real Inbox',async()=>{
 const page=read('packages/renderer/src/features/notifications/NotificationInboxPage.tsx');
 assert.match(page,/const inboxRequests = useRef\(createInboxRequestOwnership\(\)\)/);
 assert.match(page,/catch \(error\) \{\s*if \(inboxRequests.current.isCurrent\(sequence\)\)/);
 assert.match(page,/function invalidateInboxReadsForMutation\(\) \{\s*inboxRequests.current.invalidate\(\)/);
 assert.match(page,/async function setRead\([\s\S]*?invalidateInboxReadsForMutation\(\)/);
 assert.match(page,/async function dismiss\([\s\S]*?invalidateInboxReadsForMutation\(\)/);
 assert.match(page,/async function snooze\([\s\S]*?invalidateInboxReadsForMutation\(\)/);
 assert.match(page,/async function acknowledge\([\s\S]*?invalidateInboxReadsForMutation\(\)/);
 assert.match(page,/finally \{\s*finishInboxMutation\(ticket\);\s*scheduleInboxRevalidation\(\)/);
 assert.match(read('packages/renderer/src/features/application/ClusterApplication.tsx'),/<LazyNotificationCenterPage key=\{activeUser.id\}/);
});
await check('Unresolvable notifications remain in Inbox, not a fabricated Project destination',async()=>{
 const page=read('packages/renderer/src/features/notifications/NotificationInboxPage.tsx');
 const source=read('packages/renderer/src/features/notifications/notification-navigation.ts');
 assert.match(page,/The linked notification target is not available\. Your Inbox remains open/);
 assert.match(source,/if \(source \|\| stringValue\(item.entityId\) \|\| stringValue\(item.cardId\)\) return null/);
});
const cases=[
 ['project-asset','/api/project-files/a1',{id:'a1',projectId:'moved-project'},'moved-project'],
 ['project-control','/api/projects/p1/control-center',{projectId:'p1',records:[{id:'a1'}]},'p1'],
 ['review-asset','/api/review-assets/a1/session',{asset:{id:'a1',projectId:'p1'}},'p1'],
 ['source-repository','/api/projects/p1/source-control',{projectId:'p1',binding:{repositoryId:'a1'}},'p1'],
];
for(const [scope,endpoint,payload,expectedProject] of cases){
 const target={screen:'project',projectId:'p1',inspectScope:scope,inspectId:'a1'};
 await check(`${scope}: exact API and verified owner`,async()=>{
  assert.equal(nav.requiresAuthorizedProjectExtraNavigation(target),true);
  const result=await nav.resolveAuthorizedProjectExtraNavigation(target,{isCurrent:()=>true,read:async actual=>{assert.equal(actual,endpoint);return payload}});
  assert.equal(result?.projectId,expectedProject);assert.equal(result?.inspectId,'a1');
 });
 await check(`${scope}: mismatch, missing permission, stale session and bad IDs fail closed`,async()=>{
  for(const bad of [null,{},scope==='project-asset'?{id:'different',projectId:'p1'}:scope==='project-control'?{projectId:'p1',records:[]}:scope==='review-asset'?{asset:{id:'different',projectId:'p1'}}:{projectId:'p1',binding:{repositoryId:'other'}}]){
   assert.equal(await nav.resolveAuthorizedProjectExtraNavigation(target,{isCurrent:()=>true,read:async()=>bad}),null);
  }
  assert.equal(await nav.resolveAuthorizedProjectExtraNavigation(target,{isCurrent:()=>true,read:async()=>{throw Error('403')}}),null);
  let active=true;
  assert.equal(await nav.resolveAuthorizedProjectExtraNavigation(target,{isCurrent:()=>active,read:async()=>{active=false;return payload}}),null);
  for(const malformed of [{...target,projectId:null},{...target,inspectId:'x'.repeat(201)},{...target,inspectId:' '}]){
    assert.equal(await nav.resolveAuthorizedProjectExtraNavigation(malformed,{isCurrent:()=>true,read:async()=>{throw Error('should not read')}}),null);
  }
 });
}
await check('Unknown and index-only Project locations remain owned by parent path',async()=>{
 for(const target of [{screen:'project',projectId:'p1'},{screen:'project',projectId:'p1',inspectScope:'source-commit',inspectId:'c1'},{screen:'calendar',inspectScope:'project-asset',inspectId:'a1'}]){
  assert.equal(nav.requiresAuthorizedProjectExtraNavigation(target),false);
 }
});
await check('Central handler verifies Project child before generic Project and never caches admission',async()=>{
 const src=read('packages/renderer/src/features/application/ClusterApplication.tsx');
 assert.ok(src.indexOf('if (requiresAuthorizedProjectExtraNavigation(incoming))')<src.indexOf('if (incoming.screen === "project")'));
 assert.match(src,/resolveAuthorizedProjectExtraNavigation\(incoming, \{/);
 assert.match(src,/read: \(path\) => queryApi\(path, \{ force: true, persist: false, staleWhileRevalidate: false \}\)/);
});
await check('Existing server readers enforce asset, review, control and source access',async()=>{
 const asset=read('apps/server/src/domains/projects/project-asset-routes.ts');
 const review=read('apps/server/src/domains/media/review-routes.ts');
 const control=read('apps/server/src/domains/projects/project-control-routes.ts');
 const source=read('apps/server/src/domains/source-control/source-control-routes.ts');
 assert.match(asset,/app.get\("\/api\/project-files\/:fileId"[\s\S]*?fileAndAccess\(deps, request, reply, params.fileId, "view"\)/);
 assert.match(review,/get\("\/api\/review-assets\/:assetId\/session"[\s\S]*?authorization.requireTarget\(request, reply, "review_asset", asset.id, project, "view"\)/);
 assert.match(control,/get\("\/api\/projects\/:projectId\/control-center"[\s\S]*?enforceTargetAccess\(request, reply, "project", project.id, project, "view"\)/);
 assert.match(source,/get\("\/api\/projects\/:projectId\/source-control"[\s\S]*?projectSourceContext\(deps, request, reply, projectId, "view"\)/);
});
console.log(`${count}/${count} G27 P10/P11 connected checks passed`);
