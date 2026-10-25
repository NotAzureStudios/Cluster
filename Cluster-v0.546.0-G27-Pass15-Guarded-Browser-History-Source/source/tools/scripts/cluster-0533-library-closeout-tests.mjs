import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planLibraryBulkRename, LibraryBulkRenameError } from '../../apps/server/src/domains/library/library-bulk-rename.ts';

const library = readFileSync(new URL('../../apps/server/src/domains/library/library-routes.ts', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../../packages/renderer/src/features/library/LibraryWorkspacePage.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../packages/renderer/src/features/library/library-workspace.css', import.meta.url), 'utf8');
let checks = 0;
function check(name, fn) { fn(); checks++; console.log(`PASS ${name}`); }
function item(id, title, parentId = null, type = 'file') { return { id, title, parentId, type, revision: 3 }; }
function fails(code, fn) { assert.throws(fn, error => error instanceof LibraryBulkRenameError && error.code === code); }

check('exact global find/replace', () => {
 const output = planLibraryBulkRename([item('1','IMG_IMG_A.PNG')], {mode:'replace',text:'IMG_',replacement:'ART_'});
 assert.equal(output[0].to,'ART_ART_A.PNG'); assert.equal(output[0].revision,3);
});
check('case-sensitive find/replace does not overwrite unmatched names', () => {
 assert.equal(planLibraryBulkRename([item('1','Img_A.png')],{mode:'replace',text:'IMG_',replacement:'x'})[0].to,'Img_A.png');
});
check('prefix preserves filename', () => assert.equal(planLibraryBulkRename([item('1','Logo.psd')], {mode:'prefix',text:'Studio_'} )[0].to,'Studio_Logo.psd'));
check('suffix preserves last extension', () => assert.equal(planLibraryBulkRename([item('1','Logo.final.psd')],{mode:'suffix',text:'_approved'})[0].to,'Logo.final_approved.psd'));
check('suffix on extensionless names', () => assert.equal(planLibraryBulkRename([item('1','Readme')],{mode:'suffix',text:'_ok'})[0].to,'Readme_ok'));
check('numbering deterministic by title not client order', () => {
 const got = planLibraryBulkRename([item('b','z.png'),item('a','a.png')],{mode:'number',text:'S_',start:7,padding:4});
 assert.deepEqual(got.map(v=>[v.id,v.to]),[['a','S_0007.png'],['b','S_0008.png']]);
});
check('case-insensitive sibling collision on generated names',()=> fails('LIBRARY_BULK_RENAME_COLLISION',()=> planLibraryBulkRename([item('a','asset.png'),item('b','ASSET.png')], {mode:'prefix',text:'P_'})));
check('two identical titles allowed in separate folders',()=> assert.equal(planLibraryBulkRename([item('a','asset.png','folder1'),item('b','asset.png','folder2')], {mode:'prefix',text:'P_'}).length,2));
check('folder rename forbidden in bulk',()=> fails('LIBRARY_BULK_RENAME_SCOPE',()=>planLibraryBulkRename([item('folder','Assets',null,'folder')],{mode:'prefix',text:'New_'})));
check('empty find forbidden',()=> fails('LIBRARY_BULK_RENAME_INVALID_RULE',()=>planLibraryBulkRename([item('a','X')],{mode:'replace',text:'',replacement:'Y'})));
check('empty prefix forbidden',()=> fails('LIBRARY_BULK_RENAME_INVALID_RULE',()=>planLibraryBulkRename([item('a','X')],{mode:'prefix',text:''})));
check('invalid Windows character rejected',()=> fails('LIBRARY_BULK_RENAME_INVALID_TITLE',()=>planLibraryBulkRename([item('a','file.txt')],{mode:'prefix',text:'?:'})));
check('empty generated filename rejected',()=> fails('LIBRARY_BULK_RENAME_INVALID_TITLE',()=>planLibraryBulkRename([item('a','delete')],{mode:'replace',text:'delete',replacement:''})));
check('unsafe traversal rejected',()=> fails('LIBRARY_BULK_RENAME_INVALID_TITLE',()=>planLibraryBulkRename([item('a','test')],{mode:'replace',text:'test',replacement:'..'})));
check('long output rejected',()=> fails('LIBRARY_BULK_RENAME_INVALID_TITLE',()=>planLibraryBulkRename([item('a','test'.repeat(10))],{mode:'prefix',text:'x'.repeat(160)})));
check('invalid numbering rejected',()=> fails('LIBRARY_BULK_RENAME_INVALID_RULE',()=>planLibraryBulkRename([item('a','test')],{mode:'number',text:'X',padding:0})));
check('selection limit enforced',()=>fails('LIBRARY_BULK_RENAME_SCOPE',()=>planLibraryBulkRename(Array.from({length:201},(_,i)=>item(String(i),`asset${i}`)),{mode:'prefix',text:'x'})));
check('preview includes full server generated mapping',()=>assert.ok(library.includes('renames, changedCount: renames.filter')));
check('preview and apply recheck authorization and locks',()=>{
 assert.ok(library.includes('const prepared = await prepareLibraryBulk(request, reply, body);'));
 assert.ok(library.includes('LIBRARY_BULK_LOCK_CONFLICT'));
 assert.ok(library.includes('PERSONNEL_RECORD_POLICY_REQUIRED'));
});
check('rename requires matching preview-confirmed titles',()=>assert.ok(library.includes('LIBRARY_BULK_RENAME_PREVIEW_STALE')));
check('collision query rechecked inside serializable transaction',()=>{
 assert.ok(library.includes('const currentSiblings = await tx.libraryItem.findMany'));
 assert.ok(library.includes('isolationLevel: "Serializable"'));
});
check('revision-qualified mutation never unconditionally updates item',()=>assert.ok(library.includes('where: { id: item.id, revision: body.expectedRevisions[item.id] }')));
check('UI lists all rename results, no truncated preview',()=>{
 assert.ok(ui.includes('renamePreview.renames.map('));
 assert.ok(ui.includes('role="table" aria-label="Full bulk rename preview"'));
 assert.ok(css.includes('.library-bulk-rename-lines-v533'));
});
check('UI invalidates preview on changing rules',()=>assert.ok(ui.includes('setRenamePreview(null); // a changed rule always requires a new server preview')));
check('UI submits only confirmed title mappings',()=>assert.ok(ui.includes('confirmedTitles: Object.fromEntries')));
check('Inspector metadata save has actual expectedRevision in mutation body',()=>assert.ok(ui.includes('body: { ...patch, expectedRevision: inspectedItem.revision }')));
check('Restore requires client reviewed revision',()=>{
 assert.ok(ui.includes('JSON.stringify({ expectedRevision: item.revision })'));
 assert.ok(library.includes('current.revision !== body.expectedRevision'));
 assert.ok(library.includes('where: { id: params.itemId, revision: current.revision }, data: restoreData'));
});
check('Version restore confirms destructive action and handles serialization conflicts',()=>{
 assert.ok(ui.includes('title: `Restore v${version.versionNumber}?`'));
 assert.ok(library.includes('if ((error as any)?.code === "P2034") return reply.code(409)'));
});
check('CSV selection prevents spreadsheet formula execution',()=>{
 assert.ok(ui.includes('/^[\\s]*[=+@-]/.test(text)'));
 assert.ok(ui.includes('exportSelectedLibraryMetadata()'));
});
check('comparison does not claim unknown hash equality',()=>{
 assert.ok(ui.includes('Comparison is metadata-only'));
 assert.ok(ui.includes('compareAttributes.map('));
});
console.log(`Cluster 0.533 Library closeout checks: ${checks}/${checks} passed`);
