// A studio's saved project types are its whole list: built-ins are templates
// that never merge back in, deletions stick, and projects of a deleted type
// keep their template's behaviour.
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = mkdtempSync(path.join(tmpdir(), 'cluster-project-types-'));
const built = buildSync({ entryPoints: [path.join(root, 'packages/shared/src/project-types.ts')], bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent' });
writeFileSync(path.join(out, 'types.mjs'), built.outputFiles[0].text);
const { resolveClusterProjectTypes, resolveClusterProjectType, CLUSTER_PROJECT_TYPE_TEMPLATES, clusterProjectTypeDefinitionSchema } = await import(pathToFileURL(path.join(out, 'types.mjs')).href);
rmSync(out, { recursive: true, force: true });

let n = 0;
const check = (label, fn) => { fn(); n++; console.log('PASS', label); };
const ids = (list) => list.map((item) => item.id);

check('an untouched studio still sees every template', () => assert.equal(resolveClusterProjectTypes(undefined).length, CLUSTER_PROJECT_TYPE_TEMPLATES.length));
check('a saved studio list is used exactly as saved', () => {
  const list = resolveClusterProjectTypes([{ id: 'general', label: 'General', boardColumns: ['To Do'], source: 'studio' }, { id: 'youtube', label: 'YouTube', boardColumns: ['Script', 'Edit'], source: 'studio' }]);
  assert.deepEqual(ids(list), ['general', 'youtube']);
});
check('deleting a template type sticks', () => {
  const list = resolveClusterProjectTypes([{ id: 'video', label: 'Video Production', boardColumns: ['Edit'], source: 'studio' }]);
  assert.deepEqual(ids(list), ['video']);
});
check('an empty saved list still leaves General for project creation', () => {
  assert.deepEqual(ids(resolveClusterProjectTypes([{ id: 'general', label: 'General', boardColumns: ['A'], source: 'studio', enabled: false }])), ['general']);
});
check('a project of a deleted type keeps its template behaviour', () => {
  const type = resolveClusterProjectType('game', [{ id: 'general', label: 'General', boardColumns: ['A'], source: 'studio' }]);
  assert.equal(type.id, 'game');
});
check('older partial lists still merge with the templates', () => {
  const list = resolveClusterProjectTypes([{ id: 'general', label: 'Studio work', boardColumns: ['A'] }]);
  assert.equal(list.length, CLUSTER_PROJECT_TYPE_TEMPLATES.length);
  assert.equal(list.find((item) => item.id === 'general').label, 'Studio work');
});
check('the server schema accepts the studio tag and an icon', () => {
  assert.ok(clusterProjectTypeDefinitionSchema.safeParse({ id: 'x', label: 'X', boardColumns: ['A'], source: 'studio', iconId: 'icon:tabler:rocket' }).success);
});
console.log(`Project type catalog: ${n}/${n} passed`);
