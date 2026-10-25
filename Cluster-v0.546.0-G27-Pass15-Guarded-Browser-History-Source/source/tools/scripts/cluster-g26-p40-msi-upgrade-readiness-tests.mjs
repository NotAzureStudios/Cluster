// Execute the shipped Desktop MSI upgrade review and native capability wrapper
// with independently controlled profile / rollout evidence. This DOES NOT run MSI.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const ts = createRequire(import.meta.url)('typescript');
const path = new URL('../../', import.meta.url);
const read = (f) => fs.readFileSync(new URL(f, path), 'utf8');
const ui = read('packages/renderer/src/features/settings/DesktopDevicePackagesPanel.tsx');
const core = read('packages/renderer/src/core/desktop.ts');
const qt = read('apps/desktop-qt/src/NativeCapabilityBroker.cpp');
const go = read('tools/native/package-stager-go/msi_upgrade_readiness.go');
const goInstaller = read('tools/native/package-stager-go/msi_installer.go');
const goStatus = read('tools/native/package-stager-go/msi_attempt_status.go');
const goEntry = read('tools/native/package-stager-go/main.go');
function extract(src, fileName, fnName, kind) {
  const ast = ts.createSourceFile(fileName, src, ts.ScriptTarget.ES2022, true, kind);
  let found;
  (function visit(node){ if(ts.isFunctionDeclaration(node) && node.name?.text === fnName) found=node.getText(ast); ts.forEachChild(node,visit); })(ast);
  assert(found, `actual production function ${fnName} missing`);
  return ts.transpileModule(found,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText.replace(/^export\s+/gm,'');
}
const wrapper=extract(core,'desktop.ts','inspectNativeMSIUpgradeReadiness',ts.ScriptKind.TS);
const bridgeCalls=[];
const capability=Function('exports','requestNativeCapability',`'use strict';${wrapper};return inspectNativeMSIUpgradeReadiness`)({},(...args)=>{bridgeCalls.push(args);return Promise.resolve({accepted:true,operationId:'review-only'});});
const sha=(char)=>char.repeat(64);
const target={expectedArtifactSha256:sha('a'),expectedPackageKey:'studio-core',expectedVersion:'1.5.0',priorReceiptSha256:sha('b')};
let checks=0;
assert.deepEqual(await capability(target),{accepted:true,operationId:'review-only'});checks++;
assert.equal(bridgeCalls.length,1);checks++;
assert.equal(bridgeCalls[0][0],'package.previewUpgrade');checks++;
assert.deepEqual(bridgeCalls[0][1],target);checks++;
for (const bad of ['bad','A'.repeat(64),'../receipt','0'.repeat(65),'']) {
  await assert.rejects(capability({...target,priorReceiptSha256:bad}),/predecessor MSI receipt/);
  checks++;
}
assert.equal(bridgeCalls.length,1);checks++;
const reviewSource=extract(ui,'DesktopDevicePackagesPanel.tsx','reviewMSIUpgrade',ts.ScriptKind.TSX);
const uiFactory=Function('d',`'use strict'; const {available,platform,trust,msiUpgradeBusy,grantBusy,nativeStage,generation,
 setMsiUpgradeBusy,setError,setNotice,api,channel,inspectNativeMSIProfile,verifyReadOnlyMSIProfile,
 setMsiProfileEvidence,inspectNativeMSIUpgradeReadiness,preparedKitDigest,setNativeStage} = d;
 ${reviewSource}; return reviewMSIUpgrade;`);
const release={id:'release-one',version:'1.5.0',artifactSha256:sha('a')};
const selected={package:{id:'package-one',key:'studio-core'},release,manifest:{installer:{sha256:sha('c')}}};
const predecessor={packageKey:'studio-core',hasReceipt:true,receiptSha256:sha('b'),attempt:{msiPath:'install/studio-core.msi'}};
const cleanProfile={admissionLockPresent:false,lifecycleRecords:[],records:[predecessor]};
function fixture(overrides={}) {
 const seen=[];let gen=1;
 const deps={available:true,platform:'windows-x64',trust:{configured:true},msiUpgradeBusy:'',grantBusy:false,
 nativeStage:{state:'idle'},generation:{get current(){return gen},set current(v){gen=v}},
 setMsiUpgradeBusy:v=>seen.push(['busy',v]),setError:v=>seen.push(['error',v]),setNotice:v=>seen.push(['notice',v]),
 api:async()=>({targets:[selected]}),channel:'stable',inspectNativeMSIProfile:async()=>structuredClone(cleanProfile),
 verifyReadOnlyMSIProfile:p=>{assert(p.records)},setMsiProfileEvidence:p=>seen.push(['profile',p]),
 inspectNativeMSIUpgradeReadiness:async v=>{seen.push(['native',v]);return {accepted:true,operationId:'review-one'};},
 preparedKitDigest:sha('a'),setNativeStage:v=>seen.push(['stage',v]),...overrides};
 return {deps,seen,run:uiFactory(deps)};
}
{
 const {run,seen}=fixture();await run(selected);
 assert.deepEqual(seen.find(e=>e[0]==='native')?.[1],{...target,preparedKit:true});checks++;
 assert.deepEqual(seen.find(e=>e[0]==='stage')?.[1],{state:'verifying',operationId:'review-one'});checks++;
 assert.deepEqual(seen.filter(e=>e[0]==='busy').map(e=>e[1]),['studio-core','']);checks++;
}
async function rejected(name,overrides,regex) {
 const {run,seen}=fixture(overrides);await run(selected);
 assert(!seen.some(e=>e[0]==='native'),`${name}: unexpected native operation`);checks++;
 assert(seen.find(e=>e[0]==='error'&&regex.test(e[1])),`${name}: missing error`);checks++;
}
await rejected('revoked release',{api:async()=>({targets:[]})},/no longer selected/);
await rejected('missing receipt',{inspectNativeMSIProfile:async()=>({...cleanProfile,records:[{...predecessor,hasReceipt:false}]})},/No verified/);
await rejected('missing rollback source',{inspectNativeMSIProfile:async()=>({...cleanProfile,records:[{...predecessor,attempt:{}}]})},/No verified/);
await rejected('lifecycle journal',{inspectNativeMSIProfile:async()=>({...cleanProfile,lifecycleRecords:[{operation:'repair'}]})},/No verified/);
await rejected('admission lock',{inspectNativeMSIProfile:async()=>({...cleanProfile,admissionLockPresent:true})},/No verified/);
await rejected('invalid native profile',{verifyReadOnlyMSIProfile:()=>{throw new Error('invalid native inventory')}} ,/invalid native inventory/);
{
 const f=fixture({api:async()=>{f.deps.generation.current++;return {targets:[selected]}}});
 await f.run(selected);assert(!f.seen.some(e=>e[0]==='native'));checks++;
}
{
 const f=fixture({inspectNativeMSIProfile:async()=>{f.deps.generation.current++;return cleanProfile}});
 await f.run(selected);assert(!f.seen.some(e=>e[0]==='native'));checks++;
}
{
 const f=fixture({inspectNativeMSIUpgradeReadiness:async v=>{f.seen.push(['native',v]);return {accepted:false}}});
 await f.run(selected);assert(!f.seen.some(e=>e[0]==='stage'));checks++;
}
for(const [file,text,required] of [
 ['Qt',qt,['package.previewUpgrade','installerUpgradePreview','CLUSTER_MSI_UPGRADE_READINESS ','priorReceiptSha256','priorMsiSha256','msi_upgrade_reviewable_not_authorized','retainedMSIPath','mutationAuthorized','!evidence.value(QStringLiteral("osAttested")).toBool(true)']],
 ['Native',go,['reviewable_not_authorized','MutationAuthorized: false','PriorMSIPath','compareMSIVersions','reviewMSIUpgradeWithProfile','verifyRegularDigest','len(profile.LifecycleRecords) > 0','profile.DependencyEdges','m.Installer == nil']],
 ['Receipt',goInstaller,['MSIPath','m.Installer.Path']],
 ['Status',goStatus,['receipt.MSIPath','msiPathPattern','secureName']],
 ['CLI',goEntry,['preview-upgrade','prior-receipt-sha256','CLUSTER_MSI_UPGRADE_READINESS ']],
 ['UI',ui,['reviewMSIUpgrade(target)','inspectNativeMSIUpgradeReadiness','nativeStage.msiUpgrade.priorMsiSha256','priorReceiptSha256: predecessor.receiptSha256']]
]) for (const key of required){assert(text.includes(key),`${file} missing ${key}`);checks++;}
console.log(`${checks}/${checks} executed Pass40 MSI readiness, Desktop source and adversarial bridge checks passed`);
