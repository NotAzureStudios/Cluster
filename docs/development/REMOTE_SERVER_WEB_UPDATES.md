# Cluster Server: remotely authorized, publisher-signed Windows updates

**Status: experimental PR #136 source implementation; NOT approved for live installation.** A green GitHub build is not a substitute for protected-signing configuration or a real nonempty Windows upgrade and recovery test.

## Operator workflow

1. Provision a Windows Service-managed Server, with a verified backup of PostgreSQL, Library files, configuration and account secrets.
2. During an explicit, elevated Server Manager service-install, the installation provisions a **separate** ClusterStudioUpdateBroker service. It runs as LocalSystem from the administrator-protected Cluster/UpdateBroker directory, independent of the web-facing LocalService Server and replaceable Cluster/Server tree.
3. For an **already service-managed** Server installed before this feature, a local administrator must provision the broker once with the *updated, trusted native Server Manager*: 
   "D:\Cluster-Server\Cluster\Server\bin\Cluster Server.exe" --root "D:\Cluster-Server\Cluster\Server" --update-broker-install
   Verify the actual installed binary name and root first. Do not run an uncertified candidate against live data.
4. In Server Configuration → Maintenance, an administrator checks the signed server-main feed. An Owner confirms **Download & verify** and enters the Security PIN. The native Server Manager independently verifies the pinned Ed25519 publisher signature, sequence, exact size and SHA-256.
5. If the protected broker is installed, running and bound to this Windows Service root, the UI enables **Install verified update**. An Owner must give a second confirmation and PIN. The web API submits no URL, script, executable path or arbitrary argument.
6. A native fixed-purpose helper writes one exclusive, short-lived request bound to the signed main release and the current configuration fingerprint.
7. The independent LocalSystem broker validates the service identity, signed installer and disk readiness. The worker atomically claims the exact request, checks its dispatch fingerprint, holds writes, stops only the owned Server service, takes and verifies a cold PostgreSQL snapshot, invokes the signed installer from the actual portable parent with skip-launch, restarts and probes the managed service.
8. On failure before release, the existing transaction attempts to restore the previous application and database. Uncertain recovery retains its hold and evidence. A browser disconnect never cancels recovery. Successful transactions release the one-shot claim and keep the independent journal for evidence.

## Trust boundaries

- The Server runs as LocalService. A locally provisioned independent broker runs as LocalSystem; there is no headless UAC prompt or generic remote shell.
- The broker accepts only a newer signed main-channel Cluster installer, never a user-chosen URL, command, path or downgrade.
- A protected broker executable lives outside replaceable Server files; SCM service image and account are checked against this exact installation.
- Any ambiguous interrupted dispatch fails closed for local recovery, rather than repeating privileged installation.
- GitHub releases/latest is manual distribution metadata, **not** the update signature authority. A protected Ed25519 private key in the GitHub server-release environment is needed to publish the independent server-main feed.
- Existing older Server builds must receive this updated native broker through a separate reviewed installer first. Interactive-only Server mode has no automatic broker parity.
- The native service startup gate checks Host/API/Web readiness before SCM running; real remote-network and data-retention acceptance remain outstanding.

## Production-release gates

Before enabling on the real Dell Server, require exact-head Go and TypeScript builds, validated installer artifacts, trusted SCM/NTFS ACL review, Owner/PIN and replay tests, an actually signed server-main feed, and a disposable Windows upgrade with nonempty PostgreSQL 18 data, Library, account credentials, configuration and restoration evidence. Inject installer failures, listener collisions, database outages and interrupted recovery. Only after all gates pass should a separately versioned Server installer be published and installed.

**A source commit does not update an installed Cluster Server.** This branch remains a protected review candidate until the above gates pass.
