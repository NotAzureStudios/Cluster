/** Source-level route and UI access contract (not an authenticated browser run). */
import assert from 'node:assert/strict';
import fs from 'node:fs';
const routes=fs.readFileSync('apps/server/src/domains/library/library-routes.ts','utf8');
const ui=fs.readFileSync('packages/renderer/src/features/library/LibraryGovernancePanel.tsx','utf8');
const scanner=fs.readFileSync('apps/server/src/domains/library/library-disposition-ownership.ts','utf8');
let n=0;function test(name,fn){fn();n++;console.log('PASS',name)}
test('dedicated ownership read route exists exactly once',()=>assert.equal(routes.match(/app\.get\("\/api\/library\/:itemId\/disposition\/ownership"/g)?.length,1));
const start=routes.indexOf('app.get("/api/library/:itemId/disposition/ownership"');
const end=routes.indexOf('app.post("/api/library/:itemId/disposition"',start);
assert.ok(start>=0 && end>start);
const handler=routes.slice(start,end);
test('requires item manage permission',()=>assert.match(handler,/findAccessibleItem\(request, reply, params\.itemId, "manage"\)/));
test('requires administrator and valid authentication context',()=>{assert.match(handler,/accessible\?\.context\.user/);assert.match(handler,/context\.decorated\?\.isAdmin/);});
test('response explicitly prevents storage inspection caching',()=>assert.match(handler,/Cache-Control", "private, no-store"/));
test('incomplete bounded scans return conflict rather than a partial report',()=>assert.match(handler,/OWNERSHIP_INCOMPLETE/));
test('scanner forbids quarantine and physical disposal',()=>{assert.match(scanner,/quarantineAllowed: false/);assert.match(scanner,/physicalDisposalAllowed: false/);});
test('scanner traverses all three ownership models',()=>{for(const m of ['libraryItem','libraryVersion','libraryDerivative'])assert.match(scanner,new RegExp(`source: "${m}"`));});
test('capability projection hides admin inventory from ordinary managers',()=>{assert.match(routes,/canInspectStorageOwnership: Boolean\(accessible\.context\.decorated\?\.isAdmin\)/);assert.match(ui,/disposition\?\.canInspectStorageOwnership &&/);});
test('renderer exposes an explicit inspection control',()=>{assert.match(ui,/Inspect storage ownership/);assert.match(ui,/disposition\/ownership/);});
test('renderer suppresses stale inspection responses after navigation',()=>assert.match(ui,/ownershipRequest\.current === requestNumber/));
test('old physical destruction route stays absent',()=>assert.doesNotMatch(routes,/app\.(?:delete|post)\("\/api\/library\/:itemId\/permanent"/));
// R67 adds explicitly non-executable quarantine simulations. Reject actual
// purge/execute or generic quarantine calls without denying safe audit routes.
test('ownership UI does not offer a storage mutation operation',()=>{
  assert.doesNotMatch(ui,/api\/library\/\$\{item\.id\}\/disposition\/(?:execute|purge|quarantine(?!-simulations?))/);
  assert.match(ui,/quarantine-simulations/);
});
console.log(`R64 route/UI integration ${n}/${n}`);
