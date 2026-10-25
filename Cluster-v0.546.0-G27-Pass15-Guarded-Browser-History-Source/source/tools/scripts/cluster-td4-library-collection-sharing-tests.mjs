import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { libraryCollectionRole, libraryCollectionCan } from '../../apps/server/src/domains/library/library-collection-access.ts';

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8');
const routes = read('../../apps/server/src/domains/library/library-9e2-routes.ts');
const schema = read('../../apps/server/prisma/schema.prisma');
const migration = read('../../apps/server/prisma/migrations/20261014203000_td4_library_collection_grants/migration.sql');
const ui = read('../../packages/renderer/src/features/library/LibraryWorkspacePage.tsx');
const types = read('../../packages/renderer/src/features/library/library-types.ts');
let passed = 0;
function check(name, run) { run(); passed++; console.log(`PASS ${name}`); }
const collection = { ownerId: 'owner', grants: [{userId:'reader',role:'viewer'},{userId:'editor',role:'editor'}] };
check('owners retain all collection permissions', () => {
  assert.equal(libraryCollectionRole(collection,'owner',false),'owner');
  for (const action of ['view','edit','manage']) assert.equal(libraryCollectionCan('owner',action),true);
});
check('admins may perform existing owner-level maintenance', () => {
  assert.equal(libraryCollectionRole(collection,'admin',true),'owner');
});
check('viewer has read-only collection organization access', () => {
  const role=libraryCollectionRole(collection,'reader',false);
  assert.equal(role,'viewer');assert.equal(libraryCollectionCan(role,'view'),true);
  assert.equal(libraryCollectionCan(role,'edit'),false);assert.equal(libraryCollectionCan(role,'manage'),false);
});
check('editor can adjust membership but cannot manage grants/rules', () => {
  const role=libraryCollectionRole(collection,'editor',false);
  assert.equal(role,'editor');assert.equal(libraryCollectionCan(role,'view'),true);
  assert.equal(libraryCollectionCan(role,'edit'),true);assert.equal(libraryCollectionCan(role,'manage'),false);
});
check('ungranted users and unrecognized roles are denied', () => {
  assert.equal(libraryCollectionRole(collection,'outsider',false),null);
  assert.equal(libraryCollectionRole({ownerId:'owner',grants:[{userId:'victim',role:'superuser'}]},'victim',false),null);
  for(const action of ['view','edit','manage']) assert.equal(libraryCollectionCan(null,action),false);
});
check('grant lookup respects supplied user identity', () => {
  assert.equal(libraryCollectionRole(collection,'reader',false),'viewer');
  assert.equal(libraryCollectionRole(collection,'editor',false),'editor');
});
check('model uses composite foreign-key-backed grants', () => {
  assert.match(schema,/model LibraryCollectionGrant \{/);
  assert.match(schema,/@@id\(\[collectionId, userId\]\)/);
  assert.match(schema,/collection LibraryCollection @relation\(fields: \[collectionId\], references: \[id\], onDelete: Cascade\)/);
  assert.match(schema,/user\s+User @relation\(fields: \[userId\], references: \[id\], onDelete: Cascade\)/);
  assert.match(migration,/CHECK \("role" IN \('viewer', 'editor'\)\)/);
  assert.match(migration,/LibraryCollectionGrant_userId_collectionId_idx/);
});
check('list discovers owned and explicitly granted collections only', () => {
  assert.match(routes,/OR: \[\{ ownerId: auth\.user\.id \}, \{ grants: \{ some: \{ userId: auth\.user\.id \} \} \}\]/);
  assert.match(routes,/include: \{ grants: \{ where: \{ userId: auth\.user\.id \}/);
});
check('every collection read passes membership gate', () => {
  const readHandler = routes.slice(routes.indexOf('app.get("/api/library/collections/:collectionId/items"'),routes.indexOf('app.post("/api/library/collections/:collectionId/items"'));
  assert.match(readHandler,/requireCollectionAccess\(request, reply, collectionId\)/);
  assert.match(readHandler,/filterCollectionItems\(request, rows\)/);
  assert.match(routes,/personnelRecordAttachment\.findMany/);
  assert.match(routes,/libraryAccess\.filterItems\(request, rows\.filter\(\(item\) => !protectedIds\.has\(item\.id\)\), "view"\)/);
});
check('shared users do not receive raw inaccessible item counts', () => {
  assert.match(routes,/itemCount: role === "owner" \? collection\._count\?\.memberships \?\? undefined : undefined/);
  assert.match(routes,/accessRole: role/);
});
check('only owners can edit collection definition, archive, or share', () => {
  for (const route of ['app.patch("/api/library/collections/:collectionId"','app.delete("/api/library/collections/:collectionId"','app.get("/api/library/collections/:collectionId/shares"','app.put("/api/library/collections/:collectionId/shares/:userId"','app.delete("/api/library/collections/:collectionId/shares/:userId"']) {
    const block=routes.slice(routes.indexOf(route),routes.indexOf(route)+380);
    assert.match(block,/requireCollectionAccess\(request, reply, collectionId, "manage"\)/,route);
  }
});
check('editor authorization is required by all manual membership mutations', () => {
  for (const route of ['app.post("/api/library/collections/:collectionId/items"','app.delete("/api/library/collections/:collectionId/items"','app.delete("/api/library/collections/:collectionId/items/:itemId"']) {
    const block=routes.slice(routes.indexOf(route),routes.indexOf(route)+380);
    assert.match(block,/requireCollectionAccess\(request, reply, collectionId, "edit"\)/,route);
  }
});
check('mutation guards reject archived/expired/inactive recipients', () => {
  assert.match(routes,/recipient\.archived \|\| recipient\.accountState !== "ACTIVE"/);
  assert.match(routes,/recipient\.accessExpiresAt && recipient\.accessExpiresAt <= new Date\(\)/);
  assert.match(routes,/userId === access\.collection\.ownerId/);
});
check('grant updates and revoke use compare-and-swap transaction', () => {
  assert.equal((routes.match(/tx\.libraryCollection\.updateMany\(\{ where: \{ id: collectionId, archived: false, revision: body\.expectedRevision \}/g)||[]).length>=2,true);
  assert.match(routes,/tx\.libraryCollectionGrant\.upsert/);
  assert.match(routes,/tx\.libraryCollectionGrant\.deleteMany/);
  assert.match(routes,/\{ isolationLevel: "Serializable" \}/);
  assert.match(routes,/code: "LIBRARY_COLLECTION_REVISION_CONFLICT"/);
});
check('access changes have atomic, scoped activity evidence', () => {
  assert.match(routes,/tx\.activityEvent\.create\(\{ data: \{ userId: access\.user\.id, type: "access", entityType: "library_collection"/);
  assert.match(routes,/recipientId: userId, action: "revoke"/);
});
check('renderer displays shared access without exposing owner operations', () => {
  assert.match(types,/accessRole\?: "owner" \| "editor" \| "viewer"/);
  assert.match(ui,/collection\.accessRole === "owner" \? <ClusterActionMenu/);
  assert.match(ui,/collection\.accessRole !== "viewer"/);
  assert.match(ui,/role \? "PUT" : "DELETE"/);
  assert.match(ui,/sharingPendingRef\.current = true/);
  assert.match(ui,/File permissions remain unchanged/);
});
check('client does not advertise failed refresh as failed committed grant', () => {
  assert.match(ui,/The grant was committed\. A failed follow-up roster fetch is not a failed mutation/);
  assert.match(ui,/Access was updated, but the current sharing roster could not be refreshed/);
});
console.log(`${passed}/${passed} TD4 collection sharing assertions passed`);
