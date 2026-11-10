# Cluster 1.2.0 — Integrated Server and Studio administration

**Release state: SOURCE CANDIDATE.** The `1.2.0` source identity is not a published GitHub release, signed installer, or certified installed Server by itself. Publish only from a reviewed immutable `main` Windows build with matching build receipt, tests, and the trusted Server update signing process.

## Included

### Windows Server Manager
- Fourth progress meter for NVIDIA GPU utilization. It reuses the existing 30-second async sample; no extra GPU polling loop. Unsupported GPUs show no invented utilization.
- Performance and resource optimization passes A–I from earlier merged work, including request coalescing and caching.

### Web Server Configuration
- The Maintenance tab can check the signed Server update feed, start an Owner/PIN-confirmed native download, verify signature/hash/sequence and inspect staging status.
- The install control is **disabled**. Remote, unattended installation remains blocked until a separately provisioned privileged Windows updater broker is built, secured, tested, and installed. **Do not describe this as complete remote update support.**
- Studio and Server settings are grouped into fewer categories with searchable, icon-based local tabs. Existing field IDs, roles, saved controls, network restart safeguards and deep links remain.

### Operations and Jobs
- First-class Operations → Jobs with queue health, searchable/filtered states, counts, color-coded status chips, progress meters, start/finish timestamps and detail/attempt/trace access.
- Retry/cancel/export use the existing server authorization and durable queue rather than a new scheduler.
- Specialized diagnostics, scheduled tasks, event history and analytics load on demand; jobs text search is debounced, identical reads are deduplicated and stale responses are ignored.
- Redundant panels, overlong text and repeated status messages are reduced across Operations, Studio Settings and Server Configuration.

### Desktop
- Desktop native source hardening and documentation from previously merged PR #132 carry into this source, but **the independently versioned Qt Desktop binary remains 0.482.0** unless a fresh Windows build is explicitly certified. Do not imply the existing desktop download includes newer native fixes.

## Release/installation boundaries

- Server update feed `server-main` requires the Ed25519 publisher key, trusted sequence `200000`, immutable artifact and matching SHA-256 receipt. The general GitHub `releases/latest` link is for manual distribution; it is **not** an update verification authority.
- The 1.1.1 → 1.1.2 signing-key transition remains a one-time manual installer requirement for affected installations. Back up managed data, preserve the existing install parent, and verify the official receipt.
- The source-release bump does not deploy to your Dell server. Hardware tests must cover Windows native Server Manager, GPU failure handling, auth/PIN/update staging, PostgreSQL retention, login, Jobs controls and network recovery.
- The screenshot showing a failed Cluster sign-in is a separate unresolved request failure and is **not** fixed by this release bundle.

## Acceptance

1. Combined GitHub CI passes on **one** integrated commit, not just individually on the two parent PRs.
2. Windows `Cluster-Installer.exe` and `Cluster Server.exe` are compiled and SHA-256 checked against the same release receipt; no third-party installer is substituted.
3. Signed Server update publisher runs only with its protected key and successful CI; any missing key or repository release permissions must fail closed.
4. An operator installs/upgrades in a disposable backed-up Windows environment and verifies data recovery and protected settings.
5. Only after these checks publish/promote the versioned Server release and corresponding Desktop assets where applicable.

Source changes: PR #133 (native GPU + signed Web update discovery/staging); PR #134 (Jobs + admin settings); previously merged #131/#132 (performance and Desktop/readme closeout).
