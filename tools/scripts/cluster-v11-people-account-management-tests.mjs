import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildPeopleAccountWhere } from "../../apps/server/src/domains/users/people-account-management-query.ts";
import { cursorWhere, decodeCursor, encodeCursor } from "../../apps/server/src/core/cursor-pagination.ts";

const source = (path) => readFileSync(path, "utf8");
const api = source("apps/server/src/domains/users/people-account-management-routes.ts");
const admin = source("packages/renderer/src/features/people/PeopleAccountManagementPanel.tsx");
const people = source("packages/renderer/src/features/people/PeoplePages.tsx");
const directory = source("apps/server/src/domains/users/user-directory-routes.ts");
const css = source("packages/renderer/src/features/people/people.css");

let count = 0;
function check(label, action) { action(); count++; console.log("PASS", label); }
const now = new Date("2026-11-08T17:00:00Z");
const query = (changes={}) => ({
  search: "", status: "all", accountType: "all", role: "", ...changes,
});

check("Every account query is scoped to its actor workspace", () => {
  const where = buildPeopleAccountWhere("workspace-1",query());
  assert.deepEqual(where.memberships, { some: { workspaceId: "workspace-1" } });
  assert.equal(where.archived,false);
  const role = buildPeopleAccountWhere("workspace-2",query({role:"artist"}));
  assert.deepEqual(role.memberships, { some: { workspaceId:"workspace-2",role:"artist" } });
});

check("Account state filters run in DB before pagination", () => {
  const setup = buildPeopleAccountWhere("s",query({status:"setup"}),now);
  assert.ok(setup.accountState.in.includes("PASSWORD_CHANGE_REQUIRED"));
  assert.ok(setup.accountState.in.includes("PASSWORD_RESET_REQUIRED"));
  assert.ok(setup.accountState.in.includes("DISCORD_LINK_REQUIRED"));
  const restricted = buildPeopleAccountWhere("s",query({status:"restricted"}),now);
  assert.deepEqual(restricted.accountState.in,["SUSPENDED","DISABLED","LOCKED"]);
  assert.equal(buildPeopleAccountWhere("s",query({status:"archived"}),now).archived,true);
});

check("Expired and expiring filters distinguish past from future access expiry", () => {
  const expiring = buildPeopleAccountWhere("s",query({status:"expiring"}),now);
  assert.equal(expiring.accessExpiresAt.gt.getTime(),now.getTime());
  assert.equal(expiring.accessExpiresAt.lte.getTime(),now.getTime()+30*86_400_000);
  const expired = buildPeopleAccountWhere("s",query({status:"expired"}),now);
  assert.equal(expired.accessExpiresAt.lte.getTime(),now.getTime());
});

check("Search and account type constraints are composed, not applied after slicing", () => {
  const where = buildPeopleAccountWhere("s",query({status:"setup",accountType:"contractor",search:"example",role:"member"}),now);
  assert.equal(where.accountType,"contractor");
  assert.equal(where.archived,false);
  assert.equal(where.memberships.some.role,"member");
  assert.equal(where.OR.length,4);
  assert.equal(where.OR[0].username.mode,"insensitive");
});

check("Cursor model is deterministic and supports compound updatedAt/id seek", () => {
  const cursor = encodeCursor({at:new Date("2026-11-07T00:00:00Z"),id:"abc"});
  const position = decodeCursor(cursor);
  assert.equal(position.id,"abc");
  assert.equal(cursorWhere(position,"updatedAt","desc").OR.length,2);
  assert.equal(decodeCursor("broken"),null);
});

check("Admin API rejects ordinary accounts before running private listing query", () => {
  const guard=api.indexOf('["owner", "admin"].includes(membership.role)');
  const queryIndex=api.indexOf('managementQuerySchema.parse(request.query || {})');
  assert.ok(guard>0 && queryIndex>guard);
  assert.ok(api.includes('code: "ROLE_ADMIN_REQUIRED"'));
  assert.ok(api.includes('code: "AUTH_REQUIRED"'));
  assert.ok(api.includes('const where = buildPeopleAccountWhere(membership.workspaceId, query)'));
  assert.ok(api.includes('prisma.user.count({ where })'));
  assert.ok(api.includes('prisma.user.findMany({'));
  assert.ok(api.includes('where: rowsWhere'));
  assert.ok(api.includes('take: query.limit + 1'));
  assert.ok(!api.includes('WORKFORCE_USER_AUTHORITY_INCLUDE'));
  assert.ok(api.includes('const employment = user.employment?.workspaceId === membership.workspaceId ? user.employment : null;'));
  assert.ok(!api.includes('department: user.employment?.department?.name'));
});

check("Pagination and query size remain bounded and invalid cursors rejected", () => {
  assert.ok(api.includes('.min(1).max(100).default(50)'));
  assert.ok(api.includes('query.cursor && !cursor'));
  assert.ok(api.includes('PEOPLE_ACCOUNT_CURSOR_INVALID'));
  assert.ok(api.includes('buildCursorPage(rows, query.limit, "updatedAt")'));
});

check("General People directory no longer uses client-only account filters", () => {
  assert.ok(people.includes('workforceMode === "accounts" && <PeopleAccountManagementPanel'));
  assert.ok(!people.includes('accountFilter === "attention"'));
  assert.ok(!people.includes('accountFilter === "restricted"'));
  assert.ok(!people.includes('&includeArchived=true'));
  assert.ok(directory.includes('registerPeopleAccountManagementRoutes({ app, prisma, getCurrentUser });'));
});

check("Account toolbar and page navigation offer task-first actions", () => {
  assert.ok(admin.includes('label="User account management"'));
  assert.ok(admin.includes('Search accounts'));
  assert.ok(admin.includes('<option value="archived">Archived</option>'));
  assert.ok(admin.includes('onOpenAccount(account.id, "edit")'));
  assert.ok(admin.includes('onOpenAccount(account.id, "access")'));
  assert.ok(people.includes('pendingManagedAccountViewRef.current = { id, view }'));
  assert.ok(people.includes('setProfileViewState(pending.view)'));
  assert.ok(people.includes("accountCreationOpen={createAccountOpen}"));
  assert.ok(people.includes('workforceMode !== "accounts" && <ClusterButton variant="secondary"'));
  assert.ok(people.includes('workforceMode === "accounts" ? "Refresh accounts" : "Refresh people"'));
  assert.ok(admin.includes("onToggleCreateAccount"));
  assert.ok(admin.includes('Role filter unavailable: {roleError}'));
});

check("Account fetch is generation guarded and search is debounced", () => {
  assert.ok(admin.includes('setSettledSearch(search.trim()), 250'));
  assert.ok(admin.includes('const current = ++generation.current'));
  assert.ok(admin.includes('if (current !== generation.current) return;'));
  assert.ok(admin.includes('if (requestGeneration !== generation.current) return;'));
  assert.ok(admin.includes('if (!nextCursor || loading || paging.current)'));
});

check("Admin workspace is responsive without bloating the general People layout", () => {
  assert.ok(css.includes('.people-account-management-v11'));
  assert.ok(css.includes('@media(max-width:670px)'));
  assert.ok(people.includes('adminMode && currentUser.isAdmin ? "accounts" : "directory"'));
  assert.ok(people.includes('enabled: workforceMode === "directory"'));
  assert.ok(people.includes('if (workforceModeRef.current === "accounts") return;'));
  assert.ok(people.includes('previous === "accounts" && workforceMode !== "accounts"'));
  assert.ok(people.includes('!activateTarget && !contextOnly'));
});

console.log(`People account management: ${count} contract and runtime checks passed.`);
