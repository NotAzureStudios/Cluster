import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {executeClusterActionTransaction} from '../../packages/renderer/src/components/cluster-action-transaction.ts';
import {createClusterCommandInvocation} from '../../packages/renderer/src/features/search/cluster-command-invocation.ts';
const root=resolve(import.meta.dirname,'../..');
const read=(relative)=>readFileSync(resolve(root,relative),'utf8');
const tests=[];
const test=(name,fn)=>tests.push([name,fn]);
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject};};
test('Optimistic action calls commit only following confirmed server success',async()=>{
  const calls=[];
  const result=await executeClusterActionTransaction({optimistic:()=>{calls.push('optimistic');return 12},action:()=>{calls.push('server');return 'ok'},rollback:()=>{calls.push('rollback')},commit:(value)=>{calls.push(`commit:${value}`)}});
  assert.deepEqual(result,{ok:true,value:'ok'});
  assert.deepEqual(calls,['optimistic','server','commit:ok']);
});
test('Server failure rolls back snapshot and retains original failure',async()=>{
  const error=new Error('offline');let rolledBack=false;
  const result=await executeClusterActionTransaction({optimistic:()=>13,action:async()=>{throw error},rollback:(snapshot,received)=>{assert.equal(snapshot,13);assert.equal(received,error);rolledBack=true}});
  assert.equal(result.ok,false);assert.equal(result.stage,'action');assert.equal(result.error,error);assert.equal(rolledBack,true);
});
test('Rollback failure does not strand feedback or mask the server error',async()=>{
  const server=new Error('server rejected');const rollback=new Error('local recovery failed');
  const result=await executeClusterActionTransaction({action:async()=>{throw server},rollback:()=>{throw rollback}});
  assert.deepEqual(result,{ok:false,stage:'action',error:server,rollbackError:rollback});
});
test('Optimistic snapshot failure avoids all writes and does not run rollback',async()=>{
  let writes=0,rollbacks=0;const error=Error('optimistic failed');
  const result=await executeClusterActionTransaction({optimistic:()=>{throw error},action:()=>{writes++;return true},rollback:()=>{rollbacks++}});
  assert.equal(result.stage,'optimistic');assert.equal(result.error,error);assert.equal(writes,0);assert.equal(rollbacks,0);
});
test('A failed commit does not roll back a confirmed server mutation',async()=>{
  let rolledBack=0;const error=new Error('local state unavailable');
  const result=await executeClusterActionTransaction({optimistic:()=>4,action:()=>42,commit:()=>{throw error},rollback:()=>{rolledBack++}});
  assert.equal(result.ok,false);assert.equal(result.stage,'commit');assert.equal(result.error,error);assert.equal(rolledBack,0);
});
test('Command runner executes synchronously in originating user gesture',async()=>{
  const gate=createClusterCommandInvocation();const calls=[];
  const result=gate.run(()=>{calls.push('started');return true});
  assert.deepEqual(calls,['started']);assert.equal(gate.isExecuting(),true);
  assert.equal(await result,true);assert.equal(gate.isExecuting(),false);
});
test('Rapid commands cannot run a second action before the first resolves',async()=>{
  const gate=createClusterCommandInvocation();const pending=deferred();let calls=0;
  const first=gate.run(()=>{calls++;return pending.promise});
  const second=gate.run(()=>{calls++;return true});
  assert.equal(second,null);assert.equal(calls,1);
  pending.resolve(true);assert.equal(await first,true);assert.equal(gate.isExecuting(),false);
  assert.equal(await gate.run(()=>{calls++;return true}),true);assert.equal(calls,2);
});
test('False from clipboard/native call is not interpreted as success',async()=>{
  const gate=createClusterCommandInvocation();assert.equal(await gate.run(()=>false),false);
  assert.equal(await gate.run(()=>Promise.resolve(false)),false);
  assert.equal(await gate.run(()=>undefined),true);
});
test('Both sync exceptions and async rejections release command lock',async()=>{
  const gate=createClusterCommandInvocation();assert.equal(await gate.run(()=>{throw new Error('sync')}),false);
  assert.equal(gate.isExecuting(),false);
  assert.equal(await gate.run(()=>Promise.reject(new Error('async'))),false);
  assert.equal(gate.isExecuting(),false);
});
const hook=read('packages/renderer/src/components/useClusterActionFeedback.ts');
const button=read('packages/renderer/src/components/ClusterActionButton.tsx');
const palette=read('packages/renderer/src/features/search/CommandPalette.tsx');
test('Feedback reset may not clear a still-running mutation lock',()=>{
  assert.match(hook,/if \(runningRef\.current\) return;/);
  assert.match(hook,/runningRef\.current = true;\s*clearResetTimer\(\)/);
  assert.match(hook,/finally \{\s*runningRef\.current = false;/);
  assert.match(hook,/if \(!runningRef\.current && mountedRef\.current\)/);
});
test('Feedback distinguishes uncertain commit from safe retry and rollback failure',()=>{
  assert.match(hook,/result\.stage === "commit"/);
  assert.match(hook,/result\.rollbackError !== undefined/);
  assert.match(hook,/try \{ onError\?\.\(result\.error\); \} catch/);
  assert.match(button,/feedback\.errorStage === "commit" \? "Check result"/);
});
test('Taskbar search command input uses an immediate single-flight command runner',()=>{
  assert.match(palette,/const attempt = commandInvocation\.current\.run\(action\)/);
  assert.match(palette,/if \(!attempt\) return/);
  assert.match(palette,/setCommandError\("Command could not be confirmed/);
  assert.match(palette,/if \(!successful\)/);
  assert.match(palette,/aria-busy=\{searching \|\| commandBusy\}/);
});
test('Detached workspace commands report failed native open instead of closing search',()=>{
  assert.match(palette,/invokeCommand\(item, \(\) => openWorkInDesktopWindow\(navigation, item\.title\)\)/);
  assert.doesNotMatch(palette,/void openWorkInDesktopWindow\(/);
});
test('Clipboard results feed through command runner instead of fire-and-forget',()=>{
  assert.match(palette,/action: \(\) => copyClusterText\(window\.location\.href\)/);
  assert.match(palette,/action: \(\) => copyWorkLink\(activeWorkContext\)/);
  assert.doesNotMatch(palette,/void copy(?:ClusterText|WorkLink)\(/);
});
test('Project restricted share links report actual clipboard result',()=>{
  const access=read('packages/renderer/src/features/projects/ProjectAccessPanel.tsx');
  assert.match(access,/const copied = await copyClusterText\(newShareUrl\)/);
  assert.match(access,/setStatus\(copied \? "Share URL copied\." :/);
});
test('Preserves shell features and People identity treatment',()=>{
  const tabs=read('packages/renderer/src/features/application/modules/ApplicationProjectTabs.tsx');
  const avatar=read('packages/renderer/src/components/PresenceAvatar.tsx');
  for(const value of ['TaskbarProjectTabs','TaskbarTransferCenter','My Work','Tickets'])assert.ok(tabs.includes(value),value);
  for(const value of ['accentColor','cluster-presence-indicator-v227'])assert.ok(avatar.includes(value),value);
});
let passed=0;
for(const [name,fn] of tests){try{await fn();passed++;console.log('PASS',name)}catch(error){console.error('FAIL',name,error);process.exitCode=1}}
console.log(`TD3 deep shared actions: ${passed}/${tests.length} passed`);
