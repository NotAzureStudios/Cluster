import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createAccountInvitationToken, accountInvitationDigest, accountInvitationEligible,
  approvedAccountInvitationOrigin, ACCOUNT_INVITATION_TOKEN_PATTERN,
  ACCOUNT_INVITATION_TTL_MS,
} from "../../apps/server/src/domains/auth/account-invitation-policy.ts";

const read=(path)=>readFileSync(path,"utf8");
const routes=read("apps/server/src/domains/auth/account-invitation-routes.ts");
const registry=read("apps/server/src/domains/auth/auth-routes.ts");
const schema=read("apps/server/prisma/schema.prisma");
const migration=read("apps/server/prisma/migrations/20261116000000_v11_account_activation_invitations/migration.sql");
const cover=read("packages/renderer/src/features/auth/PublicClusterCover.tsx");
const activate=read("packages/renderer/src/features/auth/AccountInvitationActivation.tsx");
const admin=read("packages/renderer/src/features/people/PeoplePages.tsx");
const handoff=read("packages/renderer/src/features/people/AccountInvitationHandoff.tsx");
let n=0;function check(label, fn){fn();n++;console.log("PASS",label);}

check("Tokens are 256-bit random, purpose separated and digested before storage",()=>{
  const first=createAccountInvitationToken(),second=createAccountInvitationToken();
  assert.match(first.token,ACCOUNT_INVITATION_TOKEN_PATTERN);
  assert.equal(first.token.length,43);
  assert.equal(first.digest,accountInvitationDigest(first.token));
  assert.match(first.digest,/^[a-f0-9]{64}$/);
  assert.notEqual(first.token,second.token);
  assert.notEqual(first.digest,second.digest);
  assert.equal(first.digest.includes(first.token),false);
  assert.equal(ACCOUNT_INVITATION_TTL_MS,86_400_000);
});
check("Origin is configured and HTTPS, except loopback development",()=>{
  assert.equal(approvedAccountInvitationOrigin("https://cluster.example.test"),"https://cluster.example.test");
  assert.equal(approvedAccountInvitationOrigin("http://localhost:3000"),"http://localhost:3000");
  for(const bad of ["http://192.168.1.2:3000","http://cluster.example.com","javascript:alert(1)",
    "https://example.com/path","https://u:p@example.com","https://example.com/#token","https://example.com/?x=1"]){
    assert.equal(approvedAccountInvitationOrigin(bad),null,bad);
  }
});
check("Only unexpired first-use password-setup accounts may activate",()=>{
  assert.equal(accountInvitationEligible({accountState:"PASSWORD_CHANGE_REQUIRED",passwordChangedAt:null}),true);
  assert.equal(accountInvitationEligible({accountState:"ACTIVE",passwordChangedAt:null}),false);
  assert.equal(accountInvitationEligible({accountState:"PASSWORD_CHANGE_REQUIRED",passwordChangedAt:new Date()}),false);
  assert.equal(accountInvitationEligible({accountState:"PASSWORD_CHANGE_REQUIRED",archived:true}),false);
  assert.equal(accountInvitationEligible({accountState:"PASSWORD_CHANGE_REQUIRED",accessExpiresAt:"2020-01-01"}),false);
});
check("Schema and migration persist only digests and generation-bound lifecycle",()=>{
  assert.ok(schema.includes("model StudioAccountInvitation {"));
  assert.ok(schema.includes("tokenHash      String   @unique"));
  assert.ok(schema.includes("authGeneration Int"));
  assert.ok(schema.includes("consumedAt     DateTime?"));
  assert.ok(schema.includes("revokedAt      DateTime?"));
  assert.ok(migration.includes('CREATE UNIQUE INDEX "StudioAccountInvitation_tokenHash_key"'));
  assert.ok(!migration.includes("tokenPlaintext"));
  assert.ok(!schema.includes("activationLink String"));
});
check("Activation is bound to the role at issuance, and changes invalidate invitations",()=>{
  assert.ok(schema.includes("roleAtIssue    String"));
  assert.ok(migration.includes('"roleAtIssue" TEXT NOT NULL'));
  assert.ok(routes.includes('roleAtIssue: targetMembershipNow.role'));
  assert.ok(routes.includes('currentMembership.role !== invitation.roleAtIssue'));
  assert.ok(routes.includes('acquireTransactionAdvisoryLock(tx, `cluster-workspace-role:'));
});
check("Admin only issues links after role and identity gates, always invalidating old password",()=>{
  assert.ok(routes.includes('authorization.requireAdmin(request, reply)'));
  assert.ok(routes.includes('["owner", "admin"].includes(membership.role)'));
  assert.ok(routes.includes('actor.membership.role !== "owner"'));
  assert.ok(routes.includes('accountInvitationEligible(target)'));
  assert.ok(routes.includes('authenticationGeneration: target.authenticationGeneration'));
  assert.ok(routes.includes('passwordHash: null, // Revokes the temporary password immediately.'));
  assert.ok(routes.includes('revokedById: actor.admin.id'));
  assert.ok(routes.includes('Cache-Control", "no-store"'));
});
check("Token can be consumed once, under a transactional account generation check",()=>{
  assert.ok(routes.includes('tx.studioAccountInvitation.updateMany({'));
  assert.ok(routes.includes('consumedAt: null, revokedAt: null, expiresAt: { gt: now }'));
  assert.ok(routes.includes('accountState: "PASSWORD_CHANGE_REQUIRED"'));
  assert.ok(routes.includes('authenticationGeneration: invitation.authGeneration'));
  assert.ok(routes.includes('if (claimed.count !== 1) return null;'));
  assert.ok(routes.includes('if (changed.count !== 1) throw new Error("ACCOUNT_INVITATION_TARGET_CHANGED")'));
});
check("Public activation cannot mint sessions or bypass MFA",()=>{
  assert.ok(routes.includes('"/api/auth/account-invitations/activate"'));
  assert.ok(!routes.includes('createSession('));
  assert.ok(routes.includes('nextAccountState(invitation.user.discordUserId, requireDiscordLink)'));
  assert.ok(routes.includes('validateNewPassword(body.data.password, invitation.user)'));
  assert.ok(routes.includes('rateLimitKey(reply, rateKey, 5, 15 * 60 * 1000)'));
  assert.ok(routes.includes('onUserSessionsRevoked(consumed'));
  assert.ok(registry.includes('registerAccountInvitationRoutes(deps);'));
});
check("Invitation fragment is cleared before activation renders",()=>{
  assert.ok(cover.includes('fragment.startsWith("#activate=")'));
  assert.ok(cover.includes('window.history.replaceState(window.history.state, "", cleanUrl)'));
  assert.ok(cover.includes('<AccountInvitationActivation token={activationToken}'));
  assert.ok(cover.includes('return capturedToken;'));
  assert.ok(!cover.includes('let pendingActivationToken'));
  assert.ok(cover.includes('setActivationToken(null);'));
  assert.ok(activate.includes('"/api/auth/account-invitations/activate"'));
  assert.ok(activate.includes('setConsumedToken(null)'));
  assert.ok(!activate.includes('createSession('));
});
check("One-time link handoff requires acknowledgment and stays account scoped",()=>{
  assert.ok(admin.includes('async function issueActivationInvitationForProfile()'));
  assert.ok(admin.includes('setIssuedActivationLink({ username: result.username'));
  assert.ok(admin.includes('setIssuedActivationLink(null);'));
  assert.ok(handoff.includes('onCancel={(event) => event.preventDefault()}'));
  assert.ok(handoff.includes('disabled={!acknowledged}'));
  assert.ok(handoff.includes('useUnsavedChangesGuard('));
  assert.ok(handoff.includes('text={activationLink}'));
  assert.ok(!handoff.includes('localStorage'));
});
console.log(`Account invitation security contracts: ${n} checks passed.`);
