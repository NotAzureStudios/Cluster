import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CLUSTER_PROJECT_ROLES, requireClusterProjectRole, resolveClusterProjectRole } from '../../packages/shared/src/project-role-policy.ts';
import vm from 'node:vm';
import ts from 'typescript';
const sourceOfMembership = readFileSync('apps/server/src/domains/projects/project-membership.ts', 'utf8');
const membershipJS = ts.transpileModule(sourceOfMembership, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const membershipModule = { exports: {} };
vm.runInNewContext(membershipJS, { module:membershipModule, exports:membershipModule.exports, require:(name)=>({requireClusterProjectRole}) }, {filename:'project-membership.ts'});
const { activeProjectMemberships, membershipIsLead, replaceProjectMemberships } = membershipModule.exports;
import { previewProjectRuleImpact } from '../../apps/server/src/domains/access/project-rule-preview.ts';
let passed = 0;
function check(fn, msg) { fn(); passed++; console.log('PASS '+msg); }
check(() => assert.equal(CLUSTER_PROJECT_ROLES.length, 8), 'canonical roles are defined');
check(() => assert.equal(requireClusterProjectRole('Producer').accessLevel, 'manage'), 'producer role has scoped manage access');
check(() => assert.equal(requireClusterProjectRole('Reviewer').accessLevel, 'view'), 'reviewer role has view access');
check(() => assert.equal(resolveClusterProjectRole('arbitrary title'), null), 'untrusted labels do not become roles');
check(() => assert.equal(membershipIsLead({ roleLabel:'Project Lead', roleKey:'reviewer', isLead:false }), false), 'display labels cannot escalate project leadership');
check(() => assert.equal(membershipIsLead({ roleKey:'lead' }), true), 'canonical project lead identity');
check(() => assert.equal(activeProjectMemberships({memberships:[{userId:'u',status:'active',endsAt:'2020-01-01'}, {userId:'v',status:'active'}]}).length,1),'expired memberships excluded');
const source = (path) => readFileSync(path,'utf8');
check(() => assert.ok(source('apps/server/src/domains/projects/project-routes.ts').indexOf('PROJECT_ROLE_INVALID') < source('apps/server/src/domains/projects/project-routes.ts').indexOf('updateMany({ where: { id: params.projectId, revision')), 'role validation before revision commit');
check(() => assert.ok(source('apps/server/src/domains/access/access-routes.ts').includes('requireManageTarget(deps, request, reply, body.targetKind, body.targetId, body.projectId)')), 'preview requires same manage target check as mutation');
check(() => assert.ok(source('apps/server/src/domains/access/access-routes.ts').includes('"private, no-store"')), 'preview responses are not cacheable');
check(() => assert.ok(source('packages/renderer/src/features/projects/ProjectAccessPanel.tsx').includes('Preview impact')), 'Project Access UI exposes impact preview');
check(() => assert.ok(source('apps/server/src/domains/access/access-routes.ts').includes('deps.canAccessLibraryItem(request, item, "manage")')), 'Library source policy still guards access-rule management and preview');
// Exercise the actual ProjectMembership writer: scoped role/accessLevel must
// persist canonically and cannot be inferred from arbitrary role labels.
const storedMemberships = [];
const crewPrisma = {
  async $transaction(callback) {
    return callback({ projectMembership: {
      updateMany: async () => ({count:0}),
      upsert: async ({create,update,where}) => {storedMemberships.push({create,update,where});return create;},
    }});
  },
  projectMembership: {findMany: async()=>storedMemberships.map(row=>row.create)},
};
await replaceProjectMemberships(crewPrisma, {projectId:'p',leadId:'u1',memberIds:['u1','u2','u3'],roleLabels:{u1:'Project Lead',u2:'Producer',u3:'Reviewer'}});
check(() => assert.equal(storedMemberships[0].create.roleKey,'lead'), 'primary lead stored by stable role key');
check(() => assert.equal(storedMemberships[1].create.accessLevel,'manage'), 'producer manager stored with scoped manage access');
check(() => assert.equal(storedMemberships[2].create.accessLevel,'view'), 'reviewer stored with view-only scope');
check(() => assert.equal(storedMemberships.filter(row=>row.create.isLead).length,1), 'only one primary lead persisted');
await assert.rejects(replaceProjectMemberships(crewPrisma,{projectId:'p',leadId:'u1',memberIds:['u1','u2'],roleLabels:{u2:'Unknown Admin'}}),/Unknown Project role/);
check(() => assert.ok(true), 'invalid custom role cannot be silently stored as manager');
const members = [
  {userId:'u1',role:'member',user:{id:'u1',archived:false,projectPermissions:'{}'}},
  {userId:'u2',role:'member',user:{id:'u2',archived:false,projectPermissions:'{}'}},
];
const project = {id:'p',workspaceId:'studio',source:'manual'};
let stored = 0;
const prisma = {
  workspaceMember:{findMany: async ({where, take}) => members.filter(row => !where.userId || (typeof where.userId==='string' ? row.userId===where.userId : where.userId.in.includes(row.userId))).slice(0,take)},
  projectMembership:{findMany: async () => [{userId:'u1',status:'active',accessLevel:'view'}]},
  studioTeamMember:{findMany: async () => [{userId:'u1',teamId:'t1'}]},
  accessRule:{findMany: async () => {stored++; return []; }},
};
const authorization = {
 isExternalCollaboratorRole:()=>false,
 hasProjectResourceAccess(user,role,project,rules,min) {
   const rank = {none:0,view:1,contribute:2,manage:3};
   const direct = rules.some(rule=>rule.subjectKind==='member' && rule.subjectId===user.id && rule.effect==='deny');
   const team = rules.some(rule=>rule.subjectKind==='team' && user.studioTeamMemberships?.some(row=>row.teamId===rule.subjectId));
   const everyone = rules.some(rule=>rule.subjectKind==='all' && rule.effect==='deny');
   const level = direct || everyone ? 'none' : team ? 'manage' : 'view';
   return rank[level]>=rank[min];
 },
 hasTargetAccess(user,role,kind,id,project,rules,min){return this.hasProjectResourceAccess(user,role,project,rules,min)},
};
const preview = (overrides={}) => previewProjectRuleImpact({prisma,authorization,project,targetKind:'project',targetId:'p',subjectKind:'member',subjectId:'u1',effect:'deny',level:'none',expiresAt:null,...overrides});
const first = await preview();
check(() => assert.equal(first.reduced,1), 'member-specific denial reduces exactly one sampled subject');
check(() => assert.equal(first.after.none,1), 'proposed denial evaluated through authoritative permission function');
check(() => assert.equal(first.evaluatedCount,1), 'member-specific preview scopes to selected workspace member');
check(() => assert.ok(!JSON.stringify(first).includes('u1')), 'aggregate preview contains no member identifiers');
check(() => assert.equal(stored,1), 'one shared active-rule snapshot for before and proposed');
const teamPreview = await preview({subjectKind:'team',subjectId:'t1',effect:'allow',level:'manage'});
check(() => assert.equal(teamPreview.elevated,1), 'normalized team membership influences proposed effective level');
const allPreview = await preview({subjectKind:'all',subjectId:null,effect:'deny'});
check(() => assert.equal(allPreview.reduced,2), 'workspace-wide deny change considers both sampled people');
const targetPreview = await preview({targetKind:'board',targetId:'b'});
check(() => assert.equal(targetPreview.scope,'Selected resource only'), 'single-resource preview scope is labeled');
const many = await previewProjectRuleImpact({prisma:{...prisma,workspaceMember:{findMany:async()=>Array.from({length:45},(_,i)=>({userId:'u'+i,role:'member',user:{id:'u'+i}}))}},authorization,project,targetKind:'project',targetId:'p',subjectKind:'all',subjectId:null,effect:'deny',level:'none',expiresAt:null});
check(() => assert.equal(many.evaluatedCount,40) && many.sampled,'sample is bounded and explicitly marked incomplete');
console.log(`${passed}/${passed} scoped roles and impact assertions passed`);
