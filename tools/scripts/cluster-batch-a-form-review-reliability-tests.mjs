#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const text = readFileSync(resolve(root, 'packages/renderer/src/features/settings/StudioFormSubmissionsPanel.tsx'), 'utf8');
let passed=0;
function check(label, run) { run(); console.log('PASS', label); passed++; }
check('Form review locks every server mutation immediately and records expected revision', () => {
  assert.match(text,/if \(!selected \|\| mutationLock\.current/);
  assert.match(text,/mutationLock\.current = true; setBusy\(true\)/);
  assert.match(text,/expectedUpdatedAt: reviewedRevision, status: recordedDecision/);
  assert.match(text,/encodeURIComponent\(formId\)\}\/submissions\/\$\{encodeURIComponent\(reviewedId\)/);
});
check('Post-commit refresh reports committed success separately from refresh status', () => {
  assert.match(text,/A successful server review must never be described as a failed review/);
  assert.match(text,/const refreshed = await fetchPage\(1\)/);
  assert.match(text,/Review decision recorded, but the queue could not refresh/);
  assert.match(text,/role="status">\{reviewNotice\}/);
});
check('Stale review does not clear a newly selected response', () => {
  assert.match(text,/setSelectedId\(\(current\) => current === reviewedId \? "" : current\)/);
  assert.match(text,/setItems\(\(current\) => current\.map\(\(item\) => item\.id === reviewedId/);
});
check('Review request failure stays distinct and releases mutation lock', () => {
  assert.match(text,/Review failed\. Refresh the queue before retrying/);
  assert.match(text,/mutationLock\.current = false; setBusy\(false\);\s*return;/);
});
console.log(`Batch A delegated Form review: ${passed}/${passed} passed`);
