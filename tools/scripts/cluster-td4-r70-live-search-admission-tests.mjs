/** R70: executable admission fencing against live Search record state. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const ts = (() => { try { return require('typescript'); } catch { return require(path.join(execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim(), 'typescript/lib/typescript.js')); } })();
const sourceFile = 'apps/server/src/domains/search/search-live-admission.ts';
const source = readFileSync(sourceFile, 'utf8');
const translated = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true });
assert.equal(translated.diagnostics?.length || 0, 0);
const mod = { exports: {} };
vm.runInNewContext(translated.outputText, { module: mod, exports: mod.exports, require: id => { throw Error(`Unexpected dependency: ${id}`); }, Date, Map, Set, Error, Promise, String, Boolean, Number, console }, { filename: sourceFile });
const { createSearchLiveAdmission } = mod.exports;
const TIME = '2026-09-15T10:00:00.000Z';
const AFTER = '2026-09-16T10:00:00.000Z';
let count = 0;
async function check(name, fn) { await fn(); count++; console.log('PASS', name); }
function item(kind, id, overrides = {}) {
  return { kind, id, updatedAt: TIME, projectId: 'p1', projectUpdatedAt: TIME, resource: { kind: kind === 'file' ? 'library' : kind, id }, raw: {}, ...overrides };
}
function harness(data = {}) {
  const calls = [];
  const fixture = { project: [{ id: 'p1', archived: false, updatedAt: TIME }], ...data };
  const db = Object.fromEntries(['project','board','card','whiteboard','libraryItem','projectFile','reviewAsset','calendarEvent','timelineItem','projectControlRecord','user','packetDefinition','studioPolicy','cardComment','activityEvent','deliveryBuild','deliveryRelease','deliveryQaPlan','deliveryQaSession'].map((name) => [name, {
    findMany: async ({ where, select }) => {
      calls.push({ name, ids: where.id?.in || where.libraryFolderId?.in, select });
      if (fixture[name] instanceof Error) throw fixture[name];
      return (fixture[name] || []).filter((row) => (where.id?.in || where.libraryFolderId?.in || []).includes(name === 'packetDefinition' ? row.libraryFolderId : row.id));
    },
  }]));
  return { admission: createSearchLiveAdmission(db), calls };
}
await check('unprepared Search result is denied', () => { assert.equal(harness().admission.admit(item('project', 'p1')), false); });
await check('existing matching Project admitted', async () => {
  const h = harness({ project: [{ id: 'p1', archived: false, updatedAt: TIME }] });
  const hit = item('project', 'p1'); await h.admission.prepareBatch([hit]); assert.equal(h.admission.admit(hit), true);
  assert.equal(h.calls.length, 1); assert.deepEqual([...h.calls[0].ids], ['p1']);
});
await check('archived Project denied even if index lists it', async () => {
  const h = harness({ project: [{ id: 'p1', archived: true, updatedAt: TIME }] });
  const hit = item('project', 'p1'); await h.admission.prepareBatch([hit]); assert.equal(h.admission.admit(hit), false);
});
await check('missing Project denied', async () => {
  const h = harness(); const hit = item('project', 'gone'); await h.admission.prepareBatch([hit]); assert.equal(h.admission.admit(hit), false);
});
await check('changed Project title cannot leak older indexed title', async () => {
  const h = harness({ project: [{ id: 'p1', archived: false, updatedAt: AFTER }] });
  const hit = item('project', 'p1'); await h.admission.prepareBatch([hit]); assert.equal(h.admission.admit(hit), false);
});
await check('live adapter uses one bounded batch, not N queries', async () => {
  const h = harness({ project: Array.from({ length: 10 }, (_, i) => ({ id: 'p'+i, archived: false, updatedAt: TIME })) });
  const hits = Array.from({ length: 10 }, (_, i) => item('project', 'p'+i));
  await h.admission.prepareBatch(hits); assert.equal(h.calls.length, 1); assert.equal(h.calls[0].ids.length, 10);
});
await check('oversized batches fail closed', async () => {
  const h = harness(); await assert.rejects(() => h.admission.prepareBatch(Array.from({ length: 13 }, (_, i) => item('project', 'p'+i))), /exceeded/);
});
await check('database read failure rejects Search rather than assuming access', async () => {
  const h = harness({ project: new Error('database offline') }); await assert.rejects(() => h.admission.prepareBatch([item('project','p1')]), /database offline/);
});
await check('board moved to another Project is denied', async () => {
  const h = harness({ board: [{ id: 'b1', projectId: 'p2', archived: false, project: { archived: false }, updatedAt: TIME }] });
  const hit = item('board','b1'); await h.admission.prepareBatch([hit]); assert.equal(h.admission.admit(hit), false);
});
await check('board under archived Project is denied', async () => {
  const h = harness({ board: [{ id: 'b1', projectId: 'p1', archived: false, project: { archived: true }, updatedAt: TIME }] });
  const hit = item('board','b1'); await h.admission.prepareBatch([hit]); assert.equal(h.admission.admit(hit), false);
});
await check('card moved between Boards in one Project is denied', async () => {
  const h = harness({ card: [{ id:'c1', archived:false, workItemKind:'card', updatedAt:TIME, list:{ board:{ id:'b2', projectId:'p1', archived:false, project:{ archived:false } } } }] });
  const hit = item('card','c1',{ boardId:'b1' }); await h.admission.prepareBatch([hit]); assert.equal(h.admission.admit(hit), false);
});
await check('card stays open in its original Board', async () => {
  const h = harness({ card: [{ id:'c1', archived:false, workItemKind:'card', updatedAt:TIME, list:{ board:{ id:'b1', projectId:'p1', archived:false, project:{ archived:false } } } }] });
  const hit = item('card','c1',{ boardId:'b1' }); await h.admission.prepareBatch([hit]); assert.equal(h.admission.admit(hit), true);
});
await check('ticket changed into card loses ticket discovery', async () => {
  const h = harness({ card: [{ id:'c1', archived:false, workItemKind:'card', updatedAt:TIME, list:{ board:{ id:'b1', projectId:'p1', archived:false, project:{ archived:false } } } }] });
  const hit = item('ticket','c1',{ boardId:'b1' }); await h.admission.prepareBatch([hit]); assert.equal(h.admission.admit(hit), false);
});
await check('whiteboard child result hydrates owning Whiteboard', async () => {
  const h = harness({ whiteboard:[{ id:'w1', projectId:'p1', updatedAt:TIME }] });
  const hit = item('whiteboard','w1:node-a',{ whiteboardId:'w1' }); await h.admission.prepareBatch([hit]); assert.equal(h.admission.admit(hit), true);
  assert.deepEqual([...h.calls.find((call)=>call.name==='whiteboard').ids], ['w1']);
});
await check('Library status transition into Trash is denied', async () => {
  const h = harness({ libraryItem:[{ id:'l1', projectId:'p1', status:'trashed', updatedAt:TIME }] });
  const hit = item('file','l1'); await h.admission.prepareBatch([hit]); assert.equal(h.admission.admit(hit), false);
});
await check('Library moved to different Project is denied', async () => {
  const h = harness({ libraryItem:[{ id:'l1', projectId:'p2', status:'active', updatedAt:TIME }] });
  const hit = item('file','l1'); await h.admission.prepareBatch([hit]); assert.equal(h.admission.admit(hit), false);
});
await check('project file matches its distinct source model', async () => {
  const h = harness({ projectFile:[{ id:'f1', projectId:'p1', status:'active', updatedAt:TIME }] });
  const hit = item('file','f1',{ resource:{ kind:'file', id:'f1', projectId:'p1' }}); await h.admission.prepareBatch([hit]); assert.equal(h.admission.admit(hit), true);
  assert.equal(h.calls.some((call)=>call.name==='projectFile'),true);
});
await check('review asset uses the owning review model', async () => {
  const h = harness({ reviewAsset:[{ id:'r1', projectId:'p1', status:'active', updatedAt:TIME }] });
  const hit = item('file','r1',{ resource:{ kind:'review_asset', id:'r1', projectId:'p1' }}); await h.admission.prepareBatch([hit]); assert.equal(h.admission.admit(hit), true);
  assert.equal(h.calls.some((call)=>call.name==='reviewAsset'),true);
});
await check('Calendar visibility/metadata changed since index: deny', async () => {
  const h = harness({ calendarEvent:[{ id:'e1', projectId:'p1', updatedAt:AFTER }] });
  const hit = item('calendar','e1'); await h.admission.prepareBatch([hit]); assert.equal(h.admission.admit(hit), false);
});
await check('global policy archived: deny despite old ranked entry', async () => {
  const h = harness({ studioPolicy:[{ id:'pol', status:'archived', updatedAt:TIME, versions:[{ updatedAt: TIME }] }] });
  const hit = item('policy','pol',{ projectId:null,raw:{ updatedAt:TIME }}); await h.admission.prepareBatch([hit]); assert.equal(h.admission.admit(hit), false);
});
await check('global policy audience changed: deny stale source payload', async () => {
  const h = harness({ studioPolicy:[{ id:'pol', status:'active', updatedAt:AFTER, versions:[{ updatedAt: TIME }] }] });
  const hit = item('policy','pol',{ projectId:null,raw:{ updatedAt:TIME }}); await h.admission.prepareBatch([hit]); assert.equal(h.admission.admit(hit), false);
});
await check('Packet audience revision changed: deny', async () => {
  const h = harness({ packetDefinition:[{ libraryFolderId:'pkt',updatedAt:AFTER,libraryFolder:{status:'active',updatedAt:TIME} }] });
  const hit = item('packet','pkt',{ projectId:null,raw:{libraryFolder:{updatedAt:TIME}} }); await h.admission.prepareBatch([hit]); assert.equal(h.admission.admit(hit), false);
});
await check('Packet source folder changed: deny stale title', async () => {
  const h = harness({ packetDefinition:[{ libraryFolderId:'pkt',updatedAt:TIME,libraryFolder:{status:'active',updatedAt:AFTER} }] });
  const hit = item('packet','pkt',{ projectId:null,raw:{libraryFolder:{updatedAt:TIME}} }); await h.admission.prepareBatch([hit]); assert.equal(h.admission.admit(hit), false);
});
await check('request-local cache does not carry grants into a new Search', async () => {
  const hit = item('project','p1');
  const previous = harness({ project:[{ id:'p1',archived:false,updatedAt:TIME }] });
  await previous.admission.prepareBatch([hit]); assert.equal(previous.admission.admit(hit),true);
  const next = harness({ project:[] }); await next.admission.prepareBatch([hit]); assert.equal(next.admission.admit(hit),false);
});
await check('archived ProjectFile denies despite active status', async () => {
  const h = harness({ projectFile:[{ id:'f1', projectId:'p1', status:'active', archived:true, updatedAt:TIME }] });
  const hit = item('file','f1',{ resource:{kind:'file',id:'f1',projectId:'p1'} });
  await h.admission.prepareBatch([hit]); assert.equal(h.admission.admit(hit),false);
});
await check('archived Build no longer appears in Search', async () => {
  const h = harness({ deliveryBuild:[{ id:'build1',projectId:'p1',archived:true,updatedAt:TIME }] });
  const hit = item('build','build1'); await h.admission.prepareBatch([hit]); assert.equal(h.admission.admit(hit),false);
});
await check('QA Session routed to correct delivery table', async () => {
  const h = harness({ deliveryQaSession:[{ id:'q1',projectId:'p1',archived:false,updatedAt:TIME }] });
  const hit = item('qa','q1',{raw:{deliveryKind:'qa_session'}}); await h.admission.prepareBatch([hit]); assert.equal(h.admission.admit(hit),true);
  assert.equal(h.calls.some((call)=>call.name==='deliveryQaSession'),true);
});
await check('removed Release cannot retain an indexed action', async () => {
  const h = harness(); const hit = item('release','release1'); await h.admission.prepareBatch([hit]); assert.equal(h.admission.admit(hit),false);
});
await check('deleted Comment does not disclose old body text', async () => {
  const h = harness(); const hit = item('comment','cmt1',{cardId:'c1',boardId:'b1',raw:{body:'test comment'}});
  await h.admission.prepareBatch([hit]); assert.equal(h.admission.admit(hit),false);
});
await check('Comment moved to another Board cannot disclose stale placement', async () => {
  const h = harness({cardComment:[{ id:'cmt1',cardId:'c1',createdAt:TIME,body:'test comment',card:{archived:false,list:{board:{id:'b2',projectId:'p1',archived:false,project:{archived:false}}}}}]});
  const hit=item('comment','cmt1',{cardId:'c1',boardId:'b1',raw:{body:'test comment'}}); await h.admission.prepareBatch([hit]); assert.equal(h.admission.admit(hit),false);
});
await check('valid immutable Comment survives admission', async () => {
  const h = harness({cardComment:[{ id:'cmt1',cardId:'c1',createdAt:TIME,body:'test comment',card:{archived:false,list:{board:{id:'b1',projectId:'p1',archived:false,project:{archived:false}}}}}]});
  const hit=item('comment','cmt1',{cardId:'c1',boardId:'b1',raw:{body:'test comment'}}); await h.admission.prepareBatch([hit]); assert.equal(h.admission.admit(hit),true);
});
await check('Activity no longer resolves under a different Project', async () => {
  const h=harness({activityEvent:[{ id:'a1',projectId:'p2',boardId:null,cardId:null,createdAt:TIME,title:'Activity',message:'Old' }]});
  const hit=item('activity','a1',{raw:{title:'Activity',message:'Old'}}); await h.admission.prepareBatch([hit]); assert.equal(h.admission.admit(hit),false);
});
await check('edited immutable-style Comment body is not leaked from an old index', async () => {
  const h=harness({cardComment:[{id:'cm',cardId:'c1',createdAt:TIME,body:'new private text',card:{archived:false,list:{board:{id:'b1',projectId:'p1',archived:false,project:{archived:false}}}}}]});
  const hit=item('comment','cm',{cardId:'c1',boardId:'b1',raw:{body:'old private text'}});
  await h.admission.prepareBatch([hit]); assert.equal(h.admission.admit(hit),false);
});
await check('Activity body mutation without update timestamp is denied', async () => {
  const h=harness({activityEvent:[{id:'act',projectId:'p1',boardId:null,cardId:null,createdAt:TIME,title:'new title',message:'changed'}]});
  const hit=item('activity','act',{raw:{title:'old title',message:'changed'}});
  await h.admission.prepareBatch([hit]); assert.equal(h.admission.admit(hit),false);
});
await check('archiving owning Project immediately hides cached Library children', async () => {
  const h = harness({ project: [{ id:'p1',archived:true,updatedAt:TIME }], libraryItem:[{ id:'l1',projectId:'p1',status:'active',updatedAt:TIME }] });
  const hit=item('file','l1'); await h.admission.prepareBatch([hit]); assert.equal(h.admission.admit(hit),false);
});
await check('renaming Project invalidates indexed child details', async () => {
  const h = harness({ project: [{ id:'p1',archived:false,updatedAt:AFTER }], libraryItem:[{ id:'l1',projectId:'p1',status:'active',updatedAt:TIME }] });
  const hit=item('file','l1'); await h.admission.prepareBatch([hit]); assert.equal(h.admission.admit(hit),false);
});
await check('missing Project stamp denies Project-scoped result rather than guessing', async () => {
  const h=harness({libraryItem:[{id:'l1',projectId:'p1',status:'active',updatedAt:TIME}]});
  const hit=item('file','l1',{projectUpdatedAt:null}); await h.admission.prepareBatch([hit]); assert.equal(h.admission.admit(hit),false);
});
await check('parent Project admission uses one batched lookup for mixed kinds', async () => {
  const h=harness({board:[{id:'b1',projectId:'p1',archived:false,updatedAt:TIME,project:{archived:false}}],libraryItem:[{id:'l1',projectId:'p1',status:'active',updatedAt:TIME}]});
  const hits=[item('board','b1'),item('file','l1')]; await h.admission.prepareBatch(hits);
  assert.equal(h.calls.filter((row)=>row.name==='project').length,1);
  assert.equal(hits.every(hit=>h.admission.admit(hit)),true);
});
const route = readFileSync('apps/server/src/domains/search/search-routes.ts','utf8');
await check('Search route runs live admission before sensitive ACL and result publication', () => {
  assert.match(route,/createSearchLiveAdmission\(deps\.prisma\)/);
  assert.match(route,/liveAdmission\.prepareBatch\(items\)/);
  assert.match(route,/sensitiveAccess\.prepareBatch\(items\)/);
  assert.match(route,/if \(!liveAdmission\.admit\(item\)\) return false/);
  assert.match(route,/canAccessCalendarEvent/);
});
const palette = readFileSync('packages/renderer/src/features/search/CommandPalette.tsx','utf8');
await check('unresolvable Search results never open unrelated Projects', () => {
  assert.match(palette,/if \(!action\) return \[\]/);
  assert.match(palette,/if \(result\.kind === "activity"\)/);
  assert.doesNotMatch(palette,/return result\.projectId \? \(\) => props\.onOpenProject/);
});
await check('offline Project lookup retained without weakening online server authorization', () => {
  assert.match(palette,/\(!networkOnline \? projects : \[\]\)\.map/);
  assert.match(palette,/open && !networkOnline/);
  assert.match(palette,/Local resource matches are unavailable until the server recovers/);
  const hook = readFileSync('packages/renderer/src/features/search/use-local-search-worker.ts','utf8');
  assert.match(hook,/!enabled \|\| typeof Worker === "undefined"/);
  assert.match(hook,/\}, \[enabled\]\);/);
});
console.log(`R70 live admission checks: ${count}/${count} passed`);
