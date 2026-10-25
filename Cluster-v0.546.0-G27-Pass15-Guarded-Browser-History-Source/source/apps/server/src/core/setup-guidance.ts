/** Administrative first-run guidance. Nothing in this catalogue can grant access or change server configuration. */
export const SETUP_GUIDES = {
  "owner-passkey": {
    group: "Security", title: "Secure every Owner with a passkey",
    detail: "Each active Owner needs an active, uncompromised passkey. Passwords alone do not satisfy the Owner security baseline.",
    nextStep: "Open People / Security and enroll a passkey for each Owner. Never share an administrator authenticator.",
    destination: "people",
  },
  "recovery-codes": {
    group: "Security", title: "Preserve independent Owner recovery",
    detail: "Each active Owner needs unused recovery codes. These are a last-resort login recovery method, not a shared master password.",
    nextStep: "Have each Owner generate and securely store their own recovery codes offline. Do not paste codes into a support ticket.",
    destination: "people",
  },
  "studio-identity": {
    group: "Studio", title: "Set the studio name",
    detail: "The internal studio identity appears in administrative surfaces and is not a substitute for an external publishing identity.",
    nextStep: "Configure Studio Settings → Identity.",
    destination: "studio",
  },
  "studio-timezone": {
    group: "Studio", title: "Confirm the studio timezone",
    detail: "Calendar and scheduled operations use IANA timezones. Choose the studio's local default before scheduling work.",
    nextStep: "Review Studio Settings → Timezone; imported values must be valid IANA zones.",
    destination: "studio",
  },
  "backups": {
    group: "Infrastructure", title: "Configure backups",
    detail: "This check confirms backup policy is enabled, not that any backup or restore has succeeded.",
    nextStep: "Open Server Configuration → Backups, configure protected storage, then separately verify a successful backup and recovery.",
    destination: "server",
  },
  "second-admin": {
    group: "Security", title: "Add a backup administrator",
    detail: "A second administrator reduces lockout risk and supports independent reviews for privileged actions.",
    nextStep: "Use People administration to provision a separate authorized administrator account.",
    destination: "people",
  },
  "domains": {
    group: "Infrastructure", title: "Verify a domain and configure member access",
    detail: "Domain setup begins in OOBE. Completion here means a verified local-server binding and an access profile, not a proven live gateway, TLS or remote login.",
    nextStep: "Verify DNS proof under Studio Settings → Domains, then bind the hostname and deploy a gateway from Server Configuration → Domains & gateways.",
    destination: "server",
  },
  "first-project": {
    group: "Workspace", title: "Create a Project",
    detail: "A Project provides an initial scope for Boards, Library records, QA, and Builds.",
    nextStep: "Create a Project and select a Project Lead.",
    destination: "projects",
  },
} as const;
export type SetupGuideId = keyof typeof SETUP_GUIDES;

/** Never count a different Owner's passkey as recovery assurance for this Owner. */
export function ownerSecurityReadiness(ownerIds: readonly string[], passkeyOwnerIds: readonly string[], recoveryOwnerIds: readonly string[]) {
  const owners = new Set(ownerIds);
  const withPasskeys = new Set(passkeyOwnerIds);
  const withRecovery = new Set(recoveryOwnerIds);
  let missingPasskeys = 0;
  let missingRecovery = 0;
  for (const owner of owners) {
    if (!withPasskeys.has(owner)) missingPasskeys++;
    if (!withRecovery.has(owner)) missingRecovery++;
  }
  return {
    ownerCount: owners.size,
    passkeysReady: owners.size > 0 && missingPasskeys === 0,
    recoveryReady: owners.size > 0 && missingRecovery === 0,
    missingPasskeys,
    missingRecovery,
  };
}
