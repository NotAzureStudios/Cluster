# Cluster Server 1.0.3: server setup fixes (candidate; not published)

> **Build status:** Source candidate. A GitHub Actions installer artifact is not the same as a signed, published release. Do not replace the immutable 1.0.2 installer or publish a 1.0.3 tag before Windows upgrade, database, and recovery acceptance.

## Changes

- Unified PIN keypad and physical keyboard focus in the sign-in/reauthentication UI (#35).
- Domain hostname input normalization and Cloudflare DNS-target guidance (#37).
- Native Win32 Settings categories/search, dedicated Updates settings, correct configured-port diagnostics, and wrong-feed error messages (#40).
- Invalid `databaseUrlOverride` now gives a stable, credential-free validation error instead of an internal 500.
- Web Server Configuration **Save & restart** can post a PIN-authorized one-shot request to the separate Windows server supervisor; the native owner verifies a fresh request against the saved configuration fingerprint and restarts only its managed Host/child process job.
- Signed update verifier and publisher recognize stable `1.0.x` releases on the `main` channel with sequence `50 + patch`. No direct EXE update URLs, signature bypass, automatic downgrades, or cross-origin downloads.

## Limits / operator acceptance

- The authenticated restart flow requires Windows **interactive Server Manager or installed Windows Service**. It is not a general cross-platform remote command API.
- A managed restart and a failed startup must be verified in both native launch modes. A service-owned PostgreSQL database must retain its credentials and data.
- The API restart receipt may be `accepted`, `ready`, or `failed`. Browser reconnection must not imply completion before readiness.
- The updater still **does not execute** staged installers. Completing end-to-end installation, snapshots, automatic rollback, and in-product update delivery is a separate security-critical engineering task.
- Publishing a signed JSON update manifest requires the existing protected Ed25519 signing key. Never move it into source or the server installation.
- Run full Windows x64 native + web regression tests, a real in-place **1.0.2 → 1.0.3** upgrade, migrations, PostgreSQL/Library backup/restore checks and external HTTPS tunnel acceptance before promoting.


## Automatic-update hardening in progress (before 1.0.3 promotion)

The signed Server update flow now retains the exact signed JSON manifest beside its staged installer. The native Server launcher independently verifies the pinned Ed25519 signature, signed release/channel/sequence, matching receipt, application PE header, managed install ownership and exact SHA-256 bytes before admitting the staged candidate. Invalid, stale, ambiguous or substituted files are rejected without stopping the running server.

Read-only operator inspection of a staged release:

```powershell
& '.\Cluster Server.exe' --root 'C:\Cluster\Server' --inspect-staged-update --update-channel main
```

The native Manager's `stage-update` command also runs this second-pass verification after downloading. Do not run the EXE from the staging folder: it is not an authorized installation entry point.

A testable supervised transaction model now requires a separate authenticated authorization, write/access hold, fully stopped owned processes, verified offline PostgreSQL snapshot, installer application, new-release health check, and commit before releasing access. On failure it specifies stop, rollback, previous-release health verification and release of the hold. Missing hooks fail closed.

Cold PostgreSQL snapshot and restore primitives copy into the installation's external `UpdateRecovery/<transaction-uuid>` directory, verify per-file SHA-256 and completeness, and quarantine the failed candidate database when restoring. They **do not themselves stop PostgreSQL**, do **not** execute an installer, and must be invoked only by a native owner that has proved database shutdown. These tests use isolated fixture data, not a live database.

**Still blocked:** Implement and certify the independent Windows update worker (SCM/interactive ownership, durable intent, UAC/privileges, stop/start, installer application, health and rollback), enforce the temporary write hold in API/Host and background jobs, verify disk/backup capacity, publish the signed main update feed using the protected signing key, and run a real 1.0.2→1.0.3 Windows database upgrade/restore drill. The 1.0.3 release cannot be called self-updating or recovery-certified until those pass. No published 1.0.2 artifacts were modified.


## Native updater safety pass (pre-release)

- `--update-readiness` is now a **read-only** JSON report. It independently re-verifies the pinned signed staged update, checks an existing write hold or pending restart, and identifies the managed PostgreSQL backup prerequisite. It explicitly reports that unattended installation remains unavailable.
- `inspect-update` / `update-readiness` in the native panel console shows the same admission blockers without changing any settings.
- A production handoff can copy a pinned-signature-verified installer to `Cluster-Update-<sequence>-<digest>.exe` beside the original managed `Cluster` folder. This avoids the portable installer's location-dependent **nested-installation risk**. The copy is exclusive, SHA-256 checked twice, and does not execute the installer.
- The Windows installer now supports an **upgrade-only** `--skip-launch` mode to be used by the future independent owner. It refuses unowned/fresh installs, downgrades and replays. The independent owner is still responsible for starting/probing the candidate and finalizing or rolling back the transaction.
- Go tests cover copy authenticity, collision, path trust, an existing recovery hold, update-readiness semantics, and skip-launch admission. Source contracts enforce no auto-apply before owner certification.

### Still release-blocking

**Do not** claim that clicking Check Updates installs anything. The current runtime has no independent privileged Windows update executor that authorizes a PIN-selected release, drains its Service/interactive owner, snapshots PostgreSQL, runs the new EXE while the old Server folder is fully unlocked, probes application + network state, and restores the prior release on failure. A real, signed 1.0.3 update manifest/feed must also be published before automatic update discovery can stage this release.

The 1.0.2→1.0.3 in-place Windows upgrade and failed-start recovery still require live Windows test evidence. Never run the handoff installer from `Server/data/system/updates`.
