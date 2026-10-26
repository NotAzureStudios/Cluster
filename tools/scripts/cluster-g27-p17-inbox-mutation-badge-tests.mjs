import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = (() => { try {return require('typescript')} catch {return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js'))} })();
const read = (file) => readFileSync(new URL('../../'+file, import.meta.url),'utf8');
const file = 'packages/renderer/src/features/notifications/inbox-mutation-ownership.ts';
const module = {exports:{}};
vm.runInNewContext(ts.transpileModule(read(file),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports});
const {createInboxMutationOwnership} = module.exports;
let count = 0;
function test(name, run) { run();count++;console.log('PASS '+name) }
test('One pending mutation per account until explicit settlement',()=>{
 const gate = createInboxMutationOwnership();
 const first=gate.begin();assert.equal(first,1);
 assert.equal(gate.isPending(),true);assert.equal(gate.begin(),null);
 assert.equal(gate.end(first+1),false);assert.equal(gate.isPending(),true);
 assert.equal(gate.end(first),true);assert.equal(gate.isPending(),false);
 assert.equal(gate.begin(),2);
});
test('Separate mounted account Inbox mutation gates are independent',()=>{
 const a=createInboxMutationOwnership(),b=createInboxMutationOwnership();
 const at=a.begin(),bt=b.begin();assert.equal(at,1);assert.equal(bt,1);
 assert.equal(a.begin(),null);assert.equal(b.end(bt),true);assert.equal(b.begin(),2);
 assert.equal(a.end(at),true);
});
const page=read('packages/renderer/src/features/notifications/NotificationInboxPage.tsx');
const taskbar=read('packages/renderer/src/features/application/modules/ApplicationProjectTabs.tsx');
test('All six mutation writers obtain and release exclusive admission',()=>{
 for(const name of ['setRead','dismiss','snooze','acknowledge','restoreDismissed','setProjectMode']) {
  const begin=page.indexOf(`async function ${name}(`);assert.ok(begin>0,name);
  const next=page.indexOf('  async function ', begin+20);
  const block=page.slice(begin, next>0?next:undefined);
  assert.match(block,/const ticket = beginInboxMutation\(\)/, name);
  assert.match(block,/if \(ticket === null\) return/,name);
  assert.match(block,/finishInboxMutation\(ticket\)/,name);
  assert.match(block,/catch \(error\)/,name);
  assert.doesNotMatch(block,/throw error/,name);
 }
});
test('Precommit reads are discarded; postcommit refresh is authoritative',()=>{
 assert.match(page,/if \(inboxMutations.current.isPending\(\)\) return/);
 assert.match(page,/inboxRequests.current.invalidate\(\)/);
 assert.match(page,/scheduleInboxRevalidation\(\)/);
 for (const name of ['read','dismiss','snooze','acknowledge','restore']) {
  assert.match(page,new RegExp('await api\\("/api/notifications/'+name+'"[\\s\\S]{0,210}?notifyCommittedInboxMutation\\(\\);'),name);
 }
 assert.doesNotMatch(page,/useEffect\(\(\) => \{ void setDesktopBadge\(unread.length\)/);
});
test('Notification failure and busy states are visible instead of unhandled promises',()=>{
 assert.match(page,/setStatus\(`\$\{action\} failed/);
 assert.match(page,/setLoadError\(error\)/);
 assert.match(page,/aria-busy=\{mutationBusy\}/);
 assert.match(page,/Saving change/);
 assert.match(page,/disabled=\{mutationBusy\}/);
});
test('Only server summary updates native badge; no Inbox page-size based badge',()=>{
 assert.match(taskbar,/function setAuthoritativeNotificationCount\(raw: unknown\)/);
 assert.match(taskbar,/setAuthoritativeNotificationCount\(result.summary\?\.unread\)/);
 assert.match(taskbar,/setAuthoritativeDesktopBadge\(count\)/);
 assert.doesNotMatch(page,/import \{ setDesktopBadge \}/);
});
console.log(`${count}/${count} G27 P17 Inbox mutation and badge checks passed`);
