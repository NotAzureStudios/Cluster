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
