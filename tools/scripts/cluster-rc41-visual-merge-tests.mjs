import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { summarizeLoadedAssets, summarizeLoadedProjectHealth } from '../../packages/renderer/src/features/visual-first/loaded-view-summary.ts';
let n=0;
function check(ok, label){assert.ok(ok,label);n++;}
function equal(actual,expected,label){assert.deepEqual(actual,expected,label);n++;}
const zero=summarizeLoadedAssets([]);
equal(zero,{total:0,active:0,retired:0,other:0,kinds:[]},'empty catalog not invented');
const filtered=summarizeLoadedAssets([
 {status:'active',kind:'physical'},{status:'retired',kind:'license'},
 {status:'active',kind:'license'},{status:'archived',kind:'other'},
]);
equal([filtered.total,filtered.active,filtered.retired,filtered.other],[4,2,1,1],'lifecycle exhaustive');
equal(filtered.kinds.map(x=>[x.label,x.value]),[['license',2],['other',1],['physical',1]],'stable loaded kind ranking');
const odd=summarizeLoadedAssets([{status:'unknown',kind:'  '}]);
equal(odd.kinds[0].label,'unknown','unknown category represented');
const health=summarizeLoadedProjectHealth([{health:{tone:'good'},completeness:80},{health:{tone:'warning'},completeness:20},{health:{tone:'danger'},completeness:100}]);
equal(health,{total:3,healthy:1,attention:2,averageReadiness:67},'loaded project comparison');
equal(summarizeLoadedProjectHealth([]).averageReadiness,null,'unknown average is null');
equal(summarizeLoadedProjectHealth([{health:{tone:'good'},completeness:Number.NaN}]).averageReadiness,null,'invalid average is null');
equal(summarizeLoadedProjectHealth([{health:{tone:'good'},completeness:-15},{health:{tone:'good'},completeness:500}]).averageReadiness,50,'average clamps out-of-range readiness');
const base=new URL('../../packages/renderer/src/',import.meta.url);
const src=(path)=>readFileSync(new URL(path,base),'utf8');
const inventory=src('features/settings/StudioInventoryVaultPanel.tsx');
check(inventory.includes('label={nextCursor ? "Loaded matching assets · more available"'), 'pagination scoped inventory label');
check(inventory.includes('loadedSummary.kinds.slice(0, 6)'), 'rank top kind categories');
check(!inventory.includes('Active shown'), 'duplicate inventory kpis removed');
check(inventory.includes('"/api/admin/inventory/attention"'), 'existing audit action preserved');
const projects=src('features/projects/ProjectsPage.tsx');
check(projects.includes('projectCursor.hasMore ? "Loaded filtered projects · more on server"'), 'portfolio paging label');
check(projects.includes('label="Average loaded readiness"'), 'portfolio average scope');
check(projects.includes('onOpenProject(fact.project.id)'), 'project navigation preserved');
const home=src('features/home-widgets/BuiltInHomeWidget.tsx');
check(!home.includes('TrendIndicator'), 'no fabricated QA history');
for(const marker of ['Git connected','Discord connected','Departments staffed','Providers configured','Administrative work queues','Library types in loaded overview','Priority tickets · loaded sample','Open review states']) check(home.includes(marker),`Home visual ${marker}`);
check(home.includes('scopedAggregatesUnavailable && !["clock", "note", "clipboard"].includes(id)'), 'scoped projections guard untouched');
check(!inventory.includes('setInterval(() =>'), 'inventory visuals do not poll');
console.log(`RC41 visual merge model and integration checks passed: ${n}/${n}`);
