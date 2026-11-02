import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

const file = (path) => readFileSync(path, "utf8");
const source = file("apps/server/src/domains/auth/desktop-session-handoff.ts");
const { desktopSessionHandoffAllowed } = await import("data:text/javascript;base64," +
  Buffer.from(stripTypeScriptTypes(source, { mode: "strip" })).toString("base64"));

const now = Date.parse("2026-11-01T20:00:00Z");
const valid = () => ({
  userId: "person-a",
  user: { id: "person-a", accountState: "ACTIVE", archived: false, authenticationGeneration: 6 },
  source: { id: "browser-session", userId: "person-a", authMethod: "password+totp", authenticationGeneration: 6,
    revokedAt: null, createdAt: new Date(now - 3600_000), lastSeenAt: new Date(now - 60_000), expiresAt: new Date(now + 24*3600_000) },
  requireDiscordLink: false, sessionDays: 7, sessionIdleHours: 48, now,
});
const allowed = desktopSessionHandoffAllowed;
assert.equal(allowed(valid()), true, "fully authenticated, current browser session is eligible");
{
  const v = valid(); v.source.authMethod = "password"; v.mfaRequired = true;
  assert.equal(allowed(v), false, "MFA-required accounts cannot hand off a password-only session");
  v.source.authMethod = "password+totp";
  assert.equal(allowed(v), true, "A completed MFA session can still open Desktop");
}
for (const mutation of [
  v => { v.source.revokedAt = new Date(now - 1); },
  v => { v.source.authMethod = "mfa-enrollment-pending"; },
  v => { v.source.userId = "person-b"; },
  v => { v.user.id = "person-b"; },
  v => { v.user.accountState = "PASSWORD_CHANGE_REQUIRED"; },
  v => { v.user.accountState = "SUSPENDED"; },
  v => { v.user.archived = true; },
  v => { v.user.authenticationGeneration = 7; },
  v => { v.source.expiresAt = new Date(now); },
  v => { v.source.lastSeenAt = new Date(now - 49*3600_000); },
  v => { v.source.createdAt = new Date(now - 8*24*3600_000); },
  v => { v.user.accessExpiresAt = new Date(now); },
]) {
  const candidate = valid(); mutation(candidate);
  assert.equal(allowed(candidate), false, "invalid source or user must never mint a native login: " + mutation.toString());
}
{
  const candidate=valid();
  candidate.user.accountState="DISCORD_LINK_REQUIRED";
  assert.equal(allowed(candidate), true);
  candidate.requireDiscordLink=true;
  assert.equal(allowed(candidate), false);
}
const auth = file("apps/server/src/domains/auth/auth-core-routes.ts");
assert.match(auth,/sourceSessionId: String\(session\.id\)/);
assert.match(auth,/prisma as any\)\.session\.findUnique\(\{ where: \{ id: claim\.sourceSessionId \}/);
assert.match(auth,/desktopSessionHandoffAllowed\(\{/);
assert.match(auth,/DESKTOP_SOURCE_SESSION_REVOKED/);

const profiles = JSON.parse(file("config/distribution-profiles.json")).profiles;
const desktop = profiles["desktop-windows-x64"];
assert.ok(desktop.artifacts.every(x => !x.includes("{version}")), "Desktop distribution artifact cannot be named with Server source version");
assert.ok(desktop.artifacts.every(x => x.includes("{desktopVersion}")), "Desktop artifact names must track Qt native version");
const script = file("tools/scripts/package-qt-desktop.mjs");
assert.match(script,/Cluster-Desktop-\$\{nativeVersion\}-\$\{platform\}-\$\{architecture\}\.zip/);
assert.doesNotMatch(script,/Cluster-Desktop-\$\{manifest\.version\}/);
const restore = file("apps/server/src/core/database-recovery.ts");
assert.match(restore,/runDatabaseRestoreDrill\(\{ databaseUrl: input\.databaseUrl, dumpPath: input\.dumpPath \}\)/);
assert.match(restore,/safety backup path already exists|Safety backup path already exists/);
assert.match(restore,/if \(!safety\.stdout\.includes\("TABLE"\)/);
assert.match(restore,/CREATE DATABASE \$\{sqlIdentifier\(databaseName\)\} TEMPLATE template0/);
assert.match(restore,/DROP DATABASE IF EXISTS \$\{sqlIdentifier\(databaseName\)\}/);
assert.doesNotMatch(restore,/DROP DATABASE IF EXISTS \$\{sqlIdentifier\(databaseName\)\}; CREATE DATABASE/);
assert.match(restore,/AggregateError\(\[restoreError, rollbackError\]/);
assert.match(restore,/Do not restart Cluster/);
console.log("PASS: Desktop version isolation, browser-to-native auth safety and verified database rollback contracts");
