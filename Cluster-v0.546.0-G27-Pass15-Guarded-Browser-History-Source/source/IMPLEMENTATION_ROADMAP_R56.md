# Cluster implementation roadmap | revision 56

**Source baseline:** Cluster v0.546.0 TD4 R56, continuing exactly from R55. The complete technical-debt ledger remains `TECH_DEBT_MASTER_ROADMAP.md`. Runtime and installed-product certification remain governed by `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md`.

| Phase | Source status | Remaining work |
| --- | --- | --- |
| TD0–TD2 | Source-closed | Confirmed defects only |
| TD3 | Source-closed (R30) | Preserve UI/Qt implementation |
| TD4 | **Active (R56)** | Event producers/consumers, shared Search/Action, provider lifecycle; Library hierarchy/disposal |
| TD5 | Partly built | Native, diagnostic, and background implementations required by consumers |
| TD6 | Major required workload | CD-01–CD-20; preserve Forms draft recovery |
| TD7 | Not started | Canonical cleanup, source audit, freeze |

## R56 implementation: durable outbox lease ownership

- Periodically renew the existing event claim during slow handlers; require a fresh owner-matched, unexpired lease.
- Fence each consumer checkpoint, success acknowledgement, and failure/dead-letter transition with a checked one-row update.
- Never mark a stolen/expired claim complete or consume a new worker's lease; resume through existing durable retry/reclaim instead.
- Preserve consumer order, typed schema validation, idempotent side-effect contracts, TD2 subscription ownership, and R51–R55 event/search/provider behavior.
- Add focused tests, run the inherited event and integration suites, and verify full archive/patch reproduction.

## Still required before TD4 source closeout

1. **Typed domain integration:** close remaining domain-native producers and subscribers, including their authorization, backpressure, durable replay, and idempotency contracts.
2. **Shared resource integrations:** complete canonical Search, Action, resource address and deep-link adapters for mandatory workspaces.
3. **Provider lifecycle:** complete enrollment, disable/drain, and subscription cleanup outside the six TD2-configurable tools.
4. **Library:** implement safe durable hierarchy-wide mutations and retention-controlled physical disposal. R40/R41 explicitly preserved unreferenced files and deferred deletion.
5. **Source closeout:** finite inventory of required paths, source-level regressions, and preservation audit; no invented certification claims.

**Unverified release gates:** Node 24 dependency-backed compilation; real PostgreSQL competing-consumer leases, recoveries and advisory locking; authenticated multi-user integration; native Windows/Qt; external webhook exact-side-effect behavior.
