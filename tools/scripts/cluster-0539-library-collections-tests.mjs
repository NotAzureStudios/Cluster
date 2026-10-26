import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { libraryCollectionOffset, libraryCollectionPage, LibraryCollectionPageError } from '../../apps/server/src/domains/library/library-collection-pagination.ts';
const require = createRequire(import.meta.url);
const ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript/lib/typescript.js');
const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const libraryRoutes = read('../../apps/server/src/domains/library/library-9e2-routes.ts');
const libraryUI = read('../../packages/renderer/src/features/library/LibraryWorkspacePage.tsx');
let checks = 0;
function test(name, fn) { fn(); checks += 1; console.log(`PASS ${name}`); }
function transpileTS(source, resolve = () => { throw new Error('Unexpected runtime dependency'); }) {
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  new Function('exports', 'require', js)(exports, resolve);
  return exports;
}
const compiler = transpileTS(read('../../apps/server/src/core/prisma-semantic-query.ts'));
const mediaFilters = transpileTS(read('../../apps/server/src/domains/library/library-media-filters.ts'));
const platform = transpileTS(read('../../apps/server/src/domains/library/library-platform-9e2.ts'), (specifier) => {
  if (specifier === 'node:crypto') return require('node:crypto');
  if (specifier === 'node:path') return require('node:path');
  if (specifier === '@cluster/shared') return { LIBRARY_DATA_FIELDS: [
    { id: 'updatedAt', type: 'datetime', filterable: true },
    { id: 'status', type: 'status', filterable: true },
    { id: 'mimeGroup', type: 'enum', filterable: true },
    { id: 'visibility', type: 'enum', filterable: true },
    { id: 'pinned', type: 'boolean', filterable: true },
    { id: 'title', type: 'text', filterable: true },
    { id: 'parentId', type: 'text', filterable: true },
    { id: 'manualOrder', type: 'number', sortable: true },
  ] };
  if (specifier === '../../core/data-query.js') return { normalizeClusterDataQuery: (value) => ({ ...value, page: { limit: 250 }, sorts: value.sorts || [] }) };
  if (specifier === '../../core/prisma-semantic-query.js') return compiler;
  if (specifier === './library-media-filters.js') return mediaFilters;
  throw new Error(`Unknown dependency ${specifier}`);
});

for (const days of [1, 7, 30, 365]) {
  test(`relative last ${days} days resolves to server execution time`, () => {
    assert.equal(platform.librarySmartCollectionRelativeDays(`last-${days}-days`), days);
    const query = { filters: { logic: 'and', conditions: [{ fieldId: 'updatedAt', operator: 'greater_or_equal', value: `last-${days}-days` }] } };
    const t0 = new Date('2026-10-10T14:00:00.000Z');
    const t1 = new Date('2026-10-12T14:00:00.000Z');
    const a = platform.librarySmartCollectionWhere(query, t0);
    const b = platform.librarySmartCollectionWhere(query, t1);
    assert.equal(a.where.AND[1].AND[0].updatedAt.gte.getTime(), t0.getTime() - days * 86_400_000);
    assert.equal(b.where.AND[1].AND[0].updatedAt.gte.getTime(), t1.getTime() - days * 86_400_000);
    assert.equal(a.query.filters.conditions[0].value, `last-${days}-days`, 'relative rule stays stored, not converted to a fixed timestamp');
  });
}
test('static absolute-date filters retain their semantics', () => {
  const query = { filters: { logic: 'and', conditions: [{ fieldId: 'updatedAt', operator: 'greater_or_equal', value: '2025-01-01T00:00:00.000Z' }] } };
  const compiled = platform.librarySmartCollectionWhere(query);
  assert.equal(compiled.where.AND[1].AND[0].updatedAt.gte.toISOString(), '2025-01-01T00:00:00.000Z');
});
test('relative date syntax only accepts canonical values', () => {
  for (const value of ['last-8-days','last-7d','last-0-days','last-999999-days',{days:7},'2030-01-01']) assert.equal(platform.librarySmartCollectionRelativeDays(value), null);
});
test('relative date operator cannot be repurposed for arbitrary comparisons', () => {
  assert.throws(() => platform.librarySmartCollectionWhere({filters: {logic: 'and', conditions:[{fieldId:'updatedAt',operator:'less_than',value:'last-7-days'}]}}), /greater_or_equal/);
});
test('smart query can combine rolling date with ordinary filters', () => {
  const compiled = platform.librarySmartCollectionWhere({filters:{logic:'and',conditions:[{fieldId:'updatedAt',operator:'greater_or_equal',value:'last-7-days'},{fieldId:'status',operator:'equals',value:'active'}]}});
  assert.equal(compiled.where.AND[1].AND.length, 2);
  assert.equal(compiled.where.AND[1].AND[1].status,'active');
});

test('saved media, visibility and pinned filters are compiled server-side', () => {
  const query = { filters: { logic: 'and', conditions: [
    {fieldId:'mimeGroup',operator:'equals',value:'image'},
    {fieldId:'visibility',operator:'equals',value:'internal'},
    {fieldId:'pinned',operator:'equals',value:true},
  ] }};
  const where = platform.librarySmartCollectionWhere(query).where.AND[1].AND;
  assert.deepEqual(where, [{mimeType:{startsWith:'image/'}},{visibility:'internal'},{pinned:true}]);
});
test('canonical media filters cover image, PDF, text, model and archive', () => {
  assert.deepEqual(mediaFilters.libraryMimeFilter('pdf'),{equals:'application/pdf'});
  assert.ok(mediaFilters.libraryMimeFilter('text').OR.length > 1);
  assert.ok(mediaFilters.libraryMimeFilter('model').extension.in.includes('glb'));
  assert.ok(mediaFilters.libraryMimeFilter('archive').extension.in.includes('zip'));
});
test('UI saves media, visibility and pin filters rather than silently dropping them', () => {
  assert.ok(libraryUI.includes('fieldId: "mimeGroup"'));
  assert.ok(libraryUI.includes('fieldId: "visibility"'));
  assert.ok(libraryUI.includes('fieldId: "pinned"'));
});

test('folder-scoped smart collections keep exact folder identity', () => {
  const query = { filters: {logic:'and', conditions:[{fieldId:'parentId',operator:'equals',value:'folder123'}]}};
  assert.equal(platform.librarySmartCollectionWhere(query).where.AND[1].AND[0].parentId,'folder123');
  assert.ok(libraryUI.includes('fieldId: "parentId", operator: "equals", value: folderId'));
});
test('recursive descendant scopes are saved with an explicit canonical folder identity', () => {
  assert.ok(libraryUI.includes('folderScope: { mode: "descendants", folderId }'));
  assert.ok(libraryUI.includes('Choose a folder to save a recursive Smart Collection'));
});
test('custom ordering supported by smart collections', () => {
  assert.deepEqual(platform.librarySmartCollectionOrderBy({sorts:[{fieldId:'manualOrder',direction:'asc'}]}),[{manualOrder:'asc'}]);
});

test('first collection page preserves exactly limit entries'  , () => {
  const page = libraryCollectionPage(Array.from({length:101}, (_,i)=>i), 0, 100, 3);
  assert.deepEqual(page.entries, Array.from({length:100},(_,i)=>i));
  assert.deepEqual(page.pagination, {cursor:'v3:o100',hasMore:true,limit:100});
});
test('multiple collection pages cover more than the old first-page cap', () => {
  const records = Array.from({length:751},(_,i)=>i);
  const all = [];
  let cursor;
  for (let i = 0; i < 20; i++) {
    const offset = libraryCollectionOffset(cursor, 7);
    const page = libraryCollectionPage(records.slice(offset,offset+101),offset,100,7);
    all.push(...page.entries); cursor = page.pagination.cursor || undefined;
    if (!page.pagination.hasMore) break;
  }
  assert.deepEqual(all,records);
});
test('empty collections give an empty terminal page', () => {
  assert.deepEqual(libraryCollectionPage([],0,100,1).pagination, {cursor:null,hasMore:false,limit:100});
});
test('old revision cursors cannot be replayed after collection updates', () => {
  assert.throws(() => libraryCollectionOffset('v3:o100',4), e => e instanceof LibraryCollectionPageError && e.code==='LIBRARY_COLLECTION_CURSOR_STALE');
});
test('malformed and unbounded cursors are rejected', () => {
  for (const cursor of ['v3:o-1','v3:oNaN','v3:o1000000','v3:o4;DROP','v3:o1x','untrusted','v3:o9007199254740993']) {
    assert.throws(() => libraryCollectionOffset(cursor,3), e => e instanceof LibraryCollectionPageError && e.code==='LIBRARY_COLLECTION_CURSOR_INVALID');
  }
});
test('invalid page limits are rejected', () => {
  for (const limit of [-1,0,251,NaN,1.5]) assert.throws(() => libraryCollectionPage([],0,limit,1), LibraryCollectionPageError);
});
test('API returns server pagination rather than a fixed collection slice', () => {
  assert.ok(libraryRoutes.includes('libraryCollectionOffset(params.cursor, access.collection.revision)'));
  assert.ok(libraryRoutes.includes('skip: offset, take: limit + 1'));
  assert.ok(libraryRoutes.includes('libraryCollectionPage(results, offset, limit, access.collection.revision)'));
  assert.ok(libraryRoutes.includes('filterCollectionItems(request, rows)'));
});
test('smart collection sorting appends stable unique IDs only when missing', () => {
  assert.ok(libraryRoutes.includes('sorts.some((sort) => Object.prototype.hasOwnProperty.call(sort, "id"))'));
});
test('collection mutation actions use revision-bound database updates', () => {
  assert.ok((libraryRoutes.match(/libraryCollection\.updateMany\(\{ where: \{ id: collectionId, archived: false, revision: body\.expectedRevision \}/g) || []).length >= 2);
  assert.ok(libraryUI.includes('method: "DELETE", body: JSON.stringify({ expectedRevision: collection.revision })'));
});
test('UI loads collection pages incrementally and preserves loaded results', () => {
  assert.ok(libraryUI.includes('mergeLibraryItems(existing, result.items || [])'));
  assert.ok(libraryUI.includes('setPagination({ ...result.pagination, loaded: reset ? result.items.length : pagination.loaded + result.items.length })'));
  assert.ok(libraryUI.includes('pagination.cursor ? `&cursor=${encodeURIComponent(pagination.cursor)}`'));
});
test('smart collection UI stores rolling dates instead of fixed save-date snapshots', () => {
  assert.ok(libraryUI.includes('value: `last-${days}-days`'));
  assert.ok(!libraryUI.includes('Date.now() - days * 86_400_000'));
});
console.log(`PASS ${checks}/${checks} Library collection closeout tests`);
