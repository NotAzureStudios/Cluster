// Home grid engine: free placement, push-down on collision, same-size swap,
// snap resize, first-fit add, and explicit packing.
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The model imports the shared manifest and extensionless siblings, so bundle it.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = mkdtempSync(path.join(tmpdir(), 'cluster-home-grid-'));
const built = buildSync({
  stdin: { contents: `export * from "./home-widget-grid"; export * from "./home-widget-model";`, resolveDir: path.join(root, 'packages/renderer/src/features/home-widgets'), loader: 'ts' },
  bundle: true, format: 'esm', platform: 'node', write: false, logLevel: 'silent',
});
writeFileSync(path.join(out, 'model.mjs'), built.outputFiles[0].text);
const {
  HOME_WIDGET_SIZES, addGridItem, firstFit, gridRows, moveGridItem, nearestSize, packGrid, readingOrder, resizeGridItem, sanitizeGrid,
  applyHomeWidgetGovernance, defaultHomeWidgetLayout, normalizeHomeWidgetLayout,
} = await import(pathToFileURL(path.join(out, 'model.mjs')).href);
rmSync(out, { recursive: true, force: true });

let n = 0;
function check(label, fn) { fn(); n++; console.log('PASS', label); }
const rect = (item) => ({ ...item, ...HOME_WIDGET_SIZES[item.size] });
function noOverlap(items) {
  for (const a of items) for (const b of items) {
    if (a === b) continue;
    const r = rect(a), s = rect(b);
    assert.ok(!(r.x < s.x + s.w && s.x < r.x + r.w && r.y < s.y + s.h && s.y < r.y + r.h), `${a.id} overlaps ${b.id}`);
  }
  for (const item of items) assert.ok(item.x >= 0 && item.x + HOME_WIDGET_SIZES[item.size].w <= 12 && item.y >= 0, `${item.id} off grid`);
}
const at = (items, id) => items.find((item) => item.id === id);

const base = [
  { id: 'a', x: 0, y: 0, size: 'medium' },
  { id: 'b', x: 6, y: 0, size: 'large' },
  { id: 'c', x: 0, y: 2, size: 'small' },
  { id: 'd', x: 3, y: 2, size: 'small' },
];

check('footprints are iOS-shaped on 12 columns', () => assert.deepEqual(Object.values(HOME_WIDGET_SIZES).map(({ w, h }) => [w, h]), [[3, 2], [6, 2], [6, 4], [12, 4]]));
check('moving into free space leaves everything else alone', () => {
  const moved = moveGridItem(base, 'c', 0, 6);
  assert.deepEqual(at(moved, 'c'), { id: 'c', x: 0, y: 6, size: 'small' });
  for (const id of ['a', 'b', 'd']) assert.deepEqual(at(moved, id), at(base, id));
});
check('same-size widgets trade places', () => {
  const moved = moveGridItem(base, 'c', 3, 2);
  assert.equal(at(moved, 'c').x, 3); assert.equal(at(moved, 'd').x, 0); assert.equal(at(moved, 'd').y, 2);
});
check('a widget dropped on others pushes them down, never sideways', () => {
  const moved = moveGridItem(base, 'b', 0, 0);
  noOverlap(moved);
  assert.deepEqual([at(moved, 'b').x, at(moved, 'b').y], [0, 0]);
  assert.equal(at(moved, 'a').x, 0); assert.ok(at(moved, 'a').y >= 4);
  assert.equal(at(moved, 'c').x, 0); assert.equal(at(moved, 'd').x, 3);
});
check('moves clamp to the grid', () => {
  const moved = moveGridItem(base, 'a', 40, -5);
  assert.deepEqual([at(moved, 'a').x, at(moved, 'a').y], [6, 0]);
  noOverlap(moved);
});
check('a moved widget keeps the others readable (no overlaps across many random moves)', () => {
  let items = base;
  let seed = 7;
  const rand = (max) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % max; };
  for (let i = 0; i < 400; i++) {
    const target = items[rand(items.length)];
    items = rand(3) === 0 ? resizeGridItem(items, target.id, ['small', 'medium', 'large', 'xlarge'][rand(4)]) : moveGridItem(items, target.id, rand(12), rand(12));
    noOverlap(items);
  }
});
check('resize grows in place and pushes what it covers', () => {
  const grown = resizeGridItem(base, 'c', 'large');
  noOverlap(grown);
  assert.deepEqual([at(grown, 'c').x, at(grown, 'c').y, at(grown, 'c').size], [0, 2, 'large']);
  assert.ok(at(grown, 'd').y >= 6 || at(grown, 'd').x >= 6);
});
check('resize shifts left rather than overhanging', () => {
  const grown = resizeGridItem([{ id: 'x', x: 9, y: 0, size: 'small' }], 'x', 'medium');
  assert.equal(at(grown, 'x').x, 6);
});
check('snap picks the nearest allowed footprint', () => {
  assert.equal(nearestSize(3.2, 2.1, ['small', 'medium', 'large', 'xlarge']), 'small');
  assert.equal(nearestSize(6.4, 1.6, ['small', 'medium', 'large', 'xlarge']), 'medium');
  assert.equal(nearestSize(5.5, 4.4, ['small', 'medium', 'large', 'xlarge']), 'large');
  assert.equal(nearestSize(11, 4, ['small', 'medium', 'large', 'xlarge']), 'xlarge');
  assert.equal(nearestSize(11, 4, ['small', 'medium']), 'medium');
});
check('adding fills the first gap that fits', () => {
  const holey = [{ id: 'a', x: 0, y: 0, size: 'small' }, { id: 'b', x: 6, y: 0, size: 'medium' }];
  assert.deepEqual(firstFit(holey, 'small'), { x: 3, y: 0 });
  assert.deepEqual(at(addGridItem(holey, { id: 'c', size: 'medium' }), 'c'), { id: 'c', x: 0, y: 2, size: 'medium' });
});
check('auto-arrange closes every gap and keeps reading order', () => {
  const scattered = [
    { id: 'a', x: 6, y: 0, size: 'small' },
    { id: 'b', x: 0, y: 5, size: 'medium' },
    { id: 'c', x: 3, y: 9, size: 'small' },
  ];
  const packed = packGrid(scattered);
  noOverlap(packed);
  assert.deepEqual(readingOrder(packed).map((item) => item.id), ['a', 'b', 'c']);
  assert.equal(gridRows(packed), 2);
});
check('stored overlaps are pushed apart on load', () => {
  const clean = sanitizeGrid([{ id: 'a', x: 0, y: 0, size: 'large' }, { id: 'b', x: 2, y: 1, size: 'medium' }]);
  noOverlap(clean);
});
check('default Home has no gaps or overlaps', () => {
  const layout = defaultHomeWidgetLayout();
  noOverlap(layout.items);
  const cells = layout.items.reduce((sum, item) => sum + HOME_WIDGET_SIZES[item.size].w * HOME_WIDGET_SIZES[item.size].h, 0);
  assert.equal(cells, 12 * gridRows(layout.items), 'default layout fills every row');
});
check('a previous-version layout keeps its widgets and order', () => {
  const legacy = { schema: 2, items: [
    { id: 'inbox', enabled: true, order: 1, size: 'standard', column: 1 },
    { id: 'brief', enabled: true, order: 0, size: 'wide', column: 1 },
    { id: 'digest', enabled: true, order: 2, size: 'standard', column: 1 },
    { id: 'clock', enabled: false, order: 3, size: 'micro', column: 1 },
  ] };
  const layout = normalizeHomeWidgetLayout(legacy);
  assert.deepEqual(readingOrder(layout.items).map((item) => item.id), ['brief', 'inbox']);
  noOverlap(layout.items);
});
check('unknown, duplicate and disallowed sizes are cleaned', () => {
  const layout = normalizeHomeWidgetLayout({ schema: 3, items: [
    { id: 'clock', x: 0, y: 0, size: 'xlarge' }, { id: 'clock', x: 3, y: 0, size: 'small' }, { id: 'nope', x: 0, y: 0, size: 'small' },
  ] });
  assert.deepEqual(layout.items.map((item) => [item.id, item.size]), [['clock', 'small']]);
});
check('governance removes hidden widgets and adds required ones in a free slot', () => {
  const layout = { schema: 3, items: [{ id: 'clock', x: 0, y: 0, size: 'small' }, { id: 'note', x: 3, y: 0, size: 'small' }] };
  const governed = applyHomeWidgetGovernance(layout, { required: ['inbox'], unavailable: ['note'], recommended: [] });
  assert.deepEqual(governed.items.map((item) => item.id).sort(), ['clock', 'inbox']);
  noOverlap(governed.items);
});
console.log(`Home grid engine: ${n}/${n} passed`);
