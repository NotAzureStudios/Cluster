#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const root=resolve(import.meta.dirname,'../..');
const temp=mkdtempSync(join(tmpdir(),'cluster-g17-native-cli-'));
try {
 const exe=join(temp,'stager');
 const compile=spawnSync('go',['build','-o',exe,'.'],{cwd:join(root,'tools/native/package-stager-go'),encoding:'utf8',timeout:120000});
 if(compile.status!==0)throw Error(`Go build unavailable: ${compile.stderr}`);
 const archive=Buffer.from('signed archive bytes persisted through independent CLI processes');
 const sha=createHash('sha256').update(archive).digest('hex');
 let assertions=0;
 const run=(action,additional=[],input)=>spawnSync(exe,['--action',action,'--root',temp,'--transfer-sha256',sha,...additional],
   {input,encoding:'utf8',timeout:30000});
 const check=(action,extra=[],input)=>{
  const p=run(action,extra,input);assert.equal(p.status,0,`${action}: ${p.stderr}`);
  assert.match(p.stdout,/^CLUSTER_TRANSFER_CHECKPOINT /);
  const c=JSON.parse(p.stdout.slice('CLUSTER_TRANSFER_CHECKPOINT '.length));assert.equal(c.digest,sha);
  assertions++;return c;
 };
 const missing=run('transfer-inspect');assert.equal(missing.status,3);assert.match(missing.stderr,/CLUSTER_TRANSFER_NOT_FOUND/);assertions++;
 const begin=check('transfer-begin',['--transfer-size',String(archive.length)]);assert.equal(begin.receivedBytes,0);
 const half=13;
 check('transfer-append',['--transfer-offset','0','--transfer-chunk-size',String(half)],archive.subarray(0,half));
 const resumed=check('transfer-inspect');assert.equal(resumed.receivedBytes,half);
 const wrong=run('transfer-append',['--transfer-offset','0','--transfer-chunk-size',String(archive.length-half)],archive.subarray(half));
 assert.notEqual(wrong.status,0);assertions++;
 check('transfer-append',['--transfer-offset',String(half),'--transfer-chunk-size',String(archive.length-half)],archive.subarray(half));
 const finished=check('transfer-commit');assert.equal(finished.state,'committed');
 const again=check('transfer-inspect');assert.equal(again.prefixSha256,sha);
 console.log(`${assertions}/${assertions} G17 separate-process durable native CLI checks passed`);
}finally {rmSync(temp,{force:true,recursive:true});}
