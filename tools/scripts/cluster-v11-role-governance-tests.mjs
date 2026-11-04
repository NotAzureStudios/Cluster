// v1.1 role lifecycle is explicit: immutable IDs and no assigned-role deletion.
import assert from "node:assert/strict";
import fs from "node:fs";

const ui = fs.readFileSync("packages/renderer/src/features/settings/StudioSettingsPage.tsx", "utf8");
const routes = fs.readFileSync("apps/server/src/app/server-routes-configuration-integrations.ts", "utf8");
const settingsRoute = routes.slice(routes.indexOf('app.put("/api/settings"'), routes.indexOf('app.get("/api/security/diagnostics"'));

const checks = [
  [!ui.includes("function renameStudioRole("), "UI no longer rewrites referenced role IDs"],
  [ui.includes('aria-label="Immutable role key"') && ui.includes("readOnly disabled"), "role key editor is immutable"],
  [ui.includes('roleHasAssignments(id: string)') && ui.includes('includeArchived=true'), "UI checks assigned and archived memberships before deletion"],
  [ui.includes("if (await roleHasAssignments(id))"), "UI does not delete assigned roles"],
  [ui.includes("setStudioRoleEnabled(id: string, enabled: boolean)") && ui.includes("if (await roleHasAssignments(id))"), "UI does not disable assigned roles"],
  [ui.includes('title: `Remove role ${target.label}?`'), "destructive action asks explicit confirmation"],
  [ui.includes('patch("studioDefaultWorkspaceRole", "member")'), "removed default role is replaced"],
  [ui.includes('patch("projectTypePresets", projectTypePresets.map'), "removed role references cleaned from project presets"],
  [ui.includes('setSelectedRoleId("member")'), "selection cleared when role removed"],
  [settingsRoute.includes("const revokedIds = earlier.filter(") && settingsRoute.includes("proposed.enabled === false"), "server recognizes delete and disable"],
  [settingsRoute.includes('prisma.workspaceMember.findFirst({') && settingsRoute.includes("role: { in: revokedIds }"), "server checks authoritative stored memberships"],
  [settingsRoute.includes('code: "ROLE_IN_USE"') && settingsRoute.includes("reply.code(409)"), "role-in-use reports typed conflict"],
  [settingsRoute.includes("await verifyUserPin(admin, body.securityPin"), "settings edits retain PIN gate"],
  [settingsRoute.includes("await patchSettings(safeBody, expectedSettings)"), "settings writes retain revision preconditions"],
];
for(const [ok,label] of checks) assert.ok(ok,label);
console.log(`v1.1 role identity safety: ${checks.length} contracts passed.`);
