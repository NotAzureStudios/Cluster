import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import vm from 'node:vm';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js'))}})();
const read=(name)=>readFileSync(new URL('../../'+name,import.meta.url),'utf8');
const module={exports:{}};
vm.runInNewContext(ts.transpileModule(read('packages/renderer/src/features/notifications/native-notification-claims.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports});
const {deliverNativeNotificationTokens}=module.exports;
const claimNativeNotificationTokens = ({ tokens, primeIfMissing, read, write, exclusive }) => deliverNativeNotificationTokens({ tokens, primeIfMissing, read, write, exclusive, deliver: async () => true });
let count=0;
async function test(name,run){await run();count++;console.log('PASS '+name)}
await test('First recovered native poll primes without displaying historical notifications',async()=>{
 let stored=null;
 const result=await claimNativeNotificationTokens({tokens:['a:0','b:0'],primeIfMissing:true,read:()=>stored,write:tokens=>{stored=tokens}});
 assert.deepEqual([...result],[]);assert.deepEqual([...stored],['a:0','b:0']);
 const newResult=await claimNativeNotificationTokens({tokens:['a:0','b:0','c:0'],primeIfMissing:true,read:()=>stored,write:tokens=>{stored=tokens}});
 assert.deepEqual([...newResult],['c:0']);
});
await test('Live delivery is not dropped before first poll',async()=>{
 let stored=null;
 const result=await claimNativeNotificationTokens({tokens:['live:0'],primeIfMissing:false,read:()=>stored,write:tokens=>{stored=tokens}});
 assert.deepEqual([...result],['live:0']);assert.deepEqual([...stored],['live:0']);
});
await test('Legacy seen IDs suppress level-zero replay but not new escalation',async()=>{
 let stored=['a'];
 const result=await claimNativeNotificationTokens({tokens:['a:0','a:1'],primeIfMissing:false,read:()=>stored,write:tokens=>{stored=tokens}});
 assert.deepEqual([...result],['a:1']);
});
await test('Cross-window concurrent claim under exclusive lock delivers only once',async()=>{
 let stored=['prior:0'];let writes=0;let tail=Promise.resolve();
 const exclusive=(work)=>{
  const next=tail.then(async()=>{await Promise.resolve();return work()});
  tail=next.then(()=>undefined,()=>undefined);return next;
 };
 const input={tokens:['x:0','y:0'],primeIfMissing:false,read:()=>stored,write:tokens=>{stored=tokens;writes++},exclusive};
 const [a,b,c]=await Promise.all([claimNativeNotificationTokens(input),claimNativeNotificationTokens(input),claimNativeNotificationTokens(input)]);
 assert.deepEqual([[...a],[...b],[...c]],[['x:0','y:0'],[],[]]);assert.equal(writes,1);
});
await test('When the native lock service fails, best-effort fallback remains available',async()=>{
 let stored=[];
 const result=await claimNativeNotificationTokens({tokens:['a:0'],primeIfMissing:false,read:()=>stored,write:tokens=>{stored=tokens},exclusive:async()=>{throw Error('Unsupported')}});
 assert.deepEqual([...result],['a:0']);
});
await test('Production native poll and live listener acknowledge only after displaying',async()=>{
 const source=read('packages/renderer/src/features/notifications/desktop-notification-sync.ts');
 assert.match(source,/locks\.request\(`cluster-native-notifications:\$\{user.id\}`/);
 assert.match(source,/await deliverItems\(items, true\)/);
 assert.match(source,/deliverItems\(\[item\], false\)/);
 assert.match(source,/deliver: \(fresh\) => showItems/);
 assert.match(source,/return delivered === true/);
});
console.log(`${count}/${count} G27 P18 native notification claims passed`);
