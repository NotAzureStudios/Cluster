import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import vm from 'node:vm';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript/lib/typescript.js')); } })();
const read = p => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const module = { exports: {} };
vm.runInNewContext(ts.transpileModule(read('apps/server/src/domains/notifications/notification-best-effort.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { module, exports: module.exports, Promise });
const { runNotificationSideEffect } = module.exports;
let count=0;
const test=async(name,fn)=>{ await fn(); ++count; console.log('PASS '+name); };
await test('Synchronous post-commit callback throws without changing the caller result', async()=>{
 const failures=[]; runNotificationSideEffect(()=>{throw Error('listener');},err=>failures.push(err.message));assert.deepEqual(failures,['listener']);
});
await test('Rejected async callbacks are contained and reported without unhandled rejection', async()=>{
 const failures=[]; runNotificationSideEffect(()=>Promise.reject(Error('async')),err=>failures.push(err.message));await new Promise(r=>setImmediate(r));assert.deepEqual(failures,['async']);
});
await test('A failing logger never changes successful mutation outcomes', async()=>{
 assert.doesNotThrow(()=>runNotificationSideEffect(()=>{throw Error('publish');},()=>{throw Error('logger');}));
 runNotificationSideEffect(()=>Promise.reject(Error('publish')),()=>{throw Error('logger');});await new Promise(r=>setImmediate(r));
});
await test('Post-commit broadcast helpers use the nonblocking error boundary', async()=>{
 const s=read('apps/server/src/domains/notifications/notification-service.ts');
 assert.match(s,/if \(publish && deps\.publishSummaryInvalidation\) runNotificationSideEffect/);
 assert.match(s,/publishRecord\(record: any\) \{\s*if \(record\) runNotificationSideEffect/);
 assert.match(s,/publishRecords\(records: any\[\]\) \{\s*for \(const record of records \|\| \[\]\) if \(record\) runNotificationSideEffect/);
});
console.log(`${count}/${count} G27 P53 notification post-commit checks passed`);
