// RC18: cross-module behavior contracts that protect the resource-first UI,
// honest server-side pagination and Vault's independent security review path.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript');}catch{return require(`${execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim()}/typescript`);}})();
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
const files=[
  'apps/server/src/domains/inventory/studio-inventory-vault-routes.ts',
  'packages/renderer/src/features/settings/StudioInventoryVaultPanel.tsx',
  'packages/renderer/src/features/inventory/VaultManager.tsx',
  'packages/renderer/src/features/inventory/InventoryWorkspacePage.tsx',
  'packages/renderer/src/features/admin/ProductionIntegrationAdminPages.tsx',
  'packages/renderer/src/features/admin/ToolDirectoryPanel.tsx',
];
for(const file of files){
  const source=ts.createSourceFile(file,read(file),ts.ScriptTarget.Latest,true,file.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  assert.equal(source.parseDiagnostics.length,0,`${file}: ${source.parseDiagnostics.map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')).join(', ')}`);
}
const server=read(files[0]);
const inventory=read(files[1]);
const vault=read(files[2]);
const shell=read(files[3]);
const repo=read(files[4]);
const directory=read(files[5]);
const css=read('packages/renderer/src/features/inventory/inventory-workspace.css');
assert.match(server,/kind: z\.enum\(\["physical", "equipment", "digital", "license"\]\)\.optional\(\)/);
assert.match(server,/status: z\.enum\(\["active", "retired"\]\)\.optional\(\)/);
assert.match(server,/status: z\.enum\(\["active", "expired", "revoked"\]\)\.optional\(\)/);
assert.match(server,/kind: z\.enum\(\["integration", "password", "license_key", "game_key", "other"\]\)\.optional\(\)/);
assert.match(inventory,/params\.set\("kind", assetKindFilter\)/);
assert.match(inventory,/params\.set\("status", assetStatusFilter\)/);
assert.match(inventory,/\[filter, assetKindFilter, assetStatusFilter\]/);
assert.match(inventory,/assetCreatorOpen && <div className="settings-card-v092 cluster-inventory-creator"/);
assert.ok(inventory.indexOf('assetCreatorOpen && <div')>inventory.indexOf('<section className="studio-systems-editor-v34f">'),'Asset creation must use the full editor width');
assert.match(inventory,/setAssignmentOpen\(false\)/);
assert.match(inventory,/cluster-resource-disclosure" open=\{assignmentOpen\}/);
assert.match(shell,/useState<InventorySection>\(isAdmin \? "assets" : "mine"\)/);
assert.match(vault,/params\.set\("kind", kindFilter\)/);
assert.match(vault,/params\.set\("status", statusFilter\)/);
const metadataLoad=vault.slice(vault.indexOf('  async function load(next:'),vault.indexOf('  useEffect(() => {'));
assert.doesNotMatch(metadataLoad,/rotation-reviews/,'Vault search must not fetch review queue');
assert.match(vault,/async function loadReviews\(\)/);
assert.match(vault,/\[search, statusFilter, kindFilter\]/);
assert.match(vault,/requestId\.current\+\+; reviewsRequestId\.current\+\+/);
assert.match(vault,/document\.visibilityState === "hidden"/);
assert.match(vault,/setRevealed\(null\)/);
assert.match(vault,/confirmCluster\(/);
assert.match(repo,/source-control-repository-toolbar/);
assert.match(repo,/source-control-repository-inspector/);
assert.match(repo,/visibleRepositories\.map/);
assert.match(repo,/aria-pressed=\{selectedRepositoryId === repository\.id\}/);
assert.match(repo,/syncRepository\(selectedRepository\)/);
assert.match(directory,/cluster-tool-hub__categories/);
assert.match(directory,/groupFilter === "all" \|\| tool\.group === groupFilter/);
assert.match(css,/\.cluster-inventory-filters/);
assert.match(css,/\.cluster-vault-toolbar\{grid-template-columns:minmax\(180px/);
assert.ok(JSON.parse(read('config/release-candidate.json')).sequence >= 18, 'RC18 regressions remain active in later candidates');
console.log('RC18 resource workflow contract: JSX parse, server filters, secure Vault search, inventory and repository inspection passed');
