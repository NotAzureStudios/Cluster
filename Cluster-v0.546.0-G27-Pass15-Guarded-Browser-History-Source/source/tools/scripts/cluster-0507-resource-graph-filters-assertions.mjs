import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

let passed = 0;
const check = (condition, description) => { assert.ok(condition, description); passed++; console.log(`PASS ${description}`); };
const metadata = {
  relates_to: { category: 'general' },
  references: { category: 'reference' },
  blocks: { category: 'dependency', blocking: true },
  depends_on: { category: 'dependency', blocking: true },
  delivers: { category: 'delivery' },
  owned_by: { category: 'ownership' },
};
const categories = ['general', 'dependency', 'hierarchy', 'delivery', 'reference', 'ownership', 'quality'];
const path = 'apps/server/src/domains/work/resource-graph-service.ts';
const output = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const mod = { exports: {} };
vm.runInNewContext(output, {
  module: mod, exports: mod.exports, require(id) { assert.equal(id, '@cluster/shared'); return {
    CLUSTER_WORKFLOW_RELATIONSHIP_META: metadata,
    CLUSTER_RESOURCE_GRAPH_CATEGORIES: categories,
    clusterResourceKindFromEntityType(type) { return ['project','board','library','control','card'].includes(type) ? type : null; },
    clusterResourceDefinition(type) { return { projectScoped: type !== 'project' }; },
  }; }, Date, Set, Map, Promise, console,
}, { filename: path });
const rows = [
  ['a','project','p1','board','b1','references',false],
  ['b','board','b1','control','c1','blocks',true],
  ['c','control','c1','library','l1','delivers',false],
  ['d','project','p1','library','private-l2','references',true],
  ['e','board','b1','library','private-l3','blocks',true],
  ['f','project','p2','board','wrong','blocks',true],
].map(([id,sourceType,sourceId,targetType,targetId,relationship,critical])=>({id,projectId:id==='f'?'p2':'p1',sourceType,sourceId,targetType,targetId,relationship,critical,description:null,createdAt:'2026-10-08'}));
const requests = [];
const prisma = { projectRelationship: { async findMany({where,orderBy,skip,take}) {
  requests.push({where,orderBy,skip,take});
  assert.ok(take <= 250 && skip <= 3000, 'bounded graph read');
  return rows.filter(row=> row.projectId===where.projectId && (!where.relationship || where.relationship.in.includes(row.relationship)) && (where.critical !== true || row.critical) && where.OR.some(clause => Object.entries(clause).every(([k,v])=>row[k]===v))).sort((a,b)=> Number(b.critical)-Number(a.critical) || String(b.createdAt).localeCompare(String(a.createdAt)) || a.id.localeCompare(b.id)).slice(skip,skip+take);
} } };
const graph = mod.exports.createResourceGraphService(prisma);
const subject = {kind:'project',id:'p1'};
const query = (changes={}) => ({subject,projectId:'p1',direction:'both',depth:3,maxEdges:20,...changes});
const visible = {allowResource: async r=> !r.id.startsWith('private-')};
const full = await graph.neighborhood(query(),visible);
check(full.edges.length===3 && !full.edges.some(e=>e.id==='d'||e.id==='e'||e.projectId==='p2'), 'graph omits both denied endpoints and cross-project relationships');
check(full.nodes.length===4 && full.nodes.every(n=>!n.resource.id.startsWith('private-')), 'graph returns only authorized nodes');
check(full.nodes.find(n=>n.resource.id==='l1')?.depth===3, 'bounded breadth-first traversal assigns correct visible depth');
const incoming = await graph.neighborhood(query({subject:{kind:'control',id:'c1',projectId:'p1'},direction:'incoming',depth:1}),visible);
check(incoming.edges.map(e=>e.id).join(',')==='b','incoming traversal returns only inbound relationships');
const references = await graph.neighborhood(query({category:'reference'}),visible);
check(references.edges.map(e=>e.id).join(',')==='a','category filter restricts traversal at the database layer');
check(requests.some(req=>req.where.relationship?.in.join(',')==='references'),'database receives relationship category filter before scanning');
const critical = await graph.neighborhood(query({criticalOnly:true}),visible);
check(critical.edges.length===0 && requests.some(req=>req.where.critical===true), 'critical-only filter is pushed to SQL and respects graph reachability');
const blocked = await graph.neighborhood(query({subject:{kind:'board',id:'b1',projectId:'p1'},blockingOnly:true}),visible);
check(blocked.edges.map(e=>e.id).join(',')==='b','blocking-only filters use canonical relationship metadata');
const impossibleBefore = requests.length;
const impossible = await graph.neighborhood(query({category:'quality',blockingOnly:true}),visible);
check(impossible.edges.length===0 && impossible.nodes.length===1 && requests.length===impossibleBefore,'empty filter intersection skips database scan');
const deniedBefore=requests.length;
const denied = await graph.neighborhood(query({subject:{kind:'library',id:'private-l2',projectId:'p1'}}),visible);
check(denied.nodes.length===0 && denied.edges.length===0 && requests.length===deniedBefore,'denied subjects fail closed before database access');
await assert.rejects(graph.neighborhood(query({subject:{kind:'board',id:'b1',projectId:'p2'}}),visible),/scope conflicts/);
check(true,'subject must match requested project');
await assert.rejects(graph.neighborhood(query({category:'surprise'}),visible),/Invalid resource graph category/);
check(true,'invalid category is rejected, never treated as unfiltered discovery');
const filtered = await graph.neighborhood(query({subject:{kind:'board',id:'b1',projectId:'p1'},category:'dependency',criticalOnly:true,depth:2}),visible);
check(filtered.edges.length===1 && filtered.edges[0].id==='b','category and severity filters compose without exposing unrelated edges');
const route = readFileSync('apps/server/src/domains/projects/project-control-routes.ts','utf8');
const panel = readFileSync('packages/renderer/src/features/projects/ProjectWorkflowGraphPanel.tsx','utf8');
check(route.includes('z.enum(CLUSTER_RESOURCE_GRAPH_CATEGORIES)') && route.includes('criticalOnly: query.criticalOnly') && route.includes('blockingOnly: query.blockingOnly'),'route validates and forwards graph filters');
check(panel.includes('useAuthorizedProjectResources') && panel.includes('ClusterResourcePicker') && panel.includes('picker.nextCursor'),'graph focus reuses server-authorized discovery with continuation');
check(panel.includes('setGraph(null)') && panel.includes('Result limited by traversal budget'),'viewer clears stale graph and avoids fake truncation counts');
check(panel.includes('edgeCounts.get(') && !panel.includes('const connected = (graph.edges || []).filter('),'visible graph degrees computed once, not at every rendered node');
const viewerGraph = await graph.neighborhood(query({subject:{kind:'board',id:'b1',projectId:'p1'},depth:2,maxEdges:1}),visible);
check(viewerGraph.edges.length===1 && viewerGraph.truncated,'edge cap is enforced even with concurrent ACL batches');
let inFlight=0, peak=0, seen=0;
const slowVisibility={allowResource: async resource=>{ inFlight++;peak=Math.max(peak,inFlight);await Promise.resolve();seen++;inFlight--;return resource.id!=='private-l2' && resource.id!=='private-l3'; }};
const concurrent = await graph.neighborhood(query(),slowVisibility);
check(peak<=16 && peak>1 && seen<=concurrent.nodes.length+2, 'ACL work uses bounded concurrency with per-node promise caching');
const graphRouteRead = readFileSync('apps/server/src/domains/projects/project-control-routes.ts','utf8');
check(graphRouteRead.indexOf('const neighborhood = await resourceGraph.neighborhood(')<graphRouteRead.indexOf('const labels = await hydrateProjectWorkflowSources('),'workflow names resolve only after authorization-filtered graph traversal');
check(graphRouteRead.includes('neighborhood.nodes.map((node) => node.resource as ClusterWorkSource)'), 'label hydrator receives only visible graph nodes, not raw database relationships');
console.log(`${passed}/${passed} graph discovery, filtering and privacy assertions passed`);
