# Cluster 0.546.0 | G26 Credential Disclosure, Audit & Custody Closeout

## Parent source

`Cluster-v0.546.0-TD6-G26-Managed-Preview-IO-Authority-Source.zip`.  This checkpoint preserves all prior source, migration history and native binaries.

## Connected defects corrected

1. **Audit failure swallowed before plaintext disclosure.** The shared `logSecurityEvent` helper may report an audit repository failure as a non-throwing failure. Administrative Inventory key and standalone Vault reveal had treated that as successful audit and returned plaintext. All three reveal endpoints now require a `recordSecurity` response with `{ok:true}`; absent, throwing, or `{ok:false}` audit implementations return 503 without plaintext or `firstRevealedAt` updates. Generic telemetry is not a credential-delivery authority.
2. **Stale ciphertext after audit.** An account, key, pool, or Vault secret can change during PIN/confirmation and auditing. After a successful audit and first-reveal update, key delivery reloads the current assignment, recipient, pool and Vault secret, enforces the same version/identity and lifecycle checks, then decrypts the freshly authorized ciphertext. Standalone Vault reveal also checks current admin status, Inventory binding, revision, revocation and expiry after audit; changed records are denied. This narrows the stale-response window but is **not a substitute for serializable DB transactions and live race tests**.
3. **Password setup accounts counted as eligible.** Inventory's direct recipient checks and custody warnings now require `accountState === "ACTIVE"`, consistent with the existing independently reviewed issuance workflow. An invited, password-change-required or locked account can no longer get a key just because it wasn't one of four explicitly blocked states.
4. **Regression-fixture drift.** The older key-pool fixture now understands the separately registered reviewed Vault rotation module, and the old Vault UI fixture tests the current two-person rotation routes. Neither fixture mocks a successful audit through an unreliable telemetry shortcut.

## Security invariants

- No ciphertext is logged or placed in notification/audit metadata.
- An audit write is required *before* any key or standalone secret plaintext is returned.
- Auditing a failed or subsequently denied delivery does not mean a secret was actually disclosed. The audit event uses the existing `*_revealed` type and is a durable **attempt** record; dashboards must not infer confirmed consumption solely from these events. A richer attempted/delivered event model remains future work.
- No credential-provider revocation, silent secret rotation, auto MSI retry, or destructive storage cleanup is enabled.

## Executable tests

`npm run cluster:td6:g26:credential-disclosure` runs the new 15-case route-handler regression suite plus refreshed key-pool and Vault workspace checks. It is chained into `npm run cluster:td6:g26:one-batch`. Tests include deliberately failed/unavailable audits, revocations during audit, pool closure, account suspension, unexpected account states, Vault revision changes and successful no-leak disclosure.

## Certification still blocked

Full Node 24 dependency-backed TypeScript compilation, generated Prisma, PostgreSQL 18 race/failure tests, actual Windows native/Qt MSI execution, authenticated browser tests, and real provider storage fencing remain unverified. This source closeout cannot certify them.
