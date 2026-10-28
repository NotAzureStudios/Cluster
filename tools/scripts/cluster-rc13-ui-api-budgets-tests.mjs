// RC13: functional traffic-lane isolation and account-control layout regression.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const require=createRequire(import.meta.url);
let ts;
try {ts=require('typescript');}
catch {const bin=fs.realpathSync(execFileSync('which',['tsc'],{encoding:'utf8'}).trim());ts=require(path.resolve(path.dirname(bin),'../lib/typescript.js'));}
function load(rel){
 const js=ts.transpileModule(fs.readFileSync(path.join(root,rel),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}};
 vm.runInNewContext(js,{module,exports:module.exports,require,Date,Intl,Set,Map,Object,String,Boolean,Number,JSON,Math,Promise,Error,Array},{filename:rel});
 return module.exports;
}
const {apiTransportRateLimitPolicy: policy}=load('apps/server/src/core/request-workload.ts');
const {FixedWindowRateLimiter}=load('apps/server/src/core/rate-limit.ts');
const params={apiRateLimitMax:6000};
function lane(pathname,method){return policy({...params,pathname,method});}
assert.equal(lane('/api/projects','GET').bucketName,'api');
assert.equal(lane('/api/projects/provision/preview','POST').bucketName,'api-project-preview');
assert.equal(lane('/api/projects/provision','POST').bucketName,'api-project-create');
assert.equal(lane('/api/projects/provision/id-123/retry','POST').bucketName,'api-project-create');
assert.equal(lane('/api/projects/provision/id-123','GET').bucketName,'api-project-progress');
assert.equal(lane('/api/projects','POST').bucketName,'api-mutation');
assert.equal(lane('/api/projects/provision/preview/evil','POST').bucketName,'api-mutation');
assert.ok(lane('/api/projects/provision','POST').limit <=20);
const limiter=new FixedWindowRateLimiter();
const client='session:fake-test';const base=10_000;
const read=lane('/api/projects','GET');
for(let i=0;i<read.limit;i++)assert.equal(limiter.consumeCost(`${read.bucketName}:${client}`,read.limit,60_000,1,base).allowed,true);
assert.equal(limiter.consumeCost(`${read.bucketName}:${client}`,read.limit,60_000,1,base).allowed,false,'background read budget must be exhausted');
const preview=lane('/api/projects/provision/preview','POST');
assert.equal(limiter.consumeCost(`${preview.bucketName}:${client}`,preview.limit,60_000,2,base).allowed,true,'independent preview lane must work');
const create=lane('/api/projects/provision','POST');
for(let i=0;i<create.limit/2;i++)assert.equal(limiter.consumeCost(`${create.bucketName}:${client}`,create.limit,60_000,2,base).allowed,true);
assert.equal(limiter.consumeCost(`${create.bucketName}:${client}`,create.limit,60_000,2,base).allowed,false,'project creation must remain bounded');
const mutate=lane('/api/boards/id','PATCH');
assert.equal(limiter.consumeCost(`${mutate.bucketName}:${client}`,mutate.limit,60_000,2,base).allowed,true,'background traffic cannot block an edit');
assert.equal(policy({pathname:'/api/projects/provision',method:'POST',apiRateLimitMax:10}).limit,10,'configured low max must not be overridden');
const source=fs.readFileSync(path.join(root,'apps/server/src/app/server-request-infrastructure.ts'),'utf8');
assert.match(source,/apiTransportRateLimitPolicy\(\{ pathname, method: request.method, apiRateLimitMax \}\)/);
assert.match(source,/rateLimit\(request, reply, traffic.bucketName, traffic.limit, apiRateLimitWindowMs, workPolicy.cost\)/);
const css=fs.readFileSync(path.join(root,'packages/renderer/src/features/shell/shell.css'),'utf8');
assert.doesNotMatch(css,/\.taskbar-profile-v073 img,\s*\.taskbar-profile-v073 > span\s*\{/,'avatar rule must not also target username/status');
assert.match(css,/\.taskbar-profile-v073 > \.taskbar-profile-copy-v546\s*\{/);
assert.match(css,/width: auto !important;\s*height: auto !important;\s*min-width: 0 !important;/);
console.log('RC13: read/interactive lanes independently bounded; create remains limited; account copy no longer inherits avatar geometry');
