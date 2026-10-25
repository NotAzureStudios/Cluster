import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClusterActionFlight, createClusterLatestResponse } from '../../packages/renderer/src/components/cluster-action-flight.ts';

const root = resolve(import.meta.dirname, '../..');
const renderer = (file) => readFileSync(resolve(root, `packages/renderer/src/components/${file}`), 'utf8');
const imp = renderer('DataImportBuilder.tsx');
const exp = renderer('DataExportBuilder.tsx');
let count = 0;
const test = async (name, f) => { await f(); count++; console.log(`PASS ${count}: ${name}`); };
await test('Synchronous single-flight gate protects fast reentry across distinct actions', () => {
  const g = createClusterActionFlight();
  assert.equal(g.enter('validate'), true);
  assert.equal(g.enter('apply'), false);
  assert.equal(g.enter('validate'), false);
  assert.equal(g.leave('apply'), false);
  assert.equal(g.leave('validate'), true);
  assert.equal(g.enter('apply'), true);
});
await test('Latest-response owner ignores stale and invalidated requests', () => {
  const epoch = createClusterLatestResponse();
  const first = epoch.next(); const second = epoch.next();
  assert.equal(epoch.isCurrent(first), false); assert.equal(epoch.isCurrent(second), true);
  epoch.invalidate(); assert.equal(epoch.isCurrent(second), false);
});
await test('Export builder protects submission immediately and handles rejections visibly', () => {
  for(const c of ['useClusterActionFlight()', '!begin("export")', 'await onExport(', 'catch (error)', 'finish("export")', 'role="alert"']) assert.ok(exp.includes(c), c);
  assert.ok(!exp.includes('onClick={() => void onExport('));
  assert.ok(exp.includes('if (!isExecuting()) setOpen(false)'));
});
await test('Export builder retains semantic field/sensitivity policies', () => {
  for(const c of ['field.exportable !== false','["standard", "internal"]','visibleFieldIds','selectionCount','format === "xlsx" ? "library" : delivery','fieldIds: [...fieldIds]']) assert.ok(exp.includes(c), c);
});
await test('Import validate/apply mutations share immediate admission gate', () => {
  for(const c of ['!begin("validate")','finish("validate")','!begin("apply")','finish("apply")','!begin("worksheet")','finish("worksheet")']) assert.ok(imp.includes(c), c);
});
await test('Old import file/workbook responses cannot overwrite newer selection', () => {
  for(const c of ['fileGeneration.current.next()','fileGeneration.current.isCurrent(generation)','previewGeneration.current.invalidate()','setSource(null)','setStatus("Reading import file…")']) assert.ok(imp.includes(c), c);
});
await test('Import schema and validation calls are generation-scoped', () => {
  for(const c of ['schemaGeneration.current.next()','schemaGeneration.current.isCurrent(generation)','schemaLoading.current','previewGeneration.current.next()','previewGeneration.current.isCurrent(generation)']) assert.ok(imp.includes(c), c);
});
await test('Changing source, conflict policy or mapping invalidates staged change set', () => {
  assert.match(imp, /function updateColumn[\s\S]*?previewGeneration\.current\.invalidate\(\)/);
  assert.match(imp, /onChange=\{\(event\) => \{ if \(isExecuting\(\)\) return; previewGeneration\.current\.invalidate\(\); setConflictPolicy/);
  assert.match(imp, /async function loadFile[\s\S]*?previewGeneration\.current\.invalidate\(\)/);
});
await test('Pending import prevents editing/click-away without losing evidence UI', () => {
  for(const c of ['const isBusy = busy || Boolean(pending)', 'if (isExecuting()) return', 'disabled={isBusy}', 'preview.stage.fingerprint', 'stageConfirmed', '<DataImportOperationFeedback']) assert.ok(imp.includes(c), c);
});
await test('Roadmap formally separates certification and implementation CD-21', () => {
  const r=readFileSync(resolve(root,'TECH_DEBT_MASTER_ROADMAP.md'),'utf8');
  assert.ok(Number(r.match(/\*\*Revision:\*\*\s*(\d+)/)?.[1] || 0) >= 23, 'Roadmap revision must retain the TD3 closeout milestone');
  assert.ok(r.includes('CD-01–CD-20'));
  assert.ok(r.includes('CD-21 (MOVED OUT; HISTORICAL ONLY)'));
  assert.ok(r.includes('**TD1 — Settings Authority** | **IMPLEMENTATION CLOSED**'));
  assert.ok(r.includes('**TD2 — Tool Runtime** | **CORE IMPLEMENTATION CLOSED**'));
});
console.log(`\n${count}/${count} focused checks passed.`);
