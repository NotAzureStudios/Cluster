# Cluster implementation roadmap | revision 59

**Source baseline:** v0.546.0 TD4 R59, continuing R58 without replacing earlier code. `TECH_DEBT_MASTER_ROADMAP.md` retains the historical debt ledger; `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md` independently defines release gates.

| Phase | Source status | Next direction |
| --- | --- | --- |
| TD0–TD2 | Source-closed | Preserve existing configurations and job ownership |
| TD3 | Source-closed (R30) | Preserve Qt and renderer UI behaviors; native acceptance separate |
| TD4 | **Active (R59)** | Provider/event lifecycle, remaining Search/Actions, Library hierarchy/disposal |
| TD5 | Partly implemented | Dependent Desktop/native integrations |
| TD6 | Major backlog | CD-01–CD-20, Forms and Studio integrations |
| TD7 | Not started | Final canonical cleanup/source freeze |

## R59 delivered

1. Durable domain-event claim serializes pending updates of the same canonical `resourceKind`/`resourceId` by outbox `sequence`, even when earlier work is leased or retrying. Other resources continue independently; intentionally unscoped events remain independent; terminal dead letters release their lane and remain visible as failure evidence.
2. Typed assignment events are required to carry a canonical resource address matching their payload at both publication and replay. Corrupt stored rows cannot invoke subscribers or advance checkpoints.
3. Source Activity publisher normalizes global Packet/People work identity independently from incidental Project activity context while preserving scope on Project-owned objects. Outbox persistence does not infer a Project scope onto a typed global assignment.
4. Idempotent same-ID retries now protect correlation and causation identity in addition to existing actor, payload, scope and revision comparisons.
5. 21 focused checks and 27 inherited suites pass; authored source/CSS/import scans pass. No migration and no native executable updates.

## Remaining TD4 source closure

1. **Producer/consumer lifecycle:** finite registered-owner matrix across all real domains, including non-TD2 providers, startup/shutdown/disabling, fan-out retries, subscription permanence and re-enable semantics. Do not mistake ordering for complete provider ownership.
2. **Shared Search/Action:** remaining mandatory workspace adapters, authorized record hydration and secondary Source binding selection.
3. **Library hierarchy:** safe bounded durable folder tree operations with concurrent edits, recovery and ACL validation.
4. **Governed physical disposal:** legal holds, retention policy, restoration grace, evidence and idempotent authorized deletion.
5. **TD4 source-closure audit:** exact current owner/kind/consumer matrix and negative access tests, no duplicate general framework.

## Certification remains separate

Node 24 dependency-backed compilation, live PostgreSQL multi-process ordering/lease timing, current-permission multi-user acceptance, Windows/Qt protocol activation, and OS process lifecycle validation have not been performed by this source-only R59 pass.
