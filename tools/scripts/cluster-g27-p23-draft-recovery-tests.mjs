import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from '/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js';
import {webcrypto} from 'node:crypto';
const read = name => readFileSync(new URL('../../'+name,import.meta.url),'utf8');
const src=read('packages/renderer/src/features/settings/settings-draft-authority.ts');
function load(context={crypto:webcrypto,TextEncoder}) {
 const module={exports:{}};
 vm.runInNewContext(ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports,...context});
 return module.exports;
}
const {decideDraftRecovery,studioSettingsDraftBaseline}=load();
let checks=0;
async function test(label,fn){await fn();checks++;console.log('PASS '+label)}
await test('No saved draft is not a recovery',()=>assert.equal(decideDraftRecovery(false,null,'rev123'),'none'));
await test('Bound, matching Account draft is restorable',()=>assert.equal(decideDraftRecovery(true,'rev123','rev123'),'matching'));
await test('Older revision draft is held instead of silently applied',()=>assert.equal(decideDraftRecovery(true,'rev122','rev123'),'older-or-unverified'));
await test('Pre-baseline legacy draft is held',()=>assert.equal(decideDraftRecovery(true,undefined,'rev123'),'older-or-unverified'));
await test('Empty revision and empty server revision are never trusted',()=>assert.equal(decideDraftRecovery(true,'',''),'older-or-unverified'));
await test('Studio snapshot order does not change digest',async()=>{
 const a=await studioSettingsDraftBaseline({beta:{y:2,x:1},alpha:[{n:5,z:7}]});
 const b=await studioSettingsDraftBaseline({alpha:[{z:7,n:5}],beta:{x:1,y:2}});
 assert.match(a,/^sha256:[0-9a-f]{64}$/);assert.equal(a,b);
});
await test('Nested Studio settings change changes the saved digest',async()=>{
 const a=await studioSettingsDraftBaseline({roles:[{manage:true}]});
 const b=await studioSettingsDraftBaseline({roles:[{manage:false}]});
 assert.notEqual(a,b);
});
await test('Unavailable browser WebCrypto means fail-closed unverified baseline',async()=>{
 assert.equal(await load({crypto:undefined}).studioSettingsDraftBaseline({data:true}),null);
});
await test('Crypto digest failure means fail-closed unverified baseline',async()=>{
 assert.equal(await load({crypto:{subtle:{digest:async()=>{throw Error('fault')}}}}).studioSettingsDraftBaseline({data:true}),null);
});
const account=read('packages/renderer/src/features/settings/AccountSettingsPage.tsx');
const studio=read('packages/renderer/src/features/settings/StudioSettingsPage.tsx');
await test('Account draft captures the original revision at edit time and holds stale recovery',()=>{
 assert.match(account,/const baseFingerprint = preferencesFingerprintRef\.current; \/\/ Bind to the revision at edit time/);
 assert.match(account,/baseFingerprint \}\)/);
 assert.match(account,/const draftAuthority = decideDraftRecovery\(Boolean\(recoveredDraft\), recoveredDraft\?\.value\?\.baseFingerprint, preferenceResult\.fingerprint\)/);
 assert.match(account,/const trustedDraft = draftAuthority === "matching" \? recoveredDraft\?\.value : null/);
 assert.match(account,/setHeldAccountDraft\(draftAuthority === "older-or-unverified"/);
 assert.match(account,/heldAccountDraft && <section[^>]*role="alert"/);
 assert.match(account,/Load draft for review/);
 assert.match(account,/Discard stored draft/);
});
await test('Studio drafts store only digest, not a second full baseline settings snapshot',()=>{
 assert.match(studio,/const baseSignature = studioSettingsBaseDigestRef\.current; \/\/ Capture at edit time/);
 assert.match(studio,/studioSettingsBaseDigestRef\.current = currentBaseSignature/);
 assert.match(studio,/const currentBaseSignature = await studioSettingsDraftBaseline\(loaded\)/);
 assert.match(studio,/const trustedDraft = draftAuthority === "matching" \? recoveredDraft\?\.value : null/);
 assert.match(studio,/setHeldStudioDraft\(!pendingConflictDraft && draftAuthority === "older-or-unverified"/);
 assert.doesNotMatch(studio,/baseSettingsSnapshot:/);
 assert.match(studio,/heldStudioDraft && <section[^>]*role="alert"/);
 assert.match(studio,/Load draft for review/);
 assert.match(studio,/Discard stored draft/);
});
await test('Manual recovery is explicit and rebinds the current origin only after user choice',()=>{
 assert.match(account,/function reviewHeldAccountDraft\(\)/);
 assert.match(account,/persistAccountDraft\(next, accent, nextTheme\); \/\/ Rebind only after explicit review selection/);
 assert.match(studio,/function reviewHeldStudioDraft\(\)/);
 assert.match(studio,/persistStudioDraft\(next\); \/\/ Explicit review rebinds to the current server snapshot/);
 assert.match(account,/setDirty\(true\)/);
 assert.match(studio,/setDirty\(true\)/);
});
console.log(`${checks}/${checks} G27 P23 draft recovery checks passed`);
