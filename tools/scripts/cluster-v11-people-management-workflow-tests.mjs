import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validatePeopleAccountCreation, firstPeopleAccountCreateError } from "../../packages/renderer/src/features/people/people-account-creation-validation.ts";
import { resolveAdminActivationState } from "../../apps/server/src/domains/auth/admin-account-activation-policy.ts";

const source = (path) => readFileSync(path, "utf8");
const people = source("packages/renderer/src/features/people/PeoplePages.tsx");
const handoff = source("packages/renderer/src/features/people/AccountCredentialHandoff.tsx");
const auth = source("apps/server/src/domains/auth/auth-admin-routes.ts");
const css = source("packages/renderer/src/features/people/account-credential-handoff.css");
const now = new Date("2026-11-06T15:00:00Z");
const draft = (changes = {}) => ({
  username: "new_member", email: "", accountType: "employee", accessExpiresAt: "", role: "member", ...changes,
});
let count = 0;
function check(label, action) { action(); count++; console.log("PASS", label); }

check("valid employee defaults do not require an access expiration", () => {
  assert.deepEqual(validatePeopleAccountCreation(draft(), true, now), {});
});
check("username and email have actionable local validation", () => {
  assert.match(validatePeopleAccountCreation(draft({username:"xx"}), true, now).username, /3–32/);
  assert.match(validatePeopleAccountCreation(draft({username:"x".repeat(33)}), true, now).username, /3–32/);
  assert.match(validatePeopleAccountCreation(draft({email:"wrong"}), true, now).email, /valid email/);
  assert.equal(validatePeopleAccountCreation(draft({email:"member@example.org"}), true, now).email, undefined);
});
check("temporary identity types require expiry", () => {
  for (const accountType of ["contractor", "client", "guest"]) {
    assert.match(validatePeopleAccountCreation(draft({accountType}), true, now).accessExpiresAt, /need an expiration/);
  }
});
check("future end-of-day expiry accepted, expired and impossible dates rejected", () => {
  assert.equal(validatePeopleAccountCreation(draft({accountType:"contractor",accessExpiresAt:"2026-11-07"}), true, now).accessExpiresAt, undefined);
  for (const date of ["2026-11-05", "2026-02-30", "invalid", "2026-13-01"]) {
    assert.match(validatePeopleAccountCreation(draft({accountType:"contractor",accessExpiresAt:date}), true, now).accessExpiresAt, /valid future/);
  }
});
check("role eligibility blocks provisioning before POST", () => {
  const errors = validatePeopleAccountCreation(draft(), false, now);
  assert.match(firstPeopleAccountCreateError(errors), /enabled workspace role/);
});
check("server reactivation preserves temporary password requirements", () => {
  const active = () => "ACTIVE";
  const discordRequired = () => "DISCORD_LINK_REQUIRED";
  assert.equal(resolveAdminActivationState({passwordChangedAt:null,discordUserId:null},false,active), "PASSWORD_CHANGE_REQUIRED");
  assert.equal(resolveAdminActivationState({passwordChangedAt:null,discordUserId:"a"},true,discordRequired), "PASSWORD_CHANGE_REQUIRED");
  assert.equal(resolveAdminActivationState({passwordChangedAt:new Date("2026-01-01"),discordUserId:null},false,active), "ACTIVE");
  assert.equal(resolveAdminActivationState({passwordChangedAt:new Date("2026-01-01"),discordUserId:null},true,discordRequired), "DISCORD_LINK_REQUIRED");
});
check("real activation route uses password-state policy", () => {
  assert.ok(auth.includes('resolveAdminActivationState(target, REQUIRE_DISCORD_LINK, nextAccountState)'));
  assert.ok(auth.includes('body.state === "ACTIVE" && !target.passwordHash'));
  assert.ok(auth.includes('PEOPLE_LIFECYCLE_GOVERNED'));
});
check("account form shows why provision is disabled", () => {
  assert.ok(people.includes('validatePeopleAccountCreation(createAccountDraft,'));
  assert.ok(people.includes('Boolean(createAccountBlocker)} onClick={() => void createPersonAccount()'));
  assert.ok(people.includes('role="status">{createAccountBlocker}'));
  assert.ok(people.includes('role="alert">{createAccountError}'));
});
check("account drafts require confirmation before deliberate close", () => {
  assert.ok(people.includes('async function toggleCreateAccount()'));
  assert.ok(people.includes('await confirmCreateAccountDiscard()'));
  assert.ok(people.includes('dirty: effectiveAdminMode && createAccountOpen && createAccountDirty'));
});
check("one-time password cannot be dismissed without an acknowledgment", () => {
  assert.ok(handoff.includes('checked={handoffAcknowledged}'));
  assert.ok(handoff.includes('disabled={!handoffAcknowledged}'));
  assert.ok(handoff.includes('onCancel={(event) => event.preventDefault()}'));
  assert.ok(handoff.includes('useUnsavedChangesGuard({ dirty: true'));
  assert.ok(css.includes('.people-credential-handoff-confirm-v11'));
});
check("lifecycle changes require explicit confirmation and avoid redundant transitions", () => {
  assert.ok(people.includes('accountStateActionGateRef.current = true;'));
  assert.ok(people.includes('title: state === "ACTIVE" ? "Reactivate account?"'));
  assert.ok(people.includes('if (!confirmed || activeProfileIdRef.current !== userId) return;'));
  assert.ok(people.includes('String(profile.accountState || "ACTIVE").toUpperCase() === "SUSPENDED"'));
});
check("account type changes are deliberate, error-local, and cannot create an unexpiring external identity", () => {
  assert.ok(people.includes('async function changeProfileAccountType(nextType: string)'));
  assert.ok(people.includes('title: "Change account type?"'));
  assert.ok(people.includes('The current renewal flow cannot assign an initial expiry'));
  assert.ok(people.includes('onChange={(event) => void changeProfileAccountType(event.target.value)}'));
  assert.ok(people.includes('adminActionFeedback && <p role={adminActionFeedback.error ? "alert" : "status"}'));
});
console.log(`People management workflow: ${count} checks passed.`);
