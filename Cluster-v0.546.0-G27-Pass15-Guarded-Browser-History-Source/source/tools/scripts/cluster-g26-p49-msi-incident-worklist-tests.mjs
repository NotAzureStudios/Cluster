import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, readdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
const ts=createRequire(import.meta.url)('typescript');
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const module={exports:{}};
Function('module','exports',`'use strict';${ts.transpileModule(read('packages/renderer/src/features/settings/msi-incident-worklist.ts'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText}`)(module,module.exports);
const valid=module.exports.validMSIIncidentWorklist;
let n=0;
const check=(ok,message)=>{assert.equal(ok,true,message);n++};
const hash=ch=>ch.repeat(64);
const attempt={caseId:'attempt:studio-core',packageKey:'studio-core',operation:'install',state:'msi_exit_zero_not_os_attested',receiptSha256:hash('a'),priorReceiptSha256:'',predecessorRecorded:false,predecessorMatches:false,registrationState:'registered_version_match',severity:'review',recoveryAction:'review_unattested_installation',readOnly:true,retryAuthorized:false,mutationAuthorized:false,osAttested:false};
const lifecycle={caseId:'lifecycle:studio-core:upgrade',packageKey:'studio-core',operation:'upgrade',state:'upgrade_started_outcome_unknown',receiptSha256:hash('b'),priorReceiptSha256:hash('a'),predecessorRecorded:true,predecessorMatches:true,registrationState:'registered_version_match',severity:'manual_recovery',recoveryAction:'manual_lifecycle_review_no_replay',readOnly:true,retryAuthorized:false,mutationAuthorized:false,osAttested:false};
const base={schema:1,state:'manual_recovery_required',readOnly:true,complete:true,osAttested:false,mutationAuthorized:false,retryAuthorized:false,admissionLockPresent:false,manualRecoveryCount:1,reviewCount:1,observationCount:0,items:[attempt,lifecycle]};
const clone=x=>structuredClone(x);
check(valid(base),'valid incident inventory with matching predecessor');
const orphan=clone(base);orphan.items[1].predecessorMatches=false;orphan.items[1].predecessorRecorded=false;orphan.items[1].recoveryAction='investigate_missing_or_changed_predecessor';check(valid(orphan),'orphan remains visible');
const empty={...base,state:'empty',items:[],manualRecoveryCount:0,reviewCount:0};check(valid(empty),'empty profile');
const withLock={...empty,state:'manual_recovery_required',admissionLockPresent:true};check(valid(withLock),'profile lock without receipts');
const locked=clone(base);locked.items[0].state='msi_started_outcome_unknown';locked.items[0].severity='manual_recovery';locked.items[0].recoveryAction='investigate_install_attempt_no_replay';locked.manualRecoveryCount=2;locked.reviewCount=0;check(valid(locked),'interrupted attempt shown as manual');
const unrecorded=clone(locked);unrecorded.items[0].receiptSha256='';check(valid(unrecorded),'receipt missing is not elided');
const reviewOnly={...base,state:'review_required',items:[attempt],manualRecoveryCount:0,reviewCount:1};check(valid(reviewOnly),'non-attested installation review');
for(const [name,fn] of Object.entries({
 'grant claimed':x=>x.items[1].mutationAuthorized=true,
 'retry claimed':x=>x.retryAuthorized=true,
 'OS attested':x=>x.items[0].osAttested=true,
 'item readOnly dropped':x=>x.items[0].readOnly=false,
 'incomplete':x=>x.complete=false,
 'fake no incidents state':x=>x.state='empty',
 'missing manual total':x=>x.manualRecoveryCount=0,
 'wrong review total':x=>x.reviewCount=2,
 'negative count':x=>x.reviewCount=-1,
 'wrong observation':x=>x.observationCount=1,
 'noninteger count':x=>x.reviewCount=0.5,
 'changed case key':x=>x.items[1].caseId='lifecycle:studio-core:uninstall',
 'reordered cases':x=>x.items.reverse(),
 'duplicate cases':x=>x.items.push(clone(x.items[1])),
 'unknown operation':x=>x.items[1].operation='wipe-disk',
 'forged original digest':x=>x.items[0].receiptSha256='x',
 'missing lifecycle digest':x=>x.items[1].receiptSha256='',
 'missing predecessor digest':x=>x.items[1].priorReceiptSha256='',
 'predecessor false but match true':x=>x.items[1].predecessorRecorded=false,
 'forged predecessor review':x=>x.items[1].recoveryAction='manual_lifecycle_review_no_replay-extra',
 'grant as action':x=>x.items[1].recoveryAction='request_independent_authorization',
 'wrong install predecessor':x=>x.items[0].predecessorRecorded=true,
 'install prior hash':x=>x.items[0].priorReceiptSha256=hash('a'),
 'install action as manual':x=>x.items[0].recoveryAction='investigate_install_attempt_no_replay',
 'illegal case key':x=>x.items[0].packageKey='../malicious',
 'missing registration evidence type':x=>x.items[0].registrationState=null,
 'forged registration state':x=>x.items[0].registrationState='attested_healthy',
 'missing prior receipt field':x=>delete x.items[0].priorReceiptSha256,
 'missing attempt receipt field':x=>delete x.items[0].receiptSha256,
 'missing item state':x=>x.items[0].state='',
 'missing item authority':x=>delete x.items[1].retryAuthorized,
 'unknown severity':x=>x.items[0].severity='success',
 'hidden lifecycle case':x=>x.items.pop(),
 'empty report while lock hidden':x=>{x.items=[];x.manualRecoveryCount=0;x.reviewCount=0;x.state='empty';x.admissionLockPresent=true},
})) {const forged=clone(base);fn(forged);check(!valid(forged),`reject ${name}`)}
// Source-level contracts + actual native Go behavior.
const native=read('tools/native/package-stager-go/msi_incident_worklist.go');
const goTests=read('tools/native/package-stager-go/msi_incident_worklist_test.go');
const cli=read('tools/native/package-stager-go/main.go');
const qt=read('apps/desktop-qt/src/NativeCapabilityBroker.cpp');
const ui=read('packages/renderer/src/features/settings/DesktopDevicePackagesPanel.tsx');
const transport=read('packages/renderer/src/core/desktop.ts');
for(const [content,needles,label] of [
 [native,['planMSIIncidentWorklist','inspectMSIProfile(abs)','PredecessorMatches','investigate_missing_or_changed_predecessor','ManualRecoveryCount','sort.Slice','!profile.Complete'], 'native'],
 [goTests,['TestMSIIncidentWorklistRetainsEveryAttemptAndLifecycleJournal','TestMSIIncidentWorklistOrphansRemainVisibleAndBlockable','TestMSIIncidentWorklistRefusesForgedCustody','TestMSIIncidentWorklistEmptyProfileAndUnlaunchedAttempt'], 'native tests'],
 [cli,['case "msi-incident-worklist"','CLUSTER_MSI_INCIDENT_WORKLIST','128*1024','*statusKey != ""','o.Grant != ""'], 'CLI'],
 [qt,['package.msiIncidentWorklist','msi-incident-worklist','CLUSTER_MSI_INCIDENT_WORKLIST','expected','predecessorMatches','manualRecoveryCount'], 'Qt'],
 [ui,['validMSIIncidentWorklist','inspectNativeMSIIncidentWorklist','MSI incident worklist','No receipt','manual-recovery cases','writeNativeClipboardText','Original installation registration','No mutation, retry or OS-health authority'], 'Desktop'],
 [transport,['ClusterNativeMSIIncidentWorklist','package.msiIncidentWorklist','predecessorMatches: boolean'], 'transport']])
 for(const needle of needles)check(content.includes(needle),`${label} retains ${needle}`);
check(!native.includes('consumeGrant(')&&!native.includes('runWindowsUserMSI')&&!native.includes('os.Remove('),'read-only inventory cannot mutate MSI state');
const r=spawnSync('go',['test','-run','^TestMSIIncidentWorklist','-count=1','./...'],{cwd:new URL('../../tools/native/package-stager-go/',import.meta.url),encoding:'utf8',timeout:60000});
check(r.status===0,`actual incident Go tests: ${r.stdout} ${r.stderr}`);
const scratch=mkdtempSync(join(tmpdir(),'cluster-msi-incidents-'));
try {
 const nativeRoot=new URL('../../tools/native/package-stager-go/',import.meta.url);
 const runCli=args=>spawnSync('go',['run','.','--action','msi-incident-worklist','--root',scratch,...args],
    {cwd:nativeRoot,encoding:'utf8',timeout:60000});
 const empty=runCli([]);
 check(empty.status===0 && empty.stdout.startsWith('CLUSTER_MSI_INCIDENT_WORKLIST '),
    `native helper CLI succeeds without authorizing or creating a profile: ${empty.stderr}`);
 check(valid(JSON.parse(empty.stdout.trim().slice('CLUSTER_MSI_INCIDENT_WORKLIST '.length))),
    'actual native CLI empty inventory passes production renderer validator');
 check(readdirSync(scratch).length===0,'read-only CLI did not create incident custody state');
 const forged=runCli(['--grant','forged-authority']);
 check(forged.status!==0 && forged.stderr.includes('accepts only a private profile root'),
    'native worklist refuses injected deployment grant');
 const foreign=runCli(['--package-key','studio-core']);
 check(foreign.status!==0 && foreign.stderr.includes('accepts only a private profile root'),
    'native worklist refuses renderer-supplied package override');
 check(readdirSync(scratch).length===0,'failed CLI attempts did not create a profile or consume grants');
} finally {rmSync(scratch,{recursive:true,force:true})}
console.log(`${n}/${n} Pass49 executable MSI incident worklist and adversarial contract checks passed`);
