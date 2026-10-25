# G27 Batch 4 → Batch 5 handoff

**Canonical source archive:** `Cluster-v0.546.0-TD6-G27-Batch4-Member-Onboarding-Attention-Access-Source.zip`; direct child of the exact G27 Batch 3 archive. **Never apply patches from older versions over this checkpoint.** Source is complete within its scoped implementation; runtime certification is deferred, not passed.

**Implemented:** privacy-safe onboarding actions, first-login and My Work failure truth, current member completion, exact Inbox → My Work onboarding links, Attention queue surfacing, on-demand self Tool effective-access explanations, and admin report cache protection. See `TD6_G27_BATCH4_MEMBER_ONBOARDING_ACCESS_CLOSEOUT.md` and the focused test script `tools/scripts/cluster-td6-g27-member-onboarding-tests.mjs`.

**Preserve:** G27 Batch 1 Settings revision rollback + atomic audit, Batch 2 People access/renewal/offboarding, Batch 3 application conversion, original `/api/onboarding` authority and packet/policy/form completion ownership, G26 Vault/Library/Package protections, UI density and original taskbar Search/Project Tabs.

**Next grouped work:** Home/Admin attention projection with actual onboarding completion-aware counts; effective-access explanations in People profiles and server-authorized contexts; navigation/action menu consistency; shared Search/Create and Communications. Avoid creating a second authorization or onboarding state store. Review browser event timing for onboarding scrolled navigation in future runtime QA.

**Cert/safety:** Actual PostgreSQL 18, full Node 24 compilation, browser/Qt and Windows native acceptance not run. Physical disposal, automatic MSI recovery and external secret-provider revocation remain independently gated.

**Tests to repeat:** `npm run cluster:td6:g27:member-onboarding`, `npm run cluster:td6:g27:application-onboarding`, `npm run cluster:td6:g27:people-lifecycle`; keep suites bounded if execution limits interfere, and report partial results exactly.
