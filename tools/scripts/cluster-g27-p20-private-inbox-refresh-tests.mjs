import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=(file)=>readFileSync(new URL('../../'+file,import.meta.url),'utf8');
let passed=0;function test(name,fn){fn();passed++;console.log('PASS '+name)}
const ui=read('packages/renderer/src/features/notifications/NotificationInboxPage.tsx');
const routes=read('apps/server/src/domains/notifications/notification-routes.ts');
const query=read('packages/renderer/src/core/api/query.ts');
test('Inbox list and private digest/threads use direct server reads, never persisted query cache',()=>{
 const start=ui.indexOf('async function load('),end=ui.indexOf('  function scheduleInboxRevalidation',start);
 const block=ui.slice(start,end);
 assert.match(block,/api<InboxPage>\(pagePath\)/);
 for(const path of ['/api/notifications/digest?hours=24','/api/notifications/groups?hours=168&groupBy=thread&includeRead=false&limit=8','/api/notifications/digest/status']) assert.ok(block.includes(`api<`)&&block.includes(`("${path}")`),path);
 assert.doesNotMatch(block,/queryApi/);
 assert.match(query,/if \(!options.force && durable && durable.expiresAt/); // formerly cacheable path
});
test('Server performs fresh Inbox authorization and disables HTTP response caching',()=>{
 const start=routes.indexOf('app.get("/api/notifications",'),end=routes.indexOf('app.get("/api/notifications/stream",',start);
 const block=routes.slice(start,end);
 assert.match(block,/authorization.requireTool\(request, reply, "inbox", "view"\)/);
 assert.match(block,/enabledNotificationCategories\(user\)/);
 assert.match(block,/notificationService.list\(user.id/);
 assert.match(block,/reply.header\("Cache-Control", "no-store"\)/);
});
test('Visible Inbox rechecks permission-sensitive resource changes but not every Card event',()=>{
 const block=ui.slice(ui.indexOf('useResourceChangeRefresh('),ui.indexOf('  const now = Date.now()'));
 for(const kind of ['project','user','team','packet','policy','library','file']) assert.ok(block.includes(`"${kind}"`),kind);
 assert.ok(!block.includes('"card"'));
 assert.match(block,/debounceMs: 350, visibleOnly: true/);
});
test('Mutations and realtime refreshes are coalesced, with visibility recovery',()=>{
 assert.match(ui,/window.clearTimeout\(revalidateTimerRef.current\)/);
 assert.match(ui,/window.setTimeout\(\(\) => \{/);
 assert.match(ui,/document.visibilityState === "visible"/);
 assert.match(ui,/useVisibleRefresh\(\(\) => load\(true, null, true, true\), \{ intervalMs: 5 \* 60_000, requireOnline: true \}\)/);
});
console.log(`${passed}/${passed} G27 P20 private Inbox refresh tests passed`);
