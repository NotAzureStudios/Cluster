import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

let passed = 0;
function check(value, label) { assert.ok(value, label); passed++; console.log(`PASS ${label}`); }
function read(name) { return readFileSync(name, 'utf8'); }
const routeFile = 'apps/server/src/domains/projects/project-control-routes.ts';
const route = read(routeFile);
const ast = ts.createSourceFile(routeFile, route, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'visibleWorkflowRelationships');
assert.ok(fn, 'canonical relationship visibility filter present');
const compiled = ts.transpileModule(`${fn.getText(ast)}\nmodule.exports = visibleWorkflowRelationships;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const accessed = [];
let active = 0, peak = 0;
const sandbox = { module: { exports: null }, exports: {}, Map, Promise,
  async canReadExistingWorkflowEntity(_deps, _request, project, resource) {
    active++;
    peak = Math.max(peak, active);
    try {
      await Promise.resolve();
      accessed.push(`${project.id}:${resource.kind}:${resource.id}`);
      return !resource.id.startsWith('hidden-') && !resource.id.startsWith('deleted-');
    } finally { active--; }
  },
};
vm.runInNewContext(compiled, sandbox, { filename: routeFile });
const filter = sandbox.module.exports;
const project = { id: 'p1' };
const rows = [
  { id: 'visible', sourceType: 'board', sourceId: 'b1', targetType: 'library', targetId: 'l1' },
  { id: 'hidden-target', sourceType: 'board', sourceId: 'b1', targetType: 'library', targetId: 'hidden-file' },
  { id: 'hidden-source', sourceType: 'library', sourceId: 'hidden-src', targetType: 'board', targetId: 'b2' },
  { id: 'deleted', sourceType: 'board', sourceId: 'b3', targetType: 'library', targetId: 'deleted-file' },
  { id: 'reuse', sourceType: 'board', sourceId: 'b1', targetType: 'library', targetId: 'l1' },
];
const visible = await filter({}, {}, project, rows);
check(visible.map(row=>row.id).join(',') === 'visible,reuse', 'shared filter excludes hidden/deleted endpoints and retains order');
check(accessed.filter(name => name.endsWith(':board:b1')).length === 1, 'shared source read is deduplicated within the request');
const many = Array.from({length: 230}, (_,n)=>({ id: `r${n}`, sourceType:'board', sourceId:`b${n}`, targetType:'library', targetId: n%2?'hidden-l':'l1' }));
const bounded = await filter({}, {}, project, many);
check(bounded.length === 115, 'large relationship lists return only visible rows');
check(peak <= 24, 'relationship evaluation remains bounded to twelve edges and at most two endpoint checks per edge');
check(route.includes('const visibleRelationships = await visibleWorkflowRelationships(deps, request, project, relationships);'), 'Project Control overview invokes authorization on relationships');
const overview = route.slice(route.indexOf('app.get("/api/projects/:projectId/control-center"'),route.indexOf('app.post("/api/projects/:projectId/control-records"'));
check(overview.includes('relationships: visibleRelationships.map(serializeProjectRelationship)'), 'Project Control overview serializes only access-filtered relationships');
check(overview.includes('buildProjectControlSummary(visibleRecords as any, visibleRelationships)'), 'Project Control summary cannot reveal denied relationship counts');
check(!overview.includes('relationships: relationships.map('), 'unfiltered Project Control response removed');
check(overview.includes('reply.header("Cache-Control", "private, no-store")') && route.includes('app.get("/api/projects/:projectId/workflow-graph"'), 'private Project Control response is explicitly non-cacheable');

const linkFile = 'apps/server/src/domains/projects/project-control-link-service.ts';
const linkSource = read(linkFile);
const linkAst = ts.createSourceFile(linkFile, linkSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const enrichment = linkAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'enrichProjectControlRecords');
assert.ok(enrichment, 'canonical Project Control link enrichment present');
const compiledEnrichment = ts.transpileModule(`${enrichment.getText(linkAst)}\nmodule.exports = enrichProjectControlRecords;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
let candidatePeak = 0, candidateActive = 0;
const candidateData = Array.from({ length: 41 }, (_, index) => ({
  type: 'library', id: index % 2 ? `hidden-${index}` : `visible-${index}`,
  title: `Asset ${index}`, progress: 50, status: 'active',
}));
const linkSandbox = { module: { exports: null }, exports: {}, Map, Promise,
  async listProjectControlLinkCandidates() { return candidateData; },
  serializeProjectControlRecord(record) { return { ...record }; },
  parseObject() { return {}; }, closedStatus() { return false; },
};
vm.runInNewContext(compiledEnrichment, linkSandbox, { filename: linkFile });
const enrich = linkSandbox.module.exports;
const linkRecords = [
  { id: 'linked-visible', linkedEntityType: 'library', linkedEntityId: 'visible-0', status: 'open', progress: 0 },
  { id: 'linked-hidden', linkedEntityType: 'library', linkedEntityId: 'hidden-1', status: 'open', progress: 0 },
];
const filtered = await enrich({}, 'p1', linkRecords, async candidate => {
  candidateActive++; candidatePeak = Math.max(candidatePeak, candidateActive);
  await Promise.resolve(); candidateActive--;
  return candidate.id.startsWith('visible-');
});
check(filtered.candidates.length === 21 && filtered.candidates.every(candidate=>candidate.id.startsWith('visible-')), 'Control Center candidate titles are filtered before enrichment');
check(filtered.records[0].linkState === 'synced' && filtered.records[1].linkedEntity === null, 'hidden links never hydrate a private candidate into a Control record');
check(candidatePeak <= 12, 'link candidate permissions are checked in bounded batches');
const unrestricted = await enrich({}, 'p1', linkRecords);
check(unrestricted.candidates.length === 41, 'background reconciliation remains unfiltered when no HTTP actor exists');
check(overview.includes('canWorkflowEntity(deps, request, project, { kind: candidate.type as ClusterWorkSourceKind') && overview.includes('const visibleCandidateKeys'), 'Control Center applies target authorization and redacts hidden linked IDs');
check(overview.includes('records: visibleRecords') && overview.includes('linkCandidates: enriched.candidates'), 'Control Center never returns raw candidate names or linked IDs');

const page = read('packages/renderer/src/features/library/LibraryWorkspacePage.tsx');
const types = read('packages/renderer/src/features/library/library-types.ts');
const panel = read('packages/renderer/src/features/library/LibraryResourceReferencesPanel.tsx');
check(types.includes('"references"'), 'Library inspector reference tab is typed');
check(page.includes('tab === "references" && <LibraryResourceReferencesPanel') && page.includes('item.projectId || item.project?.id || null'), 'Library inspector mounts References tab with current project scope');
check(panel.includes('kind: "library", id: itemId') && panel.includes('depth: "1"') && panel.includes('maxEdges: "100"'), 'Library references use bounded canonical graph route');
check(panel.includes('setGraph(null)') && panel.includes('if (active) setGraph(result)') && panel.includes('return () => { active = false; };'), 'Library references drop stale/cross-item responses');
check(panel.includes('!projectId') && panel.includes('no Project scope'), 'Global Library items do not invent graph access outside a project');
check(panel.includes('names = useMemo(() => new Map((graph?.nodes || [])') && !panel.includes('/api/library?'), 'relationship display names originate from authorized graph response');
check(panel.includes('<WorkActionMenu') && panel.includes('Used by') && panel.includes('References'), 'related objects expose shared Work actions and directional usage');
check(!panel.includes('backlinkCount') && !panel.includes('private-'), 'References UI does not expose unfiltered global backlink count');
console.log(`${passed}/${passed} Project Control privacy and Library References assertions passed`);
