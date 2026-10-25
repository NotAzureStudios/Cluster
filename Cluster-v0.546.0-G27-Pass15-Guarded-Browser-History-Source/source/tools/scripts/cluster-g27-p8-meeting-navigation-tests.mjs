import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import path from 'node:path';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js'))}})();
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
function load(file){const mod={exports:{}};vm.runInNewContext(ts.transpileModule(read(file),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module:mod,exports:mod.exports},{filename:file});return mod.exports}
const {resolveAuthorizedMeetingNavigation}=load('packages/renderer/src/features/workflow/authorized-meeting-navigation.ts');
const meeting={screen:'calendar',projectId:'oldP',inspectScope:'meeting',inspectId:'m1'};
const execute=(target,{reply,fail=false,current=()=>true}={})=>{
 const calls=[];
 return resolveAuthorizedMeetingNavigation(target,{isCurrent:current,read:async(id)=>{calls.push(id);if(fail) throw Error('403');return reply===undefined?{meetingId:'m1',eventId:'event1',projectId:'currentP'}:reply}}).then(result=>({result,calls}));
};
let passed=0;
const check=(title,assertion)=>{assertion();passed++;console.log('PASS '+title)};
let x=await execute(meeting);
check('authorized Meeting opens its canonical Calendar event, not Project planning',()=>{assert.equal(x.result?.screen,'calendar');assert.equal(x.result?.inspectScope,'calendar-event');assert.equal(x.result?.inspectId,'event1');assert.equal(x.result?.projectId,'currentP');assert.deepEqual(x.calls,['m1'])});
x=await execute(meeting,{reply:{meetingId:'m1',eventId:'event1',projectId:null}});
check('standalone private/participant Meeting has no invented Project owner',()=>assert.equal(x.result?.projectId,null));
x=await execute(meeting,{reply:{meetingId:'other',eventId:'event1',projectId:null}});
check('wrong Meeting ID never borrows a Calendar event',()=>assert.equal(x.result,null));
x=await execute(meeting,{reply:{meetingId:'m1',eventId:'bad/path',projectId:null}});
check('malformed Calendar event target denied',()=>assert.equal(x.result,null));
x=await execute(meeting,{reply:{meetingId:'m1',eventId:'event1'}});
check('missing authoritative parent field denied',()=>assert.equal(x.result,null));
x=await execute(meeting,{reply:null});
check('deleted or revoked Meeting remains unavailable',()=>assert.equal(x.result,null));
x=await execute(meeting,{fail:true});
check('network and access errors do not navigate',()=>assert.equal(x.result,null));
x=await execute({...meeting,inspectId:'../../m1'});
check('pathlike Meeting identity does not trigger API read',()=>{assert.equal(x.result,null);assert.deepEqual(x.calls,[])});
x=await execute({...meeting,inspectId:'m'.repeat(201)});
check('oversized Meeting identity does not trigger API read',()=>{assert.equal(x.result,null);assert.deepEqual(x.calls,[])});
x=await execute({...meeting,inspectScope:'calendar-event'});
check('already canonical event does not invoke Meeting adapter',()=>assert.equal(x.result,null));
x=await execute({...meeting,screen:'project'});
check('wrong workspace cannot invoke Meeting adapter',()=>assert.equal(x.result,null));
x=await execute(meeting,{current:()=>false});
check('stale initial session does not issue requests',()=>{assert.equal(x.result,null);assert.deepEqual(x.calls,[])});
let live=true,unblock;
const pending=resolveAuthorizedMeetingNavigation(meeting,{isCurrent:()=>live,read:async()=>{await new Promise(resolve=>unblock=resolve);return {meetingId:'m1',eventId:'event1',projectId:null}}});
live=false;unblock();
const stale=await pending;
check('session or another navigation invalidates in-flight Meeting link',()=>assert.equal(stale,null));
const server=read('apps/server/src/domains/planning/calendar-routes.ts');
const app=read('packages/renderer/src/features/application/ClusterApplication.tsx');
const resource=read('packages/renderer/src/features/workflow/resource-navigation.ts');
const shared=read('packages/shared/src/resource-address.ts');
const manifest=read('packages/shared/src/cluster-manifest.ts');
check('canonical Meeting resource adapter preserves identity and uses Calendar rather than project plan',()=>assert.match(resource,/kind === "meeting"\) return \{ screen: "calendar", projectId, inspectScope: "meeting", inspectId: id \}/));
check('Meeting URI allows standalone Calendar meetings under canonical resource grammar',()=>{
 assert.match(manifest,/meeting: \{[^\n]*standaloneAllowed: true/);
 assert.match(shared,/"whiteboard", "meeting", "review_asset"/);
});
check('central listener fetches a fresh permission-checked Meeting target before changing UI',()=>{
 const first=app.indexOf('resolveAuthorizedMeetingNavigation(incoming, {');const second=app.indexOf('applyLinkedWork(resolved, sequence, navigationAttempt);',first);
 assert.ok(first>0 && second>first);
 assert.match(app.slice(first,second),/\/api\/calendar\/meetings\/\$\{encodeURIComponent\(id\)\}\/target/);
 assert.match(app.slice(first,second),/force: true, persist: false, staleWhileRevalidate: false/);
 assert.doesNotMatch(app.slice(first,second),/setProjectId\(|setBoardId\(/);
});
check('existing Calendar inspector can open an exact Event by authorized API',()=>{
 const calendar=read('packages/renderer/src/features/calendar/CalendarPage.tsx');
 assert.match(calendar,/useClusterDetailHistory\("calendar-event"/);
 assert.match(calendar,/`\/api\/calendar\/events\/\$\{encodeURIComponent\(id\)\}/);
});
// Browser URLs are untrusted until the same server admission path resolves them.
const hydrationModule={exports:{}};
vm.runInNewContext(ts.transpileModule(read('packages/renderer/src/features/workflow/meeting-link-hydration.ts'),{
 compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText,{module:hydrationModule,exports:hydrationModule.exports,URLSearchParams},{filename:'meeting-link-hydration.ts'});
const hydrate=hydrationModule.exports.pendingMeetingBrowserLink;
const href=(screen,search,projectId=null)=>hydrate({screen,search,projectId});
check('cold browser Calendar URL preserves an exact Meeting identity for authorization',()=>{
 const t=href('calendar','?inspect=meeting%3Am1&foo=bar','outdatedParent');
 assert.equal(t?.inspectScope,'meeting');assert.equal(t?.inspectId,'m1');assert.equal(t?.projectId,'outdatedParent');
});
check('cold browser Meeting does not require a Project ID',()=>{
 const t=href('calendar','?inspect=meeting%3Am1');assert.equal(t?.projectId,null);
});
check('URL parser never hydrates a Meeting while another tool is active',()=>assert.equal(href('project','?inspect=meeting%3Am1'),null));
check('URL parser denies path traversal rather than decoding it as a resource ID',()=>assert.equal(href('calendar','?inspect=meeting%3A..%2Fm1'),null));
check('URL parser denies overlong Meeting IDs',()=>assert.equal(href('calendar','?inspect=meeting%3A'+'m'.repeat(201)),null));
check('URL parser does not interpret unrelated inspectors as Meetings',()=>assert.equal(href('calendar','?inspect=calendar-event%3Aevent1'),null));
check('authenticated app restores browser Meeting through central work navigation',()=>{
 assert.match(app,/pendingMeetingBrowserLink\(\{ screen, search: window\.location\.search, projectId \}\)/);
 assert.match(app,/openClusterWorkNavigation\(target\)/);
 assert.match(app,/hydratedMeetingBrowserLinkRef\.current === key/);
});
check('unauthorized Calendar tool and denied Meeting clean stale URL safely',()=>{
 assert.match(app,/Meeting link unavailable[\s\S]*?Calendar is not available in this session/);
 assert.match(app,/url\.searchParams\.get\("inspect"\) === `meeting:\$\{incoming\.inspectId\}`/);
});
// Extract the actual server route callback instead of duplicating its logic.
const ast=ts.createSourceFile('calendar-routes.ts',server,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
let routeNode;
function find(node){if(ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text==='get' && node.arguments.length>1 && ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text==='/api/calendar/meetings/:meetingId/target')routeNode=node;ts.forEachChild(node,find)}
find(ast);
assert.ok(routeNode,'missing Meeting target route');
const callbackText=routeNode.arguments[1].getText(ast);
const compiled=ts.transpileModule('exports.handler='+callbackText+';', {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const fakeZ={object:()=>({parse:v=>v})};fakeZ.string=()=>({trim(){return this},min(){return this},max(){return this}});
const event={id:'event1',projectId:'currentP',meeting:{id:'m1'},title:'CONFIDENTIAL',notes:'SECRET'};
let record={id:'m1',calendarEvent:event},allow=true,reads=0,access=0;
const module={exports:{}};
vm.runInNewContext(compiled,{module,exports:module.exports,z:fakeZ,calendarEventInclude:{},
 prisma:{meeting:{findUnique:async()=>{reads++;return record}}},canViewEvent:async(_req,rec)=>{access++;assert.equal(rec,event);return allow},
 sendPrivateRevalidated:(_req,_reply,data)=>data,
},{filename:'calendar-meeting-target-handler.ts'});
const handler=module.exports.handler;
const invoke=async()=>{const response={status:200,body:null,code(status){this.status=status;return this},send(body){this.body=body;return body}};const data=await handler({params:{meetingId:'m1'}},response);return {response,data}};
let call=await invoke();
check('backend Meeting target only returns permitted identifiers, never payload/notes',()=>{
 assert.equal(reads,1);assert.equal(access,1);
 assert.equal(call.data.meetingId,'m1');assert.equal(call.data.eventId,'event1');assert.equal(call.data.projectId,'currentP');
 assert.equal('title' in call.data,false);assert.equal('notes' in call.data,false);
});
allow=false;call=await invoke();
check('private/unauthorized Meeting returns generic missing reply with no event identity',()=>{assert.equal(call.response.status,404);assert.equal(call.data?.code,'RESOURCE_NOT_FOUND');assert.ok(!JSON.stringify(call.data).includes('event1'))});
allow=true;record=null;call=await invoke();
check('missing Meeting returns same shape as revoked Meeting',()=>{assert.equal(call.response.status,404);assert.equal(call.data?.code,'RESOURCE_NOT_FOUND')});
record={id:'m1',calendarEvent:{...event,meeting:{id:'wrong'}}};call=await invoke();
check('orphaned/mismatched Calendar-Meeting relation is rejected',()=>assert.equal(call.response.status,404));
check('server validator limits target IDs and uses identical exact event visibility engine',()=>{
 assert.match(callbackText,/z\.string\(\)\.trim\(\)\.min\(1\)\.max\(200\)/);
 assert.match(callbackText,/canViewEvent\(request, event\)/);
 assert.match(server,/app\.get\("\/api\/calendar\/events\/:eventId"[\s\S]*?canViewEvent\(request, event\)/);
});
assert.equal(passed,30);
console.log(`${passed}/${passed} G27 Pass 8 canonical Meeting navigation checks passed`);
