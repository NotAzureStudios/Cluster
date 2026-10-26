import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const file = readFileSync(new URL('../../packages/renderer/src/features/notifications/NotificationInboxPage.tsx', import.meta.url), 'utf8');
let passed=0;
function test(name,fn){fn();passed++;console.log('PASS '+name)}
for(const name of ['dismiss','snooze','acknowledge']){
 test(`${name} schedules reconciliation on success AND mutation failure`,()=>{
   const begin=file.indexOf(`async function ${name}(`);
   assert.ok(begin>0,name);
   const end=file.indexOf('  async function ',begin+10);
   const body=file.slice(begin,end>0?end:undefined);
   assert.match(body,/invalidateInboxReadsForMutation\(\)/);
   assert.match(body,/try \{[\s\S]*?await api\("\/api\/notifications\//);
   assert.match(body,/\} finally \{[\s\S]*?scheduleInboxRevalidation\(\);\s*\}/);
 });
}
test('Restore reconciles after release and schedules failure recovery',()=>{
 const begin=file.indexOf('async function restoreDismissed('),end=file.indexOf('  async function setProjectMode(',begin);
 const body=file.slice(begin,end);
 assert.match(body,/if \(succeeded\) void load\(true, null, true\);/);
 assert.match(body,/catch \(error\) \{[\s\S]*?mutationFailed\(error, \"Restore\"\)/);
 assert.match(body,/else scheduleInboxRevalidation\(\)/);
 assert.match(body,/finally \{[\s\S]*?finishInboxMutation\(ticket\)/);
});
test('Read-state mutation retains its existing error rollback and retry',()=>{
 const begin=file.indexOf('async function setRead('),end=file.indexOf('async function dismiss(',begin);
 const body=file.slice(begin,end);
 assert.match(body,/setItems\(\(current\) => current\.map\(/);
 assert.match(body,/catch \(error\) \{/);
 assert.match(body,/mutationFailed\(error, \"Notification update\"\)/);
 assert.match(body,/finally \{\s*finishInboxMutation\(ticket\);\s*scheduleInboxRevalidation\(\)/);
});
console.log(`${passed}/${passed} G27 Pass 16 failed-mutation reconciliation checks passed`);
