# Cluster G26 Implementation Ledger | after Batch H

| Connected scope | Source evidence | State | Still missing / unverified |
|---|---|---|---|
| Version-pinned Library derivatives and Transfer Center progress | WS1 | Implemented | Real S3/desktop end-to-end |
| Media review → decision / Ticket work | WS2 | Implemented | Browser multi-actor behavior |
| Published Packet acknowledgment / privacy | WS3, WS6, WS7, Batch A | Implemented | Live Prisma migrations + roster tests |
| Upload source durability and provider recovery | WS4–WS5, WS8, Batch C | Non-destructive implemented | Actual object provider generation-fenced reconciliation, safe disposition |
| Additive Library retention and hierarchy review | WS9, Batch C | Implemented for existing selected descendants | Dynamic inheritance; destructive actions require stronger evidence |
| Packet compliance/reporting and eligible audience selection | Batch A | Implemented | Authenticated large-population performance and UX |
| Package+Inventory seat policy, readiness | Batch B | Implemented | Live migration and provisioned-device E2E |
| Native managed-file update, rollback guards, destination root isolation | Batch D–E | Source implemented | Windows runtime, crash/failure injection, packaged helper rebuild |
| Inventory/Vault custody, 7d/1d/expired reminders, offboarding settlement | Batch D–H | Source implemented | Third-party key rotation/revocation, independent standalone Vault rotation approval, live PostgreSQL validation |
| Windows MSI receipt/registration operator inspection | Batch F–G | Read-only source implemented | Actual OS receipts, controlled repair/rollback/reboot, elevation and post-restart attestation **open** |
| Provider-controlled physical disposal | No safe destructive execution | **Intentionally blocked** | Fencing, retention/legal checks, dual review, real storage tests |
| Node24/PostgreSQL/Prisma/Qt/Browser certification | Existing preflight evidence | **Not certified** | Provisioned build and acceptance environment |

| Offboarding Package/key closure + post-closeout credential review | Batch H | Source implemented | Concurrency test in live PostgreSQL; already-revealed keys require external provider review |

G26 is **not source-closed**. The status table is a source capability inventory, not a pass/fail production readiness claim. G27/G28 requirements remain in `TD6_CONSOLIDATED_G25_TO_G28_PLAN.md`.

## G26 consolidated one-batch update (after Batch H)

| Scope | New source authority | Status |
|---|---|---|
| Standalone Vault replacement | Separate request, independent approval and rev-pin final commit; direct rotation disabled | Source implemented; live concurrency untested |
| Library ancestor retention | Bounded ancestry used in disposition and hierarchy Trash previews/commit | Partial integration; global mutation audit still required |
| S3 object version observation | Opaque HEAD version ID present/unfenced flag | Inspection only, no conditional delete |
| Windows MSI repair/reboot recovery | Existing observer-only contract retained | **Not implemented or certified** |
| External provider key replacement/revocation | Operator assertion recorded during Vault replacement | **Not independently verified** |
| Provider-fenced destructive disposal | No conditional APIs or execution | **Deliberately blocked** |

**Decision:** one consolidated G26 implementation batch shipped; **G26 itself is not certified or fully closed**. See `TD6_G26_ONE_BATCH_IMPLEMENTATION_CLOSEOUT.md` and `TD6_G26_ONE_BATCH_TO_G27_HANDOFF.md`.

## G26 Retention Mutation Authority Closeout (after OneBatch)

| Mutation path | Canonical protection added | Status |
|---|---|---|
| Metadata PATCH | Cannot bypass retention override, destination move, Project ownership or Trash/restore APIs | Source implemented |
| Interactive bulk move | Effective before/after retention/hold must not weaken, checked in Serializable transaction | Source implemented |
| Durable hierarchy move | Source ancestor policy fingerprint and destination policy fingerprint; write-time retention recheck | Source implemented |
| Interactive bulk Trash | Selected root ancestry and descendant local hold/deadline checks in write transaction | Source implemented |
| Single-item DELETE/Trash | Serializable transaction with current parent retention, personnel attachment, lock, child and provenance checks | Source implemented |
| Library inspector | Read-only parent/Project display and explicit guidance to reviewed Move path | Source implemented |
| Runtime compliance | PostgreSQL 18, Node 24, real Windows MSI, browser/Qt, S3/NAS disposal | **Not certified** |

This checkpoint has **no migration** and **no native binary replacement**. Physical destruction, provider credential claims and MSI recovery remain intentionally disabled.

## G26 Library Media Authorization and Cache Closeout

| Surface | Connected correction | State |
|---|---|---|
| Model thumbnail mutation | `contribute` permission, copyright and safe cache root | Source implemented |
| .blend companion conversion | Per-companion Library ACL, Personnel Records and copyright restrictions before conversion | Source implemented |
| GLB preview cache | Fingerprint includes all model + companion revision/stat evidence, private safe cache filenames | Source implemented |
| Local Library model source + cached output paths | Canonical no-symlink/junction validation, final-file hardlink checks | Pre-read protection; race certification open |
| Request workload | Canonical Library thumbnail route uses bounded heavy admission | Source implemented |
| Runtime tests | Node 24/PostgreSQL 18/Assimp/browser/Windows/Qt | **Not certified** |

## G26 Native MSI launch-intent and forensic evidence update

| Boundary | Current behavior | Validation still needed |
|---|---|---|
| Pre-launch authorization | Writes `msi_prepared_not_launched` receipt before consuming grant; a failed grant leaves manual-review evidence | Windows filesystem power-loss and transaction failure injection |
| Launch commitment | Separately records optional `launchCommittedAt` and `msi_started_outcome_unknown` before invoking the installer | Actual Windows Installer crash/restart timing |
| Evidence inspection | Stable opened regular file, bounded read, path identity recheck, chronology and contradictory-state rejection | Windows ACL/junction interactions and live operator recovery |
| UI and Native contracts | Desktop distinguishes pre-launch vs launched receipt, preserves historical schema-1 status | Authenticated Desktop Qt/renderer test |
| Automated MSI repair and installation attestation | **Still disabled/unimplemented** | OS-level post-reboot, elevation and provenance verification |

These changes do not mark G26 completed or certify Windows MSI lifecycle behavior.

## G26 Managed Preview I/O Authority (post MSI intent)

| Scope | Implementation | Pending certification |
|---|---|---|
| Thumbnail updates | Exclusive temporary writes, fsync, per-item fail-closed lock, atomic rename, old-variant preflight and cleanup | Windows filesystem crash and multi-process acceptance |
| Thumbnail delivery | Opened-descriptor streams and PNG/JPEG/WebP magic verification | Authenticated viewer browser and Windows SMB behavior |
| Converted GLB delivery | Descriptor-bound streaming, fresh ACL revalidation retained, GLB v2/header length verification | Real Assimp and revocation-under-load runtime testing |
| Verification | New filesystem adversarial suite in full inherited G26 command | Full Node 24/Prisma/PostgreSQL build remains outstanding |

No Prisma migration, destructive storage action, or native executable replacement was introduced. G26 remains open.

## G26 credential audit & custody boundary (post Managed Preview I/O)

| Boundary | Implementation | Remaining gate |
|---|---|---|
| Administrative standalone Vault reveal | Requires confirmed persisted security audit; refreshes current admin, Inventory binding, Vault revision, expiry and revocation before disclosure | Authenticated multi-admin PostgreSQL race injection |
| Administrative and personal Inventory key reveals | Requires positive audit write, then refreshes active assignment, identity, pool, recipient status and Vault availability before decrypting | Database transaction/locking certification under concurrent offboarding |
| Recipient account eligibility | Requires `ACTIVE` for key custody/reveal and read-only Inventory warnings, consistent with independent entitlement approvals | Live onboarding/locked-account acceptance |
| Regression coverage | 15 current route-handler fault-injection cases plus repaired key-pool/Vault workspace fixtures in canonical G26 run | Full Node 24 build and deployed DB |

This pass neither delivers third-party provider revocation nor certifies runtime safety. G26 remains open for live PostgreSQL/Node 24/Windows/Qt/browser/NAS testing. Existing security-audit events can represent attempted disclosure even if post-audit checks block delivery. Do **not** interpret them as proof that the recipient consumed the secret.

## G26 Vault atomic mutation/audit update (post Credential Disclosure)

| Boundary | Source implementation | Outstanding validation |
|---|---|---|
| Standalone Vault create/metadata/revoke | Security audit appended inside same Prisma transaction; failure rolls back change | Live PostgreSQL 18 rollback and contention |
| Reviewed rotation request/decision/commit | Same transaction for review/credential write and tamper-evident audit event | Multi-admin authenticated PostgreSQL acceptance |
| Audit service | New caller-transaction audit writer throws on persistence failure, including logging failure | High-load audit-chain sequence and advisory-lock behavior |
| Toolchain | Source scan and isolated handler regressions completed | Node 24 dependencies, Prisma client, TypeScript build, Windows runtime |

New handoff: `TD6_G26_ATOMIC_VAULT_AUDIT_TO_RUNTIME_HANDOFF.md`. Never claim source tests certify physical storage deletion or MSI recovery.

## G26 audit integrity/export authority (post Atomic Vault Audit)

| Area | Source state | Outstanding |
|---|---|---|
| Global security chain coverage | Reads all audit event versions; unchained/unsupported records invalidate global integrity status | PostgreSQL 18 large-table, legacy-row and corruption tests |
| Audit evidence export | v2 digest hashes the actual parsed-metadata payload, excluding embedded digest; malformed metadata fails | Repeatable-read/snapshot consistency and trusted external anchors |
| Export authorization | Requires acknowledged persisted `security.audit_exported` event or responds 503 without events | Authenticated server/browser tests under audit-DB outage |
| Independent verifier | Offline, dependency-free v2 SHA-256 verifier | Self-digest does not establish sender authenticity |
| Runtime certification | Source and native Go regressions only | Node24, PostgreSQL18, Windows/Qt/actual MSI, provider lifecycle |

No new Prisma migration. No native EXE replacement. Do not mark G26 complete from this checkpoint.

## G26 security-export snapshot convergence

| Scope | Source-level change | Certification status |
|---|---|---|
| Filtered export + unfiltered chain | Both read inside one bounded Prisma `REPEATABLE READ` transaction | Application-level mock MVCC tests passed; live PostgreSQL 18 still needed |
| Concurrent append | Filtered rows and integrity share one fixed DB snapshot; append may occur afterward | Real multi-session load not tested |
| Snapshot failure | Generic no-data 503, no digest header, no successful export evidence | Regression tested at route boundary |
| Export authorization / evidence | Existing durable `security.audit_exported` requirement preserved *after* snapshot | Real DB fault injection pending |
| Payload digest | Export v2 stable projection unchanged and still verifier-compatible | Export authenticity/external signing still open |

**G26 remains open** for Windows MSI post-reboot recovery, external credential revocation, destructive storage fencing and full real-runtime certification.

## G26 Pass 19 transfer continuation and recovery boundary

| Connected work | Code authority | Status |
|---|---|---|
| Fresh download journal creation | `TransferManager::startDownload` writes explicit unknown total `0`, compatible with strict journal loader | Fixed in source |
| Durable upload source generation | `sourceModifiedAtMs` stored and checked during run/chunk/hash/complete | Fixed at size/mtime level; OS file-ID race checks open |
| Historical unpinned uploads | Keep entry readable; refuse unsafe auto-resume | Preserved / explicitly held |
| Authenticated native upload redirects | Manual redirect policy for upload mutations and inspection | Fixed in source |
| Recovered Downloads destinations | Directory/sibling/nonlink guard before write/verify/publish/open/reveal | Fixed at path level; hardlink/reparse races open |
| G26-08/G26-09 overall | Native/Qt browser/mobile runtime and evidence linking | **Source partial; NOT certified** |

Evidence: `G26_NATIVE_TRANSFER_RECOVERY_SOURCE_IDENTITY_PASS19.md`, `tools/scripts/cluster-g26-p19-transfer-recovery-tests.mjs`, unchanged master register. No migration, and no change to destructive disposal policy.

## G26 Pass 20: Project-file finalization reply loss

| Boundary | Result |
|---|---|
| Completed server upload → downstream Project-file finalizer | Durable checksum/session/byte-count receipt saved before POST |
| Interrupted Desktop between remote finalization and local journal commit | Explicit manual resume replays idempotent finalizer, **not** upload session creation or byte transmission |
| Project-file response | Requires expected Project, file ID, checksum and size |
| Authorization | Server's existing Project Library contribution and ingestSessionId replay checks remain authoritative |
| Certification | Source-only; G26-08/09 open |

Evidence: `G26_NATIVE_UPLOAD_FINALIZATION_REPLAY_PASS20.md`, `tools/scripts/cluster-g26-p20-finalization-replay-tests.mjs`.

## G26 Pass 34: immutable MSI source and late ProductCode guard

| Boundary | Implemented source | Still outstanding |
|---|---|---|
| Staged MSI execution bytes | Windows `FILE_SHARE_READ` held handle, source hash/size/path identity rechecks before/after process | Real Windows sharing/ACL/adversarial install tests |
| Last admission | Two ProductCode queries after suspended child creation, before `ResumeThread`; fail-closed termination | External MSI global concurrency cannot be made transactional by observation alone |
| Installer results | Post-exit held-source drift becomes unknown/manual-review result | OS software health and real Win10 reboot certification |
| Lifecycle authority | Existing signed, fresh per-user install and one-use grant only | Authorized upgrades, repairs, uninstall, rollback and OS-wide elevation |

G26-10/11 and CERT-12 remain **open**. See `G26_PASS34_MSI_IMMUTABLE_SOURCE_AND_RESUME_GATE.md`.

## G26 Pass 35: signed MSI prerequisite lifecycle and read-only reverse dependencies

| Boundary | Implemented source | Still outstanding |
|---|---|---|
| Signed manifest dependency | Mandatory `content-selected` or `msi-installed`; offline signer, server publish, device target, Go stager aligned | Untyped pre-production signed manifests deliberately rejected; content upgrades remain separate |
| MSI prerequisite evidence | Exact prerequisite Package receipt SHA-256, terminal exit-zero installer result, prior and current OS registration and version; no conflicting locks | OS ProductCode registration is **not** application health or exhaustive external inventory |
| Admission lifecycle | Pre-grant, post-grant, and suspended pre-resume rechecks; bounded original receipt snapshot | Authorized upgrade, repair, uninstall and dependent rollback executor |
| Native recovery | Bounded read-only known-receipt edges with present/matches flags; Qt/Desktop independently reject forged graph | Graph cannot establish a safe deletion condition or authorize any mutation |
| Verification | 1,059/1,059 source/portable named checks, plus 11/11 signed integration tests, Go unit/race/vet/Win64 build and test cross-compile | Linked Qt, real Windows MSI/reboot, PostgreSQL integration not run |

G26-10, G26-11 and CERT-12 stay **open**. See `G26_PASS35_SIGNED_MSI_DEPENDENCY_LIFECYCLE.md`.
