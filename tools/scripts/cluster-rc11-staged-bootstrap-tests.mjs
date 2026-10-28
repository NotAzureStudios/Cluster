// RC11: exercise live policy and MFA-boundary functions, not just regex checks.
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
try { ts=require('typescript'); }
catch { const bin=fs.realpathSync(execFileSync('which',['tsc'],{encoding:'utf8'}).trim()); ts=require(path.resolve(path.dirname(bin),'../lib/typescript.js')); }
function load(rel,mocks={}) {
  const js=ts.transpileModule(fs.readFileSync(path.join(root,rel),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  vm.runInNewContext(js,{module,exports:module.exports,require:(name)=>mocks[name]||require(name),Date,Intl,Set,Map,Object,String,Boolean,Number,JSON,Promise,Error,Array},{filename:rel});
  return module.exports;
}
const policy=load('apps/server/src/core/studio-security-policy.ts');
const boundary=load('apps/server/src/domains/auth/mfa-policy-boundary.ts',{'../../core/studio-security-policy.js':policy});
const defaults={sessionDays:7,sessionIdleHours:12,sessionMaxPerUser:5};
const fresh=policy.normalizeStudioSecurityPolicy({},defaults);
assert.equal(fresh.mfaRequirement,'optional');
assert.equal(policy.securityPolicyRequiresMfa(fresh,'owner'),false,'fresh owner must not be locked into MFA');
assert.equal(policy.securityPolicyRequiresMfa(fresh,'admin'),false);
const admins=policy.normalizeStudioSecurityPolicy({securityMfaRequirement:'admins'},defaults);
assert.equal(policy.securityPolicyRequiresMfa(admins,'owner'),true);
assert.equal(policy.securityPolicyRequiresMfa(admins,'admin'),true);
assert.equal(policy.securityPolicyRequiresMfa(admins,'member'),false);
const all=policy.normalizeStudioSecurityPolicy({securityMfaRequirement:'all'},defaults);
assert.equal(policy.securityPolicyRequiresMfa(all,'member'),true);
let mutationCount=0;
let replyCode=200;
let replyBody=null;
const session={id:'session-1',userId:'owner-1',authMethod:'password'};
const input={pathname:'/api/projects',session,user:{id:'owner-1'},workspaceRole:'owner',prisma:{
  authenticator:{count:async()=>0},session:{updateMany:async()=>{mutationCount++;return {count:1};}}
},settings:{},sessionDefaults:defaults,
reply:{code(n){replyCode=n;return this;},send(o){replyBody=o;return this;}},
onUserSessionsRevoked(){},clearSessionCookies(){}};
assert.equal(await boundary.enforceStudioMfaPolicyBoundary(input),false);
assert.equal(mutationCount,0,'optional policy must not mutate owner session');
input.settings={securityMfaRequirement:'admins'};
assert.equal(await boundary.enforceStudioMfaPolicyBoundary(input),true);
assert.equal(mutationCount,1);
assert.equal(replyCode,428);
assert.equal(replyBody.code,'MFA_ENROLLMENT_REQUIRED');
assert.equal(session.authMethod,'mfa-enrollment-pending');
assert.equal(await boundary.enforceMfaEnrollmentRestriction({pathname:'/api/projects',session,reply:input.reply}),true);
assert.equal(await boundary.enforceMfaEnrollmentRestriction({pathname:'/api/auth/mfa/passkeys/enroll/start',session,reply:input.reply}),false);
const setup=fs.readFileSync(path.join(root,'apps/server/src/app/server-routes-setup.ts'),'utf8');
const ui=fs.readFileSync(path.join(root,'packages/renderer/src/features/application/modules/ApplicationSetupWizard.tsx'),'utf8');
const security=fs.readFileSync(path.join(root,'apps/server/src/domains/auth/studio-security-routes.ts'),'utf8');
const origin=fs.readFileSync(path.join(root,'apps/server/src/domains/auth/webauthn.ts'),'utf8');
assert.match(setup,/createSession\(owner\.id, reply, request, \{ authMethod: "password" \}\)/);
assert.match(setup,/mfaEnrollmentRequired: false/);
assert.doesNotMatch(setup,/user: \{ .*nextAuthStep: "SETUP_MFA"/);
assert.match(ui,/Configure MFA and recovery codes after sign-in/);
assert.doesNotMatch(ui,/This requirement cannot be skipped/);
assert.match(security,/MFA_POLICY_BOOTSTRAP_REQUIRED/);
assert.match(origin,/WEBAUTHN_DOMAIN_REQUIRED/);
console.log('RC11 staged setup: policy defaults, explicit MFA enforcement, limited session, initial bootstrap, UI messaging, policy activation guard passed');
