import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { filterHomeWidgetItems } from '../../packages/renderer/src/features/home-widgets/home-widget-runtime-policy.ts';
import { createHomeRequestAuthority } from '../../packages/renderer/src/features/home-widgets/home-request-authority.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const runtime = { currentUserId:'alice', currentProjectId:'p1', currentRoleId:'developer', now:new Date('2026-10-25T15:00:00Z') };
const items = [
  {id:'p1',title:'alpha',projectId:'p1',userId:'alice',roleId:'developer',at:'2026-10-25T14:00:00Z'},
  {id:'p2',title:'alpha',projectId:'p2',userId:'bob',roleId:'admin',at:'2026-10-24T14:00:00Z'},
  {id:'blank',title:'alpha'},
  {id:'work',title:'alpha',workTarget:{projectId:'p1',inspectScope:'person',inspectId:'alice'},at:'2026-10-25T13:00:00Z'},
  {id:'broken',title:'alpha',projectId:'p1',userId:'alice',roleId:'developer',at:'not-a-date'},
];
const ids = (config, ctx=runtime) => filterHomeWidgetItems(items,config,ctx).map(x=>x.id);
let assertions=0;
function check(name, cb) {cb(); assertions++; console.log('PASS',name);}
check('project context drops unscoped and other-project rows',()=>assert.deepEqual(ids({context:'project',contextId:'p1'}),['p1','work','broken']));
check('current project with no selection is empty',()=>assert.deepEqual(ids({context:'current-project'},{...runtime,currentProjectId:null}),[]));
check('explicit unconfigured project context is empty',()=>assert.deepEqual(ids({context:'project'}),[]));
check('personal context excludes unspecified owner',()=>assert.deepEqual(ids({context:'me'}),['p1','work','broken']));
check('explicit user context rejects unknown owner',()=>assert.deepEqual(ids({context:'user',contextId:'bob'}),['p2']));
check('user context without owner is empty',()=>assert.deepEqual(ids({context:'user'}),[]));
check('role context excludes unknown role',()=>assert.deepEqual(ids({context:'my-role'}),['p1','broken']));
check('role context without a role is empty',()=>assert.deepEqual(ids({context:'my-role'},{...runtime,currentRoleId:null}),[]));
check('studio context still shows unscoped data',()=>assert.deepEqual(ids({context:'studio'}),items.map(i=>i.id)));
check('project saved view requires matched ownership',()=>assert.deepEqual(ids({savedViewId:'saved'}, {...runtime,savedViews:[{id:'saved',values:{projectId:'p1'}}]}),['p1','work','broken']));
check('missing saved view must not degrade to studio-wide results',()=>assert.deepEqual(ids({savedViewId:'missing'}),[]));
check('saved view with user filter rejects absent owner',()=>assert.deepEqual(ids({savedViewId:'saved'}, {...runtime,savedViews:[{id:'saved',values:{userId:'alice'}}]}),['p1','work','broken']));
check('saved view with role filter rejects missing role',()=>assert.deepEqual(ids({savedViewId:'saved'}, {...runtime,savedViews:[{id:'saved',values:{roleId:'developer'}}]}),['p1','broken']));
check('time filter excludes dateless and unparseable dates',()=>assert.deepEqual(ids({timeRange:'today'}),['p1','work']));
check('combined context and time filter is strict',()=>assert.deepEqual(ids({context:'project',contextId:'p1',timeRange:'today'}),['p1','work']));
check('late time cutoff filters old rows',()=>assert.deepEqual(ids({timeRange:'7d'}).includes('p2'),true));
const authority=createHomeRequestAuthority('alice|source:1');
const first=authority.claim('source');
check('initial request owns its lane',()=>assert.equal(authority.isCurrent(first),true));
const second=authority.claim('source');
check('newer request supersedes earlier request',()=>{assert.equal(authority.isCurrent(first),false);assert.equal(authority.isCurrent(second),true)});
authority.setOwner('bob|source:0');
check('changing account invalidates every old request',()=>{assert.equal(authority.isCurrent(second),false);assert.equal(authority.isOwner('alice|source:1'),false)});
const b=authority.claim('source');
authority.setOwner('alice|source:1');
check('A to B to A cannot revive old A result',()=>{assert.equal(authority.isCurrent(first),false);assert.equal(authority.isCurrent(b),false)});
const third=authority.claim('source');
authority.invalidate('source');
check('unmount or disable invalidates request',()=>assert.equal(authority.isCurrent(third),false));
const catalog=readFileSync(path.join(root,'packages/renderer/src/features/home-widgets/use-widget2-catalog-insights.ts'),'utf8');
const lifecycle=readFileSync(path.join(root,'packages/renderer/src/features/home-widgets/use-home-delivery-lifecycle.ts'),'utf8');
const dashboard=readFileSync(path.join(root,'packages/renderer/src/features/application/modules/ApplicationDashboard.tsx'),'utf8');
check('catalog masks previous owner rows before effects',()=>assert.match(catalog,/state\.owner === owner \? state : initialState\(/));
check('catalog verifies authority before publishing data',()=>assert.equal((catalog.match(/authority\.isCurrent\(ticket\)/g)||[]).length,6));
check('catalog prevents old callbacks claiming a newer account',()=>assert.equal((catalog.match(/authority\.isOwner\(owner\)/g)||[]).length,3));
check('catalog clears unauthorized data before return',()=>{assert.match(catalog,/repositories: canSourceControl \?/);assert.match(catalog,/providers: canIntegrations \?/)});
check('catalog preserves user-visible retry actions for all three failures',()=>{for (const method of ['loadSourceControl','loadIntegrations','loadSavedViews']) assert.match(catalog,new RegExp('onRetry: \\(\\) => void '+method+'\\(true\\)'));});
check('delivery summary is masked when context changes',()=>assert.match(lifecycle,/result\.owner === owner \? result\.rows : \[\]/));
check('delivery recomputes canonical project set',()=>assert.match(lifecycle,/new Set\(projectIds\)/));
check('dashboard passes current user identity to both hooks',()=>{assert.match(dashboard,/useWidget2CatalogInsights\([^\n]+currentUser\.id\)/);assert.match(dashboard,/useHomeDeliveryLifecycleSummaries\([^\n]+currentUser\.id\)/)});
console.log(`G27 Pass 26 Home privacy & request-scope: ${assertions}/${assertions} passed`);
