import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const dash=readFileSync(path.join(root,'packages/renderer/src/features/application/modules/ApplicationDashboard.tsx'),'utf8');
const cat=readFileSync(path.join(root,'packages/renderer/src/features/home-widgets/use-home-source-control.ts'),'utf8');
let checks=0;
function check(name, fn) {fn();console.log('PASS',name);checks++;}
check('source control depends on a visible widget that reads it',()=>assert.match(dash,/homeCanSourceControl && homeNeedsSourceControl/));
check('source control demand comes only from repositories and reviews',()=>assert.match(dash,/homeNeedsSourceControl = homeWidgetUses\("sourceControl", "reviewQueue"\)/));
check('every remote source is gated by a widget on Home',()=>{for (const name of ['Library','RequiredKnowledge','Time','Calendar','Timeline','People','Activity','Assignments','Tickets','Inbox']) assert.match(dash,new RegExp(`homeNeeds${name} = homeWidgetUses\\(`));});
check('retired saved-view and integration lanes stay removed',()=>{assert.doesNotMatch(dash,/homeNeedsSavedViews|homeNeedsIntegrations/);assert.doesNotMatch(cat,/savedViews|integrations/i);});
check('disabled source reader never starts a request',()=>assert.match(cat,/if \(enabled\) void load\(\)/));
check('disabled source has a ready rather than infinite loading state',()=>assert.match(cat,/status: \{ state: enabled \? "loading" : "ready" \}/));
check('disabled source cannot render previous rows',()=>assert.match(cat,/repositories: enabled \? current\.repositories : \[\]/));
check('switching demand reinitializes account-scoped data',()=>assert.match(cat,/initialState\(owner, enabled\)/));
console.log(`G27 Pass 28 Home demand-loading: ${checks}/${checks} passed`);
