#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const require=createRequire(import.meta.url),ts=require('typescript');
const p='packages/renderer/src/features/shell/transfer-progress-summary.ts';
const js=ts.transpileModule(readFileSync(p,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const mod={exports:{}};vm.runInNewContext(js,{module:mod,exports:mod.exports,Set,Number,Math});
const summary=mod.exports.transferProgressSummary;
let n=0;
function check(name,fn){fn();n++;console.log('PASS G26 Transfer '+name)}
check('failed and paused transfers are not active',()=>{
 const v=summary([{status:'failed'},{status:'paused'}],[{state:'failed',direction:'download'},{state:'paused',direction:'upload'}]);
 assert.equal(v.activeCount,0);assert.equal(v.failedCount,2);assert.equal(v.pausedCount,2);assert.equal(v.percentage,null);
});
check('active directions use actual moving jobs',()=>{
 const v=summary([{status:'pending'},{status:'uploading'},{status:'paused'}],[{state:'queued',direction:'download'},{state:'running',direction:'upload'},{state:'complete',direction:'download'}]);
 assert.equal(v.activeCount,4);assert.equal(v.uploadingCount,3);assert.equal(v.downloadingCount,1);
});
check('known byte progress is size weighted, not arithmetic mean',()=>{
 const v=summary([],[{state:'running',direction:'download',totalBytes:900,transferredBytes:450},{state:'running',direction:'download',totalBytes:100,transferredBytes:100}]);
 assert.equal(v.percentage,55);
});
check('browser uploads make aggregate percentage unknown rather than misleading',()=>{
 const v=summary([{status:'uploading'}],[{state:'running',direction:'download',totalBytes:100,transferredBytes:100}]);
 assert.equal(v.percentage,null);
});
check('zero size and missing byte progress never imply completion',()=>{
 assert.equal(summary([],[{state:'queued',direction:'upload',totalBytes:0,transferredBytes:0}]).percentage,null);
 assert.equal(summary([],[{state:'verifying',direction:'download',totalBytes:100}]).percentage,null);
});
check('overshot bytes are clamped to 100 percent',()=>{
 assert.equal(summary([],[{state:'running',direction:'upload',totalBytes:100,transferredBytes:900}]).percentage,100);
});
check('verifying reports measured bytes without claiming completion',()=>{
 const v=summary([],[{state:'verifying',direction:'upload',totalBytes:100,transferredBytes:100}]);
 assert.equal(v.percentage,100);assert.equal(v.verifyingCount,1);
});
check('cancelled and completed are excluded from progress denominator',()=>{
 const v=summary([],[{state:'cancelled',direction:'download',totalBytes:100,transferredBytes:50},{state:'complete',direction:'upload',totalBytes:100,transferredBytes:100},{state:'running',direction:'download',totalBytes:100,transferredBytes:20}]);
 assert.equal(v.percentage,20);assert.equal(v.activeCount,1);
});
console.log(`${n}/${n} G26 Transfer Center checks passed`);
