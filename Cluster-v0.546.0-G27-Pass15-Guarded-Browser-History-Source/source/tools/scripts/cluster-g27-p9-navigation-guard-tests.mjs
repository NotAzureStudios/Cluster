import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
import path from 'node:path';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js')); } })();
const read = p => readFileSync(new URL('../../'+p,import.meta.url),'utf8');
let passed=0;
const check=(title, fn)=>{fn();passed++;console.log('PASS '+title)};
const app=read('packages/renderer/src/features/application/ClusterApplication.tsx');
const src=ts.createSourceFile('ClusterApplication.tsx',app,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let setScreenNode;
function find(node){if(ts.isFunctionDeclaration(node)&&node.name?.text==='setScreen')setScreenNode=node;ts.forEachChild(node,find)}
find(src);
assert.ok(setScreenNode,'Missing actual setScreen controller');
const compiled=ts.transpileModule(`exports.setScreen = ${setScreenNode.getText(src)};`,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
async function runScreen({next='calendar',current='project',dirty=true,confirm=false,requestedSection,confirmFailure=false}={}){
 const calls=[];let state=current;
 const url=new URL('https://studio.test/?inspect=build-artifact%3Aitem1#project/p1');
 const simulatedWindow={location:{pathname:url.pathname,search:url.search,hash:url.hash},history:{pushState:(...args)=>calls.push(['history.pushState',...args])}};
 const exports={};const module={exports};
 const env={
   module,exports,window:simulatedWindow,screen:current,projectId:'p1',boardId:null,whiteboardId:null,
   kioskActiveRef:{current:false},kioskPolicyRef:{current:{}},kioskSafeScreen:(p,s)=>s,
   setNavigationNotice:x=>calls.push(['notice',x]),
   settingsInitialSection:'privacy',serverConfigInitialSection:'overview',
   setSettingsInitialSection:x=>calls.push(['settingsInitialSection',x]),
   setServerConfigInitialSection:x=>calls.push(['serverConfigInitialSection',x]),
   normalizeAccountSettingsSection:x=>x,normalizeServerConfigSection:x=>x,
   setMobileSidebarOpen:x=>calls.push(['sidebar',x]),
   clearIncompatibleRouteContext:x=>calls.push(['clearRoute',x]),
   hasUnsavedChanges:()=>{calls.push(['dirtyCheck']);return dirty;},
   confirmCluster:async()=>{calls.push(['confirm']);if(confirmFailure)throw Error('dialog unavailable');return confirm},
   setRouteSection:x=>calls.push(['routeSection',x]),setRouteSubsection:x=>calls.push(['routeSubsection',x]),
   setScreenState:f=>{calls.push(['setScreenState']);state=typeof f==='function'?f(state):f},
   createNavigationState:(route,options)=>({route,...options}),
   historyRestoreRef:{current:false},navigationAttemptRef:{current:0},
   navigationHash:s=>'#'+s.route,
 };
 vm.runInNewContext(compiled,env,{filename:'ClusterApplication.setScreen.ts'});
 try{await module.exports.setScreen(next,requestedSection?{section:requestedSection}:{});return {calls,state}}catch(error){return {calls,state,error}}
}
let result=await runScreen();
check('cancelled dirty workspace leaves the prior route untouched',()=>{assert.equal(result.state,'project');assert.ok(result.calls.some(x=>x[0]==='confirm'));assert.equal(result.calls.filter(x=>x[0]==='clearRoute').length,0)});
check('cancelled navigation retains modal/sidebar and route settings',()=>assert.deepEqual(result.calls.map(x=>x[0]),['dirtyCheck','confirm']));
result=await runScreen({next:'settings',requestedSection:'myForms'});
check('cancelled settings transition does not switch settings section',()=>assert.equal(result.calls.some(x=>x[0]==='settingsInitialSection'),false));
result=await runScreen({next:'serverConfig',requestedSection:'network'});
check('cancelled Server Config transition does not switch server section',()=>assert.equal(result.calls.some(x=>x[0]==='serverConfigInitialSection'),false));
result=await runScreen({next:'calendar',confirmFailure:true});
check('unavailable confirm dialog fails without losing inspector/route',()=>{assert.ok(result.error);assert.equal(result.calls.some(x=>x[0]==='clearRoute'),false);assert.equal(result.state,'project')});
result=await runScreen({confirm:true});
check('confirmed route switch cleans incompatible inspector after permission to discard',()=>{
 const operations=result.calls.map(x=>x[0]);assert.ok(operations.indexOf('confirm')<operations.indexOf('clearRoute'));assert.equal(result.state,'calendar');
});
result=await runScreen({dirty:false});
check('clean route switch bypasses prompt but still updates route',()=>{assert.equal(result.calls.some(x=>x[0]==='confirm'),false);assert.equal(result.state,'calendar')});
result=await runScreen({next:'project'});
check('same-screen navigation does not discard unsaved changes',()=>{assert.equal(result.calls.some(x=>x[0]==='confirm'),false);assert.equal(result.state,'project')});
result=await runScreen({next:'settings',requestedSection:'myForms',confirm:true});
check('approved settings switch applies requested panel after confirmation',()=>{const ops=result.calls.map(x=>x[0]);assert.ok(ops.indexOf('confirm')<ops.indexOf('settingsInitialSection'));assert.equal(result.state,'settings')});
const tab=read('packages/renderer/src/features/application/modules/project-tab-workspace.ts');
const tabExports={};
vm.runInNewContext(ts.transpileModule(tab,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
 module:{exports:tabExports},exports:tabExports,URL,
 require:()=>({CLUSTER_WORK_PROJECT_TAB_QUERY_KEY:'projectTab'}),
 window:{location:{href:'https://studio.test/?inspect=meeting%3Am1&projectTab=overview#project/p1'},history:{replaceState:(_state,_title,destination)=>{tabExports.lastDestination=destination}}},
},{filename:'project-tab-workspace.ts'});
tabExports.clearIncompatibleRouteContext('calendar');
check('switch to Calendar preserves a pending Meeting identity for authorization',()=>assert.match(tabExports.lastDestination,/[?&]inspect=meeting%3Am1/));
tabExports.clearIncompatibleRouteContext('library');
check('switch to incompatible tool deletes Meeting inspector',()=>assert.doesNotMatch(tabExports.lastDestination,/inspect=/));
check('Calendar route allowlist still includes canonical event inspectors',()=>assert.match(tab,/calendar: new Set\(\["calendar-event", "meeting"\]\)/));
const winSrc=read('packages/renderer/src/features/workflow/workspace-window.ts');
const windowExports={};
const nativeWindow={location:{href:'https://studio.test/?inspect=meeting%3Am1#calendar',hash:'#calendar'}};
vm.runInNewContext(ts.transpileModule(winSrc,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
 module:{exports:windowExports},exports:windowExports,URL,window:nativeWindow,require:()=>({openDesktopWorkspaceWindow:async()=>true}),
},{filename:'workspace-window.ts'});
check('detached current Calendar tab retains Meeting inspector identity',()=>assert.equal(windowExports.desktopWorkspaceRouteFromCurrentLocation(),'calendar/inspect/meeting/m1'));
check('detached target URL also retains exact meeting identity',()=>assert.equal(windowExports.desktopWorkspaceRoute({screen:'calendar',inspectScope:'meeting',inspectId:'m1'}),'calendar/inspect/meeting/m1'));
check('detached URL refuses injected path tokens',()=>assert.equal(windowExports.desktopWorkspaceRoute({screen:'calendar',inspectScope:'meeting',inspectId:'../../s'}),'calendar'));
const work=read('packages/renderer/src/features/workflow/work-actions.ts');
check('work source reconstruction preserves Meeting resource identity',()=>assert.match(work,/scope === "meeting"\) kind = "meeting"/));
check('Meetings route through fresh authorization before Calendar inspector becomes canonical',()=>{
 assert.match(app,/resolveAuthorizedMeetingNavigation\(incoming, \{/);
 assert.match(app,/\/api\/calendar\/meetings\/\$\{encodeURIComponent\(id\)\}\/target/);
});
assert.equal(passed,17);
console.log(`${passed}/${passed} G27 Pass 9 navigation guard and detachable Meeting checks passed`);
