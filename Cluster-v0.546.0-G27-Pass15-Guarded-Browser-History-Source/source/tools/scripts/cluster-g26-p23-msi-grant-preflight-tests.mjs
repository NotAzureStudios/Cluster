// Execute extracted production MSI command handlers under controlled Desktop
// and server dependencies. No installer is launched by these regression tests.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const source = fs.readFileSync(new URL('../../packages/renderer/src/features/settings/DesktopDevicePackagesPanel.tsx', import.meta.url), 'utf8');
const parsed = ts.createSourceFile('DesktopDevicePackagesPanel.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ['runMSI','verifyReadOnlyMSIEvidence','verifyMSIBootObservation','isRecordedMSIAttemptBlocked'];
const bodies = new Map();
function visit(node) {
  if (ts.isFunctionDeclaration(node) && names.includes(node.name?.text)) bodies.set(node.name.text, node.getText(parsed));
  ts.forEachChild(node, visit);
}
visit(parsed);
for (const name of names) assert.ok(bodies.has(name), `production function ${name} is present`);
const js = ts.transpileModule([...bodies.values()].join('\n'), {compilerOptions:{target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.None}}).outputText;
const required = ['available','busy','grantBusy','msiGrantPending','msiGrantOwner','trust','nativeStage','platform','generation','setGrantBusy','setError','setNotice','api','channel','runNativeSupervisedMSI','supervisedMsiEnabled','controlTrust','inspectNativeMSIAttempt','setMsiEvidence','setNativeStage'];
const build = Function(...required, `"use strict"; ${js}; return {runMSI,verifyReadOnlyMSIEvidence,isRecordedMSIAttemptBlocked};`);
const target={package:{id:'pkg-id',key:'studio-editor',title:'Studio Editor'},release:{id:'release-id',version:'2.4.1',artifactSha256:'a'.repeat(64)},manifest:{installer:{sha256:'b'.repeat(64)}}};
const clean = {schema:1,packageKey:'studio-editor',state:'no_recorded_attempt',hasReceipt:false,lockPresent:false,admissionLockPresent:false,manualReviewRequired:false,retryAuthorized:false,readOnly:true,osAttested:false};
let count=0;
async function scenario({report=clean, changeAt='', waitAt='', grant=null, invalidTarget=false}={}) {
  const calls=[];const statuses=[];const notices=[];const errors=[];const evidence={}; const gen={current:2};
  const pending={current:false}; let held; let releaseHold;
  if (waitAt) held=new Promise(r=>releaseHold=r);
  const env={available:true,busy:false,grantBusy:false,msiGrantPending:pending,msiGrantOwner:{current:0},trust:{configured:true},nativeStage:{state:'idle'},platform:'windows-x64',generation:gen,
    setGrantBusy:v=>statuses.push(v),setError:v=>errors.push(v),setNotice:v=>notices.push(v),channel:'stable',
    supervisedMsiEnabled:true,controlTrust:{configured:true},
    setMsiEvidence:cb=>Object.assign(evidence,cb(evidence)),
    setNativeStage:v=>{env.nativeStage=v;},
    api:async (url,options)=>{const stage=options?'grant':'targets'; calls.push(stage);
      if (waitAt===stage) await held;
      if (changeAt===stage) gen.current++;
      if(stage==='targets') return {targets:invalidTarget?[]:[target]};
      return grant??{purpose:'supervised_user_msi_install',grant:{expiresAt:Math.floor(Date.now()/1000)+300}};
    },
    inspectNativeMSIAttempt:async ()=>{calls.push('inspect');if(waitAt==='inspect') await held;if(changeAt==='inspect')gen.current++;return report;},
    runNativeSupervisedMSI:async (_,operation)=>{calls.push(operation);return {accepted:true,operationId:'operation-1'};},
  };
  const f=build(...required.map(k=>env[k]));
  return {...f,env,calls,statuses,errors,notices,evidence,gen,pending,releaseHold:()=>releaseHold?.()};
}
const expect=async (value, expected, label)=>{assert.deepEqual(value,expected,label);count++;};
for (const [label,report] of [
  ['past receipt',{...clean,hasReceipt:true,manualReviewRequired:true,product:{readOnly:true,osAttested:false}}],
  ['held operation lock',{...clean,lockPresent:true}],
  ['unexplained native state',{...clean,state:'interrupted_or_active_without_receipt'}],
  ['manual recovery review',{...clean,manualReviewRequired:true}],
  ['malformed response',{...clean,readOnly:false}],
  ['falsely attested response',{...clean,osAttested:true}],
  ['unexpected native permission',{...clean,retryAuthorized:true}],
  ['wrong package record',{...clean,packageKey:'some-other-package'}],
  ['incomplete receipt product',{...clean,hasReceipt:true,product:undefined}]
]){
  const x=await scenario({report}); await x.runMSI(target,'install');
  await expect(x.calls,['targets','inspect'],`${label} blocks grant before request`);
  assert.ok(x.errors.some(Boolean),`${label} reports explicit error`);count++;
  await expect(x.pending.current,false,`${label} releases click lock`);
}
{
  const x=await scenario();await x.runMSI(target,'install');
  await expect(x.calls,['targets','inspect','grant','install'],'fresh MSI authorizes after local read');
  await expect(x.statuses,[true,false],'pending UI enters then leaves');
  await expect(x.env.nativeStage.state,'verifying','native installation remains a pending stage');
  await expect(x.evidence['studio-editor'].readOnly,true,'local inspection shown as read-only');
}
{
  const x=await scenario({invalidTarget:true});await x.runMSI(target,'install');
  await expect(x.calls,['targets'],'revoked target forbids local command and grant');
  assert.ok(x.errors.some(Boolean));count++;
}
for(const stage of ['targets','inspect','grant']){
  const x=await scenario({changeAt:stage});await x.runMSI(target,'install');
  const expected=stage==='targets'?['targets']:stage==='inspect'?['targets','inspect']:['targets','inspect','grant'];
  await expect(x.calls,expected,`generation change during ${stage} cancels progression`);
  await expect(x.env.nativeStage.state,'idle',`generation change during ${stage} does not set stale success`);
}
{
  const x=await scenario({waitAt:'targets'});
  const first=x.runMSI(target,'install'),second=x.runMSI(target,'install');
  x.releaseHold();await Promise.all([first,second]);
  await expect(x.calls.filter(c=>c==='grant').length,1,'two same-tick clicks mint only one grant');
  await expect(x.calls.filter(c=>c==='install').length,1,'two same-tick clicks invoke only one installer');
}
{
  const x=await scenario({grant:{purpose:'supervised_user_msi_install',grant:{expiresAt:1}}});await x.runMSI(target,'install');
  await expect(x.calls,['targets','inspect','grant'],'expired grant is not forwarded to native helper');
}
{
  const x=await scenario({report:{...clean,hasReceipt:true,manualReviewRequired:true,product:{readOnly:true,osAttested:false}}});
  assert.equal(x.isRecordedMSIAttemptBlocked(clean),false);count++;
  assert.equal(x.isRecordedMSIAttemptBlocked(x.env && {...clean,lockPresent:true}),true);count++;
  assert.equal(x.isRecordedMSIAttemptBlocked({...clean,manualReviewRequired:true}),true);count++;
}
assert.ok(source.includes('isRecordedMSIAttemptBlocked(msiEvidence[target.package.key])'),'UI disables known blocked MSI attempts');count++;
assert.ok(source.includes('if (startingGeneration !== generation.current) return;'),'in-flight profile generation is fenced');count++;
console.log(`${count}/${count} executed MSI grant-preflight / desktop race assertions passed`);
