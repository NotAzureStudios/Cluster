# Cluster v0.546.0 | F3 P2 to incident and Windows closeout

Continue from the full `Cluster-v0.546.0-F3-P2-API-Readiness-Incident-Bridge-Source.zip`. Do not restart from standalone policy-kit code or older G27 archives.

## Highest-priority connected work

1. **F4 Alert routing & responsibilities:** user/team/department/group/on-call ownership policies, assignment fallback and escalation, operational contact selection and authorization separation. Inbox acknowledgement vs incident acknowledgement semantics, stateful deadlines, reminder jobs, notification suppression/quiet hours and exact event idempotency.
2. **Native offline fallback:** Windows supervisor must catch DB/API/unreachable events when in-app incidents cannot persist and must maintain its own bounded durable emergency evidence/delivery queue. Test restart across loss of connectivity; never put secrets into notifications.
3. **F3 per-tool functional probes:** explicit server-owned allowlist of safe, non-mutating, permission-isolated probes with per-tool budgets, dependencies, response redaction and automated rate limits. Current per-domain readiness is **dependency-level only**.
4. **F2 Windows supervisor & networking:** process Job Objects, supervised startup shutdown, UI startup/tray/on-top, configuration rollback, ports/TLS/firewall preflight. Respect native-only service authority.
5. **F5 scheduled maintenance:** configurable health windows, update verification/rollback, restart/drain policy, Garnet compatibility and fallback. No speculative data repairs.

## Mandatory first certification tasks

- Prisma new nullable unique automation key migration on PostgreSQL 18.
- Real transactional duplicate-create and reopen races in two processes, authenticated UI/API smoke, notification visibility + summary invalidation, Node 24 native dependencies.
- Existing G26 destructive operations remain disabled until provider safety/fencing tests; do not treat a green code assertion as approval.
- CD-01–CD-20 feature ledger, G27 incomplete product work and TD7 fossil cleanup still open.
