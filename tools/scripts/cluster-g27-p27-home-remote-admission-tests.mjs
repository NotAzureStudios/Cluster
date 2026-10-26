import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHomeRequestAuthority } from '../../packages/renderer/src/features/home-widgets/home-request-authority.ts';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const app=readFileSync(path.join(root,'packages/renderer/src/features/application/modules/ApplicationDashboard.tsx'),'utf8');
const cluster=readFileSync(path.join(root,'packages/renderer/src/features/application/ClusterApplication.tsx'),'utf8');
let count=0;
function test(name, fn) { fn(); console.log('PASS',name); count++; }
for (const name of ['Library','RequiredKnowledge','Time','Calendar','Timeline','People','Activity','Assignments','Inbox','Tickets']) {
  test(`${name} uses shared guarded Home reader`,()=> {
    const re=new RegExp(`function load${name === 'Library' ? 'HomeLibrary' : name === 'RequiredKnowledge' ? 'RequiredKnowledge' : 'Home'+name}\\([\\s\\S]*?return loadHomeSource\\(`);
    assert.match(app,re);
  });
}
test('Home reads are only admitted when the source is permitted',()=>assert.match(app,/if \(!homeMountedRef\.current \|\| !authority\.isOwner\(homeReadOwner\) \|\| !homeSourceAllowed\(source\)\) return;\s*const ticket = authority\.claim\(source\)/));
test('Home writes only commit if matching lane is still current',()=>assert.match(app,/const result = await read\(\);\s*if \(!authority\.isCurrent\(ticket\)\) return;\s*apply\(result\)/));
test('Home failures also check request ownership',()=>assert.match(app,/catch \(error\) \{\s*if \(!authority\.isCurrent\(ticket\)\) return;\s*markHomeRemote\(source/));
test('Home request epoch keyed by actual account and tool availability',()=>assert.match(app,/const homeReadOwner = `\$\{currentUser\.id\}\|\$\{HOME_REMOTE_SOURCES\.map/));
test('Home remounts after account switch',()=>assert.match(cluster,/<LazyDashboard\s+key=\{activeUser\.id\}/));
test('Home assigned-work scope contributes to request epoch',()=>assert.match(app,/homeNeedsTeamWideAssignments \? "1" : "0"/));
const auth=createHomeRequestAuthority('userA|source:1');
const old=auth.claim('inbox');
const oldConcurrent=auth.claim('inbox');
test('later same-source request invalidates earlier read',()=>{assert.equal(auth.isCurrent(old),false);assert.equal(auth.isCurrent(oldConcurrent),true)});
const independent=auth.claim('people');
test('concurrent different-source reads are independent',()=>{assert.equal(auth.isCurrent(independent),true);assert.equal(auth.isCurrent(oldConcurrent),true)});
auth.setOwner('userA|source:0');
test('permission downgrade rejects all old source and failure results',()=>{assert.equal(auth.isCurrent(oldConcurrent),false);assert.equal(auth.isCurrent(independent),false)});
const newRead=auth.claim('people');
auth.invalidate('people');
test('unmount invalidates reads',()=>assert.equal(auth.isCurrent(newRead),false));
console.log(`G27 Pass 27 Home remote admission: ${count}/${count} passed`);
