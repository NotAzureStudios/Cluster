#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, appendFile, symlink, rm, open as realOpen } from 'node:fs/promises';
import * as realFs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require = createRequire(import.meta.url), ts=require('typescript');
const source=readFileSync('apps/server/src/domains/library/packet-verified-file.ts','utf8');
const script=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
function load(fs=realFs){const mod={exports:{}};vm.runInNewContext(script,{module:mod,exports:mod.exports,require: name=>name==='node:fs/promises'?fs:require(name),Buffer,Date,Number,Promise,JSON,Math,String},{filename:'packet-verified-file.ts'});return mod.exports.readPacketVerifiedSourceFile;}
const root=await mkdtemp(path.join(tmpdir(),'cluster-packet-verified-'));
let checks=0;async function check(label,fn){await fn();checks++;console.log('PASS '+label)}
const bytes=Buffer.from('%PDF-test verified immutable canonical source\n');
const checksum=createHash('sha256').update(bytes).digest('hex');
const item={revision:5,checksumSha256:checksum,sizeBytes:bytes.length,fileName:'source.pdf'};
const entry={revision:5,checksumSha256:checksum};
try {
 await writeFile(path.join(root,item.fileName),bytes);
 await check('Pinned canonical file reads exact verified content', async()=>{
   const result=await load()(root,entry,item,65536);
   assert.deepEqual(Buffer.from(result),bytes);
 });
 await check('Pinned size and digest must match current source authority',async()=>{
   await assert.rejects(load()(root,entry,{...item,revision:6},65536),/PACKET_FILE_SOURCE_CHANGED/);
   await assert.rejects(load()(root,entry,{...item,sizeBytes:bytes.length+1},65536),/PACKET_FILE_SOURCE_CHANGED/);
   await assert.rejects(load()(root,entry,item,bytes.length-1),/PACKET_FILE_SOURCE_SIZE_INVALID/);
 });
 await check('Relative path traversal and symbolic links are blocked',async()=>{
   await assert.rejects(load()(root,entry,{...item,fileName:'../source.pdf'},65536),/PACKET_FILE_PATH_UNSAFE/);
   await symlink(path.join(root,'source.pdf'),path.join(root,'alias.pdf'));
   await assert.rejects(load()(root,entry,{...item,fileName:'alias.pdf'},65536),/PACKET_FILE_PATH_UNSAFE/);
 });
 await check('Concurrent file growth is rejected without unbounded readFile',async()=>{
   let appended=false;
   const fs={...realFs,open:async(...args)=>{
     const h=await realOpen(...args);
     return new Proxy(h,{get(target,key){if(key==='read')return async(...input)=>{
       if(!appended){appended=true;await appendFile(path.join(root,'source.pdf'),Buffer.from('malicious appended bytes'));}
       return target.read(...input);
     };const value=target[key];return typeof value==='function'?value.bind(target):value;}});
   }};
   await assert.rejects(load(fs)(root,entry,item,65536),/PACKET_FILE_SOURCE_CHANGED/);
   assert.equal(appended,true);
   assert.doesNotMatch(source,/handle\.readFile\(/);
   assert.match(source,/Math\.min\(64 \* 1024, bytes\.length - offset\)/);
 });
}finally{await rm(root,{recursive:true,force:true});}
console.log(`Batch A bounded Packet source custody: ${checks}/${checks} passed`);
