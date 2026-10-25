# Cluster v0.507 | Project Scoped Roles + Access Rule Impact Preview

**Baseline:** Cluster-v0.507-Scoped-Permission-Bundles.zip (the verified full development-source checkpoint).
**Status:** Source implemented, AST validated, focused runtime-mock tests passed. NOT integration compiled, database tested, or Windows certified.

## Delivered

1. **Canonical Project roles** in `packages/shared/src/project-role-policy.ts`: Project Lead (manage), Producer (manage), Designer/Engineer/Artist/QA/Contributor (contribute), Reviewer (view). Stable role keys and explicit access levels. These are **ProjectMembership authorities**, not Studio tool permissions or another ACL table. Existing Admin/Owner rules, tool caps, explicit person project overrides, and Access Rules remain separate.
2. **No privilege from free-text role labels.** `membershipIsLead()` now checks `isLead` / `roleKey` only. Project creation and crew management validate supported roles, permit a single primary Project Lead, and persist canonical `roleKey`, `roleLabel`, `accessLevel`, `isLead`. Invalid role submissions are rejected before the ordinary Project revision update; the UI offers a typed role dropdown and blocks missing/multiple leads.
3. **Renderer consistency.** Project access fallback uses canonical membership access levels and active membership windows instead of assuming every member may contribute or inferring access from their free-text display name.
4. **Read-only Access Rule impact preview.** `POST /api/access/rule-impact-preview` checks the **same target/manage/project boundary** as real access-rule mutations, validates the intended subject against canonical Workspace/Team authorities, and uses `authorization.hasProjectResourceAccess` / `hasTargetAccess` with existing + proposed active rule snapshots. Does not mutate an AccessRule or Settings.
5. **Library source authority preserved.** The common access-target management check now applies the separate Library inherited source/folder manage ACL before either mutating an Access Rule or previewing it. Authorization denial is a non-disclosing 404.
6. **Bounded privacy-safe preview.** Up to 40 active workspace members are compared; external accounts are sampled from a bounded larger window. Response includes access-level before/after counts, raised/lowered/unchanged counts, scope and explicit `sampled` flag. No per-user names, identifiers or hidden target identities. The response is `private, no-store`.
7. **Access UI.** Added explicit **Preview impact**, busy/stale-response safeguards, before/after distribution table, and prominent simulation limitations. Simulations are advisory; live writes reauthorize separately.
8. **Tests.** `tools/scripts/cluster-0507-scoped-roles-impact-assertions.mjs` runs the role contract, real membership writer (with transaction mock), active-window semantics, and read-only preview against mock Prisma/authorization dependencies.

## Important limitations and next actions

- Preview is a **bounded sample**, not full workspace authorization certification. It does not simulate child-specific overrides, Library folder/source policies, future expiry, external recipients beyond the sample, or access changes in other tools; those continue to be enforced on real reads/writes. No live multi-user permission tests were run.
- Project header revision CAS and ProjectMembership replacement are still separate database transactions in the existing route. This pass validates role input before the revision commit to reduce bad partial writes, but a later transactional project-update consolidation is required to ensure atomicity against database interruptions.
- No new Prisma models or migrations; native executables were not rebuilt.
- Pass 14/15 authoritative source reconciliation, dependency-backed compile, full PostgreSQL/Windows/runtime, App UI, CSRF/PIN, expiry, owner invariant and performance certification remain open. Do **not** call this a release.
- Next: team/project scope inheritance beyond ProjectMembership roles (permission bundles scoped to Projects/Teams with clear effective provenance), large-dataset cursor discovery and picker adoption across workspaces. Continue 0.508 after the shared foundations are coherent.

**Certification policy:** Keep per-feature unit/contract/security tests active now; full application certification remains v0.512.
