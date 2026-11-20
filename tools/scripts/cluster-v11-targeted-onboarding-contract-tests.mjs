import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read=(path)=>readFileSync(path,"utf8");
const route=read("apps/server/src/domains/studio-systems/studio-onboarding-routes.ts");
const wizard=read("packages/renderer/src/features/people/PeopleAccountProvisioningWizard.tsx");
const people=read("packages/renderer/src/features/people/use-account-provisioning.ts");
const usersPage=read("packages/renderer/src/features/admin/AdminUsersPage.tsx");
const css=read("packages/renderer/src/features/people/people-account-provisioning-wizard.css");
let n=0;function check(label,okay){assert.ok(okay,label);n++;console.log("PASS",label);}

check("A dedicated single-person route does not reuse audience broadcast",
  route.includes('"/api/studio-systems/onboarding/versions/:versionId/assign-person"') &&
  route.includes('"/api/studio-systems/onboarding/versions/:versionId/assign"') &&
  route.includes('id: input.data.userId,') &&
  !route.slice(route.indexOf('"/api/studio-systems/onboarding/versions/:versionId/assign-person"'),route.indexOf('app.patch("/api/studio-systems/onboarding/assignments')).includes('resolveStudioAudienceUserIds('));
check("Strong admin and workspace guard occurs before target queries",
  route.includes('["owner", "admin"].includes(actorMembership.role)') &&
  route.includes('memberships: { some: { workspaceId: actorMembership.workspaceId } }') &&
  route.includes('ONBOARDING_TARGET_UNAVAILABLE'));
check("Published version, active target and matching audience required",
  route.includes('version.status !== "published" || version.plan.status !== "active"') &&
  route.includes('accountState: { notIn: ["DISABLED", "PRIVACY_ERASED"] }') &&
  route.includes('ONBOARDING_TARGET_EXPIRED') &&
  route.includes('await studioAudienceMatchesUser(tx, version.plan.audienceJson, target)') &&
  route.includes('ONBOARDING_AUDIENCE_MISMATCH'));
check("Assignments use a transaction and cannot accidentally duplicate or reactivate",
  route.includes('await prisma.$transaction(async (tx: any) => {') &&
  route.includes('tx.studioOnboardingAssignment.createMany({') &&
  route.includes('skipDuplicates: true') &&
  route.includes('ONBOARDING_ASSIGNMENT_INACTIVE') &&
  route.includes('source: "admin_person"'));
check("Wizard offers optional published plans from existing administration authority",
  wizard.includes('"/api/studio-systems/onboarding"') &&
  wizard.includes('plan.status === "active"') &&
  wizard.includes('version.status === "published"') &&
  wizard.includes('Do not assign onboarding yet') &&
  wizard.includes('onPatch({ onboardingVersionId: event.target.value })'));
check("Review identity includes onboarding choice without changing authentication preflight input",
  wizard.includes('signature = JSON.stringify({ ...previewPayload(draft), onboardingVersionId: draft.onboardingVersionId })') &&
  wizard.includes('const requestSignature = JSON.stringify({ ...body, onboardingVersionId: draft.onboardingVersionId });') &&
  wizard.includes('body: JSON.stringify(body)') &&
  wizard.includes('The onboarding assignment is a separate governed operation after account creation'));
check("Account creation commits before onboarding without interpreting failure as account failure",
  people.includes('setIssuedCredential({ username: created.username, temporaryPassword: created.temporaryPassword })') &&
  people.includes('const onboardingVersionId = draft.onboardingVersionId;') &&
  people.indexOf('setIssuedCredential({ username: created.username') < people.indexOf('if (onboardingVersionId) {') &&
  people.includes('setOnboardingFollowup({ userId: created.id, versionId: onboardingVersionId, message })'));
check("Retry is scoped to existing user only, never re-posts an account",
  people.includes('async function retryOnboarding()') &&
  people.includes('/assign-person`, {\n        method: "POST", body: JSON.stringify({ userId: current.userId })') &&
  usersPage.includes('Retry onboarding') &&
  people.includes('No duplicate account was created.'));
check("Session changes clear private handoff and pending remediation state",
  people.includes('setIssuedCredential(null);\n    setOnboardingFollowup(null);\n  }, [currentUserId]);'));
check("Responsive followup avoids onboarding burying the one-time credential handoff",
  usersPage.indexOf('<AccountCredentialHandoff') < usersPage.indexOf('provisioning.onboardingFollowup ? <div className="au-followup" role="alert">') &&
  usersPage.includes('<AccountCredentialHandoff'));
console.log(`Targeted onboarding contract checks: ${n} passed.`);
