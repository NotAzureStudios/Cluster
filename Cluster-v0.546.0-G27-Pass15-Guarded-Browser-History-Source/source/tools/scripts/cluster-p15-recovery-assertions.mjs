import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const read = path => fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
let passed=0;
function check(name, fn) { fn(); console.log(`PASS ${name}`); passed++; }
function extractFunctions(file, names, prefix='') {
  const source=read(file);
  const ast=ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const snippets=ast.statements.filter(n=>ts.isFunctionDeclaration(n) && names.includes(n.name?.text)).map(n=>n.getText(ast));
  assert.equal(snippets.length,names.length);
  const js=ts.transpileModule(prefix+'\n'+snippets.join('\n'), { compilerOptions:{module:ts.ModuleKind.None, target:ts.ScriptTarget.ES2022} }).outputText;
  return vm.runInNewContext(js+`\n({${names.join(',')}})`, { Set, Array, Object, String, Number, exports: {} });
}
const ids=['overview','plan','source','library','qa'];
const tools=extractFunctions('packages/shared/src/project-types.ts',['resolveClusterProjectToolSets','setClusterProjectToolState'],`const toolIds=${JSON.stringify(ids)};`);
check('duplicate and overlap collapse to single On state',()=>{
  const result=tools.resolveClusterProjectToolSets(['plan','plan'],['plan','qa'],['plan','qa','source']);
  assert.deepEqual(Array.from(result.defaultTools),['plan']);
  assert.deepEqual(Array.from(result.optionalTools),['qa']);
  assert.deepEqual(Array.from(result.hiddenTools),['source']);
});
check('unknown tool IDs are ignored',()=>{
  const result=tools.resolveClusterProjectToolSets(['hacker','plan'],[],['not-real']);
  assert.deepEqual(Array.from(result.defaultTools),['plan']);assert.deepEqual(Array.from(result.hiddenTools),[]);
});
check('moves from On to Off without retaining stale entries',()=>{
  const result=tools.setClusterProjectToolState({ defaultTools:['plan','library'], optionalTools:['qa'], hiddenTools:[] },'plan','off');
  assert.deepEqual(Array.from(result.defaultTools),['library']);assert.deepEqual(Array.from(result.hiddenTools),['plan']);
});
check('moves from hidden to optional without duplicate ownership',()=>{
  const result=tools.setClusterProjectToolState({ defaultTools:[], optionalTools:[], hiddenTools:['qa'] },'qa','optional');
  assert.deepEqual(Array.from(result.optionalTools),['qa']);assert.deepEqual(Array.from(result.hiddenTools),[]);
});
check('unknown mutations leave configuration unchanged',()=>{
  const result=tools.setClusterProjectToolState({ defaultTools:['plan'],optionalTools:[],hiddenTools:[] },'invalid','off');
  assert.deepEqual(Array.from(result.defaultTools),['plan']);assert.deepEqual(Array.from(result.hiddenTools),[]);
});
const profileSource=read('packages/shared/src/project-types.ts');
const block=profileSource.slice(profileSource.indexOf('export const CLUSTER_PRODUCTION_PROFILE_DEFINITIONS'),profileSource.indexOf('export function resolveClusterProductionProfile'));
const profileRows=Array.from(block.matchAll(/\{ id: "([\w]+)", label: "([^"]+)", purposeType: "([\w]+)"[\s\S]*?classification: "(standard|specialized)"/g), m=>({id:m[1],label:m[2],purposeType:m[3],classification:m[4]}));
const profileTools=extractFunctions('packages/shared/src/project-types.ts',['enabledClusterProductionProfiles'],`const CLUSTER_PRODUCTION_PROFILE_DEFINITIONS=${JSON.stringify(profileRows)}; const normalizeClusterProjectTypeId=(id)=>String(id||'general').toLowerCase();`);
check('technology profiles have an explicit standard/specialized classification',()=>{
  assert.equal(profileRows.length,10); assert.equal(profileRows.filter(x=>x.classification==='standard').length,1);
});
check('new studios expose generic only',()=>{
  const result=profileTools.enabledClusterProductionProfiles([], { id:'game', category:'game' });
  assert.deepEqual(Array.from(result,p=>p.id),['generic']);
});
check('studio-enabled specializations are category-scoped',()=>{
  const result=profileTools.enabledClusterProductionProfiles(['unreal','blender'], { id:'new_custom_game',category:'game' });
  assert.deepEqual(Array.from(result,p=>p.id),['generic','unreal']);
});
check('existing project profile can remain after studio opt-out',()=>{
  const result=profileTools.enabledClusterProductionProfiles([], { id:'game',category:'game' }, 'unreal');
  assert.deepEqual(Array.from(result,p=>p.id),['generic','unreal']);
});
check('server validates specialized profile before project create and update',()=>{
  const src=read('apps/server/src/domains/projects/project-routes.ts');
  assert.match(src,/PROJECT_TECHNOLOGY_DISABLED/g);
  assert.ok(src.includes('enabledClusterProductionProfiles'));
});
check('creation hides technology selector for generic-only studios',()=>{
  const src=read('packages/renderer/src/features/create/SharedCreateDrawer.tsx');
  assert.ok(src.includes('productionProfiles.length > 1'));
  assert.ok(src.includes('enabledClusterProductionProfiles(settings?.studioEnabledProductionProfileIds'));
});
const admin=extractFunctions('packages/renderer/src/features/admin/admin-workspace-state.ts',['canonicalAdminOperationsSection']);
check('Governance groups access and approvals',()=>{
  assert.equal(admin.canonicalAdminOperationsSection('security-center'),'approvals');
  assert.equal(admin.canonicalAdminOperationsSection('permissions'),'approvals');
});
check('Systems groups background operations and persistence',()=>{
  assert.equal(admin.canonicalAdminOperationsSection('operations-center'),'systems');
  assert.equal(admin.canonicalAdminOperationsSection('persistence'),'systems');
});
check('Data & Audit groups data tools, changelog and reports',()=>{
  assert.equal(admin.canonicalAdminOperationsSection('data-model'),'reports');
  assert.equal(admin.canonicalAdminOperationsSection('changelog'),'reports');
  assert.equal(admin.canonicalAdminOperationsSection('reports'),'reports');
});
check('Command Center and Incidents remain direct destinations',()=>{
  assert.equal(admin.canonicalAdminOperationsSection('overview'),'overview');
  assert.equal(admin.canonicalAdminOperationsSection('incidents'),'incidents');
});
check('Operations nav has five canonical entries',()=>{
  const src=read('packages/renderer/src/features/admin/admin-workspace-state.ts');
  const match=src.match(/export const ADMIN_WORKSPACE_SECTIONS = \[([\s\S]*?)\] as const/);
  assert.ok(match);assert.equal((match[1].match(/scope: "operations",.+nav: true/g)||[]).length,5);
});
check('all contextual specialist section IDs have a rendered surface',()=>{
  const ui=read('packages/renderer/src/features/admin/AdminWorkspacePage.tsx')+read('packages/renderer/src/features/admin/AdminUtilitySections.tsx');
  const state=read('packages/renderer/src/features/admin/admin-workspace-state.ts');
  const section=state.slice(state.indexOf('export const ADMIN_OPERATIONS_CONTEXT'),state.indexOf('export function canonicalAdminOperationsSection'));
  const ids=Array.from(section.matchAll(/\{ id: "([\w-]+)", label:/g),m=>m[1]);
  for(const id of ids) assert.ok(ui.includes(`adminSection === "${id}"`),`section ${id} has no rendered surface`);
});
check('Project Type editor uses shared tri-state manifest',()=>{
  const src=read('packages/renderer/src/features/settings/StudioSettingsPage.tsx');
  assert.match(src,/setClusterProjectToolState\(preset, tool/);
  assert.match(src,/CLUSTER_PROJECT_TOOL_IDS\.map/);
  assert.doesNotMatch(src,/<label>Default tools<\/label>/);
});
check('P16C source functionality remains retained',()=>{
  assert.ok(fs.existsSync(new URL('../../packages/renderer/src/features/library/LibraryGovernancePanel.tsx',import.meta.url)));
  assert.match(read('packages/renderer/src/features/projects/ProjectAccessPanel.tsx'),/explain/);
});
console.log(`${passed}/${passed} source reconciliation tests passed`);
