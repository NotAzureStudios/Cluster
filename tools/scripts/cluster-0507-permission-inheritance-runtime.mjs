import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function loadTypeScript(file, injections = {}) {
  const code = ts.transpileModule(fs.readFileSync(file,'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }}).outputText;
  const module = { exports: {} };
  const require = (id) => { assert.ok(id in injections, `Unregistered test module: ${id}`); return injections[id]; };
  vm.runInNewContext(code, {module,exports:module.exports,require,Date,Set,Map,WeakMap,Promise,console}, {filename:file});
  return module.exports;
}
const keys=['mywork','inbox','projects','boards','whiteboards','viewer','timeline','builds','qa','tickets','calendar','scheduler','library','packets','sourceControl','integrations','people','activity','settings','serverConfig'];
const sharedContracts = loadTypeScript('packages/shared/src/permission-bundle-contracts.ts', {'./cluster-manifest.js': {CLUSTER_TOOL_PERMISSION_KEYS: keys}});
const effectiveState = loadTypeScript('packages/shared/src/effective-state-contracts.ts');
const workforceProjection = ({employment}) => ({department: employment?.department?.name || null});
const auth = loadTypeScript('apps/server/src/domains/access/authorization.ts', {
  '@cluster/shared': { CLUSTER_ACCESS_TARGET_KINDS: ['project','library','file','board','whiteboard','review_asset'], CLUSTER_TOOL_PERMISSION_KEYS:keys, createClusterExplanation: () => ({}), ...sharedContracts, ...effectiveState },
  '../projects/project-membership.js': {membershipIsLead:()=>false,projectMembershipForUser:()=>null},
  './authorization-decision.js': {decisionResource:()=>({}),minimumForAuthorizationAction:()=> 'view'},
  '../workforce/workforce-user-authority.js': {workforceAuthorityProjection:workforceProjection},
  '../planning/calendar-access.js': {canAccessCalendarEvent:()=>false},
});
const base = {
  studioDepartmentDefinitions: [{id:'development',label:'Development',permissionTemplateKey:'viewer',permissionBundleIds:['bundle_department'],toolPermissions:{timeline:'manage'}}],
  studioRoleDefinitions: [{id:'qa',label:'QA',departmentId:'development',permissionTemplateKey:'viewer',permissionBundleIds:['bundle_role'],toolPermissions:{qa:'none'}}],
  studioPermissionBundles: [
    {id:'bundle_department',label:'Team tools',revision:1,enabled:true,toolPermissions:{qa:'edit',library:'edit'}},
    {id:'bundle_role',label:'Role tools',revision:1,enabled:true,toolPermissions:{qa:'manage',boards:'edit'}},
  ],
};
let current = base;
const service=auth.createAuthorizationService({prisma:{}, authRequired:true, getCurrentUser:async()=>null, decorateUserForClient:async()=>null, getStudioPermissionSettings:()=>current, parseObject:(v)=> typeof v === 'string' ? JSON.parse(v) : v || {}, parseLabels:()=>[]});
let n=0;const yes=(v,label)=>{assert.ok(v,label);console.log('PASS',label);n++};
const result=service.previewToolPermissionMatrix('qa','development',base);
yes(result.qa.level==='none','role explicit deny overrides role bundle manage and department bundle edit');
yes(result.qa.provenance.effective.sourceId==='role:qa','effective provenance identifies role override');
yes(result.boards.level==='edit','role bundle overrides role preset');
yes(result.boards.provenance.effective.sourceId==='bundle:bundle_role@1','role bundle revision in provenance');
yes(result.library.level==='view','role preset takes precedence over department bundle');
yes(result.timeline.level==='view','role preset takes precedence over department overrides');
const roleNoOverrides={...base,studioRoleDefinitions:[{...base.studioRoleDefinitions[0],toolPermissions:{},permissionTemplateKey:undefined}]};
const simpler=service.previewToolPermissionMatrix('qa','development',roleNoOverrides);
yes(simpler.qa.level==='manage','without direct override the role bundle is effective');
const noRoleBundle={...roleNoOverrides,studioRoleDefinitions:[{...roleNoOverrides.studioRoleDefinitions[0],permissionBundleIds:[]}]};
const department=service.previewToolPermissionMatrix('qa','development',noRoleBundle);
yes(department.qa.level==='edit','department bundle supplies effective permission without role override');
const disabled={...noRoleBundle,studioPermissionBundles:[{...base.studioPermissionBundles[0],enabled:false},base.studioPermissionBundles[1]]};
const disabledResult=service.previewToolPermissionMatrix('qa','development',disabled);
yes(disabledResult.qa.level==='edit','disabled bundle ignored, member default retained');
yes(service.previewToolPermissionMatrix('owner',null,base).qa.level==='manage','owner authority cannot be diminished by bundle');
yes(service.getToolPermissionLevel({id:'person',employment:{department:{name:'development'}},toolPermissions:{boards:'none'}},'qa','boards')==='none','user override is final layer in live resolver');
yes(service.getToolPermissionLevel({id:'person',employment:{department:{name:'development'}}},'qa','boards')==='edit','live authorization uses same role bundle precedence');
yes(service.explainToolPermission({id:'person',employment:{department:{name:'development'}}},'qa','boards').effectiveState.provenance.effective.sourceId==='bundle:bundle_role@1','live explanation returns bundle provenance');
current=disabled;
yes(service.getToolPermissionLevel({id:'person',employment:{department:{name:'development'}}},'qa','qa')==='edit','live permission refreshes on configuration change');
console.log(`${n}/${n} live inheritance matrix assertions passed`);
