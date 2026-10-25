import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
const require=createRequire(import.meta.url);
const ts=require('typescript');
function load(file,imports={}) {
  const js=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  vm.runInNewContext(js,{module,exports:module.exports,require:name=>name in imports?imports[name]:(name === "./managed-package-seat-policy.js" ? {
    packageSeatEligibleIds: async (_db, ids) => ids,
    packageSeatEligibleUsers: async (_db, _pkg, ids) => ids,
    registerManagedPackageSeatRoutes: () => {},
  } : name === "./managed-package-readiness.js" ? {
    registerManagedPackageReadinessRoutes: () => {},
  } : null)||require(name),Buffer,Date,JSON,String,Number,Set,Map,Math,Promise},{filename:file});
  return module.exports;
}
const policy=load('apps/server/src/domains/inventory/managed-package-policy.ts');
const states=load('apps/server/src/domains/inventory/managed-package-deployments.ts');
const delivery=load('apps/server/src/domains/inventory/managed-package-device.ts',{'./managed-package-policy.js':policy});
const check=[];const test=(name,fn)=>{fn();check.push(name)};
const {challenge,challengeHash,expiresAt}=states.newPackageReceiptChallenge();
test('Challenge nonce generated and verifiable',()=>{assert.equal(states.packageReceiptChallengeValid(challenge,challengeHash,expiresAt),true)});
test('Wrong challenge denied',()=>assert.equal(states.packageReceiptChallengeValid('A'.repeat(43),challengeHash,expiresAt),false));
test('Expired challenge denied',()=>assert.equal(states.packageReceiptChallengeValid(challenge,challengeHash,new Date(0)),false));
test('Malformed challenge denied',()=>assert.equal(states.packageReceiptChallengeValid('??',challengeHash,expiresAt),false));
test('Nonce not stored in plaintext',()=>assert.ok(!challengeHash.includes(challenge)));
for(const [prior,after,allowed] of [['offered','artifact_verified',true],['offered','activated',false],['artifact_verified','staged',true],['artifact_verified','rolled_back',false],['staged','activated',false],['staged','content_selected',true],['content_selected','activated',false],['content_selected','rolled_back',true],['activated','rolled_back',false],['rolled_back','activated',false],['failed','rolled_back',false]])test(`${prior} -> ${after}`,()=>assert.equal(states.packageDeviceTransitionAllowed(prior,after),allowed));
test('Device-reported status never attested',()=>assert.equal(states.packageDeviceReportedState('content_selected').osAttested,false));
const routeSrc=fs.readFileSync('apps/server/src/domains/inventory/managed-package-routes.ts','utf8');
const schema=fs.readFileSync('apps/server/prisma/schema.prisma','utf8');
const migration=fs.readFileSync('apps/server/prisma/migrations/20261009060000_managed_package_device_receipts/migration.sql','utf8');
for(const q of ['managedPackageDeviceDeployment.create','managedPackageDeviceReceipt.create','packageReceiptChallengeValid','updateMany','isolationLevel: "Serializable"','readDevicePackageTargets(tx','registration.proofKeyFingerprint !== device.fingerprint','X-Cluster-Package-Receipt-Challenge','osAttested: false'])test(`Route uses ${q}`,()=>assert.ok(routeSrc.includes(q)));
for(const q of ['model ManagedPackageDeviceDeployment','model ManagedPackageDeviceReceipt','@@unique([deploymentId, eventId])','@@unique([deploymentId, sequence])'])test(`Schema ${q}`,()=>assert.ok(schema.includes(q)));
for(const q of ['CREATE TABLE "ManagedPackageDeviceDeployment"','CREATE TABLE "ManagedPackageDeviceReceipt"','REFERENCES "ManagedPackageDeviceDeployment"','CREATE UNIQUE INDEX "ManagedPackageDeviceReceipt_deploymentId_eventId_key"'])test(`Migration ${q}`,()=>assert.ok(migration.includes(q)));
console.log(`Cluster 0.515 device receipt assertions: ${check.length}/${check.length} passed`);
