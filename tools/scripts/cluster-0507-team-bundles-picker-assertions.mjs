import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { discoverProjectAccessTargets } from '../../apps/server/src/domains/access/project-target-discovery.ts';
let n = 0;
const check = (cond, title) => { assert.ok(cond, title); n++; console.log(`PASS ${title}`); };
function transpile(file, imports = {}) {
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022} }).outputText;
  const module = {exports:{}};
  vm.runInNewContext(code, {module, exports:module.exports, require:(id) => {assert.ok(id in imports, `Unexpected import: ${id}`);return imports[id];}, Date, Set, Map, WeakMap, Promise, console}, {filename:file});
  return module.exports;
}
const keys=['mywork','inbox','projects','boards','whiteboards','viewer','timeline','builds','qa','tickets','calendar','scheduler','library','packets','sourceControl','integrations','people','activity','settings','serverConfig'];
const contracts=transpile('packages/shared/src/permission-bundle-contracts.ts', {'./cluster-manifest.js':{CLUSTER_TOOL_PERMISSION_KEYS:keys}});
const effective=transpile('packages/shared/src/effective-state-contracts.ts');
const auth=transpile('apps/server/src/domains/access/authorization.ts', {
  '@cluster/shared':{CLUSTER_ACCESS_TARGET_KINDS:['project','board','whiteboard','library','review_asset'], CLUSTER_TOOL_PERMISSION_KEYS:keys,createClusterExplanation:()=>({}),...contracts,...effective},
  '../projects/project-membership.js':{projectMembershipForUser:()=>null,membershipIsLead:()=>false},
  './authorization-decision.js':{decisionResource:()=>({}),minimumForAuthorizationAction:()=> 'view'},
  '../workforce/workforce-user-authority.js':{workforceAuthorityProjection:()=>({department:null})},
  '../planning/calendar-access.js':{canAccessCalendarEvent:()=>false},
});
let settings={studioPermissionBundles:[
  {id:'team_review',label:'Team reviewers',revision:1,enabled:true,toolPermissions:{boards:'view',library:'none'}},
  {id:'team_disabled',label:'Disabled team',revision:1,enabled:false,toolPermissions:{qa:'manage'}},
],studioDepartmentDefinitions:[],studioRoleDefinitions:[]};
const service=auth.createAuthorizationService({
  prisma:{accessRule:{findMany:async()=>[]}},authRequired:true,getCurrentUser:async()=>null,
  decorateUserForClient:async()=>({isAdmin:false,workspaceRole:'member'}),getStudioPermissionSettings:()=>settings,
  parseObject:(value)=>typeof value==='string'?JSON.parse(value):value||{},parseLabels:()=>[],
});
const team={id:'team-1',name:'Review Team',archived:false,permissionBundleIds:'["team_review","team_disabled"]'};
const user={id:'user-1',archived:false,studioTeamMemberships:[{teamId:'team-1',archived:false,team}]};
check(service.getToolPermissionLevel(user,'member','boards')==='view','active Team bundle changes member tool permission');
check(service.getToolPermissionLevel(user,'member','library')==='none','Team bundle can explicitly remove permission');
check(service.getToolPermissionLevel(user,'member','qa')==='edit','disabled bundle contributes no permissions');
const explain=service.explainToolPermission(user,'member','boards');
check(explain.source==='studio-team-bundle' && explain.effectiveState.provenance.effective.sourceId==='team:team-1/bundle:team_review@1','authorization exposes stable Team and bundle revision provenance');
check(explain.effectiveState.provenance.chain.some((row)=>row.scope==='default'),'Team provenance includes preceding Studio default');
check(service.getToolPermissionLevel({...user,toolPermissions:{boards:'manage'}},'member','boards')==='manage','explicit per-person override remains highest priority');
settings={...settings,studioRoleDefinitions:[{id:'member',label:'Member',permissionTemplateKey:'member',toolPermissions:{boards:'edit'}}]};
check(service.getToolPermissionLevel(user,'member','boards')==='edit','explicit Studio role policy outranks Team bundle');
settings={...settings,studioRoleDefinitions:[]};
check(service.getToolPermissionLevel({...user,studioTeamMemberships:[{teamId:'team-1',archived:true,team}]},'member','boards')==='edit','archived memberships cannot inherit Team bundle');
check(service.getToolPermissionLevel({...user,studioTeamMemberships:[{teamId:'team-1',archived:false,team:{...team,archived:true}}]},'member','boards')==='edit','archived Teams cannot inherit bundle');
check(service.getToolPermissionLevel({...user,accountState:'DISABLED'},'member','boards')==='none','disabled user cannot inherit Team grants');
check(service.getToolPermissionLevel({...user,accountState:'SUSPENDED'},'owner','settings')==='none','suspended owner blocked by direct tool-level helper');
check(service.hasTargetAccess({...user,archived:true},'owner','board','board-1',{id:'p1',source:'manual'},[],'view')===false,'archived owner blocked from direct resource helper');
const denied=await service.authorize({user:{...user,accountState:'DISABLED'},role:'owner',decorated:{workspaceRole:'owner',isAdmin:true}},'manage',{kind:'tool',tool:'settings'});
check(!denied.allowed && denied.code==='ACCOUNT_INACTIVE','inactive owner denied before administrative bypass');
const settingsAfter={...settings,studioPermissionBundles:[{...settings.studioPermissionBundles[0],enabled:false},settings.studioPermissionBundles[1]]};
settings=settingsAfter;
check(service.getToolPermissionLevel(user,'member','boards')==='edit','disabled Team bundle stops affecting live users on settings refresh');
let modelCalls=[];
const db={accessRule:{findMany:async()=>[]}};
for(const kind of ['board','whiteboard','libraryItem','reviewAsset']) db[kind]={findMany:async(q)=>{modelCalls.push(kind);return kind==='board'?[{id:'board1',name:'Board One'}]:[];}};
const discover=(updates={})=>discoverProjectAccessTargets({
  prisma:db,authorization:{authorize:async()=>({allowed:true})},request:{},actorId:'user-1',cursorSecret:'cursor-key',
  project:{id:'project1',name:'Project One'},q:'',minimum:'view',limit:1,ruleSelect:{id:true},canAccessLibraryItem:async()=>true,
  kinds:['board'],...updates,
});
const first=await discover();
check(first.targets.length===1 && first.targets[0].kind==='board' && !first.targets.some(row=>row.kind==='project'),'narrow discovery excludes Project and other resource kinds');
check(modelCalls.every(kind=>kind==='board'),'resource-kind restriction skips unrelated table reads');
check(!!first.nextCursor,'bounded narrow discovery issues cursor');
await assert.rejects(discover({cursor:first.nextCursor,kinds:['library']}),/INVALID_PICKER_CURSOR/);
check(true,'encrypted cursor cannot be replayed against another kind set');
await assert.rejects(discover({kinds:['invalid']}),/INVALID_PICKER_KINDS/);
check(true,'unknown resource types fail closed');
const routes=readFileSync('apps/server/src/domains/users/team-routes.ts','utf8');
const access=readFileSync('apps/server/src/domains/access/access-routes.ts','utf8');
const ui=readFileSync('packages/renderer/src/features/people/PeoplePages.tsx','utf8');
const hook=readFileSync('packages/renderer/src/components/useAuthorizedProjectResources.ts','utf8');
const migration=readFileSync('apps/server/prisma/migrations/20261008150000_studio_team_permission_bundles/migration.sql','utf8');
check(routes.includes('authorization.requireAdmin(request, reply)') && routes.includes('validateClusterBundleAssignments') && routes.includes('expectedRevision'), 'Team bundle writes require Admin with revision and catalog validation');
check(ui.includes('Permission bundles (') && ui.includes('currentUser.isAdmin') && ui.includes('expectedRevision: team.revision'), 'People Team UI exposes admin-only revision-safe bundle editing');
check(access.includes('include: WORKFORCE_USER_AUTHORITY_INCLUDE') && access.includes('query.userId'), 'Access Explorer hydrates inspected user’s normalized Team authority');
check(hook.includes('sequence !== requestSequence.current') && hook.includes('setResources([])') && hook.includes('setNextCursor(null)'), 'shared picker hook rejects stale requests and fails closed');
check(migration.includes('ALTER TABLE "StudioTeam" ADD COLUMN "permissionBundleIds"'), 'migration adds scoped Team assignments to canonical Team record');
console.log(`${n}/${n} Team bundle / authorized picker assertions passed`);
