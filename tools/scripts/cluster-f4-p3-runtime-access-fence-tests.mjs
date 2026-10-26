import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const ts=require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const root=path.resolve(import.meta.dirname,'../..');
const code=fs.readFileSync(path.join(root,'apps/server/src/core/runtime-access-state.ts'),'utf8');
const result=ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
assert.equal((result.diagnostics||[]).filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'cluster-f4p3-'));
const ok=(condition,label)=>{assert.ok(condition,label);count++;};
const eq=(a,b,label)=>{assert.deepEqual(a,b,label);count++;};
let count=0;
try{
 fs.writeFileSync(path.join(tmp,'runtime.cjs'),result.outputText);
 const {runtimeRequestDecision,normalizeClusterRuntimeAccessMode,publicServerRuntimeState}=require(path.join(tmp,'runtime.cjs'));
 const decide=(mode,method,pathname)=>runtimeRequestDecision({mode,method,pathname});
 for(const [value,want] of Object.entries({normal:'normal',maintenance:'maintenance',readonly:'read-only','read-only':'read-only',recovery:'recovery',restore:'recovery','recovery-hold':'recovery','nonexistent':'normal'}))eq(normalizeClusterRuntimeAccessMode(value),want,'normalized runtime '+value);
 for(const mode of ['maintenance','read-only','recovery']){
  for(const [method,url] of [
    ['POST','/api/admin/operations/jobs/retry-failed'],['POST','/api/admin/operations/jobs/abc/retry'],
    ['POST','/api/admin/operations/jobs/abc/cancel'],['POST','/api/admin/operations/search/rebuild'],
    ['PUT','/api/admin/operations/alert-policies'],['PATCH','/api/admin/operations/alert-preferences'],
    ['POST','/api/admin/backups/now'],['POST','/api/admin/backups/pre-upgrade-checkpoint'],
    ['DELETE','/api/admin/backups/backup.zip'],['POST','/api/admin/backups/backup.zip/restore-drill'],
    ['POST','/api/admin/maintenance/prune'],['POST','/api/auth/mfa/disable'],
    ['POST','/api/auth/mfa/recovery/regenerate'],['POST','/api/security/client-incidents'],
    ['POST','/api/admin/operations/incidents'],['PATCH','/api/admin/operations/incidents/abc'],
    ['POST','/api/admin/operations/incidents/abc/timeline'],['POST','/api/admin/operations/jobs/retry-failed/typo'],
    ['POST','/api/admin/operations-not-real'],['POST','/api/auth/mfa/enroll/start'],
    ['POST','/api/auth/dev-login'],['PUT','/api/server-config'],
  ]){
    const decision=decide(mode,method,url);
    eq(decision.allowed,false,`${mode} rejects ${method} ${url}`);
    ok(decision.code?.startsWith('SERVER_'),`${mode} explicit error ${method} ${url}`);
  }
  for(const [method,url] of [
    ['GET','/health/ready'],['HEAD','/health/ready'],['GET','/api/meta/compatibility'],
    ['GET','/api/admin/operations/health'],['GET','/api/admin/operations/api-tools'],
    ['GET','/api/admin/operations/incidents/abc'],['GET','/api/admin/backups/recovery-readiness'],
    ['GET','/api/auth/csrf'],['GET','/api/auth/config'],['GET','/api/me'],['GET','/api/setup/status'],
    ['POST','/api/auth/login'],['POST','/api/auth/logout'],['POST','/api/auth/reauth'],
    ['POST','/api/auth/passkeys/login/start'],['POST','/api/auth/passkeys/login/verify'],
    ['POST','/api/auth/mfa/challenge'],['POST','/api/admin/operations/api-tools/check'],
    ['POST','/api/admin/operations/incidents/abc/acknowledge'],['OPTIONS','/api/projects'],
  ])eq(decide(mode,method,url).allowed,true,`${mode} safe operator request ${method} ${url}`);
  for(const [method,url] of [
    ['POST','/api/admin/operations/incidents/abc/acknowledge/other'],
    ['POST','/api/admin/operations/incidents//acknowledge'],
    ['POST','/api/admin/operations/incidents/abc/acknowledge-and-close'],
    ['POST','/api/admin/backups/now/anything'],
    ['POST','/api/auth/login/other'],
  ])eq(decide(mode,method,url).allowed,false,`${mode} prefix abuse forbidden`);
 }
 for(const [method,url] of [['GET','/api/projects'],['POST','/api/projects'],['PUT','/api/admin/operations/alert-policies'],['DELETE','/api/admin/backups/backup.zip']])eq(decide('normal',method,url).allowed,true,`normal unchanged ${url}`);
 eq(decide('read-only','GET','/api/projects').allowed,true,'readonly workspace read retained');
 eq(decide('read-only','HEAD','/api/projects').allowed,true,'readonly head retained');
 eq(decide('read-only','POST','/api/projects').status,423,'readonly workspace mutation locked');
 eq(decide('maintenance','GET','/api/projects').status,503,'maintenance workspace read blocked');
 eq(decide('recovery','GET','/api/projects').status,503,'recovery workspace read blocked');
 eq(publicServerRuntimeState({mode:'maintenance',ready:true,draining:false}),'maintenance','maintenance publicly visible');
 eq(publicServerRuntimeState({mode:'normal',ready:true,draining:true}),'draining','drain outranks normal');
 const source=fs.readFileSync(path.join(root,'apps/server/src/app/server-request-infrastructure.ts'),'utf8');
 ok(source.includes('runtimeRequestDecision({ mode: serverState.mode, pathname, method: request.method })'),'real server pre-handler uses method-aware policy');
 console.log(`${count}/${count} F4 P3 runtime maintenance mode enforcement assertions passed`);
}finally{fs.rmSync(tmp,{recursive:true,force:true});}
