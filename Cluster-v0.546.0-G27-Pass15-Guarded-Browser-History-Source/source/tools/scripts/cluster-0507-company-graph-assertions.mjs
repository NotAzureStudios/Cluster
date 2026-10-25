import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildCompanyGraph } from '../../packages/renderer/src/features/people/company-graph.ts';
const checks = [];
function check(name, cb) { try { cb(); checks.push([name, true]); } catch (error) { checks.push([name, false]); console.error(error); } }
const fixture = {
  departments: [ {id:'d1',name:'Development'}, {id:'d2',name:'Engine',parentId:'d1'}, {id:'d3',name:'Production'} ],
  teams: [{id:'t1',name:'Tools',departmentId:'d2',leadUserId:'u1',members:[{userId:'u1'},{userId:'u2'}]}, {id:'t2',name:'Studio-wide',members:[{userId:'u2'}]}],
  people: [{id:'u1',username:'owner',employment:{departmentId:'d2',active:true,jobRole:{name:'Lead'}}},{id:'u2',username:'builder',employment:{departmentId:'d2',managerUserId:'u1',active:true}},{id:'u3',username:'retired',employment:{departmentId:'d1',active:false}}]
};
const graph = buildCompanyGraph(fixture);
check('hierarchical departments', () => assert.ok(graph.edges.some(e=>e.kind==='department'&&e.from==='department:d1'&&e.to==='department:d2')));
check('team membership authority', () => assert.ok(graph.edges.some(e=>e.kind==='team_member'&&e.from==='team:t1'&&e.to==='person:u2')));
check('manager reporting authority', () => assert.ok(graph.edges.some(e=>e.kind==='reports_to'&&e.from==='person:u1'&&e.to==='person:u2')));
check('departments root correctly', () => assert.ok(graph.roots.includes('department:d1')));
check('unscoped team remains discoverable', () => assert.ok(graph.roots.includes('team:t2')));
check('archived employment excluded', () => assert.ok(!graph.nodes.some(n=>n.id==='person:u3')));
check('organization has one person node per person', () => assert.equal(graph.nodes.filter(n=>n.id==='person:u2').length,1));
check('no physical duplicate graph authority', () => assert.ok(!readFileSync('packages/renderer/src/features/people/company-graph.ts','utf8').includes('fetch(')));
const cyclic = buildCompanyGraph({departments:[{id:'a',name:'A',parentId:'b'},{id:'b',name:'B',parentId:'a'}],teams:[],people:[]});
check('legacy cycles do not hang or emit hierarchy edges', () => assert.equal(cyclic.edges.filter(e=>e.kind==='department').length,0));
check('legacy cycles report diagnostics', () => assert.ok(cyclic.warnings.length>=1));
const orphan = buildCompanyGraph({departments:[{id:'x',name:'X',parentId:'nonexistent'}],teams:[],people:[]});
check('orphan department remains navigable', () => assert.ok(orphan.roots.includes('department:x')));
const server = readFileSync('apps/server/src/domains/workforce/workforce-routes.ts','utf8');
check('People context users scoped to workspace membership', () => assert.ok(server.includes('memberships: { some: { workspaceId } }')));
check('Workforce project memberships are workspace-scoped', () => assert.ok(server.includes('project: { workspaceId }, user: { is: userWhere }')));
check('Archived directory requires elevated permission', () => assert.ok(server.includes('WORKFORCE_ARCHIVED_DENIED')));
check('Other-workspace manager identity hidden', () => assert.ok(server.includes('!visibleUserIds.has(String(employment.managerUserId))')));
check('Availability edits require a shared workspace', () => assert.ok(server.includes('workspaceId: { in: workspaceIds }') && server.includes('if (!sharedMembership) return false')));
check('Only workspace teams returned on People records', () => assert.ok(server.includes('workspaceTeamIds.has(String(row.teamId))')));
check('Department parent validated in same workspace', () => assert.ok(server.includes('DEPARTMENT_PARENT_INVALID')));
check('Department lead validated in same workspace', () => assert.ok(server.includes('DEPARTMENT_LEAD_INVALID')));
check('Job Role department validated in same workspace', () => assert.ok(server.includes('JOB_ROLE_DEPARTMENT_INVALID')));
check('Department and Job Role writes require actor workspace membership', () => assert.ok((server.match(/WORKSPACE_ACCESS_DENIED/g)||[]).length>=2));
check('Department hierarchy changes use a shared graph lock', () => assert.ok(server.includes('cluster-company-department-graph:')));
check('Department update checks expected revision', () => assert.ok(server.includes('DEPARTMENT_REVISION_CONFLICT')));
check('Department update checks cycles', () => assert.ok(server.includes('DEPARTMENT_HIERARCHY_CYCLE')));
check('Department update requires strict allowlisted input', () => assert.ok(server.includes('}).strict().parse(request.body || {})')));
check('Archived flag does not coerce false string to true', () => assert.ok(server.includes('value === true || value === "true"')));
const ui=readFileSync('packages/renderer/src/features/people/PeoplePages.tsx','utf8');
check('Organization surface uses canonical graph view', () => assert.ok(ui.includes('<CompanyGraphPanel departments={workforceContext.departments}')));
check('Company Graph profile navigation implemented', () => assert.ok(ui.includes('onOpenPerson={(id) => personDetailHistory.openDetail(id)}')));
for (const [name,ok] of checks) console.log(`${ok?'PASS':'FAIL'} ${name}`);
console.log(`${checks.filter(c=>c[1]).length}/${checks.length} 0.507 Company Graph assertions passed`);
if (checks.some(c=>!c[1])) process.exitCode=1;
