import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {homeWidgetNeedsScopedAggregates, HOME_SCOPED_AGGREGATES_UNAVAILABLE, filterHomeWidgetItems} from '../../packages/renderer/src/features/home-widgets/home-widget-runtime-policy.ts';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const custom=readFileSync(path.join(root,'packages/renderer/src/features/home-widgets/CustomHomeWidget.tsx'),'utf8');
const builtIn=readFileSync(path.join(root,'packages/renderer/src/features/home-widgets/BuiltInHomeWidget.tsx'),'utf8');
let checks=0;
function check(name,fn){fn();checks++;console.log(`PASS ${name}`)}
for(const [name,config,expected] of [
 ['no config',undefined,false],['studio', {context:'studio'}, false],['all time', {timeRange:'all'},false],
 ['local list limit',{listLimit:3},false],['presentation only',{detailLevel:'compact',showActions:false},false],
 ['project',{context:'project',contextId:'p1'},true], ['current project',{context:'current-project'},true],
 ['user',{context:'user',contextId:'u1'},true],['me',{context:'me'},true],['role',{context:'role',contextId:'r1'},true],
 ['today',{timeRange:'today'},true], ['seven days',{timeRange:'7d'},true],['search',{filterText:'  road  '},true],
 ['blank search',{filterText:'   '},false],['saved view',{savedViewId:'view1'},true],['blank saved view',{savedViewId:'  '},false],
])check(`scope eligibility: ${name}`,()=>assert.equal(homeWidgetNeedsScopedAggregates(config),expected));
check('unavailable explanation does not claim completeness',()=>{assert.match(HOME_SCOPED_AGGREGATES_UNAVAILABLE,/server-side aggregate/);assert.match(HOME_SCOPED_AGGREGATES_UNAVAILABLE,/incomplete/)});
check('filtered lists still use strict project ownership evidence',()=>{const rows=[{id:'one',title:'Public note'},{id:'two',title:'Private note',projectId:'p1'},{id:'three',title:'Another',projectId:'p2'}];assert.deepEqual(filterHomeWidgetItems(rows,{context:'project',contextId:'p1'},{currentUserId:'u1'}).map(x=>x.id),['two']);});
check('missing current project fails closed',()=>assert.deepEqual(filterHomeWidgetItems([{id:'1',title:'X',projectId:'p'}],{context:'current-project'},{currentUserId:'u'}),[]));
check('missing selected saved view fails closed',()=>assert.deepEqual(filterHomeWidgetItems([{id:'1',title:'X'}],{savedViewId:'deleted'},{currentUserId:'u',savedViews:[]}),[]));
check('custom aggregate blocks all route through scoped guard',()=>{assert.match(custom,/const scopedAggregatesUnavailable = homeWidgetNeedsScopedAggregates\(config\)/);for(const t of ['metric','status','trend','progress','matrix','operation'])assert.match(custom,new RegExp(`block.type === "${t}"`));assert.match(custom,/const scopedMetricValue = .*scopedAggregatesUnavailable/);assert.match(custom,/const metricLabel = .*scopedMetricValue/);assert.match(custom,/if \(scopedAggregatesUnavailable\) return <div key=\{index\} className="home-widget-custom-progress/);});
check('custom lists do not bypass scoping when runtime context unavailable',()=>assert.match(custom,/runtimeContext \? filterHomeWidgetItems\(base, config, runtimeContext\) : scopedAggregatesUnavailable \? \[\] : base/));
check('custom metric unavailable warning is visible to assistive tech',()=>{assert.match(custom,/HOME_SCOPED_AGGREGATES_UNAVAILABLE/);assert.match(custom,/role="status"/);});
check('built-in widget prevents unscoped count usage for filtered views',()=>{assert.match(builtIn,/if \(scopedAggregatesUnavailable && !\["clock", "note", "clipboard"\]\.includes\(id\)\)/);assert.match(builtIn,/const rows = runtimeContext \? availableRows\[id\] \|\| \[\] : \[\]/);assert.match(builtIn,/HOME_SCOPED_AGGREGATES_UNAVAILABLE/);});
check('unscoped built-in rendering remains intact',()=>{assert.match(builtIn,/const openItem =/);assert.match(builtIn,/renderers\.projects/);});
console.log(`G27 P29 widget aggregate provenance: ${checks}/${checks} passed`);
