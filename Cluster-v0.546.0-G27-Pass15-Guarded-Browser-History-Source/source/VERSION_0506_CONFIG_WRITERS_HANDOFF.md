# Cluster v0.506 | Configuration-writer convergence and security closeout

**State:** Source-implemented and verified against the inherited source-foundation suite plus new targeted behavioral/source assertions. **Development staging only.** No live PostgreSQL multi-process, Windows/NTFS, WebAuthn, GPU-driver, or authoritative Pass 15 integration certification is claimed.

## Baseline and packaging

Started from the most recent `Cluster-v0.506.zip` delivered with the server-configuration publication journal, database commit marker and startup reconciliation. The cumulative source retains the previous 0.506 work (OOBE/configuration review/revisions, protected settings, GPU metrics/admission/media) and the P16A–P16C overlay staging features. It remains reconstructed P13 + P16C + 0.506 deltas, **not** a replacement for the trusted Pass 14/15 source.

## Four connected changes

1. **Context Pack API authorization.** All six context-pack endpoints (list, create-from-settings, import, full export, apply and delete) explicitly require an administrator before reading, exporting or mutating stored configuration. Export is `Cache-Control: no-store`. Previously handlers only sometimes called `getCurrentUser`, including nullable returns, with no explicit route-level admin enforcement. Any caller using these routes must have admin authority.
2. **Context Pack application.** Applying a pack now selects the existing allowlisted configuration keys and publishes *only* those fields through `saveSettings`'s advisory-lock + durable journal + database marker path. Missing/empty fields no longer cause an unrelated whole-settings save, empty packs are rejected, and stale previews/field changes return 409. This preserves the established Context Pack allowlist; it is not a new configuration format.
3. **Security Policy + Discord writes.** Security Policy now commits its named fields through the same server configuration field-level CAS path; session tightening/revocation behavior remains. Discord configuration now sends only its named fields; bot token, webhook and application public key are sent only when explicitly set or cleared. This avoids stale/hidden token values being rewritten from the last client projection. Both return explicit 409 conflicts.
4. **Explicit encrypted-settings maintenance.** Regular `readSettings()` no longer rewrites database settings or `cluster.config.json` and no longer automatically rewraps Context Packs. Implicit rewrap bypassed the journal and could race with other writers. The existing admin-only `REWRAP SECRETS` action now performs a freshly-read, under-lock journaled settings publication, then rewraps Context Packs and security credentials. A read encountering old-key ciphertext warns once, without mutating state. Previous encryption keys must remain configured until an explicit successful rewrap and verification.

## Safety notes and known limits

- The shared save path protects only callers using that authority. First-run bootstrap still initializes from an old settings snapshot once; it requires real OOBE testing. Offline host/setup, backup/restore and credential writers not using this service remain separate audit surfaces.
- Security Policy's MFA precondition and session revocation occur after settings publication; concurrent changes return 409, but runtime session behavior needs live policy verification.
- Context Pack **exports may contain secrets by design** when created with `includeSecrets`. Admin enforcement limits access, but step-up authentication, explicit sensitive-export controls and secure lifecycle should be reviewed before release. `.clusterconfig` export remains intentionally secret-free.
- Discord Connection metadata database writes happen after settings commit; there is not yet one transaction spanning those two authorities. Recovery/reconciliation tests remain.
- Rewrap is idempotent in intent but Context Pack payload maintenance and subsequent credential rewraps require fault-injection tests using the previous encryption key retained.
- `saveSettings` still supports direct whole-object use for first-time initialization and explicit internal maintenance; retire more unsafe callers after reviewing their individual invariants, not by deleting a shared function on faith.
- No dependency-backed Node 24/Prisma server build, live database/multi-admin test, Windows process kill, native Qt/Go build or 100/125/150% DPI test performed here.

## Validation added

- `npm run cluster:0506:config:writers` checks the actual shared precondition helper with real values and covers six explicit context-pack admin gates, safe field/secret selection, CAS conflict responses, rewrap path, journal dependency wiring, and the absence of implicit writes.
- Test is integrated into the maintained `verify:source-foundation` chain.
- Parser/import/CSS sweep, source-manifest and ZIP integrity are recorded in the package's `SOURCE_VALIDATION.txt`.

## Continue next

1. **Merge the staged 0.506 deltas with actual Pass 15 source**, preserving Pass 14 Library/Media/Projects and Pass 15 Admin/Project Types. File lineage, not optimistic matching names, decides the authority.
2. Use a real PostgreSQL 18.6 installation to exercise transactions, lock contention, journal/SIGKILL startup recovery, setup migrations (#90–92) and credentials; then Windows native and WebAuthn tests.
3. Complete remaining configuration writer audits, context-pack sensitive export policies, full reset/import integration and owner recovery device flows.
4. Begin **0.507 Company/Resource Graph, scoped permissions and shared engines**, maintaining the complete roadmap feature ledger; do not turn infrastructure into the entire product.

### Additional route behavior evidence

A compiled handler fixture now tests the real Context Pack route registration under mocked dependencies (`cluster:0506:context:routes`): six unauthenticated requests cannot touch the database, authorized apply submits only a selected patch, stale CAS conflicts return 409 without emitting successful activity, and empty packs do not rewrite settings. This is an isolated behavioral test, **not** live Fastify/PostgreSQL certification.
