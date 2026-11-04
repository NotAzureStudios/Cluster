// v1.1 workspace boundary invariants for the People API.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source=readFileSync("apps/server/src/domains/users/user-directory-routes.ts","utf8");
const list=source.slice(source.indexOf('app.get("/api/users",'),source.indexOf('app.post("/api/users",'));
const patch=source.slice(source.indexOf('app.patch("/api/users/:userId",'),source.indexOf('app.get("/api/users/:userId/profile",'));
const profile=source.slice(source.indexOf('app.get("/api/users/:userId/profile",'),source.indexOf("\n}\n",source.indexOf('app.get("/api/users/:userId/profile",')));
const tests=[
  [list.includes("if (!viewer) return reply.code(401)"),"directory requires identity"],
  [list.includes("const viewerMembership = await prisma.workspaceMember.findFirst({"),"directory resolves viewer workspace"],
  [list.includes("if (!viewerMembership) return reply.code(403)"),"directory refuses nonmembers"],
  [list.split("memberships: { some: { workspaceId, ...(query.role ? { role: query.role } : {}) } },").length-1===2,"summary and normal lists scope role filters to workspace"],
  [list.includes("query.includeArchived && !includePrivate"),"archived people require private profile access"],
  [list.includes("workspaceRole: user.memberships.find((membership: any) => membership.workspaceId === workspaceId)")&&list.includes('isAdmin: ["owner", "admin"].includes(user.memberships.find('),"role and admin badges use correct workspace"],
  [profile.includes("if (!viewer) return reply.code(401)"),"profile requires authentication"],
  [profile.includes("where: { id: params.userId, memberships: { some: { workspaceId } } }"),"profile is scoped before data loading"],
  [profile.includes("if (!user) return reply.code(404)"),"cross-workspace profile not found"],
  [profile.includes("where: { archived: false, memberships: { some: { workspaceId } }"),"direct reports cannot leak across workspace"],
  [profile.includes("manager: managerMember ? user.employment?.manager || null : null"),"unrelated manager profile is masked"],
  [profile.includes("workspaceRole: user.memberships.find((row: any) => row.workspaceId === workspaceId)"),"profile role uses workspace-local membership"],
  [patch.includes("const actorMembership = await prisma.workspaceMember.findFirst({"),"mutations resolve actor workspace"],
  [patch.includes("where: { id: params.userId, memberships: { some: { workspaceId: actorMembership.workspaceId } } }"),"mutations reject foreign-workspace user ID"],
  [patch.includes("const targetMembership = await tx.workspaceMember.findUnique({"),"transaction rechecks workspace membership"],
  [patch.includes('code: "USER_NOT_FOUND"')&&patch.includes('"USER_NOT_IN_WORKSPACE"'),"cross-workspace mutations return not-found"],
  [patch.includes("membership.workspaceId === actorMembership.workspaceId"),"mutation response displays scoped role"],
  [patch.includes("await assignWorkspaceRole(tx, {"),"scoped role governance retained"],
];
for(const [ok,label] of tests)assert.ok(ok,label);
console.log(`v1.1 People workspace boundary: ${tests.length} checks passed.`);
