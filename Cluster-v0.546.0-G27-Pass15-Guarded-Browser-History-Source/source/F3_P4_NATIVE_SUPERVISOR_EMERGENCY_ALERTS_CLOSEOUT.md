# Cluster v0.546.0 | F3 P4: Native Emergency Alerts & Readiness Monitoring

**Source-implemented against:** `Cluster-v0.546.0-F3-P3-Incident-Routing-Acknowledgement-Source.zip`.

**Release boundary:** This is *not* a production-certified Windows binary or a tested PostgreSQL 18 migration. Native Go binaries must be rebuilt from this source, preferably with the pinned Go toolchain. The F3 P2/P3 Prisma migrations remain unapplied.

## Integrated change

- Added `apps/native-alerts-go`, a small standard-library-only module used by **both** `apps/host-go` and `apps/server-launcher-go`. No new HTTP listener, external process, SQLite database, or polling service is introduced.
- API process unexpected exit, exhausted native restart attempts, recovery success, readiness startup failure, host listener failure, launcher bootstrap failure, host unexpected exit, and host startup timeout record **predefined** native events even when Cluster API/PostgreSQL is unavailable.
- The Go host independently samples the existing private `/health/ready` endpoint **once every 30 seconds** after the successful startup readiness boundary. It opens one native incident only after two consecutive unhealthy samples and records recovery only after two consecutive healthy samples. These samples do not auto-restart a database-dependent but still-running Node process.
- Native Windows **Stop** and **Restart** buttons require confirmation while the server is running/starting. The existing confirmation for **Close** remains, and the existing Close behavior *still stops the server*. Independent Windows Service lifetime/tray-mode behavior remains F2 work.

## Resilience and storage contract

The native journal is rooted at:

`<Cluster workspace>/data/system/operations/native-alerts/`

The journal does not consult the application database. Records use fixed allowlisted codes/descriptions, a random 128-bit ID and an UTC timestamp; **never** raw exception strings, filesystem paths, SQL URLs, API tokens or user-provided HTTP paths. Files are created exclusively and flushed before a final rename to `.pending`.

Outbound transport is **disabled by default**. Configure the native host/launcher process environment variable `CLUSTER_NATIVE_ALERT_DISCORD_WEBHOOK_URL` to a dedicated HTTPS `https://discord.com/api/webhooks/<id>/<token>` endpoint to opt into external delivery. There is no supported general-purpose webhook/URL target. Discord mentions are disabled, redirects are rejected, delivery has a four-second HTTP timeout, and raw errors never reveal the secret-bearing URL. **Do not store the webhook in source control or Cluster's plaintext settings JSON.** Windows environment/service secret provisioning remains a configuration and certification task.

On success, `.pending` transitions to `.sending` then `.sent`. The claim is a cross-process filesystem rename so the launcher and host do not intentionally deliver the same pending item concurrently. Failed sends revert to `.pending` for later retry. A crashed sender's abandoned `.sending` file is reclaimable after five minutes. Invalid events are quarantined as `.invalid` instead of being sent or blocking the entire queue. Delivery is **at-least-once**, not exactly-once, if a crash happens after Discord accepts the message but before the `.sent` rename; the ID in the message allows correlation.

The journal is explicitly bounded: at most 256 pending records, at most 256 retained sent receipts, at most 4 attempted deliveries per background interval, one periodic retry every 60 seconds, and a ten-minute duplicate-code suppression window. A full journal emits an operator-visible local error instead of silently deleting unsent incidents. Quarantined files and journal permissions require operator review.

## Explicitly unfinished

1. **OS-level delivery certification** on the real Windows server, including inaccessible disk, antivirus interference, Windows ACLs, reboots, actual HTTPS delivery and expired credentials.
2. **Native-to-Inbox reconciliation:** Persist native event IDs in the existing canonical Operations Incident/Inbox system after PostgreSQL recovers. The native fallback currently journals locally and optionally sends to a dedicated Discord destination, but does not notify in-app users while SQL is unavailable.
3. **Assigned on-call rotations / non-admin delegated responders / channel preferences / quiet-hour and critical override policy**, to be implemented on top of existing F3 P3 role/identity fencing.
4. **True persistent Windows Service:** the existing launcher starts with Windows via an on-logon task; the control panel currently owns the child host lifetime. Independent service-on-boot + GUI-on-logon separation, tray behavior and always-on-top are not claimed.
5. **PostgreSQL 18 / Node 24 / Go pinned version / Qt / S3/SMB/NAS / Garnet** runtime certification remains open. Go source was exercised with a temporary Go 1.23-compatible test module and Windows-target compilation; the checked-in Go version remains `1.27.1`.

## Verification

- `apps/native-alerts-go`: unit tests for TLS-only Discord allowlist, disallowed URLs, SQL-independent persistence, concurrent duplicate suppression, retry and sent receipts, crash claim recovery, multi-process delivery, invalid content quarantine, token redaction, and payload safety.
- `apps/host-go`: inherited host tests plus two-sample readiness transition and HTTP probe tests.
- `apps/server-launcher-go`: inherited tests, Windows cross-compile and integration-path source assertions.
- Go `-race` tests and `go vet` pass for all three modules using a temporary Go 1.23-only test copy of the module version; no source version pin was lowered in the release.
- Both Go binaries compiled for Windows amd64 with the same temporary compatibility setup. Executables from that alternate toolchain are **not shipped** as production binaries.
- Inherited F3 P3/P2/P1 source regression suites and Domain settings/network tests pass, plus source scan.

**Operational caution:** This new native emergency path is a resilience supplement. It does not replace the authorized in-app Incident Manager, outage paging escalation, backups, tested restores, manual maintenance controls or human response ownership.
