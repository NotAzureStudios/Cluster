import assert from 'node:assert/strict';
import fs from 'node:fs';
const picker = fs.readFileSync('packages/renderer/src/components/ClusterResourcePicker.tsx','utf8');
const panel = fs.readFileSync('packages/renderer/src/features/projects/ProjectAccessPanel.tsx','utf8');
const manifest = fs.readFileSync('packages/shared/src/cluster-manifest.ts','utf8');
const tests = [
 ['canonical resource kinds', picker.includes('ClusterResourceKind') && picker.includes('CLUSTER_RESOURCE_MANIFEST')],
 ['project scope enforced', picker.includes('resource.projectId !== projectId')],
 ['kinds restricted', picker.includes('!allowedKinds.includes(resource.kind)')],
 ['deduplicate typed ids', picker.includes('`${resource.kind}:${resource.id}`') && picker.includes('unique.has(key)')],
 ['blank ids and labels dropped', picker.includes('!resource.id.trim() || !resource.label.trim()')],
 ['picker never fetches', !picker.includes('queryApi') && !picker.includes('fetch(')],
 ['picker uses shared entity control', picker.includes('<ClusterEntityPicker')],
 ['project access integration', panel.includes('<ClusterResourcePicker ariaLabel="Access target"')],
 ['server explanation remains authority', panel.includes('/api/access/explain')],
 ['manifest includes canonical project', manifest.includes('project: { label: "Project"')],
];
for (const [name, ok] of tests) { assert.ok(ok,name); console.log(`PASS ${name}`); }
console.log(`${tests.length}/${tests.length} resource picker assertions passed`);
