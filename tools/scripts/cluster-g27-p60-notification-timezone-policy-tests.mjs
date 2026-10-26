import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js'))}})();
const root=new URL('../../',import.meta.url);
const file=(name)=>fs.readFileSync(new URL(name,root),'utf8');
function load(fileName, mocks={}){
  const js=ts.transpileModule(file(fileName),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  vm.runInNewContext(js,{module,exports:module.exports,require:(id)=>{if(id in mocks)return mocks[id];throw Error(`Unexpected dependency: ${id}`)},Intl,Date,Object,Number,String,Array,Set,Math,JSON,console},{filename:fileName});
  return module.exports;
}
const shared=load('packages/shared/src/notification-quiet-hours.ts');
const constants={...shared,CLUSTER_NOTIFICATION_PRIORITIES:['normal','medium','high','critical'],CLUSTER_NOTIFICATION_CATEGORIES:['mentions','approvals','work','schedule','delivery','qa','system','activity'],CLUSTER_NOTIFICATION_TOOLS:['project','system'],CLUSTER_NOTIFICATION_TOOL_DETAILS:{},PRODUCT_TERMS:{qa:'QA'}};
const server=load('apps/server/src/domains/notifications/notification-policy.ts',{'@cluster/shared':constants});
const client=load('packages/renderer/src/features/notifications/notification-preferences.ts',{'@cluster/shared':constants});
let n=0;
function check(label,fn){fn();n++;console.log('PASS '+label)}
const prefs={userQuietHoursEnabled:true,userQuietHoursStart:'22:00',userQuietHoursEnd:'07:00'};
for(const [label,tsValue,nyExpected,laExpected] of [
  ['summer late evening','2026-07-10T02:30:00Z',true,false],
  ['winter late evening','2026-01-10T03:30:00Z',true,false],
  ['spring DST skip','2026-03-08T07:30:00Z',true,true],
  ['fall DST repeated hour','2026-11-01T06:30:00Z',true,true],
  ['midday outside quiet hours','2026-07-10T16:00:00Z',false,false],
]) check(label,()=>{
  for(const [tz,expected] of [['America/New_York',nyExpected],['America/Los_Angeles',laExpected]]){
    const now=new Date(tsValue); const user={preferences:prefs,workingPattern:{timezone:tz}};
    assert.equal(server.notificationQuietHoursActive(user,now),expected,`server ${tz}`);
    assert.equal(client.notificationQuietHoursActive({...prefs,timezone:tz},now),expected,`client ${tz}`);
    assert.equal(client.notificationQuietHoursActive(prefs,now,tz),expected,`client explicit zone ${tz}`);
  }
});
check('invalid timezone deterministically falls back to UTC, not device',()=>{
  const now=new Date('2026-07-10T02:30:00Z');
  const expected=shared.notificationQuietHoursForZone(prefs,'UTC',now);
  assert.equal(shared.notificationQuietHoursForZone(prefs,'Fake/Zone',now),expected);
  assert.equal(client.notificationQuietHoursActive(prefs,now,'Fake/Zone'),expected);
  assert.equal(server.notificationQuietHoursActive({preferences:prefs,workingPattern:{timezone:'Fake/Zone'}},now),expected);
});
check('malformed clock falls back to policy defaults, equal endpoints mean 24-hour quiet',()=>{
  const now=new Date('2026-07-10T05:00:00Z');
  assert.equal(shared.notificationQuietHoursForZone({...prefs,userQuietHoursStart:'bogus',userQuietHoursEnd:'99:99'},'UTC',now),true);
  assert.equal(shared.notificationQuietHoursForZone({...prefs,userQuietHoursStart:'12:00',userQuietHoursEnd:'12:00'},'UTC',now),true);
  assert.equal(shared.notificationQuietHoursForZone({...prefs,userQuietHoursEnabled:false},'UTC',now),false);
});
check('server keeps normal off/silent choices and forces critical security delivery channel',()=>{
  const classify={category:'system',tool:'project',signal:'security',priority:'critical',requiresAction:true};
  for(const mode of ['off','silent']){
    const user={preferences:{notificationCategoryDelivery:{system:mode}}};
    const policy=server.evaluateNotificationPolicy(user,classify,new Date('2026-07-10T12:00:00Z'));
    assert.equal(policy.store,true);
    assert.equal(policy.interruptive,true);
    assert.equal(policy.deliveryMode,'toast');
    const routine=server.evaluateNotificationPolicy(user,{...classify,signal:'activity',priority:'normal'},new Date());
    assert.equal(routine.deliveryMode,mode);
  }
});
check('quiet behavior is evaluated against recipient timezone',()=>{
  const now=new Date('2026-07-10T02:30:00Z');
  const classify={category:'work',tool:'project',signal:'activity',priority:'normal',requiresAction:false};
  const user={preferences:{...prefs,notificationQuietHoursBehavior:'critical-only',notificationCategoryDelivery:{work:'toast'}},workingPattern:{timezone:'America/New_York'}};
  assert.equal(server.evaluateNotificationPolicy(user,classify,now).interruptive,false);
  assert.equal(client.notificationEffectiveDelivery({...prefs,notificationQuietHoursBehavior:'critical-only',notificationCategoryDelivery:{work:'toast'}},'work','normal',now,'America/New_York'),'silent');
});
check('web and desktop call canonical clock with member timezone',()=>{
  const taskbar=file('packages/renderer/src/features/application/modules/ApplicationProjectTabs.tsx');
  const desktop=file('packages/renderer/src/features/notifications/desktop-notification-sync.ts');
  assert.match(taskbar,/notificationLiveChannels\(settings, item, user.timezone\)\.toast/);
  assert.match(desktop,/categoryAllowed\(item, settings, user.timezone\)/);
  assert.match(desktop,/user.timezone\]\);/);
  assert.doesNotMatch(file('packages/renderer/src/features/notifications/notification-preferences.ts'),/now\.getHours\(/);
});
check('mandatory critical security remains interruptive in taskbar even for old silent policies',()=>{
  const taskbar=file('packages/renderer/src/features/application/modules/ApplicationProjectTabs.tsx');
  assert.match(taskbar,/notificationLiveChannels\(settings, item, user.timezone\)\.toast/);
  assert.match(file('packages/renderer/src/features/notifications/desktop-notification-sync.ts'),/notificationLiveChannels\(settings, item, timeZone\)\.native/);
});
console.log(`${n}/${n} G27 P60 notification timezone/policy checks passed`);
