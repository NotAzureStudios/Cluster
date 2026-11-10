# Remote Server updates from Cluster Web

## Current implementation

Server Configuration → Maintenance offers **Check for updates**, **Download & verify**, and **Refresh status**. The web app does not supply artifact URLs or executable paths to the Server. The native Windows Manager uses its pinned Ed25519 verification key, configured official main feed, release sequence, bounded download and SHA-256 checks. If the signed feed is unavailable, GitHub release metadata may be shown for **information only**. It cannot authorize a downloadable installer.

Only the authenticated Owner can request staging, after a Security PIN and exact action confirmation. Read-only checks and status require administrator authentication. The main-channel helper writes a private status receipt and holds a single exclusive staging lock. No API route can run shell commands, disable signature verification, update the database or install EXEs.

### What remains

**Unattended remote installation is intentionally disabled.** The existing native Windows Server runs under `LocalService`. The standalone update executor currently uses a UAC-elevated interactive handoff and is designed for native Server Manager operation, not a browser. Calling its executable from Node would be an unsafe privilege-boundary bypass and UAC prompts are not remotely satisfiable.

A future elevated **dedicated update broker**, provisioned during a trusted Windows installation, must consume a short-lived Owner/PIN-authorized, replay-safe request bound to the exact signed release and configuration. It must run outside the replaceable Server tree, enforce SCM ownership, hold writes, create a verified cold database snapshot, stop/start the service, independently check installed identity and API readiness, publish durable progress and roll back on failure. It must not accept a user-supplied command, URL or unsigned installer. Certification requires an actual Windows service-managed in-place upgrade and failure recovery with populated data.

A new Server release/installer is necessary to deploy these UI and native changes onto an existing installation; merging source into `main` does not update installed binaries.
