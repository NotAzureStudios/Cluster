#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCalendarMutationGate } from '../../packages/renderer/src/features/calendar/calendar-mutation-gate.ts';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const calendar = readFileSync(resolve(root, 'packages/renderer/src/features/calendar/CalendarPage.tsx'), 'utf8');
let passed = 0;
function check(title, fn) { fn(); passed++; console.log('PASS', title); }
async function checkAsync(title, fn) { await fn(); passed++; console.log('PASS', title); }
function deferred() { let resolve, reject; const promise = new Promise((ok, fail) => { resolve=ok; reject=fail; }); return {promise,resolve,reject}; }

await checkAsync('Two rapid mutations produce only one server operation', async () => {
  const gate = createCalendarMutationGate();
  const action = deferred();
  let requests = 0; const states = []; const results = [];
  const first = gate.run(() => { requests++; return action.promise; }, (result) => results.push(result), () => {}, (busy) => states.push(busy));
  const second = await gate.run(() => { requests++; return Promise.resolve('second'); }, (result) => results.push(result), () => {}, (busy) => states.push(busy));
  assert.equal(second, false);
  assert.equal(requests, 1);
  assert.equal(gate.busy(), true);
  action.resolve('saved');
  assert.equal(await first, true);
  assert.deepEqual(results, ['saved']);
  assert.deepEqual(states, [true, false]);
});
await checkAsync('Failed mutations release gate for retry and only report actual request errors', async () => {
  const gate = createCalendarMutationGate();
  const failures = [], successes = [];
  assert.equal(await gate.run(() => Promise.reject(new Error('denied')), (v) => successes.push(v), (e) => failures.push(e.message), () => {}), false);
  assert.deepEqual(failures, ['denied']);
  assert.equal(gate.busy(), false);
  assert.equal(await gate.run(() => Promise.resolve(42), (v) => successes.push(v), () => {}, () => {}), true);
  assert.deepEqual(successes, [42]);
});
await checkAsync('Unmount invalidates an in-flight response and refuses future writes', async () => {
  const gate = createCalendarMutationGate();
  const operation = deferred(); const results = [], failures = [];
  const pending = gate.run(() => operation.promise, (v) => results.push(v), (e) => failures.push(e), () => {});
  gate.invalidate();
  operation.resolve('after-unmount');
  assert.equal(await pending, false);
  assert.deepEqual(results, []);
  assert.deepEqual(failures, []);
  assert.equal(await gate.run(async () => 'no', () => {}, () => {}, () => {}), false);
});
await checkAsync('Post-commit presentation failure is not treated as a failed server mutation', async () => {
  const gate = createCalendarMutationGate();
  const notices=[];
  const committed=await gate.run(() => Promise.resolve({ id: 'event-1' }), () => { throw Error('refresh failed'); }, (e) => notices.push(e.message), () => {});
  assert.equal(committed, true);
  assert.match(notices.join(' '), /Changes saved/);
});
check('Calendar event detail never opens private cached data without authorization', () => {
  assert.match(calendar, /History and local list items are not authorization evidence/);
  assert.match(calendar, /api<CalendarEvent>\(`\/api\/calendar\/events\/\$\{encodeURIComponent\(id\)\}/);
  assert.doesNotMatch(calendar, /if \(local && !local\.occurrenceStartsAt\)/);
  assert.match(calendar, /request !== detailRequestSequence\.current/);
  assert.match(calendar, /openedOccurrenceRef\.current = null/);
});
check('Calendar range changes mask old event and Timeline snapshots', () => {
  assert.match(calendar, /eventsSnapshotPath === eventsPath \? events : \[\]/);
  assert.match(calendar, /timelineSnapshotPath === timelinePath \? timelineEntries : \[\]/);
  assert.match(calendar, /sequence === eventsRequestSequence\.current\) setStatus/);
  assert.match(calendar, /sequence === timelineRequestSequence\.current\) setStatus/);
});
check('Calendar remounts on identity changes and rejects stale participant reads', () => {
  const app = readFileSync(resolve(root, 'packages/renderer/src/features/application/ClusterApplication.tsx'), 'utf8');
  assert.match(app, /<CalendarPage key=\{activeUser\.id\} projects=\{visibleProjects\}/);
  assert.match(calendar, /sequence !== usersRequestSequence\.current/);
  assert.match(calendar, /usersRequestSequence\.current \+= 1/);
  assert.match(calendar, /queryApi<\{ user: \{ id\?: string \} \| null \}>\("\/api\/me"/);
});
check('Calendar editor mutations share the same immediate single-flight gate', () => {
  assert.match(calendar, /createCalendarMutationGate\(\)/);
  for (const action of ['saveEvent', 'changeOccurrence', 'deleteEvent', 'updateRsvp', 'saveAttendance']) {
    assert.match(calendar, new RegExp(`async function ${action}\\(`));
  }
  assert.equal((calendar.match(/await runMutation\(/g) || []).length, 5);
  assert.match(calendar, /disabled=\{mutationBusy \|\| !title\.trim\(\)/);
  assert.match(calendar, /key=\{`\$\{currentUserId\}:\$\{editing\?\.id/);
});
console.log(`Batch A Calendar reliability: ${passed}/${passed} passed`);
