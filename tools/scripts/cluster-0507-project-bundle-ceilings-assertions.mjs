import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
let checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; console.log(`PASS ${label}`); };
function transpile(file, imports = {}) {
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022} }).outputText;
  const module = {exports:{}};
  vm.runInNewContext(code,{module,exports:module.exports,require:(id)=>{assert.ok(id in imports,`Unexpected dependency ${id}`);return imports[id];},Date,Set,Map,WeakMap,Promise,console},{filename:file});
  return module.exports;
}
const keys = ['mywork','inbox','projects','boards','whiteboards','viewer','timeline','builds','qa','tickets','calendar','scheduler','library','packets','sourceControl','integrations','people','activity','settings','serverConfig'];
const contracts = transpile('packages/shared/src/permission-bundle-contracts.ts', {'./cluster-manifest.js':{CLUSTER_TOOL_PERMISSION_KEYS:keys}});
const effective = transpile('packages/shared/src/effective-state-contracts.ts');
const membership = (project,userId) => (project.memberships||[]).find((record)=>record.userId===userId) || null;
const authorization = transpile('apps/server/src/domains/access/authorization.ts', {
  '@cluster/shared':{CLUSTER_ACCESS_TARGET_KINDS:['project','board','library','whiteboard','review_asset'],CLUSTER_TOOL_PERMISSION_KEYS:keys,createClusterExplanation:()=>({}),...contracts,...effective},
  '../projects/project-membership.js':{projectMembershipForUser:membership,membershipIsLead:(m)=>Boolean(m?.isLead)},
  './authorization-decision.js':{decisionResource:()=>({}),minimumForAuthorizationAction:(action)=>action==='manage'?'manage':'view'},
  '../workforce/workforce-user-authority.js':{workforceAuthorityProjection:()=>({department:null})},
  '../planning/calendar-access.js':{canAccessCalendarEvent:()=>false},
});
const bundle = {id:'project_restricted',label:'Project restricted',revision:1,enabled:true,toolPermissions:{projects:'view',boards:'none',library:'view'}};
const editing = {id:'other_restriction',label:'Other restriction',revision:1,enabled:true,toolPermissions:{projects:'edit',library:'none'}};
const settings = {studioPermissionBundles:[bundle,editing],studioProjectBundlePolicies:[{projectId:'p1',permissionBundleIds:['project_restricted']}],studioRoleDefinitions:[],studioDepartmentDefinitions:[]};
const policy = contracts.validateClusterProjectBundlePolicies(settings.studioProjectBundlePolicies,contracts.validateClusterPermissionBundles(settings.studioPermissionBundles));
check(policy.length===1 && policy[0].projectId==='p1','canonical project policies validate');
check(contracts.clusterProjectBundleCap('p1','boards',policy,settings.studioPermissionBundles)==='none','explicit target tool ceiling resolves');
check(contracts.clusterProjectBundleCap('p1','qa',policy,settings.studioPermissionBundles)===null,'unset tool ceiling cannot create an ACL grant');
check(contracts.clusterProjectBundleCap('p2','projects',policy,settings.studioPermissionBundles)===null,'project policy is limited to assigned Project');
for (const invalid of [
  [{projectId:'p1',permissionBundleIds:['invalid']}],
  [{projectId:'p1',permissionBundleIds:[]},{projectId:'p1',permissionBundleIds:[]}],
  [{projectId:'',permissionBundleIds:[]}],
  [{projectId:'p1',permissionBundleIds:['project_restricted','project_restricted']}],
]) assert.throws(()=>contracts.validateClusterProjectBundlePolicies(invalid,settings.studioPermissionBundles));
check(true,'unknown, duplicate and invalid policy identifiers rejected');
let current = settings;
const svc = authorization.createAuthorizationService({prisma:{accessRule:{findMany:async()=>[]}},authRequired:true,getCurrentUser:async()=>null,decorateUserForClient:async()=>({isAdmin:false,workspaceRole:'member'}),getStudioPermissionSettings:()=>current,parseObject:(value)=>typeof value==='string'?JSON.parse(value):value||{},parseLabels:()=>[]});
const user = {id:'u1',projectPermissions:{p1:'manage',p2:'manage'}};
const project = {id:'p1',source:'manual',memberships:[{userId:'u1',isLead:true,accessLevel:'manage'}]};
const another = {...project,id:'p2'};
const allow = {id:'r1',targetKind:'project',targetId:'p1',projectId:'p1',subjectKind:'all',effect:'allow',level:'manage',status:'active'};
check(svc.getProjectPermissionLevel(user,'member',project)==='view','project ceiling restricts explicit user override and lead');
check(svc.getProjectPermissionLevel(user,'member',another)==='manage','other Projects retain their access');
check(!svc.canArchiveProject(user,'member',{},project),'Project Lead cannot bypass scoped ceiling when archiving');
check(!svc.hasProjectResourceAccess(user,'member',project,[allow],'manage'),'Project AccessRule allow cannot bypass Project ceiling');
check(!svc.hasTargetAccess(user,'member','board','b1',project,[allow],'view'),'board cannot bypass explicit none ceiling');
check(svc.hasTargetAccess(user,'member','library','l1',project,[allow],'view'),'Library view permitted subject to separate Library source ACL');
check(!svc.hasTargetAccess(user,'member','library','l1',project,[allow],'contribute'),'Library higher access blocked by project ceiling');
const actor = {user,role:'member',decorated:{isAdmin:false,workspaceRole:'member'}};
const decision = await svc.authorize(actor,'manage',{kind:'project',project},{minimum:'manage',rules:[allow]});
check(!decision.allowed && decision.contributors.some((part)=>part.source==='project-policy'),'canonical project decision reports project policy when denying an allow');
const target = await svc.authorize(actor,'view',{kind:'target',targetKind:'board',targetId:'b1',project},{minimum:'view',rules:[allow]});
check(!target.allowed,'canonical resource decision honors target ceiling');
check((await svc.authorize({user,role:'owner',decorated:{isAdmin:true}},'manage',{kind:'project',project})).allowed,'active administrator recovery is preserved');
check(!(await svc.authorize({user:{...user,accountState:'SUSPENDED'},role:'owner',decorated:{isAdmin:true}},'view',{kind:'project',project})).allowed,'inactive admin never bypasses account lifecycle');
// Settings are mutated in place by Cluster publication; an old WeakMap entry cannot survive a new policy array.
current.studioProjectBundlePolicies = [{projectId:'p1',permissionBundleIds:['other_restriction']}];
check(svc.getProjectPermissionLevel(user,'member',project)==='contribute','in-place settings publication refreshes Project policy cache');
check(!svc.hasTargetAccess(user,'member','library','l1',project,[],'view'),'new Project policy immediately restricts Library');
current.studioPermissionBundles = [{...bundle,enabled:false},editing];
check(svc.getProjectPermissionLevel(user,'member',project)==='contribute','active bundle definitions refresh after publication');
current.studioProjectBundlePolicies = [{projectId:'p1',permissionBundleIds:['project_restricted']}];
check(svc.getProjectPermissionLevel(user,'member',project)==='manage','disabled bundle contributes no project restriction');
current.studioProjectBundlePolicies = [{projectId:'p1',permissionBundleIds:['invalid']}];
assert.throws(()=>svc.getProjectPermissionLevel(user,'member',project));
check(true,'invalid live Project policy fails closed instead of granting access');
const strict = contracts.validateClusterProjectBundlePolicies([{projectId:'p1',permissionBundleIds:['project_restricted','other_restriction']}],settings.studioPermissionBundles);
check(contracts.clusterProjectBundleCap('p1','library',strict,settings.studioPermissionBundles)==='none','multiple Project bundles combine by strictest active explicit key');
const cardProjection = readFileSync('packages/renderer/src/features/boards/CardProjectionPanel.tsx','utf8');
const pickerHook = readFileSync('packages/renderer/src/components/useAuthorizedProjectResources.ts','utf8');
check(cardProjection.includes('useAuthorizedProjectResources') && cardProjection.includes('ClusterResourcePicker') && cardProjection.includes('kinds: ["board"]'),'Card projection uses shared server-authorized Board discovery instead of a local Board dropdown');
check(cardProjection.includes('available.some((board) => board.id === targetBoardId)') && cardProjection.includes('targetsError'),'Card projection fails closed on stale, denied or unavailable targets');
check(pickerHook.includes('enabled = true') && pickerHook.includes('!enabled || !projectId'),'shared picker supports lazy authorization reads');
const ui = readFileSync('packages/renderer/src/features/settings/StudioSettingsPage.tsx','utf8');
const writer = readFileSync('apps/server/src/app/server-routes-configuration-integrations.ts','utf8');
check(writer.includes('validateClusterProjectBundlePolicies') && writer.includes('Project policy targets must refer to active Projects.') && writer.includes('await verifyUserPin(admin'), 'Project policy writer uses existing admin PIN, optimistic CAS and server-side resource validation');
check(ui.includes('Project-specific bundle restrictions') && ui.includes('studioProjectBundlePolicies'),'Studio editor exposes Project-scoped restrictions in existing settings workflow');
console.log(`${checks}/${checks} Project bundle ceiling assertions passed`);
