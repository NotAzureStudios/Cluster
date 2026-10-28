import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(`${require('node:child_process').execFileSync('npm', ['root','-g'],{encoding:'utf8'}).trim()}/typescript`)}})();
const get=(f)=>fs.readFileSync(f,'utf8');
const icon=get('packages/renderer/src/styles/design-system/primitives.css');
const controls=get('packages/renderer/src/styles/controls.css');
const assetUI=get('packages/renderer/src/features/settings/StudioInventoryVaultPanel.tsx');
const vault=get('packages/renderer/src/features/inventory/VaultManager.tsx');
const entry=get('packages/renderer/src/features/inventory/InventoryWorkspacePage.tsx');
const api=get('apps/server/src/domains/inventory/studio-inventory-vault-routes.ts');
let n=0;const check=(description,fn)=>{fn();n++;console.log('PASS',description)};
check('App-wide chevrons not pinned by important transform reset',()=>{assert.doesNotMatch(icon,/transform:\s*none\s*!important/);assert.doesNotMatch(controls, /cluster-detail-close-v429>\.cluster-icon-svg\{[^}]*transform:\s*none\s*!important/);assert.match(icon,/cluster-disclosure-chevron-v546.*transform: rotate\(90deg\)/)});
check('Stock catalog has grid and list with category navigation',()=>{for(const t of ['catalogMode','catalog-${catalogMode}','cluster-inventory-category-nav','aria-pressed','cluster-inventory-item__stock'])assert.ok(assetUI.includes(t),t)});
check('Asset detail only opens on intentional selection',()=>{assert.match(assetUI,/selected \|\| assetCreatorOpen/);assert.match(assetUI,/Close asset details/);assert.match(assetUI,/rows\.some\(\(row\) => row\.id === current\) \? current : ""/)});
check('Visible catalog stock backed by authorized paginated aggregate',()=>{assert.match(api,/const page = rows\.slice\(0, 100\)/);assert.match(api,/\.groupBy\(/);assert.match(api,/\.\.\.effectiveDigitalAllocations\(now\)/);assert.match(api,/available: asset\.status === "active"/)});
check('People directory is not loaded on catalog navigation',()=>assert.match(assetUI,/if \(!assignmentOpen && !includeKeyPools\) return/));
check('Vault metadata browser has categories, cards, and on-demand details',()=>{for(const v of ['cluster-vault-categories','vault-catalog-v29','detailsVisible','Close credential details','reviewsLoaded'])assert.ok(vault.includes(v),v);assert.doesNotMatch(vault,/mounted\.current = true;\s*void loadReviews\(\)/)});
check('Vault catalog never requests secret values',()=>{assert.match(vault,/const visible = records/);assert.match(api,/select: vaultPublicSelect/)});
check('Domains no longer double as a Vault inventory tab',()=>assert.doesNotMatch(entry,/DomainInventoryPanel/));
for(const file of ['packages/renderer/src/features/settings/StudioInventoryVaultPanel.tsx','packages/renderer/src/features/inventory/VaultManager.tsx','packages/renderer/src/features/inventory/InventoryWorkspacePage.tsx','apps/server/src/domains/inventory/studio-inventory-vault-routes.ts']){
 const src=ts.createSourceFile(file,get(file),ts.ScriptTarget.Latest,true,file.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
 check(`${file} parses`,()=>assert.equal(src.parseDiagnostics.length,0));
}
console.log(`${n}/${n} RC29 inventory/vault/icon checks passed`);
