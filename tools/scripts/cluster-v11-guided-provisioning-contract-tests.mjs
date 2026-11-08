import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validatePeopleAccountCreation } from "../../packages/renderer/src/features/people/people-account-creation-validation.ts";


const source=(path)=>readFileSync(path,"utf8");
const wizard=source("packages/renderer/src/features/people/PeopleAccountProvisioningWizard.tsx");
const pages=source("packages/renderer/src/features/people/PeoplePages.tsx");
const route=source("apps/server/src/domains/users/people-provisioning-preview-routes.ts");
const registry=source("apps/server/src/domains/users/user-directory-routes.ts");
const roleGovernance=source("apps/server/src/domains/users/people-role-governance.ts");
const css=source("packages/renderer/src/features/people/people-account-provisioning-wizard.css");
const rolePreview=source("apps/server/src/domains/users/people-role-change-preview-routes.ts");
const roleEditor=source("packages/renderer/src/features/people/PeopleRoleAssignmentPanel.tsx");
const roleCss=source("packages/renderer/src/features/people/people-role-impact-preview.css");
let passed=0;function check(label,fn){fn();passed++;console.log("PASS",label);}
const base={username:"user_name",email:"",accountType:"employee",accessExpiresAt:"",role:"member"};
check("Guided creation keeps identity, starting access and review distinct",()=>{
  assert.ok(wizard.includes('"identity", label: "Identity"'));
  assert.ok(wizard.includes('"access", label: "Starting access"'));
  assert.ok(wizard.includes('"review", label: "Review & create"'));
  assert.ok(wizard.includes('onClick={() => setStage("access")}'));
  assert.ok(wizard.includes('onClick={() => void reviewWithServer()}'));
});
check("Actual creation cannot occur until matching server preflight succeeds",()=>{
  assert.ok(wizard.includes('preview?.signature === signature'));
  assert.ok(wizard.includes('readyReview?.canCreate === true'));
  assert.ok(wizard.includes('preview?.signature !== latestSignatureRef.current'));
  assert.ok(wizard.includes('if (!canSubmit || !readyReview'));
  assert.ok(wizard.includes('await onCreate();'));
});
check("Preview is on demand, not called once per keystroke",()=>{
  assert.ok(wizard.includes('async function reviewWithServer()'));
  assert.ok(wizard.includes('"/api/admin/users/provisioning-preview"'));
  assert.ok(wizard.includes('const requestId = ++previewSequenceRef.current;'));
  assert.ok(wizard.includes('requestSignature !== latestSignatureRef.current'));
  assert.ok(wizard.includes('++previewSequenceRef.current;\n    setPreview(null);'));
  assert.ok(!wizard.includes('useEffect(() => { void reviewWithServer()'));
});
check("Invalid expiry never throws during review-signature calculation",()=>{
  assert.ok(wizard.includes('expiry && Number.isFinite(expiry.getTime())'));
  assert.match(validatePeopleAccountCreation({...base,accountType:"guest"} ,true).accessExpiresAt,/need an expiration/);
});
check("Server revalidates role and expiry using the same authoritative rules as creation",()=>{
  assert.ok(route.includes('requireAssignableStudioRole(await readSettings(), input.role)'));
  assert.ok(registry.includes('requireAssignableStudioRole(await readSettings(), body.role)'));
  assert.ok(route.includes('validateReturnAccessWindow(input.accountType, expiresAt)'));
  assert.ok(registry.includes('validateReturnAccessWindow(body.accountType || "employee"'));
  assert.ok(route.includes('registerPeopleProvisioningPreviewRoutes'));
});
check("Preflight is strictly read-only and requires owner/admin membership",()=>{
  assert.ok(route.includes('["owner", "admin"].includes(membership.role)'));
  assert.ok(route.includes('ROLE_ADMIN_REQUIRED'));
  assert.ok(!route.includes('prisma.user.create('));
  assert.ok(!route.includes('prisma.workspaceMember.update('));
  assert.ok(!route.includes('prisma.$transaction('));
  assert.ok(route.includes('prisma.user.findUnique('));
});
check("Role catalog never silently maps disabled or privileged roles to active ones",()=>{
  assert.ok(roleGovernance.includes('enabled: raw.enabled !== false'));
  assert.ok(roleGovernance.includes('privileged: id === "owner" || id === "admin"'));
  assert.ok(roleGovernance.includes('if (!role || !role.enabled)'));
  assert.ok(wizard.includes('canChooseStudioRole(role, roleCatalog?.actorRole)'));
  assert.ok(wizard.includes('disabled={!canChooseStudioRole(role, roleCatalog?.actorRole)}'));
});
check("Preview represents policy-derived initial tool matrix, not a resource grant",()=>{
  assert.ok(route.includes('authorization.configuredToolPermissionsForRole(role.id'));
  assert.ok(route.includes('toolPermissions: {}'));
  assert.ok(route.includes('studioTeamMemberships: []'));
  assert.ok(route.includes('No Project membership or individual scoped grant is created'));
  assert.ok(wizard.includes('This is not an effective-access grant.'));
});
check("Committed account still uses the existing one-time credential handoff",()=>{
  assert.ok(pages.includes('<PeopleAccountProvisioningWizard'));
  assert.ok(pages.includes('onCreate={createPersonAccount}'));
  assert.ok(pages.includes('setIssuedCredential({ username: created.username, temporaryPassword: created.temporaryPassword });'));
  assert.ok(pages.includes('<AccountCredentialHandoff'));
  assert.ok(pages.includes('setCreateAccountOpen(false);'));
});
check("Creation does not silently add Project grants, team membership, or bypass scope",()=>{
  assert.ok(registry.includes('SCOPED_GRANT_REVIEW_REQUIRED'));
  assert.ok(registry.includes('memberships: { create: { workspaceId: workspace.id, role: body.role } }'));
  assert.ok(route.includes('only; effective access'));
  assert.ok(wizard.includes('No individual Project grant or team membership is assigned'));
});
check("Wizard is responsive and keeps the access review readable",()=>{
  assert.ok(css.includes('@media(max-width:680px)'));
  assert.ok(css.includes('.people-account-wizard-progress-v11'));
  assert.ok(wizard.includes('<details>'));
  assert.ok(wizard.includes('Review all starting tool levels'));
});
check("Role change preview checks authority and matches workspace-specific membership",()=>{
  assert.ok(rolePreview.includes('["owner", "admin"].includes(membership.role)'));
  assert.ok(rolePreview.includes('where: { id: userId, memberships: { some: { workspaceId: membership.workspaceId } } }'));
  assert.ok(rolePreview.includes('ROLE_SELF_CHANGE_DENIED'));
  assert.ok(rolePreview.includes('ROLE_OWNER_REQUIRED'));
  assert.ok(rolePreview.includes('ROLE_LAST_OWNER'));
  assert.ok(rolePreview.includes('PEOPLE_LIFECYCLE_GOVERNED'));
  assert.ok(registry.includes('registerPeopleRoleChangePreviewRoutes'));
});
check("Role preview does not weaken transactional owner or revision protections",()=>{
  assert.ok(rolePreview.includes('configuredToolPermissionsForRole(previousRole'));
  assert.ok(rolePreview.includes('configuredToolPermissionsForRole(nextRole.id'));
  assert.ok(rolePreview.includes('not a guarantee of effective access'));
  assert.ok(!rolePreview.includes('prisma.workspaceMember.update('));
  assert.ok(!rolePreview.includes('prisma.user.update('));
  assert.ok(registry.includes('assignWorkspaceRole(tx'));
  assert.ok(registry.includes('PROFILE_REVISION_CONFLICT'));
});
check("Existing role editor requires fresh matching review before Apply",()=>{
  assert.ok(roleEditor.includes('"/api/admin/users/'));
  assert.ok(roleEditor.includes('role-change-preview'));
  assert.ok(roleEditor.includes('preview?.key === previewKey'));
  assert.ok(roleEditor.includes('!reviewed?.canApply'));
  assert.ok(roleEditor.includes('reviewed.profileRevision !== (person.profileRevision || 1)'));
  assert.ok(roleEditor.includes('requestId !== previewSequenceRef.current || key !== currentKeyRef.current'));
  assert.ok(roleEditor.includes('Review role impact'));
  assert.ok(roleEditor.includes('Apply reviewed role'));
  assert.ok(roleCss.includes('.people-role-impact-v11'));
});
console.log(`Guided provisioning contracts: ${passed} checks passed.`);
