import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js'))}})();
const file=(r)=>fs.readFileSync(new URL('../../'+r,import.meta.url),'utf8');
function load(rel,mocks={}){
 const module={exports:{}};
 const js=ts.transpileModule(file(rel),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(js,{module,exports:module.exports,require:(n)=>{if(n in mocks)return mocks[n];throw Error('missing mock '+n);},Date,Intl,Number,String,Array,Math,Set,Object,JSON},{filename:rel});
 return module.exports;
}
const shared=load('packages/shared/src/notification-quiet-hours.ts');
const consts={...shared,CLUSTER_NOTIFICATION_CATEGORIES:['activity','mentions','approvals','delivery','qa','schedule','work','system'],CLUSTER_NOTIFICATION_TOOLS:['project','builds','system'],CLUSTER_NOTIFICATION_TOOL_DETAILS:{},PRODUCT_TERMS:{qa:'QA'}};
const prefs=load('packages/renderer/src/features/notifications/notification-preferences.ts',{'@cluster/shared':consts});
const mandatory=load('packages/renderer/src/features/notifications/notification-mandatory-security.ts');
const channels=load('packages/renderer/src/features/notifications/notification-live-channels.ts',{'./notification-preferences':prefs,'./notification-mandatory-security':mandatory});
const now=new Date('2026-07-10T02:30:00Z');
let n=0;function check(name,fn){fn();++n;console.log('PASS '+name)}
const item=(more={})=>({category:'work',priority:'normal',tool:'project',projectId:'p1',signal:'activity',metadata:{},...more});
const config=(more={})=>({notificationCategoryDelivery:{work:'both',system:'both'},...more});
const decide=(c={},i=item(),when=now,tz='America/New_York')=>channels.notificationLiveChannels(config(c),i,tz,when);
const result=(r)=>JSON.stringify(r);
check('both channels are active when unmuted without stored policy',()=>{
 assert.equal(result(decide()),result({toast:true,native:true}));
});
check('category off and silent suppress routine interruptions',()=>{
 for(const mode of ['off','silent'])assert.equal(result(decide({notificationCategoryDelivery:{work:mode}},item())),result({toast:false,native:false}));
});
check('both native and toast obey project mutes',()=>{
 for(const mode of ['off','important'])assert.equal(result(decide({notificationProjectModes:{p1:mode}},item())),result({toast:false,native:false}));
 assert.equal(result(decide({notificationProjectModes:{p1:'important'}},item({priority:'high'}))),result({toast:true,native:true}));
});
check('per-tool mute and priority floor suppress routine, not mandatory security',()=>{
 assert.equal(decide({notificationToolModes:{project:'off'}},item()).toast,false);
 assert.equal(decide({notificationPriorityFloor:'high'},item()).native,false);
 const critical=item({category:'system',priority:'critical',signal:'security',metadata:{notificationPolicy:{interruptive:false,deliveryMode:'off'}}});
 assert.equal(result(decide({notificationCategoryDelivery:{system:'off'},notificationToolModes:{project:'off'},notificationPriorityFloor:'critical'},critical)),result({toast:true,native:false}));
});
check('current quiet hours suppress routine interruption even if old snapshot was interruptive',()=>{
 const i=item({metadata:{notificationPolicy:{interruptive:true,deliveryMode:'both'}}});
 const s={userQuietHoursEnabled:true,userQuietHoursStart:'22:00',userQuietHoursEnd:'07:00',notificationQuietHoursBehavior:'silent'};
 assert.equal(result(decide(s,i)),result({toast:false,native:false}));
 assert.equal(result(decide(s,i,now,'America/Los_Angeles')),result({toast:true,native:true}));
});
check('stored noninterruptive policy suppresses routine alert',()=>{
 assert.equal(result(decide({},item({metadata:{notificationPolicy:{interruptive:false,deliveryMode:'both'}}}))),result({toast:false,native:false}));
});
check('stored channel selection intersects current recipient channels',()=>{
 for(const [current,old,toast,native] of [
   ['both','toast',true,false],['both','native',false,true],['native','toast',false,false],['toast','both',true,false],['both','off',false,false]
 ]){
  const i=item({metadata:{notificationPolicy:{interruptive:true,deliveryMode:old}}});
  assert.equal(result(decide({notificationCategoryDelivery:{work:current}},i)),result({toast,native}),`${current}/${old}`);
 }
});
check('mandatory security category off and old policy silent forces interruptive toast',()=>{
 const i=item({category:'system',priority:'critical',signal:'security',metadata:{notificationPolicy:{interruptive:false,deliveryMode:'silent'}}});
 for(const mode of ['off','silent'])assert.equal(result(decide({notificationCategoryDelivery:{system:mode}},i)),result({toast:true,native:false}));
 assert.equal(result(decide({notificationCategoryDelivery:{system:'both'}},i)),result({toast:true,native:true}));
 assert.equal(result(decide({notificationCategoryDelivery:{system:'native'}},i)),result({toast:false,native:true}));
});
check('nonsecurity critical system still obeys recipient mode',()=>{
 const i=item({category:'system',priority:'critical',signal:'failure'});
 assert.equal(result(decide({notificationCategoryDelivery:{system:'off'}},i)),result({toast:false,native:false}));
});
check('missing or malformed policy is safely resolved from current preferences',()=>{
 for(const policy of [null,5,[],{deliveryMode:'bogus'},{}]){
   assert.equal(result(decide({},item({metadata:{notificationPolicy:policy}}))),result({toast:true,native:true}));
 }
});
check('Inbox, taskbar and Desktop use shared project and live channel helpers',()=>{
 const inbox=file('packages/renderer/src/features/notifications/NotificationInboxPage.tsx');
 const taskbar=file('packages/renderer/src/features/application/modules/ApplicationProjectTabs.tsx');
 const desktop=file('packages/renderer/src/features/notifications/desktop-notification-sync.ts');
 assert.match(inbox,/return notificationProjectAllowed\(user, item.projectId, item.category, item.priority\)/);
 assert.match(taskbar,/return notificationLiveChannels\(settings, item, user.timezone\)\.toast/);
 assert.match(desktop,/return notificationLiveChannels\(settings, item, timeZone\)\.native/);
});
console.log(`${n}/${n} G27 P61 shared notification delivery checks passed`);
