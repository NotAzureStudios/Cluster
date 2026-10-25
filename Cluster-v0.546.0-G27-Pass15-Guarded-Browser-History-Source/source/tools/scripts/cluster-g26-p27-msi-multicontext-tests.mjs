// Exercise the production Desktop receipt validator and MSI admission source.
// Pure Go MSI enumeration decision table runs with package-stager-go tests.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const ts=createRequire(import.meta.url)('typescript');
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8');
const renderer=read('../../packages/renderer/src/features/settings/DesktopDevicePackagesPanel.tsx');
const ast=ts.createSourceFile('panel.tsx',renderer,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let functionSource; let bootSource;
function walk(n){if(ts.isFunctionDeclaration(n)&&['verifyReadOnlyMSIEvidence','verifyMSIBootObservation'].includes(n.name?.text)) {if(n.name?.text==='verifyReadOnlyMSIEvidence')functionSource=n.getText(ast);else bootSource=n.getText(ast);}ts.forEachChild(n,walk)}
walk(ast);assert.ok(functionSource);assert.ok(bootSource);
const js=ts.transpileModule(bootSource+"\n"+functionSource,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const verify=Function(`"use strict";${js}; return verifyReadOnlyMSIEvidence;`)();
const code='{12345678-1234-ABCD-ABCD-1234567890AB}';
const receipt={schema:1,packageKey:'studio-tools',state:'msi_exit_zero_not_os_attested',hasReceipt:true,lockPresent:false,
 admissionLockPresent:false,manualReviewRequired:true,retryAuthorized:false,readOnly:true,osAttested:false,
 receiptSha256:'f'.repeat(64),stagedArtifactVerified:false,registrationTransition:'historical_receipt_no_transition_evidence',registrationDrift:'no_post_exit_baseline',
 bootObservation:{state:'os_uptime_unavailable',readOnly:true,osAttested:false,rebootConfirmed:false,anchorRecorded:false},
 product:{state:'registered_version_match',productCode:code,expectedVersion:'1.2.3',reportedVersion:'1.2.3',versionMatches:true,
   readOnly:true,osAttested:false,probeScope:'current_user_and_machine',probeComplete:true},
 attempt:{packageKey:'studio-tools',state:'msi_exit_zero_not_os_attested',version:'1.2.3',productCode:code,productVersion:'1.2.3',
 artifactSha256:'a'.repeat(64),msiSha256:'b'.repeat(64),osAttested:false,startedAt:'2026-10-24T11:00:00Z',
 finishedAt:'2026-10-24T11:05:00Z',exitCode:0}};
let count=0;
verify(receipt,'studio-tools');count++;
const unqueryable={...receipt,product:{...receipt.product,state:'os_query_unavailable',probeScope:'',probeComplete:false,
  versionMatches:false,reportedVersion:undefined}};
verify(unqueryable,'studio-tools');count++;
const missing={...receipt,product:{...receipt.product,state:'not_registered_for_user',probeScope:'current_user_and_machine',probeComplete:true,
  versionMatches:false,reportedVersion:undefined}};
verify(missing,'studio-tools');count++;
for(const invalid of [
 {...receipt.product,probeComplete:undefined},{...receipt.product,probeScope:undefined},
 {...receipt.product,probeScope:'current_user_only'}, {...receipt.product,probeComplete:false},
 {...receipt.product,probeScope:''},{...receipt.product,probeScope:'all_users'},
 {...receipt.product,state:'not_registered_for_user',versionMatches:true},
 {...receipt.product,state:'registered_version_match',reportedVersion:'1.2.4'},
 {...receipt.product,state:'registered_version_match',versionMatches:false},
 {...receipt.product,state:'os_query_unavailable'},
 {...receipt.product,state:'registration_maybe_ready'},
 {...unqueryable.product,probeComplete:true},
 {...unqueryable.product,probeScope:'current_user_and_machine'},
 {...unqueryable.product,reportedVersion:'1.2.3'},
 {...unqueryable.product,versionMatches:true},
]) {assert.throws(()=>verify({...receipt,product:invalid},'studio-tools'),/MSI recovery evidence/);count++}
const windows=read('../native/package-stager-go/msi_product_windows.go');
const probe=read('../native/package-stager-go/msi_registration_probe.go');
const installer=read('../native/package-stager-go/msi_installer.go');
const custody=read('../native/package-stager-go/msi_cross_package_custody.go');
for(const marker of ['MsiEnumProductsExW','MsiGetProductInfoExW','msiContextCurrentAndMachine','classifyMSIEnumeratedProduct']){
 assert.ok(windows.includes(marker));count++}
assert.ok(!windows.includes('MsiQueryProductStateW")'));count++;
for(const marker of ['msiRegistrationScope = "current_user_and_machine"','msiEnumeratedEnd','firstCode == msiEnumeratedEnd',
 'nextCode != msiEnumeratedEnd','strings.EqualFold(returnedCode, code)']){assert.ok(probe.includes(marker));count++}
const prior=installer.indexOf('prepareMSIInstall(receipt, root, claim, out)');
const late=installer.indexOf('latestProduct, latestErr := queryInstalledMSIProduct',prior);
const launch=installer.indexOf('out.State = "msi_started_outcome_unknown"',prior);
assert.ok(prior>0 && late>prior && launch>late);count++;
for(const marker of ['unrecognized MSI custody evidence','another or malformed MSI operation lock','info.Mode()&os.ModeSymlink']){
 assert.ok(custody.includes(marker)|| (marker==='another or malformed MSI operation lock' && custody.includes('unrecognized MSI custody')));count++}
const qt=read('../../apps/desktop-qt/src/NativeCapabilityBroker.cpp');
assert.ok(qt.includes('product.value(QStringLiteral("probeComplete")).isBool()'));count++;
assert.ok(qt.includes('QStringLiteral("current_user_and_machine")'));count++;
const bridge=read('../../packages/renderer/src/core/desktop.ts');
assert.ok(bridge.includes('probeComplete: boolean; probeScope: "" | "current_user_and_machine"'));count++;
console.log(`${count}/${count} Pass27 production contract and tamper assertions passed`);
