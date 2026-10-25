import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require=createRequire(import.meta.url);
const ts=(()=>{try{return require('typescript')}catch{return require(path.join(execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim(),'typescript','lib','typescript.js'))}})();
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');
const sharedFile='packages/shared/src/tool-settings-contract.ts';
const compiled=ts.transpileModule(read(sharedFile),{fileName:sharedFile,reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
assert.equal((compiled.diagnostics||[]).filter(x=>x.category===ts.DiagnosticCategory.Error).length,0);
const module={exports:{}};
vm.runInNewContext(compiled.outputText,{module,exports:module.exports,console,require});
const {CLUSTER_TOOL_SETTING_KEYS,CLUSTER_TOOL_CONFIG_FIELDS,clusterResolveToolConfig,clusterToolNumericRange,clusterToolSettingAuthority}=module.exports;
const server=read('apps/server/src/domains/admin/admin-tool-routes.ts');
const editor=read('packages/renderer/src/features/admin/AdminToolControls.tsx');
let passed=0;
function check(label,callback){callback(); passed++; console.log('PASS '+label)}
const tools=Object.keys(CLUSTER_TOOL_SETTING_KEYS);
const inspect=(spec,val)=>{
  if(spec.kind==='boolean')return typeof val==='boolean';
  if(spec.kind==='enum')return typeof val==='string'&&spec.values.includes(val);
  if(spec.kind==='string')return typeof val==='string'&&val.length>=(spec.min??0)&&val.length<=(spec.max??Infinity)&&(!spec.format||/^\d{2}:\d{2}$/.test(val));
  if(spec.kind==='string-array')return Array.isArray(val)&&val.length<=(spec.max??Infinity)&&val.every(x=>typeof x==='string');
  if(spec.kind==='number')return typeof val==='number'&&Number.isFinite(val)&&(!spec.integer||Number.isInteger(val))&&val>=(spec.min??-Infinity)&&val<=(spec.max??Infinity);
  throw new Error('Unknown spec kind '+spec.kind);
};
check('all six configurable tools have exactly matching storage, field and resolved-default keys',()=>{
  assert.equal(tools.length,6);
  for(const tool of tools){
    const mapped=Object.keys(CLUSTER_TOOL_SETTING_KEYS[tool]).sort();
    const defined=Object.keys(CLUSTER_TOOL_CONFIG_FIELDS[tool]).sort();
    const projected=Object.keys(clusterResolveToolConfig(tool,{})).sort();
    assert.equal(JSON.stringify(mapped),JSON.stringify(defined),`${tool} map/contract drift`);
    assert.equal(JSON.stringify(mapped),JSON.stringify(projected),`${tool} projection drift`);
  }
});
check('every declared default satisfies its value constraints',()=>{
  for(const tool of tools){
    const config=clusterResolveToolConfig(tool,{});
    for(const [field,spec] of Object.entries(CLUSTER_TOOL_CONFIG_FIELDS[tool]))
      assert(inspect(spec,config[field]),`${tool}.${field} invalid default ${JSON.stringify(config[field])}`);
  }
});
check('numeric ranges are identical to the field contracts',()=>{
  for(const tool of tools)for(const [field,spec] of Object.entries(CLUSTER_TOOL_CONFIG_FIELDS[tool])){
    if(spec.kind==='number'){
      const bounds=clusterToolNumericRange(tool,field);
      assert.equal(bounds.min,spec.min??Number.MIN_SAFE_INTEGER);
      assert.equal(bounds.max,spec.max??Number.MAX_SAFE_INTEGER);
      if(spec.min!==undefined)assert(!inspect(spec,spec.min-1));
      if(spec.max!==undefined)assert(!inspect(spec,spec.max+1));
    } else assert.throws(()=>clusterToolNumericRange(tool,field),/Not a numeric/);
  }
});
check('all explicit enum choices are unique and nonempty',()=>{
  for(const tool of tools)for(const [field,spec] of Object.entries(CLUSTER_TOOL_CONFIG_FIELDS[tool]))if(spec.kind==='enum'){
    assert(spec.values.length>0,`${tool}.${field}`);
    assert.equal(new Set(spec.values).size,spec.values.length,`${tool}.${field}`);
    assert(!inspect(spec,'unknown-value-not-allowed'));
  }
});
check('scheduler Studio-linked keys remain explicitly Studio-owned',()=>{
  for(const field of ['timezone','workingDaysCsv','workdayStart','workdayEnd']){
    assert.equal(clusterToolSettingAuthority('scheduler',field).scope,'studio');
    assert.equal(typeof clusterResolveToolConfig('scheduler',{})[field],'string');
  }
});
check('stored false and zero have preserved projection semantics',()=>{
  const t=clusterResolveToolConfig('tickets',{ticketsEnabled:false,ticketsAutoArchiveDays:0,ticketsAutoAssignCreator:false});
  assert.equal(t.enabled,false); assert.equal(t.autoArchiveDays,0); assert.equal(t.autoAssignCreator,false);
  const l=clusterResolveToolConfig('library',{libraryThumbnailQuality:0,libraryEnabled:false,librarySensitiveOfflineCachePolicy:'protected'});
  assert.equal(l.enabled,false); assert.equal(l.thumbnailQuality,0); assert.equal(l.sensitiveOfflineCachePolicy,'protected');
});
check('legacy library upload-limit fallback is retained without a persisted alias',()=>{
  assert.equal(clusterResolveToolConfig('library',{uploadLimitMb:777}).maxUploadMb,777);
  assert.equal(CLUSTER_TOOL_SETTING_KEYS.library.maxUploadMb,'libraryMaxUploadMb');
  assert(!Object.values(CLUSTER_TOOL_SETTING_KEYS.library).includes('uploadLimitMb'));
});
check('server builds its schemas once using shared constraints and still validates every write',()=>{
  assert.match(server,/const TOOL_CONFIG_SCHEMAS = Object\.fromEntries/);
  assert.match(server,/CLUSTER_TOOL_CONFIG_FIELDS\[tool\]/);
  assert.match(server,/config = TOOL_CONFIG_SCHEMAS\[tool\]\.parse\(requestBody\.config\)/);
  assert.match(server,/z\.object\(shape\)/);
  assert.match(server,/patchSettings\(patch, expected\)/);
  assert.doesNotMatch(server,/const schemas: Record<AdminToolKey/);
});
check('renderer fallback uses the canonical projection for all six tools',()=>{
  for(const tool of tools)assert(editor.includes(`config: clusterResolveToolConfig("${tool}", input || {})`),tool);
  assert.equal((editor.match(/config: clusterResolveToolConfig\(/g)||[]).length,6);
});
check('renderer numeric fields consume constraints instead of hard-coded copies',()=>{
  const inputs=[...editor.matchAll(/<NumericField\b.*?\/>/gs)].map(x=>x[0]);
  assert.equal(inputs.length,21);
  for(const input of inputs){
    const field=input.match(/patch\("(\w+)", value\)/)?.[1];
    assert(field,`Missing field identity ${input.slice(0,80)}`);
    assert(input.includes(`clusterToolNumericRange(tool, "${field}")`),field);
    assert(!/ min=\{\d+\} max=\{\d+\}/.test(input),field);
  }
});
check('shared descriptor remains independent of Zod and cannot create new setting identities',()=>{
  assert(!/from ["']zod["']/.test(read(sharedFile)));
  for(const tool of tools)for(const field of Object.keys(CLUSTER_TOOL_CONFIG_FIELDS[tool])){
    assert(Object.hasOwn(CLUSTER_TOOL_SETTING_KEYS[tool],field));
  }
});
console.log(`${passed}/${passed} TD1 canonical Tool Config definition checks passed`);
