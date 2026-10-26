#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const root=resolve(import.meta.dirname,'../..');
const temp=mkdtempSync(join(tmpdir(),'cluster-g18-native-'));
try {
 const exe=join(temp,'stager');
 const build=spawnSync('go',['build','-o',exe,'.'],{cwd:join(root,'tools/native/package-stager-go'),encoding:'utf8',timeout:120000});
 if(build.status!==0)throw Error(`Native Go build failed: ${build.stderr}`);
 const bytes=Buffer.from('a signed archive recovered after Qt and native CLI have restarted');
 const sha=createHash('sha256').update(bytes).digest('hex');
 const offer=['--transfer-offer-id','deployment_123','--transfer-package-id','package_123',
  '--transfer-release-id','release_123','--transfer-channel','stable','--transfer-platform','windows-x64'];
 let checks=0;
 const run=(action,args=[],input)=>spawnSync(exe,['--action',action,'--root',temp,'--transfer-sha256',sha,...args],{input,encoding:'utf8',timeout:30000});
 const success=(action,args=[],input)=>{const result=run(action,args,input);assert.equal(result.status,0,result.stderr);checks++;
  assert.match(result.stdout,/^CLUSTER_TRANSFER_CHECKPOINT /);return JSON.parse(result.stdout.slice('CLUSTER_TRANSFER_CHECKPOINT '.length));};
 success('transfer-begin',['--transfer-size',String(bytes.length)]);
 const bound=success('transfer-bind',offer);assert.equal(bound.offer.deploymentId,'deployment_123');
 const first=bytes.subarray(0,15);
 success('transfer-append',['--transfer-offset','0','--transfer-chunk-size',String(first.length)],first);
 const afterRestart=success('transfer-inspect');assert.equal(afterRestart.receivedBytes,first.length);
 assert.deepEqual(afterRestart.offer,bound.offer);
 const again=success('transfer-bind',offer);assert.deepEqual(again.offer,bound.offer);
 const forged=run('transfer-bind',[...offer.slice(0,1),'different_offer',...offer.slice(2)]);
 assert.notEqual(forged.status,0);checks++;
 const injection=run('transfer-bind',[...offer,'--grant','Bearer bad-secret']);
 assert.notEqual(injection.status,0);checks++;
 const rest=bytes.subarray(first.length);
 success('transfer-append',['--transfer-offset',String(first.length),'--transfer-chunk-size',String(rest.length)],rest);
 success('transfer-commit');
 const committed=success('transfer-inspect');assert.equal(committed.state,'committed');
 assert.deepEqual(committed.offer,bound.offer);
 assert.ok(!JSON.stringify(committed).includes('challenge'));
 console.log(`${checks}/${checks} G18 separate-process offer-binding checks passed`);
} finally {rmSync(temp,{recursive:true,force:true});}
