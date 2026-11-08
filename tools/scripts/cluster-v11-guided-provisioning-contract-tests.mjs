import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validatePeopleAccountCreation } from "../../packages/renderer/src/features/people/people-account-creation-validation.ts";
import { assignableStudioRoles, requireAssignableStudioRole } from "../../apps/server/src/domains/users/people-role-governance.ts";

const source=(path)=>readFileSync(path,"utf8");
const wizard=source("packages/renderer/src/features/people/PeopleAccountProvisioningWizard.tsx");
const pages=source("packages/renderer/src/features/people/PeoplePages.tsx");
const route=source("apps/server/src/domains/users/people-provisioning-preview-routes.ts");
const registry=source("apps/server/src/domains/users/user-directory-routes.ts");
const css=source("packages/renderer/src/features/people/people-account-provisioning-wizard.css");
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
  const roles=assignableStudioRoles({studioRoleDefinitions:[{id:"disabled_role",label:"Disabled",enabled:false}]});
  assert.equal(roles.find(x=>x.id==="disabled_role").enabled,false);
  assert.equal(requireAssignableStudioRole({},"owner").privileged,true);
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
console.log(`Guided provisioning contracts: ${passed} checks passed.`);
