# Cluster v0.546.0 | F2 P6 staged network restart / guarded rollback

## Parent and intention
Exact parent: `Cluster-v0.546.0-F2-P5-Network-Ports-Draft-Review-Source.zip`.
This work connects the protected server-config publication journal to an **offline native Windows Service restart gate**. It is not a generic remote-connectivity test, Windows Firewall manager, or a guarantee of high availability.

## Source changes
1. `server-network-deployment.ts` stages exact before/after boot file snapshots, a UUID linked to the canonical DB/file publication decision, SHA-256 hashes and a restricted-size `staged` record. It refuses edits while a committed deployment is awaiting verification. If the earlier transaction aborted and the file matches its previous snapshot, a new publication can replace the inert candidate.
2. The existing `saveSettings()` holds BOTH advisory locks during the staged write; staging happens after `prepareConfigPublication()` and before publishing the candidate file. The canonical journal remains the ONLY authority for handling an interrupted PostgreSQL/file commit. The rollout record is inert while that journal exists. Server-config PUT uses the existing one-PIN/revision-checked path. Network changes must be submitted separately from database-backed Studio settings to keep offline restoration consistent.
3. The native Windows Service refuses to report SCM Running until its Host publishes authenticated local API/web readiness and the rollout can be marked `verified` on disk. No external URLs are probed, redirects followed or TLS verification bypassed.
4. After **failed FIRST startup only** (never after healthy service later exits; never for an intentional SCM stop), it considers one rollback. It requires a syntactically valid record, exact SHA-256 and byte matches for the current candidate, no publication journal, and a valid canonical previous boot configuration. It atomically restores the previous boot file, persists `rolled_back` and retries one time. A mismatching record or new operator edits fail closed.
5. Restored/blocked conditions use the allowlisted native alert transport, and after database recovery the existing incident importer maps the new `network-deployment` category into the canonical Operations Inbox and escalation rules. The incident routing policy inventory and UI include the new category.
6. Admin-only `GET /api/server-config/network/deployment` is no-store and returns safe deployment state only. Server Config → Network displays status, a manual refresh control, verification limitations and rollback warnings. No additional polling loop was added.

## Tested in this source pass
- 30 focused TypeScript assertions for provenance, exact hashes, no partial commit, owner-only record permissions on POSIX, safe status redaction, unexpected edits and invalid records.
- Native Go deployment tests for successful ready, one-shot rollback, default/no config, aborted commits, in-flight publication, unexpected modifications, invalid previous schema, malformed and trailing JSON, durable state transitions.
- Windows amd64 launcher cross-compilation with a temporary Go 1.23 compatibility manifest; committed Go 1.27.1 remains pinned and unchanged.
- Inherited F2 P5, F2 P4, F2 P3, F2 P2, F2 P1, F3 alert/incident/API/domain suites and TypeScript/CSS/import structural scan.

## Important limitations and release blockers
- **No real Windows 10/22H2 + ESU installation, Service Control Manager, port conflict, boot recovery, filesystem ACL, or fault-injection tests run.** Actual Windows 10 target acceptance is REQUIRED.
- Service-mode ONLY: a direct, standalone or developer run does not independently verify a pending native rollout. The deployment status exposes this so operators can resolve it; an authorized native recovery/cancel operation for standalone usage is still needed before 1.0.
- Rollback is deliberately based only on local ready-file health and managed startup. DNS, external TLS, gateways, client access, Windows Firewall and remote networking can still fail while a local service appears healthy. External verification and manual approval remain release blockers. No firewall changes are made.
- A network-only setting transaction is atomic in the config file but no live PostgreSQL 18 transaction was executed here. Pending Prisma migrations from earlier passes remain untested.
- The plan contains a duplicate of **already-encrypted** protected boot settings. Enforce and test Windows LocalService/operator ACLs on the config directory; POSIX chmod is not an adequate substitute on Windows.
- Recovery after an unexpected config edit intentionally refuses to overwrite anything. Native operator recovery and an incident are needed.
- Two inherited `go vet` warnings remain in unrelated Win32 owner-draw/clipboard pointer conversions. The pinned Go 1.27.1 toolchain and full Node24 dependencies/Prisma generation remain uncertified.
