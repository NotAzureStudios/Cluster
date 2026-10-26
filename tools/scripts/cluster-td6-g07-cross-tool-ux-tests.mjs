import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
const root = resolve(import.meta.dirname, '../..');
const require = createRequire(import.meta.url);
const ts = require('typescript');
const text = file => readFileSync(join(root, file), 'utf8');
const load = (file, imports) => {
  const code = ts.transpileModule(text(file), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(code, { module: mod, exports: mod.exports, require: name => { if (name in imports) return imports[name]; throw Error(`Unexpected import: ${name}`); }, Date, Math, JSON, Map, Set, Promise, Number, String, Error }, { filename: file });
  return mod.exports;
};
const stored = new Map();
let authorized = true;
let failedAudience = false;
const recipients = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
const audienceService = load('apps/server/src/domains/access/studio-audience.ts', {
  '@cluster/shared': { studioAudienceSchema: { parse: value => value } },
});
const inputSchema = { parse: value => {
  if (!value || typeof value.title !== 'string' || !value.title.trim() || typeof value.body !== 'string' || !value.body.trim()) throw Error('invalid announcement');
  if (!Number.isInteger(value.revision) || value.revision < 1) throw Error('invalid revision');
  return value;
} };
const studio = load('apps/server/src/domains/studio-systems/studio-workflow-routes.ts', {
  '@cluster/shared': {
    studioAnnouncementDraftEditSchema: inputSchema,
    studioAnnouncementAudiencePreviewSchema: { parse: value => { if (!value?.audience) throw Error('Missing audience'); return value; } },
    studioAnnouncementCreateSchema: { parse: value => value }, studioAnnouncementScheduleSchema: { parse: value => value },
    publicApplicationSubmissionSchema: { parse: value => value }, studioApplicationConversionSchema: { parse: value => value },
    studioApplicationListQuerySchema: { parse: value => value }, studioApplicationReviewSchema: { parse: value => value },
    projectVisibleStudioFormAnswers: () => ({})
  },
  'zod': { z: { object: () => ({ parse: input => input }), string: () => ({ min() { return this; }, max() { return this; } }) } },
  '../../core/cursor-pagination.js': { buildCursorPage: () => ({}), cursorWhere: () => null, decodeCursor: () => null },
  '../access/studio-audience.js': {
    parseStudioAudience: value => typeof value === 'string' ? JSON.parse(value) : value,
    parseStudioJson: () => ({}), resolveStudioAudienceUserIds: audienceService.resolveStudioAudienceUserIds,
    studioAudienceMatchesUser: async () => true, loadStudioAudienceUserContext: async () => ({}), studioAudienceMatchesContext: () => true,
  },
  './studio-form-runtime.js': { applicationRespondentMetadata: () => ({}), serializeStudioForm: () => ({}), serializeStudioFormVersion: () => ({}), validateStudioFormAnswers: () => ({ ok: true }) },
  './studio-onboarding-runtime.js': { createStudioOnboardingAssignment: async () => ({}) },
  '../workforce/workforce-normalization.js': { syncUserWorkforceAuthorities: async () => ({}) },
    '../../core/security-audit-store.js': { appendSecurityAuditEvent: async () => ({}) },
  './studio-announcement-create-intents.js':{announcementCreateDigest:()=> 'test-digest',isAnnouncementCreateUniqueConflict:(e)=>e?.code==='P2002'},
    './studio-application-profile.js': { buildApplicationProfile: () => ({}), ApplicationMappingError: class extends Error {} },
'./studio-application-revisions.js': { applicationReviewWhere: () => ({}), applicationConversionWhere: () => ({}) },
  './studio-announcement-delivery.js': { createStudioAnnouncementDelivery: () => ({ publish: async () => ({ outcome: 'not_ready' }) }) },
});
const handlers = new Map();
const app = Object.fromEntries(['get', 'post', 'put', 'patch', 'delete'].map(method => [method, (path, handler) => handlers.set(`${method.toUpperCase()} ${path}`, handler)]));
const db = {
  studioAnnouncement: {
    findUnique: async ({ where }) => stored.get(where.id) ?? null,
    updateMany: async ({ where, data }) => {
      const record = stored.get(where.id);
      if (!record || record.revision !== where.revision) return { count: 0 };
      if (!where.OR.some(condition => record.status === condition.status && (!condition.scheduledAt || new Date(record.scheduledAt).getTime() > new Date(condition.scheduledAt.gt).getTime()))) return { count: 0 };
      stored.set(record.id, { ...record, ...data, revision: record.revision + 1 });
      return { count: 1 };
    },
  },
  user: { findMany: async ({ where }) => {
    if (failedAudience) throw Error('Audience query failed');
    assert.ok(where.accountState.notIn.includes('DISABLED'));
    return recipients;
  } },
};
studio.registerStudioWorkflowRoutes({ app, prisma: db, authorization: { requireTool: async () => authorized }, events: {} });
const reply = () => ({ status: 200, code(n) { this.status = n; return this; }, send(data) { return { ...data, _status: this.status }; } });
const preview = body => handlers.get('POST /api/studio-systems/announcements/audience-preview')({ body }, reply());
const edit = (id, body) => handlers.get('PUT /api/studio-systems/announcements/:announcementId/draft')({ params: { announcementId: id }, body }, reply());
const base = (id, status = 'draft', scheduledAt = null) => ({ id, status, scheduledAt, revision: 1, title: 'Old title', body: 'Old content', audienceJson: JSON.stringify({ mode: 'all', targets: [] }), priority: 'normal', requiresAcknowledgement: false, discordDeliveryRequested: false });
const data = (revision = 1, title = 'New title') => ({ revision, title, body: 'Updated body', audience: { mode: 'all', targets: [] }, priority: 'urgent', requiresAcknowledgement: true, discordDeliveryRequested: false });
let checks = 0;
async function check(title, fn) { await fn(); checks++; console.log('PASS', title); }
await check('advisory preview counts only currently eligible users without disclosing identities', async () => {
  const result = await preview({ audience: { mode: 'all', targets: [] } });
  assert.equal(result.eligibleNow, 3); assert.equal(result.advisory, true); assert.equal(result.limit, 5000);
  assert.ok(!JSON.stringify(result).includes('"id"'));
});
await check('preview failures are fail-closed; no silent all-users fallback', async () => {
  failedAudience = true; await assert.rejects(preview({ audience: { mode: 'all', targets: [] } }), /Audience query failed/); failedAudience = false;
});
await check('denied administrator cannot preview or edit', async () => {
  authorized = false; assert.equal(await preview({ audience: { mode: 'all', targets: [] } }), undefined); assert.equal(await edit('draft', data()), undefined); authorized = true;
});
await check('successful draft content edit increments shared revision and preserves schedule', async () => {
  stored.set('draft', base('draft'));
  const result = await edit('draft', data()); assert.equal(result.ok, true);
  assert.equal(stored.get('draft').title, 'New title'); assert.equal(stored.get('draft').revision, 2);
  assert.equal(stored.get('draft').status, 'draft'); assert.equal(stored.get('draft').priority, 'urgent');
});
await check('stale second write cannot overwrite a completed edit', async () => {
  const result = await edit('draft', data(1, 'Stale overwrite')); assert.equal(result.code, 'ANNOUNCEMENT_DRAFT_STALE');
  assert.equal(result._status, 409); assert.equal(stored.get('draft').title, 'New title');
});
await check('future scheduled content edits without rescheduling', async () => {
  const date = new Date(Date.now() + 86_400_000);
  stored.set('future', base('future', 'scheduled', date));
  const result = await edit('future', data()); assert.equal(result.ok, true); assert.equal(stored.get('future').scheduledAt, date);
});
await check('imminent schedule blocks edits', async () => {
  stored.set('imminent', base('imminent', 'scheduled', new Date(Date.now() + 30_000)));
  assert.equal((await edit('imminent', data())).code, 'ANNOUNCEMENT_DRAFT_STALE');
});
await check('published content is immutable', async () => {
  stored.set('published', base('published', 'published'));
  assert.equal((await edit('published', data())).code, 'ANNOUNCEMENT_DRAFT_STALE');
});
await check('invalid edits do not mutate existing row', async () => {
  await assert.rejects(edit('draft', { ...data(2), title: '' }), /invalid announcement/);
  assert.equal(stored.get('draft').revision, 2);
});
await check('old schedule and publication flows remain present', () => {
  assert.ok(handlers.has('PUT /api/studio-systems/announcements/:announcementId/schedule'));
  assert.ok(handlers.has('POST /api/studio-systems/announcements/:announcementId/publish'));
});
await check('admin UI exposes create, edit, preview, schedule and reporting', () => {
  const ui = text('packages/renderer/src/features/settings/StudioAnnouncementsPanel.tsx');
  for (const phrase of ['Edit content & audience', 'Save changes', 'Preview eligible audience', 'Duplicate as draft', 'Cancel schedule', 'Refresh report', 'Schedule announcement']) assert.ok(ui.includes(phrase), phrase);
});
await check('shared Search and workspace action registry offer canonical Copy ID', () => {
  assert.ok(text('packages/shared/src/workflow-contracts.ts').includes('"copy_id"'));
  assert.ok(text('packages/renderer/src/features/workflow/WorkActionMenu.tsx').includes('copyWorkId(context)'));
  assert.ok(text('packages/renderer/src/features/search/CommandPalette.tsx').includes('copyWorkId(activeWorkContext)'));
  const work = text('packages/renderer/src/features/workflow/work-actions.ts');
  assert.match(work, /copyClusterText\(id\)/);
});
console.log(`G07 cross-tool UX: ${checks}/${checks} checks passed`);
