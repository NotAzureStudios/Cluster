/** Source contract validation, supplementary to executable module tests. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
let n=0;function test(label,fn){fn();n++;console.log('PASS',label)}
const read=(f)=>fs.readFileSync(f,'utf8');
const routes=read('apps/server/src/domains/library/library-routes.ts');
const scanner=read('apps/server/src/domains/library/library-disposition-ownership.ts');
const related=read('apps/server/src/domains/library/library-disposition-related-authority.ts');
const ui=read('packages/renderer/src/features/library/LibraryGovernancePanel.tsx');
const schema=read('apps/server/prisma/schema.prisma');
test('related authority is part of canonical ownership evidence, not separate URL',()=>{
 assert.match(scanner,/inspectRelatedLibraryStorageAuthority\(\{ prisma, itemId, content: candidateDigests, check \}\)/);
 assert.equal(routes.match(/app\.get\("\/api\/library\/:itemId\/disposition\/ownership"/g)?.length,1);
});
test('manage + admin auth and private no-store still required',()=>{
 const start=routes.indexOf('app.get("/api/library/:itemId/disposition/ownership"');
 const end=routes.indexOf('app.post("/api/library/:itemId/disposition"',start);
 const handler=routes.slice(start,end);
 assert.match(handler,/findAccessibleItem\(request, reply, params\.itemId, "manage"\)/);
 assert.match(handler,/context\.decorated\?\.isAdmin/);
 assert.match(handler,/Cache-Control", "private, no-store"/);
});
test('new bounded scan failures produce no partial response',()=>assert.match(routes,/LIBRARY_RELATED_\(\?:DIGEST\|MATCH\|RELEASE\)_LIMIT/));
test('all original Library pointer models still scanned',()=>{
 for(const s of ['libraryItem','libraryVersion','libraryDerivative'])assert.match(scanner,new RegExp(`source: "${s}"`));
});
test('original and child pointer checksum freshness is checked',()=>{
 assert.match(scanner,/CHILD_POINTERS_CHANGED_DURING_AUDIT/);
 assert.match(scanner,/item\.checksumSha256 !== reread\.checksumSha256/);
});
test('cross-system SQL models actually exist',()=>{
 for(const m of ['ManagedBlob','UploadSession','PacketRelease','PacketReleaseDerivative']) assert.match(schema,new RegExp(`model ${m} \\{`));
});
test('published Packet derivative remains independent of Library file path',()=>{
 assert.match(schema,/model PacketReleaseDerivative\s*\{[\s\S]*?content\s+Bytes/);
 assert.match(related,/packetReleaseDerivative.count/); assert.doesNotMatch(related,/packetReleaseDerivative.findMany/);
});
test('cross-domain storage locators are never used for provider operations',()=>{
 assert.doesNotMatch(related,/\.delete\(|\.unlink\(|\.rename\(|\.copy\(|\.putFile\(|\.openRead\(/);
 assert.doesNotMatch(related,/storageKey: true/);
});
test('all disposal and quarantine capability responses remain false',()=>{
 for(const source of [scanner,related]){assert.match(source,/quarantineAllowed: false/);assert.match(source,/physicalDisposalAllowed: false/);}
 assert.doesNotMatch(routes,/app\.(?:post|delete)\("\/api\/library\/:itemId\/disposition\/(?:execute|quarantine|purge)"/);
});
test('renderer shows related evidence separately and never offers execution',()=>{
 assert.match(ui,/storageOwnership\.relatedAuthority\.managedBlobs/);
 assert.match(ui,/storageOwnership\.relatedAuthority\.publishedReleases/);
 assert.match(ui,/SQL correlation only/);
 assert.doesNotMatch(ui,/api\/library\/\$\{item\.id\}\/disposition\/(?:execute|purge|quarantine)(?:\/|`|")/);
});
console.log(`R65 integration assertions ${n}/${n}`);
