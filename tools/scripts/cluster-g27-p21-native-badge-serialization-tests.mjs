import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js'))}})();
const read=(name)=>readFileSync(new URL('../../'+name,import.meta.url),'utf8');
const module={exports:{}};
vm.runInNewContext(ts.transpileModule(read('packages/renderer/src/core/desktop-badge.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports});
const {createLatestSerializedWriter}=module.exports;
let count=0;async function check(name,run){await run();count++;console.log('PASS '+name)}
await check('Multiple synchronous summary responses commit only latest native count',async()=>{
 const write=createLatestSerializedWriter();const received=[];
 await Promise.all([write(17,v=>received.push(v)),write(14,v=>received.push(v)),write(3,v=>received.push(v))]);
 assert.deepEqual(received,[3]);
});
await check('Running bridge writes serialize; newer account summary wins',async()=>{
 const write=createLatestSerializedWriter();const received=[];
 let unblock;let signalStarted;
 const latch=new Promise(resolve=>{unblock=resolve});
 const started=new Promise(resolve=>{signalStarted=resolve});
 const first=write(15,async n=>{signalStarted();await latch;received.push(n)});
 await started;
 const second=write(0,n=>received.push(n));
 const third=write(8,n=>received.push(n));
 unblock();await Promise.all([first,second,third]);
 assert.deepEqual(received,[15,8]);
});
await check('One rejected Desktop write does not poison subsequent updates',async()=>{
 const write=createLatestSerializedWriter();const received=[];
 await assert.rejects(write(1,()=>{throw Error('native unavailable')}));
 await write(2,n=>received.push(n));assert.deepEqual(received,[2]);
});
await check('Persistent taskbar consumes server unread, not paged filtered Inbox length',async()=>{
 const bar=read('packages/renderer/src/features/application/modules/ApplicationProjectTabs.tsx');
 const badge=read('packages/renderer/src/core/desktop-badge.ts');
 const inbox=read('packages/renderer/src/features/notifications/NotificationInboxPage.tsx');
 assert.match(bar,/setAuthoritativeNotificationCount\(result.summary\?\.unread\)/);
 assert.match(bar,/setAuthoritativeDesktopBadge\(count\)/);
 assert.match(badge,/await import\("\.\/desktop"\)/);
 assert.doesNotMatch(inbox,/setDesktopBadge/);
});
console.log(`${count}/${count} G27 P21 native badge serialization tests passed`);
