import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript');}catch{return require(path.join(require('node:child_process').execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript/lib/typescript.js'));}})();
const root=path.resolve(new URL('../..',import.meta.url).pathname);
const input=fs.readFileSync(path.join(root,'packages/api-client/src/index.ts'),'utf8');
const output=ts.transpileModule(input,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
let resets=0;
const deps={'./read-rate-limit.js':{
  readTrafficLane:()=>null,readRateLimitCooldown:async()=>{},noteReadRateLimit:()=>{},
  resetReadRateLimitCooldowns:()=>{resets++;},
}};
const mod={exports:{}};
const requests=[];
const runtime=vm.runInNewContext(`(function(require,module,exports){${output}\n})`,{
  Date,Map,Set,Promise,Array,Number,String,Math,console,URL,Headers,Response,AbortController,
  setTimeout,clearTimeout,crypto:globalThis.crypto,
  fetch:async(url,init)=>{requests.push({url,method:init.method});return new Response('{}',{status:200,headers:{'content-type':'application/json'}});},
});
runtime((name)=>{if(!(name in deps))throw new Error(`Unexpected ${name}`);return deps[name];},mod,mod.exports);
const api=mod.exports;
api.configureClusterApiClient({baseUrl:'https://one.example.test'});
assert.equal(resets,1);
api.configureClusterApiClient({baseUrl:'https://one.example.test',maxReadRetries:0});
assert.equal(resets,1);
api.configureClusterApiClient({baseUrl:'https://two.example.test'});
assert.equal(resets,2,'switching servers must drop the prior server retry-after window');
await api.clusterApiFetch('/api/auth/login',{method:'POST',body:'{}'});
assert.equal(resets,3,'successful authentication must drop previous account cooldowns');
assert.equal(requests.length,1);
assert.equal(requests[0].url,'https://two.example.test/api/auth/login');
console.log('RC36 traffic cooldown scope: 4/4 passed');
