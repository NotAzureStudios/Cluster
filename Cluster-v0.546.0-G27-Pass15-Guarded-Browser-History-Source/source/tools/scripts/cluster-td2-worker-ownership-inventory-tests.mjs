/** Audit-only classification for registered durable handlers.
 * Shared services must not be stopped merely because a related optional tool
 * was disabled; optional-only jobs must explicitly declare an owner. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = path.join(root, 'apps/server/src');
const discovered = new Map();
function visit(dir) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const filename = path.join(dir,d.name);
    if (d.isDirectory()) { visit(filename); continue; }
    if (!filename.endsWith('.ts')) continue;
    const text = fs.readFileSync(filename, 'utf8');
    for (const m of text.matchAll(/\bregister\(\s*["']([\w.-]+)["']/g)) {
      if (!m[1].includes('.')) continue;
      if (discovered.has(m[1])) throw Error(`Duplicate durable handler: ${m[1]}`);
      discovered.set(m[1], path.relative(root,filename));
    }
  }
}
visit(src);
const required = new Set([
  'automation.project-overdue','system.job-history-prune','notifications.digest-scan',
  'notifications.digest-deliver','notifications.escalation-sweep','notifications.retention-prune',
  'studio.onboarding-lifecycle','studio.knowledge-lifecycle','integrations.webhook-deliver',
  'integrations.webhook-recovery','source.repository-sync','source.workflow',
  'integration.discord-delivery','data-export.generate','data-import.apply','system.search-rebuild',
]);
const mixed = new Set(['automation.project-rule','automation.studio-action']);
const owned = new Map([
  ['automation.calendar-scan','calendar'],
  ['library.transfer.finalize','library'],
  ['library.derivative.build','library'],
  ['library.bulk.metadata','library'],
  ['library.hierarchy.move','library'],
  ['library.hierarchy.lifecycle','library'],
  ['library.storage.reconcile','library'],
  ['library.storage.orphan-audit','library'],
]);
const classification = new Map([...Array.from(required, x => [x,'shared']), ...Array.from(mixed,x => [x,'contextual']), ...Array.from(owned,([k,v])=>[k,`owned:${v}`])]);
assert.deepEqual([...discovered.keys()].sort(), [...classification.keys()].sort(),
  'Every durable handler must be explicitly reviewed for shared/contextual/tool-owned lifecycle');
const ownership = fs.readFileSync(path.join(src,'domains/jobs/job-tool-ownership.ts'),'utf8');
for (const [type, owner] of owned) {
  assert.match(ownership, new RegExp(`\\b${owner}: \\[([\\s\\S]*?)\\]`), `Owner must be declared: ${owner}`);
  assert.ok(ownership.includes(`"${type}"`), `Owned job missing from canonical availability policy: ${type}`);
}
const runtime = fs.readFileSync(path.join(src,'app/server-job-runtime.ts'),'utf8');
for (const type of mixed) assert.match(runtime, /verifyContextAvailability: async/, `${type} requires payload-specific gating`);
console.log(`${discovered.size} durable handlers classified: ${required.size} shared, ${mixed.size} contextual, ${owned.size} tool-owned`);
console.log('Shared maintenance remains independent of tool disable; new handlers require explicit ownership review.');
