# Cluster implementation roadmap | revision 44

**Baseline:** v0.546.0 TD4 R44. Historical scope: `TECH_DEBT_MASTER_ROADMAP.md`. Runtime acceptance: `CLUSTER_RELEASE_CERTIFICATION_ROADMAP.md`.

| Phase | Status | Next source work |
| --- | --- | --- |
| TD0–TD2 | Source/core closed | Confirmed regressions only |
| TD3 | Source closed at R30 | Preserve UI and native contracts |
| TD4 | **Active** | Resource provider enrollment, typed events, shared action/search adapters, provider lifecycle and remaining hierarchy/storage safeguards |
| TD5 | Partly implemented | Missing native/diagnostic/background integrations |
| TD6 | Major unfinished source work | Required CD-01–CD-20 workflows |
| TD7 | Not started | Fossil removal after canonical replacements and source audit |

## Completed source work in R44

- Enrolled **Project, Build, QA Plan, QA Session and Release** resource-change providers alongside R43 Board/Whiteboard/Timeline coverage.
- Each provider requires a real, non-archived canonical record and its authoritative Project scope; Project access uses the same Project-view authority as the delivery read API. Administrator events do not bypass identity proof.
- Enrolled resources now load Project-level Access Rules (the R43 skip omitted these) and propagate store failures rather than treating missing rules as public grants.
- Project-less event envelopes resolve their parent from the provider's identity snapshot so real invalidations are not silently lost; false supplied scopes are denied. One provider query is reused through authorization to avoid a second inconsistent identity read.
- Executable feed tests cover missing/archived/mismatched records, absent scope, explicit Project deny, permission changes, administrator identity checks, and provider store failures. Inherited R42/R43 mocks now reflect production administrator authorization.

## Remaining TD4 source implementation

1. Enroll remaining resource types, including privacy-sensitive Forms/submissions, Packet deliveries, Source Control and People, with real domain policy and account-state semantics rather than generic fallback.
2. Build shared resource/action/search adapters, typed provider events and consumer invalidations. Bind provider startup/drain/disable to TD2 ownership where applicable.
3. Complete durable hierarchy-wide moves and lifecycle jobs with authorization/revision fences.
4. Implement write-fenced retention/provenance-controlled physical-blob quarantine and disposal; R40–R44 orphan auditing still never grants deletion.
5. Perform bounded TD4 source closeout; Node 24, PostgreSQL, actual Windows/Qt and authenticated multi-user runtime tests remain separate certification work.

No Prisma migration or native executable change in R44.
