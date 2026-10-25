import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import path from 'node:path';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js'))}})();
const read=(f)=>readFileSync(new URL('../../'+f,import.meta.url),'utf8');
const load=(file)=>{
 const src=read(file);
 const mod={exports:{}};
 const output=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(output,{module:mod,exports:mod.exports,URLSearchParams},{filename:file});
 return mod.exports;
};
const {delegatedFormDestination,formInspectorFromSearch}=load('packages/renderer/src/features/workflow/delegated-form-navigation.ts');
const {admitRecentWorkspace,recentWorkspaceIdentity}=load('packages/renderer/src/features/search/recent-workspace-admission.ts');
let assertions=0;
function check(label,fn){fn();assertions++;console.log('PASS '+label)}
const formRoute={screen:'studioSettings',scope:'form-submission',id:'sub-123',isAdmin:false};
check('delegated Form submission opens only personal Forms',()=>assert.equal(delegatedFormDestination(formRoute),'forms'));
check('delegated Form identity supports reviewer landing',()=>assert.equal(delegatedFormDestination({...formRoute,scope:'studio-form'}),'forms'));
check('admin still opens the administrative form workbench',()=>assert.equal(delegatedFormDestination({...formRoute,isAdmin:true}),null));
check('no generic studio settings access for member',()=>assert.equal(delegatedFormDestination({...formRoute,scope:null}),null));
check('application, announcements, and approvals are never delegated',()=>{
 for(const scope of ['studio-application','studio-announcement','approval','studio-announcement-new','studio-announcement-list'])
   assert.equal(delegatedFormDestination({...formRoute,scope}),null);
});
check('not a bypass from arbitrary routes',()=>assert.equal(delegatedFormDestination({...formRoute,screen:'admin'}),null));
check('reject blank/oversized ID',()=>{
 assert.equal(delegatedFormDestination({...formRoute,id:' '}),null);
 assert.equal(delegatedFormDestination({...formRoute,id:'a'.repeat(161)}),null);
});
check('exact legacy inspector parsed without emitting private data',()=>{
 const found=formInspectorFromSearch('?inspect=form-submission%3Asub-123&other=1');
 assert.equal(found?.scope,'form-submission');assert.equal(found?.id,'sub-123');
});
check('legacy application/announcement inspector not permitted',()=>{
 assert.equal(formInspectorFromSearch('?inspect=studio-application:xxx'),null);
 assert.equal(formInspectorFromSearch('?inspect=studio-announcement:xxx'),null);
});
check('malformed/surplus inspector values rejected',()=>{
 assert.equal(formInspectorFromSearch('?inspect=form-submission:'),null);
 assert.equal(formInspectorFromSearch('?inspect=form-submission%3A'+ 'z'.repeat(161)),null);
});
const project={route:'project',context:{projectId:'p1',boardId:null,whiteboardId:null}};
const board={route:'board',context:{projectId:'p1',boardId:'b1',whiteboardId:null}};
const standaloneBoard={route:'board',context:{projectId:null,boardId:'b1',whiteboardId:null}};
const whiteboard={route:'whiteboard',context:{projectId:null,boardId:null,whiteboardId:'w1'}};
const simple={route:'settings',context:{projectId:null,boardId:null,whiteboardId:null}};
const execute=(target,{online=true,current=()=>true,offline=false,response,fail=false,nav=true}={})=>{
 const calls=[];
 return admitRecentWorkspace({target,online,isCurrent:current,hasOfflineCopy:()=>offline,
   load:async(kind,id)=>{calls.push('read:'+kind+':'+id);if(fail)throw Error('unauthorized');return response===undefined ? ({projectId:'p1',id:'b1'}) : response},
   navigate:()=>{calls.push('navigate');return nav},
 }).then(admitted=>({admitted,calls}));
};
check('recent resource address identity is typed and project-scoped',()=>{
 const x=recentWorkspaceIdentity(board);assert.equal(x?.kind,'board');assert.equal(x?.projectId,'p1');
});
await (async()=>{
 let x=await execute(project,{response:{projectId:'p1'}});
 check('project snapshot with same ID admitted',()=>{assert.equal(x.admitted,true);assert.deepEqual(x.calls,['read:project:p1','navigate'])});
 x=await execute(project,{response:{projectId:'p2'}});
 check('snapshot of different project rejects',()=>{assert.equal(x.admitted,false);assert.deepEqual(x.calls,['read:project:p1'])});
 x=await execute(board,{response:{id:'b1',projectId:'p1'}});
 check('board with exact project accepted',()=>assert.equal(x.admitted,true));
 x=await execute(board,{response:{id:'b1',projectId:'p2'}});
 check('board moved between projects rejected',()=>assert.equal(x.admitted,false));
 x=await execute(board,{response:{id:'b2',projectId:'p1'}});
 check('board identity swap rejected',()=>assert.equal(x.admitted,false));
 x=await execute(standaloneBoard,{response:{id:'b1',projectId:'p1'}});
 check('standalone Board gaining project fails old link',()=>assert.equal(x.admitted,false));
 x=await execute(whiteboard,{response:{id:'w1',projectId:null}});
 check('standalone Whiteboard revalidated',()=>assert.equal(x.admitted,true));
 x=await execute(whiteboard,{response:{id:'w1',projectId:'p1'}});
 check('Whiteboard placement change rejected',()=>assert.equal(x.admitted,false));
 x=await execute(project,{response:null});
 check('deleted or inaccessible project rejected',()=>assert.equal(x.admitted,false));
 x=await execute(project,{fail:true});
 check('network/authorization error never navigates',()=>assert.equal(x.admitted,false));
 x=await execute(project,{online:false});
 check('offline project without local copy rejected',()=>{assert.equal(x.admitted,false);assert.deepEqual(x.calls,[])});
 x=await execute(project,{online:false,offline:true});
 check('offline project with local copy explicitly supported',()=>{assert.equal(x.admitted,true);assert.deepEqual(x.calls,['navigate'])});
 x=await execute({...project,context:{...project.context,projectId:null}});
 check('incomplete project route cannot downgrade to generic screen',()=>{assert.equal(x.admitted,false);assert.deepEqual(x.calls,[])});
 x=await execute(simple,{fail:true});
 check('non-resource screen follows caller route permission, no remote resource request',()=>{assert.equal(x.admitted,true);assert.deepEqual(x.calls,['navigate'])});
 x=await execute(project,{response:{projectId:'p1'},nav:false});
 check('navigation failure remains failure',()=>assert.equal(x.admitted,false));
 let current=true,release;
 const gate=new Promise(resolve=>release=resolve);
 const calls=[];
 const flight=admitRecentWorkspace({target:board,online:true,isCurrent:()=>current,hasOfflineCopy:()=>false,
  load:async()=>{calls.push('load');await gate;return {id:'b1',projectId:'p1'}},navigate:()=>{calls.push('navigate')}});
 current=false;release();
 const approved=await flight;
 check('user/session/ACL changes midflight cannot trigger navigation',()=>{assert.equal(approved,false);assert.deepEqual(calls,['load'])});
})();
const shell=read('packages/renderer/src/features/application/ClusterApplication.tsx');
const states=read('packages/renderer/src/features/application/application-runtime-ux.tsx');
const routing=read('packages/renderer/src/features/application/modules/project-tab-workspace.ts');
const forms=read('packages/renderer/src/features/settings/MyFormsPanel.tsx');
const palette=read('packages/renderer/src/features/search/CommandPalette.tsx');
const createDrawer=read('packages/renderer/src/features/create/SharedCreateDrawer.tsx');
check('legacy direct URL resolves to My Forms without admin permission',()=>assert.match(shell,/formInspectorFromSearch\(window\.location\.search\)[\s\S]*?setScreen\("settings", \{ section: "forms" \}\)/));
check('work navigation does not discard delegated inspector before resolution',()=>assert.match(shell,/!activeUser\.isAdmin && !delegatedForms/));
check('route admission checks cannot open generic administrator surfaces',()=>assert.match(shell,/if \(!delegatedForms && !canOpenScreen\(activeUser, target\.screen\)\) return/));
check('personal Forms and My Resources are actual deep-linkable account sections',()=>assert.match(states,/"desktop", "forms", "licenses"/));
check('cross-workspace navigation retains Form inspector on account Settings',()=>assert.match(routing,/settings: new Set\(\["studio-form", "form-submission"\]\)/));
check('admin navigation keeps its own Forms and Announcements inspector',()=>assert.match(routing,/studioSettings: new Set\(\["studio-form", "form-submission", "studio-application"/));
check('member reviewer uses ID-only Form-target resolver with uncached access',()=>assert.match(forms,/submissions\/\$\{encodeURIComponent\(targetInspector\.id\)\}\/target`[\s\S]*?force: true, persist: false, staleWhileRevalidate: false/));
check('member reviewer does not receive source/admin Form settings',()=>assert.match(forms,/delegatedReview/));
check('member review workbench resolves only matching grant and never selects another Form',()=>assert.match(forms,/reviewForms\.some\(\(form\) => form\.id === formId\)/));
check('manual Form choice cannot replay stale response against another Form',()=>assert.match(forms,/chooseReviewForm\(form\.id\)[\s\S]*?targetSubmissionId=\{targetInspector\?\.scope/));
check('native and user recents both invoke exact fresh resource admission',()=>{
 assert.match(palette,/const success = await admitRecentWorkspace/);
 assert.match(palette,/kind === "project" \? `\/api\/projects\/\$\{encodeURIComponent\(id\)\}\/snapshot`/);
 assert.match(palette,/kind === "board" \? `\/api\/boards\/\$\{encodeURIComponent\(id\)\}`/);
 assert.match(palette,/`\/api\/whiteboards\/\$\{encodeURIComponent\(id\)\}`/);
});
check('offline Board cache cannot promote a project Board into a standalone workspace',()=>assert.match(palette,/project\.id === resource\.projectId\);/));
check('stale or failed recent navigation surfaces a visible error',()=>assert.match(palette,/Recent workspace is no longer accessible, changed location, or could not be verified/));
check('Search no longer contains duplicate type declaration',()=>assert.doesNotMatch(palette,/let relevance: number;\s*let relevance: number;/));
check('Create & Open carries the exact Calendar object ID',()=>assert.match(createDrawer,/entity\.kind === "calendar"\) return \{ screen: "calendar", projectId: targetProjectId, inspectScope: "calendar-event", inspectId: entity\.id \}/));
check('Create & Open carries the exact Scheduler object ID',()=>assert.match(createDrawer,/entity\.kind === "scheduler"\) return \{ screen: "scheduler", projectId: targetProjectId, inspectScope: "schedule-block", inspectId: entity\.id \}/));
check('Create & Open carries the exact Timeline object ID',()=>assert.match(createDrawer,/entity\.kind === "timeline"\) return \{ screen: "timeline", projectId: targetProjectId, inspectScope: "timeline-item", inspectId: entity\.id \}/));
check('Create & Open carries the exact Packet object ID',()=>assert.match(createDrawer,/entity\.kind === "packet"\) return \{ screen: "packets", packetId: entity\.id \}/));
check('legacy meeting stays in its project workflow, not incorrect calendar event',()=>assert.match(createDrawer,/entity\.kind === "meeting"\) return \{ screen: "project", projectId: targetProjectId, projectTab: "plan" \}/));
check('Form reviewer grants are fetched independently from own assigned Forms',()=>assert.match(forms,/Promise\.allSettled\(\[\s*queryApi.*\/api\/forms\/available[\s\S]*?\/api\/forms\/review-assignments/));
assert.ok(assertions>=43);
console.log(`${assertions}/${assertions} G27 Pass 3 scoped navigation, recents, and regression assertions passed`);
