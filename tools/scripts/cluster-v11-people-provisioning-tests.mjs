import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildPeopleProvisioningPreview, provisioningPreviewInput } from "../../apps/server/src/domains/users/people-provisioning-preview.ts";

const source = path => readFileSync(path,"utf8");
const routes = source("apps/server/src/domains/users/user-directory-routes.ts");
const people = source("packages/renderer/src/features/people/PeoplePages.tsx");
const wizard = source("packages/renderer/src/features/people/PeopleProvisioningWizard.tsx");
const css = source("packages/renderer/src/features/settings/people-management-layout-v11.css");
const now = new Date("2026-11-08T18:00:00.000Z");
const settings = { studioRoleDefinitions: [{ id: "artist", label: "Artist", enabled: true }, { id: "qa", enabled: false }] };
const draft = changes => ({ role:"member",accountType:"employee",accessExpiresAt:null,...changes });
let passed=0;
function check(name,fn){fn();passed++;console.log("PASS",name);}

check("Valid default identity has no policy blockers but never claims effective access",()=>{
 const preview=buildPeopleProvisioningPreview(draft(), "admin",settings,now);
 assert.equal(preview.ready,true);
 assert.equal(preview.permissions,"NOT_AN_EFFECTIVE_ACCESS_DECISION");
 assert.equal(preview.projectGrants,"SEPARATE_APPROVAL_REQUIRED");
 assert.equal(preview.firstSignIn,"PASSWORD_CHANGE_REQUIRED");
 assert.match(preview.notice,/Project memberships/);
});
check("Owner-only privileged role and disabled role are blocked",()=>{
 assert.equal(buildPeopleProvisioningPreview(draft({role:"admin"}),"admin",settings,now).ready,false);
 assert.equal(buildPeopleProvisioningPreview(draft({role:"owner"}),"owner",settings,now).ready,true);
 assert.equal(buildPeopleProvisioningPreview(draft({role:"qa"}),"owner",settings,now).ready,false);
 assert.equal(buildPeopleProvisioningPreview(draft({role:"not_existing"}),"owner",settings,now).ready,false);
});
check("Expiry validates temporary identities and rejects past or invalid timestamps",()=>{
 assert.equal(buildPeopleProvisioningPreview(draft({accountType:"contractor"}),"owner",settings,now).ready,false);
 assert.equal(buildPeopleProvisioningPreview(draft({accountType:"guest",accessExpiresAt:"2026-12-08T23:59:59.000Z"}),"owner",settings,now).ready,true);
 assert.equal(buildPeopleProvisioningPreview(draft({accountType:"client",accessExpiresAt:"2026-10-08T23:59:59.000Z"}),"owner",settings,now).ready,false);
 assert.equal(buildPeopleProvisioningPreview(draft({accountType:"employee",accessExpiresAt:"invalid"}),"owner",settings,now).ready,false);
});
check("Preview schema rejects extra privilege-bearing fields",()=>{
 assert.equal(provisioningPreviewInput.safeParse({...draft(),toolPermissions:{serverConfig:"manage"}}).success,false);
 assert.equal(provisioningPreviewInput.safeParse({...draft(),projectPermissions:{p:"manage"}}).success,false);
 assert.equal(provisioningPreviewInput.safeParse({...draft(),username:"root"}).success,false);
 assert.equal(provisioningPreviewInput.safeParse(draft()).success,true);
});
check("Preview endpoint validates actor before reading studio role policy",()=>{
 const start=routes.indexOf('app.post("/api/admin/users/provisioning-preview"');
 const end=routes.indexOf('app.get("/api/users"',start);
 assert.ok(start>=0&&end>start);
 const segment=routes.slice(start,end);
 assert.ok(segment.indexOf('const actor = await getCurrentUser(request)') < segment.indexOf('await readSettings()'));
 assert.ok(segment.includes('ROLE_ADMIN_REQUIRED'));
 assert.ok(segment.includes('provisioningPreviewInput.safeParse(request.body)'));
 assert.ok(segment.includes('return buildPeopleProvisioningPreview(parsed.data, membership.role, await readSettings())'));
 assert.ok(!segment.includes('user.create('));
});
check("Wizard has distinct identity, access and review stages with confirmed preflight",()=>{
 assert.ok(wizard.includes('type Step = "identity" | "access" | "review"'));
 assert.ok(wizard.includes('"/api/admin/users/provisioning-preview"'));
 assert.ok(wizard.includes('const reviewed = step === "review" && snapshot === previewKey && preview?.ready === true'));
 assert.ok(wizard.includes('disabled={busy || !reviewed || !reviewAcknowledged || Boolean(blocker)}'));
 assert.ok(wizard.includes('checked={reviewAcknowledged}'));
});
check("Review never claims automatic project grants or bypasses password setup",()=>{
 assert.ok(wizard.includes('Requires separate, reviewed grants'));
 assert.ok(wizard.includes('Must change temporary password'));
 assert.ok(wizard.includes('permissions, team bundles')===false || wizard.includes('preview?.notice'));
});
check("Parent retains original canonical POST and one-time credential handoff",()=>{
 assert.ok(people.includes('<PeopleProvisioningWizard'));
 assert.ok(people.includes('"/api/users"'));
 assert.ok(people.includes('setIssuedCredential({ username: created.username, temporaryPassword: created.temporaryPassword })'));
 assert.ok(people.includes('setCreateAccountOpen(false)'));
 assert.ok(people.includes('<AccountCredentialHandoff'));
});
check("Layout is responsive, and the entire draft retains unsaved-work guard",()=>{
 assert.ok(css.includes('.people-provisioning-wizard-v11'));
 assert.ok(css.includes('@media(max-width:650px)'));
 assert.ok(people.includes('dirty: effectiveAdminMode && createAccountOpen && createAccountDirty'));
});
console.log(`People guided provisioning: ${passed} checks passed.`);
