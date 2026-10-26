import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=(path)=>readFileSync(new URL('../../'+path,import.meta.url),'utf8');
let passed=0;
function test(name,fn){fn();passed++;console.log('PASS '+name)}
const taskbar=read('packages/renderer/src/features/application/modules/ApplicationProjectTabs.tsx');
const inbox=read('packages/renderer/src/features/notifications/NotificationInboxPage.tsx');
const routing=read('packages/renderer/src/features/notifications/notification-navigation.ts');
test('Taskbar notification does not use old Project fallback for explicit missing records',()=>{
 const body=taskbar.slice(taskbar.indexOf('function openNotificationPreview('),taskbar.indexOf('  useEffect(',taskbar.indexOf('function openNotificationPreview(')));
 assert.ok(body.indexOf('if (item.resource?.id || item.entityId || item.cardId)')>0);
 assert.ok(body.indexOf('if (item.resource?.id || item.entityId || item.cardId)')<body.indexOf('if (item.projectId)'));
 assert.match(body,/onOpenNotifications\(\)/);
 assert.match(body,/setNotificationActionError\("This notification's linked record is unavailable/);
});
test('Inbox and Taskbar retain the same exact-target rule',()=>{
 assert.match(inbox,/if \(item.resource\?\.id \|\| item.entityId \|\| item.cardId\) \{/);
 assert.match(routing,/if \(source \|\| stringValue\(item.entityId\) \|\| stringValue\(item.cardId\)\) return null/);
});
test('Paged Inbox never promises to mark more than its loaded unread items',()=>{
 assert.match(inbox,/>Mark loaded read<\/ClusterButton>/);
 assert.doesNotMatch(inbox,/>Mark all read<\/ClusterButton>/);
 const mutation=inbox.slice(inbox.indexOf('async function setRead('),inbox.indexOf('async function dismiss('));
 assert.match(mutation,/ids, read/);
});
console.log(`${passed}/${passed} G27 P19 notification destination and paging tests passed`);
