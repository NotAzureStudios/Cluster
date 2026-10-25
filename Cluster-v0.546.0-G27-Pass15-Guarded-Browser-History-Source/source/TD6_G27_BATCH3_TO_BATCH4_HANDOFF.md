# G27 Batch 3 → Batch 4 handoff

**Canonical parent:** `Cluster-v0.546.0-TD6-G27-Batch3-Application-Onboarding-Integration-Source.zip`. Reuse this complete source, not Batch 2 or historic lean sources. Never replay an older patch over Batch 3.

**Batch 3:** transactional application-review and conversion audit, bounded explicit applicant-to-People mapping, strictly eligible onboarding, transactional member Inbox assignment and admin action closeout, single-item authorized application deeplinks, Person follow-through, more complete Admin operations metrics. Source-only tests and UI scan passed. No schema changes. Preserve G27 Batch 1 setup rollback, Batch 2 People renewal closeout, TD6 G26 security protections, and existing application CAS behavior.

**Next connected priority:** Close the remaining recipient-facing onboarding process: a discoverable authenticated `/api/onboarding` member surface and step deep links, authoritative completion state, clear outstanding/overdue Admin/Home attention and effective People access explanations without leaking private Studio information. Then bundle shared Search/Create, navigation and communications. Focus on whole journeys and the canonical system; do not invent additional account or permission stores.

**Safety/cert boundary:** No physical storage deletion, direct third-party credential revocation, or automatic MSI recovery without separate authorization and runtime proof. User explicitly deferred certification; distinguish source tests from execution evidence. Full build, live PostgreSQL, browser/Qt and native Windows tests remain not run here.

**Verification:** `npm run cluster:td6:g27:application-onboarding`, `npm run cluster:td6:g27:people-lifecycle`, and `node tools/scripts/cluster-td6-source-scan.mjs`. One large G27 command can exceed the execution window at its final scan; run bounded suites independently and report exact partial results, never fabricate success.
