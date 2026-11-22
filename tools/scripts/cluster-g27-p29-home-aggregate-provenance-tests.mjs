import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {homeWidgetNeedsScopedAggregates, HOME_SCOPED_AGGREGATES_UNAVAILABLE, filterHomeWidgetItems} from '../../packages/renderer/src/features/home-widgets/home-widget-runtime-policy.ts';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const builtIn=readFileSync(path.join(root,'packages/renderer/src/features/home-widgets/BuiltInHomeWidget.tsx'),'utf8');
let checks=0;
function check(name,fn){fn();checks++;console.log(`PASS ${name}`)}
for(const [name,config,expected] of [
 ['no config',undefined,false],['studio', {context:'studio'}, false],['all time', {timeRange:'all'},false],
 ['project',{context:'project',contextId:'p1'},true], ['current project',{context:'current-project'},true],
 ['user',{context:'user',contextId:'u1'},true],['me',{context:'me'},true],['role',{context:'role',contextId:'r1'},true],
 ['today',{timeRange:'today'},true], ['seven days',{timeRange:'7d'},true],['search',{filterText:'  road  '},true],
 ['blank search',{filterText:'   '},false],
])check(`scope eligibility: ${name}`,()=>assert.equal(homeWidgetNeedsScopedAggregates(config),expected));
check('unavailable explanation does not claim completeness',()=>{assert.match(HOME_SCOPED_AGGREGATES_UNAVAILABLE,/server-side aggregate/);assert.match(HOME_SCOPED_AGGREGATES_UNAVAILABLE,/incomplete/)});
check('filtered lists still use strict project ownership evidence',()=>{const rows=[{id:'one',title:'Public note'},{id:'two',title:'Private note',projectId:'p1'},{id:'three',title:'Another',projectId:'p2'}];assert.deepEqual(filterHomeWidgetItems(rows,{context:'project',contextId:'p1'},{currentUserId:'u1'}).map(x=>x.id),['two']);});
check('missing current project fails closed',()=>assert.deepEqual(filterHomeWidgetItems([{id:'1',title:'X',projectId:'p'}],{context:'current-project'},{currentUserId:'u'}),[]));
check('retired custom widget runtime stays removed',()=>assert.equal(existsSync(path.join(root,'packages/renderer/src/features/home-widgets/CustomHomeWidget.tsx')),false));
check('built-in widget prevents unscoped count usage for filtered views',()=>{assert.match(builtIn,/const scoped = homeWidgetNeedsScopedAggregates\(config\)/);assert.match(builtIn,/count !== undefined && !filtered/);assert.match(builtIn,/const summary = \(props[^\n]+\) => scoped/);});
check('filtered lists fail closed without runtime context',()=>assert.match(builtIn,/<Rows items=\{runtimeContext \? props\.list \|\| \[\] : \[\]\}/));
check('filtered explanation is announced',()=>{assert.match(builtIn,/role="status" title=\{HOME_SCOPED_AGGREGATES_UNAVAILABLE\}/);assert.match(builtIn,/className="sr-only">\. \{HOME_SCOPED_AGGREGATES_UNAVAILABLE\}/);});
check('unscoped built-in rendering remains intact',()=>{assert.match(builtIn,/const open = /);assert.match(builtIn,/case "projects":/);});
console.log(`G27 P29 widget aggregate provenance: ${checks}/${checks} passed`);
