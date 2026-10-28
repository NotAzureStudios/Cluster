import fs from "node:fs";
const read = (file) => fs.readFileSync(file, "utf8");
const has = (file, text) => read(file).includes(text);
const checks = [
  ["product SemVer matches current release contract", JSON.parse(read("package.json")).version === JSON.parse(read("VERSION_NAMING_CONVENTION.json")).internalSemver],
  ["public UI displays v0.506", has("packages/renderer/src/core/version.ts", 'replace(/\\.0$/, "")')],
  ["owner recovery password model removed", !has("apps/server/prisma/schema.prisma", "model OwnerRecoveryCredential")],
  ["owner recovery password dropped with a new migration", has("apps/server/prisma/migrations/20261007222000_remove_owner_recovery_password/migration.sql", 'DROP TABLE IF EXISTS "OwnerRecoveryCredential"')],
  ["no owner recovery password routes remain", !has("apps/server/src/domains/auth/auth-core-routes.ts", '/api/auth/owner-recovery') && !has("apps/server/src/domains/auth/auth-admin-routes.ts", '/api/admin/owner-recovery')],
  ["public auth config no longer advertises an owner recovery password", !has("apps/server/src/domains/auth/auth-core-routes.ts", "ownerRecoveryConfigured")],
  ["owner setup no longer accepts a second permanent recovery password", !has("apps/server/src/app/server-routes-setup.ts", "ownerRecoveryPassword")],
  ["owner's initial setup session uses password authentication", has("apps/server/src/app/server-routes-setup.ts", 'authMethod: "password"')],
  ["Owner MFA follows explicit studio policy", !has("apps/server/src/core/studio-security-policy.ts", 'toLowerCase() === "owner") return true;')],
  ["owner minimum authenticator strength remains phishing resistant", has("apps/server/src/core/studio-security-policy.ts", '"phishing_resistant"')],
  ["passkey enrollment issues hashed one-time recovery codes", has("apps/server/src/domains/auth/authenticator-service.ts", "issueInitialRecoveryCodes") && has("apps/server/src/domains/auth/auth-mfa-routes.ts", "recoveryCodes")],
  ["owner setup UI defers passkeys until after sign-in", has("packages/renderer/src/features/application/modules/ApplicationSetupWizard.tsx", "MFA setup after sign-in")],
  ["native launcher local administrator recovery stays available", has("apps/server/src/scripts/bootstrap-owner.ts", "issueAdministratorRecoveryCredential")],
  ["active source includes P16C capability exposure", has("packages/renderer/src/features/projects/ProjectWorkflowGraphPanel.tsx", "Workflow graph direction")],
];
const oldNames = ["apps/server/src", "packages/renderer/src"].flatMap((folder) => {
  const matches=[]; const stack=[folder];
  while (stack.length) { const path=stack.pop();for (const entry of fs.readdirSync(path,{withFileTypes:true})) { const next=`${path}/${entry.name}`;if(entry.isDirectory())stack.push(next);else if (/\.(ts|tsx)$/.test(entry.name) && /ownerRecoveryCredential|ownerRecoveryPassword|ownerRecoveryConfigured/.test(read(next))) matches.push(next); }}
  return matches;
});
checks.push(["no active obsolete owner recovery password references remain", oldNames.length === 0]);
let passed=0; for(const [title,ok] of checks){console.log(`${ok?'PASS':'FAIL'} ${title}`);if(ok)passed++;}
console.log(`${passed}/${checks.length} v0.506 assertions passed`);
if(passed!==checks.length)process.exit(1);
