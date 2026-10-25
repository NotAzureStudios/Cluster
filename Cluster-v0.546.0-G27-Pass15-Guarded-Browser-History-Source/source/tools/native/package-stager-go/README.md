# Cluster Package Verifier and Managed File Updater (Go)

This is a deliberately isolated native **verification, staging, managed-content and destination-file update** tool. It does not download packages, run scripts, execute binaries, start services or install applications. Signed content can be copied or replaced in authorized destination folders with tracked backups and guarded rollback. Nothing here proves OS application installation or runtime health.

## Trust boundary

The public Ed25519 signing key **must** be pinned independently, outside the Cluster package feed. A key obtained together with the downloaded ZIP is not automatically a trust root. The `--trusted-key-sha256` value is the SHA-256 of the trusted public key's DER/SPKI encoding and is compared before signature verification. Do not use user-controlled output directories.

The server's device ZIP endpoint supplies `X-Cluster-Package-Deployment-ID` and `X-Cluster-Package-Receipt-Challenge`. Treat these as secret, short-lived, single-use values. They bind a sequence of **device-reported** deployment states to an authenticated Device Registration; they do not attest OS installation success. The client must use the existing device-proof signed-request protocol when reporting outcomes.

## Usage

Build with Go 1.22+:

```sh
go -C tools/native/package-stager-go build -o cluster-package-stager
```

Prepare the following from an approved downloaded release and its verified manifest: `approved.zip`, `manifest.json`, `signature.txt` (base64 Ed25519 signature), and `trusted-public.pem`. The manifest and signature can also be extracted from the signed JSON envelope produced by `tools/scripts/cluster-package-sign.mjs` during development, but the trust fingerprint must come from an independent channel.

```sh
cluster-package-stager --archive approved.zip --manifest manifest.json --signature signature.txt --public-key trusted-public.pem --trusted-key-sha256 0123... --root /path/to/isolated/private/package-staging
```

The output is `staged/<archive-sha256>/` below the root, with read/write-restricted extracted files and `.cluster-package-stage.json` stating `verified_staged_not_installed`. Re-running the same stage fails rather than overwriting files. Extraction rejects traversal, Windows reserved names, symlinks, special files, duplicate paths, unsupported compression, excessive expansion, and a forged internal staging marker.

**Open work:** integration with the authenticated Qt/Workstation native update flow, durable tamper-resistant install service and rollback, OS-level locks/atomic activation, independently attested execution evidence, service recovery, and Windows build/runtime certification. Do not advertise this utility as a completed Package installer.

## Checks

```sh
go -C tools/native/package-stager-go test ./...
node tools/scripts/cluster-0515-native-package-stage-smoke.mjs
```

## Version selection and reversible content handoff (v0.516)

`stage` is still the default action. The new `activate` action selects an
**already staged, independently signed and byte-reverified content tree**.
It does **not** install software, execute scripts, restart Cluster, update
running processes or authorize rollout; `content_selected_not_installed` is
strictly a local, unaudited operating-system pointer.

```sh
# First run the stage command above for an approved release.
cluster-package-stager --action activate --archive approved.zip --manifest manifest.json --signature signature.txt --public-key trusted-public.pem --trusted-key-sha256 0123... --root /trusted/private/staging
cluster-package-stager --action status --root /trusted/private/staging --package-key my-package
# Rollback must name and independently verify the EXACT previous signed archive.
cluster-package-stager --action rollback --archive previous.zip --manifest previous-manifest.json --signature previous.sig --public-key trusted-public.pem --trusted-key-sha256 0123... --root /trusted/private/staging
```

Local selection metadata is saved atomically under `active/<package-key>.json`,
retaining one previous content selection and a monotonically increasing
**local** generation. Before any selection the stager opens each ZIP entry,
re-hashes the corresponding staged file, checks every byte and rejects
extra files, modified evidence and symlink paths. It requires an independently
pinned public-key fingerprint on activation **and rollback**. A package-scoped
`.lock` directory serializes pointer writes, and an orphaned lock fails
closed; a trusted operator must verify no other stager is running before
manually clearing it. Consumers must not mistake the local pointer for an
attested install report or run files directly from the staging directory.

**Security limitation:** a valid cryptographic signature alone does not prove
that a release is still entitled, unrevoked or approved by a current rollout.
The authenticated native client must recheck that server-side policy and device
identity before *each* staging, selection or rollback. The stager is not a
privileged installer or an operating-system trust anchor. No OS file locks,
process handover, Windows Update/Service integration or runtime health checks
are implemented. Do not report `activated` merely because `activate` selected
content; the separate server receipt state is `content_selected`.

## Direct five-entry staging-kit import (v0.519)

The signed-in Cluster Desktop Account panel can create a fixed five-entry staging
kit. `--kit` imports the kit **without extracting untrusted sidecars to disk**:

```sh
cluster-package-stager --action stage --kit /downloads/studio-1.0.0-windows-x64-staging-kit.zip \
  --trusted-key-sha256 <INDEPENDENTLY_PROVISIONED_SPKI_SHA256> --root /private/staging
```

The helper accepts exactly `release.zip`, `manifest.json`, `signature.txt`,
`public-key.pem`, and `README.txt`; rejects extra, duplicate, compressed,
nonregular, oversized or corrupt entries; and performs the same Ed25519 signature,
manifest/platform/digest checks as the standalone sidecar mode. It never executes
content. `--kit` is **not** allowed with `activate`/`rollback` or sidecar flags.

In Qt Desktop, the user chooses the ZIP with a native picker and confirms local
staging. Qt reads `<QStandardPaths::AppConfigLocation>/package-trust/<profileId>.pin`
for the current server profile. Only a trusted operator should provision this file
from an out-of-band fingerprint. A kit's embedded PEM does not independently
establish trust. The local user profile's settings directory is not a tamper-proof
machine-wide trust store. Qt places the verified content in its local application
data location, under `package-staging/<profileId>`.

**Critical limitation:** Staging does not prove continued entitlement. The
Qt-selected local ZIP is not yet cryptographically bound to the latest server
rollout policy; do not activate/install it or mark the device healthy based on
this result. Native OS-level installer/orchestration remains future work.

## Read-only selected-content audit (v0.522)

Use an independently trusted signed ZIP, manifest, signature, public key and key
fingerprint to re-verify an existing active or previous staged selection:

```
cluster-package-stager --action audit --archive approved.zip --manifest manifest.json \
  --signature signature.txt --public-key trusted-public.pem \
  --trusted-key-sha256 <out-of-band-sha256> --root /private/package-staging
```

The command verifies the signed archive, current pointer identity and every
file in the staged tree, without altering selection or executing anything. It
returns `verified_selected_content_not_installed`, `osAttested: false`, and
`slot` (`active` or `previous`). If any byte is missing or tampered, audit
fails closed. This does not prove current rollout entitlement, OS installation,
or native workload health.

## Native trust enrollment and staged-file re-audit (v0.523)

In **Cluster Desktop → Account Settings → Desktop → Managed Packages**, use **Set up local signing trust…** to enter the DER/SPKI SHA-256 fingerprint **from your studio administrator using an independent trusted channel**. Qt asks you to type it twice and confirms any change. The renderer cannot pass a trusted key, override a path, or install content. The pin is published atomically under the current desktop user's `package-trust/<server-profile-id>.pin`. This is user-profile-local configuration, not tamper-proof machine-wide trust.

After successfully staging a signed Package, you can select **Audit existing staged files…** and choose that exact downloaded kit again. This calls the native verifier in *read-only* audit mode:

```sh
cluster-package-stager --action verify-stage --kit path/to/signed-staging-kit.zip \
  --trusted-key-sha256 <fingerprint-from-independent-channel> \
  --expected-package-key studio-preset --expected-version 1.2.3 \
  --expected-artifact-sha256 <full-digest> --root /private/staging
```

`CLUSTER_STAGE_AUDIT_RESULT` confirms the signed identity and checksums of **existing** staged bytes. It does not stage new bytes, mutate a selection pointer, emit a server deployment receipt, install software, or attest OS health. Incorrect pins, mismatched identity, missing files, extra files, changed bytes and forged stage evidence fail closed.

Server progress reports no longer accept an `activated` device claim, because Cluster does not have a native OS installer. `content_selected` and `rolled_back` describe only local pointer selection; these are never OS installation proof. A real supervised installer and server-issued activation authorization remain open work.

## Current signed managed-content deployment (v0.524)

The `deploy-content` and `rollback-content` operations create a **private,
unprivileged managed copy** and change a reversible pointer. They do not install
executables into OS applications folders, launch scripts, restart services, or
claim native OS health. A selected managed file is simply a verified copy
available for later *explicitly authorized* consumers. Legacy `activate` and
`rollback` pointer actions still refer to inert staged selections and are not
managed-content deployment.

The server deployment-control signer is independent from every Package signing
key. The studio operator generates it once with:

```
node tools/scripts/cluster-package-deployment-keygen.mjs /private/cluster-deployment-control.pem
```

Configure the **server**, not clients, with
`CLUSTER_PACKAGE_DEPLOYMENT_GRANT_PRIVATE_KEY_FILE` pointing to this PEM file.
On non-Windows hosts, the file must not be readable by group/others. On Windows,
restrict access via OS ACLs. The generator prints the control public key's
DER/SPKI SHA-256 fingerprint, which must be delivered to each Desktop user by a
separate authenticated administration channel. Never ship the private PEM,
trust fingerprints, or server-issued grants inside Package archives.

Desktop now requires two **different** user-profile-local pins:
- Package signature fingerprint: `package-trust/<server-profile>.pin`
- Deployment-control fingerprint: `package-control-trust/<server-profile>.pin`

After an authorized device downloads a kit and stages it, the user explicitly
requests a short-lived grant from the device-proof-authenticated Cluster server
and confirms the native operation. The grant is passed via a private, transient
native file to the Go helper, not persisted in a staging kit or browser storage.

Equivalent administrative smoke usage, after a separate authenticated server
request has returned a genuine signed grant JSON:

```
cluster-package-stager --action deploy-content --kit downloaded-staging-kit.zip \
  --trusted-key-sha256 <INDEPENDENT_PACKAGE_SIGNING_PIN> \
  --trusted-control-key-sha256 <INDEPENDENT_DEPLOYMENT_CONTROL_PIN> \
  --grant fresh-server-grant.json --root /private/cluster-package-root
cluster-package-stager --action managed-status --package-key studio-preset \
  --root /private/cluster-package-root
```

An authorized rollback uses `--action rollback-content` and **a separate new**
rollback grant for the exact recorded previous release. A revoked/unentitled
previous release must be explicitly re-authorized by studio policy (for example,
an approved device pin) before its new grant can be issued.

The Go helper verifies signed archive bytes, each staged file, independent
package and control pins, grant identity, operation, issued/expiry times, and
a one-use nonce. The managed copy is privately prepared and checked before an
atomic pointer change. Old content is retained for bounded rollback.

**Security and certification limitations:** A short-lived bearer grant may remain
usable for up to 60 seconds after a server-side revocation; the helper has no
trusted hardware clock or online nonce-consumption authority. The replay ledger
is local, so an administrator or malicious process with full control of that
profile can tamper with it. The current Qt client is not hardware-attested, and
this source pass has not been run on Windows/Qt or a real PostgreSQL server.
System-level software installation, machine-protected trust, full rollback and
health checks require a privileged, supervised installer designed and tested
separately. Do not execute managed bytes without additional policy enforcement.

## Signed managed-copy audit (v0.525)

After a successful `deploy-content`, Desktop can check that an active or
recorded previous **managed copy** still exactly matches the independently pinned
signed release and the staged source. Choose the matching kit from the native
file picker, then run the read-only audit operation:

```sh
cluster-package-stager --action audit-managed \
  --kit signed-staging-kit.zip \
  --trusted-key-sha256 <INDEPENDENT_PACKAGE_SIGNING_PIN> \
  --expected-artifact-sha256 <EXACT_TARGET_SHA256> \
  --expected-package-key studio-preset --expected-version 1.2.3 \
  --root /private/package-staging
```

`CLUSTER_MANAGED_AUDIT_RESULT` includes the recorded slot (`active` or
`previous`), exact digest, generation, and `osAttested: false`. The verifier
reads managed bytes, compares them to the signed archive, checks the stage and
pointer again, and detects unexpected files, missing files, file tampering,
unsafe links and changed pointer state. It does not consume a deployment grant,
change the selected release, run binaries or infer application health. The
independently pinned signing key and the signed ZIP remain mandatory. Audits
fail if the target is neither the recorded current nor previous release.

Qt now parses `artifactSha256` from the managed result correctly, fixing a
cross-language mismatch that could report successful native operations as
failure. When a selection receipt successfully advances, the next in-memory
one-time challenge can record `rolled_back` if a fresh authorized native
rollback occurs while the receipt remains valid. Rollback without that lease
is local-only; a device report is not OS attestation.

## v0.532 direct native handoff

The authenticated renderer can send a device-proof downloaded kit to Qt using bounded `package.kit.begin/chunk/finish/cancel` calls, avoiding the manual Downloads-folder round trip. Qt verifies the total size and kit checksum in a private profile-scoped temporary file. It then invokes this unchanged Go verifier using the **independently pinned** key fingerprint and exact expected Package identity. After successful staging, the UI may recheck rollout authorization and request a separate, confirmed native destination-file update. This is not unattended software installation or a replacement for native confirmation. The previous offline kit picker remains supported.


## Read-only tracked destination file audit (TD6 F07)

After an independently signed managed release is selected, run:

```sh
cluster-package-stager --action audit-files --kit signed-staging-kit.zip \
  --trusted-key-sha256 <OUT_OF_BAND_SIGNING_PIN> \
  --expected-package-key studio-preset --expected-version 1.2.3 \
  --expected-artifact-sha256 <SIGNED_RELEASE_SHA256> \
  --root /private/cluster-package-root --destination /existing/studio-folder
```

The verifier requires the current signed managed release and reads the private destination tracking ledger. `CLUSTER_FILE_AUDIT_RESULT` reports recorded tracked-byte matches and drift, missing files, already-present but untracked files, and older tracked files that have intentionally been preserved. The latter are **not automatically deleted** even if they were superseded. The scan refuses unsafe filesystem nodes, invalid ownership state and changed managed generation. Audits are read-only, bounded to 4,096 tracked names and 512 MiB tracked-data reads; a truncated scan fails rather than returning a misleading healthy result. Only the first 20 sorted issues are exported to Qt for the Desktop panel.

The renderer does not choose paths or trust pins. Qt uses its own local destination mapping/folder picker, prompts for confirmation, checks the signed target and forwards a bounded evidence summary. A successful local hash scan is not an OS installation, device attestation, proof of running software or server authorization to modify files. It cannot prevent all concurrent external writes to the destination and does not execute a repair.


## TD6 G05: Signed Package prerequisites and fail-closed deployment order

An author may now add **up to 12** exact-version Package dependencies to the
signed release manifest, with the *optional* final argument to the offline
signer:

```sh
# deps.json: [{"packageKey":"studio-foundation","version":"1.2.0"}]
node tools/scripts/cluster-package-sign.mjs private.pem content.zip \
  studio-editing-kit 2.0.0 windows-x64 signed-release.json deps.json
```

Dependency keys must be unique, cannot reference the package itself, and cannot
contain scripts, install arguments, URL hooks or wildcard versions. The signed
manifest contains only `{packageKey,version}` entries. The server requires a
matching unrevoked prerequisite release at publication time and evaluates the
**entire currently authorized and entitled device target graph** before making
a release available. Missing dependencies, version mismatch, withdrawn
prerequisite rollout/entitlement, and cycles fail closed. Targets are presented
in prerequisite-first order. A `packageId`-scoped download still checks the
full authorized graph and then narrows the response; it must not use a
single-Package projection for dependency authorization.

Native `deploy-content` and guarded destination file writes require their
prerequisites to be selected in the local managed-content registry at the
exact signed version. Native preview reports unmet requirements without
claiming it can install them automatically. Native signed content selection
is **not** cryptographic OS installation evidence, and a user-profile-local
registry is not a machine-enforced trust anchor. Rollback to a prior version
with newly missing dependencies may be refused; emergency recovery needs a
separate explicitly authorized installer/recovery protocol. Staging and
read-only verification remain available to diagnose problems.

**Still NOT implemented:** invoking MSI/EXE/PKG installers, resolving system
services, elevation, OS-level dependency attestation, executable lifecycle,
atomic cross-package installation or OS recovery. A signed content ZIP is
never executed merely because a dependency resolves. Full Windows/Qt/Postgres
runtime acceptance remains a later certification gate.

## TD6 G11: Opt-in supervised per-user Windows MSI execution (source implementation)

This capability is **separate from** `deploy-content`, `sync-files`, and native
Package selection. None of those existing actions can launch a program. Native
Windows Installer execution requires all of the following:

1. An immutable studio-signed `windows-x64` Package release whose manifest has
   an optional `installer` declaration containing **exactly**:
   `{"kind":"windows-msi","path":"install/editor.msi","sha256":"<64 lowercase hex>","scope":"user","productCode":"{12345678-1234-ABCD-ABCD-1234567890AB}","productVersion":"1.2.3"}`.
   The named MSI must actually be a regular ZIP member with the signed digest
   and the MSI/OLE compound-file header. Generic EXE, scripts and install flags
   are **not supported**. ZIP/staging limits still apply: ordinary content archives remain capped at **4 MiB**, while explicitly
   declared signed MSI archives support **up to 32 MiB** (64 MiB expanded).
   This remains an in-memory signed-ZIP pipeline, not a streaming protocol
   suitable for large commercial installers.
2. A separately out-of-band-pinned Ed25519 Package-signing fingerprint, a
   distinct pinned deployment-control fingerprint, and the existing trusted
   staged archive with valid dependencies and matching SHA-256.
3. A new **install-specific** one-use control grant from the server. Deployment
   and rollback grants cannot be substituted. Issuance is disabled by default;
   the server operator must explicitly set
   `CLUSTER_ALLOW_SUPERVISED_MSI_INSTALL=true`, and the signed-in Device user
   must pass existing Package entitlement + active-device checks **and**
   administrator authorization.
4. Qt's explicit Package-key-typed confirmation, followed by a second native
   confirmation dialog. The renderer cannot supply executable paths, arguments,
   administrator credentials, destinations or trust pins.

Offline authoring (existing signer, with optional installer declaration in the
**eighth positional argument**; use `-` in the seventh position when there are
no dependency declarations):

```sh
node tools/scripts/cluster-package-sign.mjs private.pem content.zip \
  studio-editor 1.0.0 windows-x64 signed-release.json - installer.json
```

The native read-only `--action preview-installer` verifies staged MSI contents
and currently selected signed prerequisites without consuming a grant. Native
`--action install-msi` verifies the same evidence, checks the distinct short-lived grant, writes a fail-closed
**prepared/not launched** receipt *before consuming that grant*, consumes
it, then persists a separate **launch committed/outcome unknown** receipt
before process creation. Only then can it invoke the Windows system `msiexec.exe` with fixed
`/i <signed MSI> /qn /norestart ALLUSERS=2 MSIINSTALLPERUSER=1` arguments.
It does not invoke a shell or arbitrary installer hooks as a Cluster action.
However, **MSI files themselves can contain executable custom actions** and
per-user install properties do not provide a security sandbox.

If the process crashes or cannot consume a grant after preparation, the
`msi_prepared_not_launched` receipt remains for operator review. This state
does not claim that msiexec ran or that a grant was successfully consumed.
If the process crashes after persisting the launch commitment, the attempt
remains `msi_started_outcome_unknown`. Both states block automatic retry.
On an exit code of 0 or 3010 it records the returned code as
`msi_exit_zero_not_os_attested` or `msi_restart_required_not_os_attested`.
Failed process outcomes remain failed/unknown. Retained receipts block automatic
retry; an authorized operator must investigate before any reset. This is **not**
a durable native Windows Installer database attestation or successful software
health check, and no OS-level uninstall, elevation workflow, cross-Package
atomic installation, cancellation of MSI custom actions or dependency-group
rollback exists yet. There are no Windows native runtime acceptance claims;
only Windows-target Go cross-compilation and source tests were performed.

## G12: Bounded installer media and read-only recovery evidence

Signed `windows-msi` archives may now be up to **32 MiB** compressed while
ordinary content archives retain their **4 MiB** limit. ZIP expansion stays
bounded to 64 MiB. The trusted signer, server publication and request admission,
recipient download, Qt staging, and native Go verifier apply these limits.
This is **not** externally streamed media, resumable download, vendor trust,
or installed-product verification. In-memory ZIP/base64 handling remains and
large installers still require a separate streamed-artifact design.

After a restart, an operator can inspect local evidence with:

```text
cluster-package-stager --action msi-attempt-status --root <private-profile-root> --package-key studio-editor
```

The command reads an existing bounded receipt and operation lock, refuses
symlinks, corrupt records or unknown receipt states, and reports whether
manual review is needed. It accepts **no** signed kit, grant, or independent
control-key material and creates/deletes **nothing**. Desktop exposes the same
read-only inspection per Package and per server profile. A lock with no receipt
or a started receipt after interruption is explicitly *unknown*; exit 0 or
3010 means Windows Installer returned, not that the software is healthy.
The inspector does not reset attempts, authorize a retry, or attest a product.
Local records may be modified by privileged OS actors and must not be treated
as tamper-proof compliance evidence.

### G13 ProductCode and product-version reporting

The Windows MSI declaration additionally **requires** a canonical ProductCode
GUID (uppercase, braces) and a numeric three-component `productVersion`. Both
are covered by the release Ed25519 signature. Signed/staged MSI preview and
existing `msi-attempt-status` read only the Windows Installer registration for
that declared ProductCode and compare `VersionString` against the signed version.
A registration match is *not* MSI-property verification, vendor/Authenticode
trust, program health, or permission to retry/repair/uninstall. Registration is
queried under the current user and may not cover machine-wide installs. On
non-Windows hosts the product state is explicitly `os_query_unavailable`.


### TD6 G14: Verify staged MSI database properties before execution

The signed `productCode` and `productVersion` are no longer treated solely as
publisher claims. On Windows, `preview-installer` opens the already hash-verified,
locally staged MSI through the native Windows Installer database API **read-only**
(`MsiOpenDatabaseW`, `MsiDatabaseOpenViewW`) and retrieves the MSI `Property` table's
`ProductCode` and `ProductVersion`. Both must exactly match the signed declaration.
Missing, malformed, duplicate, unreadable, and mismatching values are refused. The
`install-msi` operation performs the same check **before** consuming its one-use
install grant or creating the attempt receipt; the staged bytes are hashed again
immediately before `msiexec` as before. A preview includes explicit
`identity.verified` evidence distinct from Windows product *registration* evidence.
Qt rejects a successful preview unless the returned read-only identity evidence
contains matching declared and actual properties; Desktop displays both checks.

Other platforms report the property-table inspection as unavailable rather than
claiming verified MSI identity. This does not validate Authenticode signatures,
MSI embedded custom actions, publisher trust, OS health, installed-product health,
or deployment rollback. Windows execution is still administrator-authorized and
opt-in, with no automatic retry. Actual Windows runtime execution/certification is
separate from the source-level checks.

### G19: Native staging directly from a durable retained archive

`transfer-stage` is reserved for the authenticated Qt broker. Qt chooses the
profile-private `--root` and `--staging-root`, reads an independently enrolled
SPKI signing-key fingerprint, confirms the user intent and provides bounded
signed sidecars on stdin. No bearer challenge, installation grant, selected
filesystem path or ZIP byte payload is accepted from the renderer. The helper
revalidates the committed archive and uses the existing signed `stage` verifier.
A retained transport ZIP alone is **not** a stage or an authorized installation.
Duplicate stage destinations and missing/invalid signatures fail closed.

### G26 Batch G: post-restart operator status (read-only)

`msi-attempt-status` includes `recoveryAssessment` and `requiresRebootReview`.
The decision table treats a receipt for exit `3010` as requiring restart
inspection, even if a registration query reports the expected version.
A version match is *not* proof of installed-file health, installer provenance,
or authority to repair, roll back, uninstall or repeat an MSI process.
No operation clears the original attempt receipt or active lock.

### G26 Native MSI launch-intent hardening

The installer now records a bounded pre-launch receipt before committing the
one-use authorization token. The receipt includes an optional
`launchCommittedAt` timestamp when execution is about to begin. Existing
version-1 MSI receipts without this field remain readable as ambiguous
historical evidence. A newly prepared receipt must not declare a finished
process, an exit code, or launch commitment. Malformed ordering is refused.

Read-only forensic inspection uses an opened file descriptor with regular-file,
identity, bounded-length, size and modification checks before reporting its
SHA-256. Neither this snapshot nor a matching Windows registration record
authorizes a retry, repair, uninstall, or rollback. The pre-launch journal
uses an atomic synced file and attempts directory sync where supported; a
complete power-loss durability guarantee requires actual Windows/filesystem
testing.

Windows acceptance still requires a disposable VM and an independently
reviewed, signed test MSI, including injected failures immediately before
preparation, after receipt write, after grant consumption, and after launch
commitment, plus exit-code 0/3010/failure and restart inspection. No
production install is certified by the local Linux cross-compile.


### Explicit native transfer crash recovery (G26 follow-on)

`--action transfer-recover --root <private-profile-root> --transfer-sha256 <64-lowercase-hex>` is **local and explicit**, never a background auto-retry. It refuses an existing transfer lock, a missing/untrusted checkpoint, changed published prefix, truncated or ambiguous artifact files, unsafe metadata residue, and foreign/symlink paths. On a valid append/checkpoint interruption, it hashes retained bytes and advances only the local disk checkpoint. On a valid rename/checkpoint interruption it requires the entire signed-release transport SHA-256 before marking committed. No payload file is deleted or installed.

The Qt capability `package.transfer.recover` prompts for native confirmation; the renderer checks the currently authorized Package target and does not renew remote download lease/recipient authorization. A recovered archive is still not staged, trusted or installed until the normal independent Ed25519/SPKI verifier runs. A stranded lock must be reviewed manually, not guessed stale. Recovery of browser/mobile upload flows and live Windows 10 verification remain open.


### Read-only transfer diagnostic

`--action transfer-diagnose --root <private-profile-root> --transfer-sha256 <digest>` returns `CLUSTER_TRANSFER_DIAGNOSTIC` without creating transfer directories or changing locks, payloads, or checkpoint records. The code may report a *candidate* interrupted append/rename, explicitly unverified. If `lockPresent=true`, operator review is required. Never treat diagnosis as authority to remove the lock or replay bytes. Qt exposes this via `package.transfer.diagnose` and the Desktop Packages panel's on-demand diagnostic button.


### G26 Pass 5: bounded-I/O native transfer checkpoints

Native `transfer-begin` now creates **schema 2** checkpoints containing the nonsecret serialized SHA-256 streaming state, payload modification timestamp and SHA-256 of the last 64 KiB. Each `transfer-append` checks the previous bounded tail and metadata, then hashes only the new chunk and saves the next checkpoint; it does **not** rehash the entire archive for routine progress. `transfer-inspect`, final `transfer-commit`, stage and explicit operator-confirmed recovery still fully read and verify the retained bytes. A corrupted or unsupported hash-state record blocks ordinary append and requires explicit full-rehash recovery. Out-of-band changes outside the bounded tail might not be observed until full inspection/commit; a streamed prefix hash is NEVER signed-artifact proof. See root `G26_NATIVE_TRANSFER_LINEAR_IO_CLOSEOUT.md`.

### G26 Pass 29: advisory boot continuity in MSI recovery

Read-only `msi-attempt-status` and `msi-profile-status` now report a `bootObservation` for recorded MSI attempts. On Windows, the helper samples `GetTickCount64` and UTC in one narrow observation window, then compares an **estimated** boot time to the immutable MSI attempt timestamps using a five-minute ambiguity band. Output states are `reboot_indicated_unverified`, `same_boot_indicated_unverified`, `boot_relation_ambiguous`, or `os_uptime_unavailable`. No attempt receipt is changed, and missing Windows API access remains explicitly unavailable. The observation carries `readOnly: true`, `osAttested: false`, and `rebootConfirmed: false` in every case. Wall-clock adjustments and suspended system time may affect the estimate. **A restart indication is not a confirmed reboot, MSI success, application-health proof, or authorization to retry, repair, uninstall or clear locks.** Qt and Desktop validate the read-only response independently.

### G26 Pass 30: immutable boot anchor and stable registration observations

New `install-msi` attempts may persist `bootAnchor` with UTC time and monotonic uptime in the existing pre-launch schema-1 receipt. It is optional and historical receipts stay readable. Invalid anchors fail closed during forensic inspection. `bootObservation.anchorRecorded` makes the stronger two-observation vs historical timestamp comparison explicit, but **neither proves a reboot or authorizes any installation mutation**. `msi-attempt-status` now reads Windows Installer registration twice, and the bounded profile inventory rechecks each record's OS registration after the initial scan. Changed OS registration invalidates the read-only result. The new queries do not certify a product, uninstall, repair, retry or clear locks. Cross-build success is not live Windows acceptance.
