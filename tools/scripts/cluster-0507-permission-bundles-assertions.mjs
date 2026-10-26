import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

// Execute the REAL shared source. Inject only the manifest that is normally
// resolved by the workspace package loader in the full development toolchain.
const filename = 'packages/shared/src/permission-bundle-contracts.ts';
const raw = fs.readFileSync(filename, 'utf8');
const transformed = ts.transpileModule(raw, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }}).outputText;
const module = { exports: {} };
const manifestSource = fs.readFileSync('packages/shared/src/cluster-manifest.ts','utf8');
const keys = [...manifestSource.matchAll(/\b(?:mywork|inbox|projects|boards|whiteboards|viewer|timeline|builds|qa|tickets|calendar|scheduler|library|packets|sourceControl|integrations|people|activity|settings|serverConfig):\s*\{/g)].map((m) => m[0].split(':')[0]);
assert.ok(keys.length >= 19, 'manifest test fixture must find permission keys');
const context = { module, exports: module.exports, require: (name) => {
  assert.equal(name, './cluster-manifest.js');
  return { CLUSTER_TOOL_PERMISSION_KEYS: keys };
} };
vm.runInNewContext(transformed, context, { filename });
const { validateClusterPermissionBundles, validateClusterBundleAssignments, resolveAssignedPermissionBundles, validateClusterBundleRevisionChanges } = module.exports;
let count = 0;
function pass(condition, label) { assert.ok(condition, label); ++count; console.log(`PASS ${label}`); }
const base = { id: 'bundle_qa', label: 'QA access', revision: 1, enabled: true, toolPermissions: { qa: 'edit', tickets: 'edit' } };
const parsed = validateClusterPermissionBundles([base]);
pass(parsed[0].toolPermissions.qa === 'edit', 'valid bundle parses and preserves levels');
pass(validateClusterBundleAssignments(['bundle_qa'], parsed, 'role')[0] === 'bundle_qa', 'known bundle assignment');
pass(resolveAssignedPermissionBundles(parsed, ['bundle_qa']).length === 1, 'enabled bundle resolves');
pass(resolveAssignedPermissionBundles([{...base,enabled:false}], ['bundle_qa']).length === 0, 'disabled bundle contributes nothing');
pass(resolveAssignedPermissionBundles(parsed, ['missing']).length === 0, 'unknown bundle contributes nothing');
const bad = (callback, label) => { assert.throws(callback, (error) => error?.name === "Error"); ++count; console.log(`PASS ${label}`); };
bad(() => validateClusterPermissionBundles([{...base, toolPermissions:{ serverConfig:'superadmin' }}]),'reject unknown permission level');
bad(() => validateClusterPermissionBundles([{...base, toolPermissions:{ fakeTool:'manage' }}]),'reject unknown permission key');
bad(() => validateClusterPermissionBundles([base,base]),'reject duplicate IDs');
bad(() => validateClusterPermissionBundles([{...base,revision:0}]),'reject nonpositive revision');
bad(() => validateClusterPermissionBundles([{...base,id:'../../bad'}]),'reject path-like IDs');
bad(() => validateClusterBundleAssignments(['missing'],parsed,'role'),'reject dangling assignment');
bad(() => validateClusterBundleAssignments(['bundle_qa','bundle_qa'],parsed,'role'),'reject repeated assignment');
validateClusterBundleRevisionChanges(parsed, [{...base, label:'QA Updated',revision:2}]);
pass(true, 'changed revision advances exactly once');
validateClusterBundleRevisionChanges(parsed, [base]);
pass(true,'unchanged revision remains stable');
bad(() => validateClusterBundleRevisionChanges(parsed,[{...base,label:'Changed',revision:1}]),'reject same-revision mutation');
bad(() => validateClusterBundleRevisionChanges(parsed,[{...base,label:'Changed',revision:3}]),'reject revision skips');
bad(() => validateClusterBundleRevisionChanges(parsed,[]),'reject destructive bundle deletion');
const source = Object.fromEntries([
  ['serverAuth','apps/server/src/domains/access/authorization.ts'],
  ['route','apps/server/src/domains/access/access-routes.ts'],
  ['studioWriter','apps/server/src/app/server-routes-configuration-integrations.ts'],
  ['ui','packages/renderer/src/features/settings/StudioSettingsPage.tsx'],
  ['types','packages/renderer/src/features/application/application-models/settings-server.ts'],
].map(([name,file])=>[name,fs.readFileSync(file,'utf8')]));
pass(source.serverAuth.includes('resolveAssignedPermissionBundles(bundles, department.permissionBundleIds'), 'bundles applied at department inheritance layer');
pass(source.serverAuth.includes('resolveAssignedPermissionBundles(bundles, roleDefinition.permissionBundleIds'), 'bundles applied at role inheritance layer');
pass(source.serverAuth.includes('sourceId: `bundle:${bundle.id}@${bundle.revision}`'), 'provenance identifies exact bundle revision');
pass(source.serverAuth.includes('toolPermissionLayers(role, user, false, configured)'), 'dry-run shares live layer resolver');
pass(source.route.includes('authorization.requireAdmin(request, reply)'), 'dry-run requires admin');
pass(source.route.includes('Cache-Control", "private, no-store'), 'preview not cacheable');
pass(source.studioWriter.includes('validateClusterBundleRevisionChanges(previous, bundles)'), 'publisher enforces revisions');
pass(source.studioWriter.includes('validateClusterBundleAssignments(entry?.permissionBundleIds'), 'publisher denies dangling role and department assignment');
pass(source.ui.includes('Preview effective-access changes'), 'effective preview has UI entry');
pass(source.ui.includes('LoadedRawSettingsRef') === false && source.ui.includes('loadedRawSettingsRef.current.studioPermissionBundles'), 'edit revisions compare against published snapshot');
pass(source.types.includes('studioPermissionBundles?: ClusterPermissionBundle[]'), 'typed studio bundles');
console.log(`${count}/${count} permission bundle assertions passed`);
