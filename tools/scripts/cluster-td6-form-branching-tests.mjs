import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const ts = (() => {
  try { return require('typescript'); }
  catch { return require(`${execFileSync('npm', ['root', '-g'], {encoding:'utf8'}).trim()}/typescript`); }
})();
const root = new URL('../../', import.meta.url);
const read = path => fs.readFileSync(new URL(path, root), 'utf8');
function compile(path, mocks = {}) {
  const js = ts.transpileModule(read(path), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  const module={exports:{}};
  const context={module,exports:module.exports,require:name=>{
    if (!(name in mocks)) throw new Error(`Unexpected import: ${name}`);
    return mocks[name];
  },URL,Set,Map,Object,console};
  vm.runInNewContext(js,context,{filename:path});
  return module.exports;
}
const visibility=compile('packages/shared/src/studio-form-visibility.ts');
const {visibleStudioFormFieldIds, projectVisibleStudioFormAnswers}=visibility;
const fields=[
  {id:'kind',type:'select'},
  {id:'reason',type:'long_text',visibleWhen:{fieldId:'kind',equals:'Other'}},
  {id:'detail',type:'select',visibleWhen:{fieldId:'kind',equals:'Other'}},
  {id:'detail_notes',type:'long_text',visibleWhen:{fieldId:'detail',equals:'Sensitive'}},
  {id:'confirm',type:'checkbox'},
  {id:'contact',type:'email',visibleWhen:{fieldId:'confirm',equals:true}},
  {id:'decline',type:'short_text',visibleWhen:{fieldId:'confirm',equals:false}},
  {id:'choices',type:'multi_select'},
  {id:'special',type:'long_text',visibleWhen:{fieldId:'choices',equals:'Special'}},
];
let checks=0;
function check(condition,msg){assert.ok(condition,msg);checks++}
function ids(a){return [...visibleStudioFormFieldIds(fields,a)].join(',');}
check(ids({})==='kind,confirm,decline,choices','Default checkbox false reveals unchecked branch');
check(ids({kind:'Other',detail:'Sensitive',confirm:true,choices:['Special']}) === 'kind,reason,detail,detail_notes,confirm,contact,choices,special','Nested and multi-select conditions reveal dependent fields');
check(ids({kind:'Standard',detail:'Sensitive',confirm:false})==='kind,confirm,decline,choices','Hidden parent suppresses nested condition even with stale answers');
check(JSON.stringify(projectVisibleStudioFormAnswers(fields,{kind:'Standard',reason:'stale',detail:'Sensitive',detail_notes:'secret',confirm:true,decline:'stale',contact:'member@studio.test',choices:[],special:'stale'}))===JSON.stringify({kind:'Standard',confirm:true,contact:'member@studio.test',choices:[]}), 'Projection strips all hidden answers, including stale nested values');
const runtime=compile('apps/server/src/domains/studio-systems/studio-form-runtime.ts',{
  '@cluster/shared':{studioAudienceSchema:{parse:v=>v},visibleStudioFormFieldIds},
  '../access/studio-audience.js':{parseStudioJson:JSON.parse},
});
const definition={fields:[
  {id:'kind',type:'select',options:['Standard','Other'],required:true,label:'Kind'},
  {id:'detail',type:'long_text',required:true,label:'Details',visibleWhen:{fieldId:'kind',equals:'Other'}},
  {id:'agree',type:'checkbox',required:true,label:'Agreement',visibleWhen:{fieldId:'kind',equals:'Other'}},
]};
check(runtime.validateStudioFormAnswers(definition,{kind:'Standard'}).ok===true,'Hidden required fields not demanded by server');
check(runtime.validateStudioFormAnswers(definition,{kind:'Other'}).ok===false,'Visible required branch enforced');
check(runtime.validateStudioFormAnswers(definition,{kind:'Other',detail:'Notes',agree:false}).ok===false,'Visible required checkbox must be true');
check(runtime.validateStudioFormAnswers(definition,{kind:'Other',detail:'Notes',agree:true}).ok===true,'Complete visible conditional answers accepted');
check(runtime.validateStudioFormAnswers(definition,{kind:'Standard',bogus:'unknown'}).ok===false,'Unknown field cannot bypass validation');
check(runtime.validateStudioFormAnswers(definition,{kind:'Other',detail:55,agree:true}).ok===false,'Conditional visible field types validated');
const sources=[
  'packages/shared/src/studio-systems-contracts.ts',
  'apps/server/src/domains/studio-systems/studio-systems-routes.ts',
  'apps/server/src/domains/studio-systems/studio-workflow-routes.ts',
  'packages/renderer/src/features/studio-systems/StudioFormRunner.tsx',
  'packages/renderer/src/features/settings/StudioSystemsSettingsSection.tsx',
];
for (const path of sources) {
  const source=read(path);
  const ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true,path.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
  check(ast.parseDiagnostics.length===0,`${path} parses`);
}
check(read('packages/shared/src/studio-systems-contracts.ts').includes('"Visibility conditions must reference an earlier field."'),'Published schema rejects forward/cyclic conditions');
check(read('apps/server/src/domains/studio-systems/studio-systems-routes.ts').includes('answersJson: JSON.stringify(effectiveAnswers)'),'Authenticated submissions persist projected answers');
check(read('apps/server/src/domains/studio-systems/studio-workflow-routes.ts').includes('answersJson: JSON.stringify(effectiveAnswers)'),'Anonymous applications persist projected answers');
check(read('packages/renderer/src/features/studio-systems/StudioFormRunner.tsx').includes('activeFields.map('),'Renderer hides conditional fields');
check(read('packages/renderer/src/features/settings/StudioSystemsSettingsSection.tsx').includes('Cannot save form:'),'Form author gets validation feedback for invalid branches');
console.log(`${checks}/${checks} conditional form source checks passed`);
