# Cluster 1.0 Feature Progress | v0.507 historical feature wave

This is a milestone progress index, not a replacement for the original Master Roadmap and Feature Ledger. A source-level test is **not** production certification.

| Workstream | Engineering status | Remaining before 1.0 |
|---|---|---|
| 0.506 security/setup/config/GPU foundation | Source implemented, pending merge/certification | Conflict-reviewed source consolidation, final runtime certification |
| 0.507 Company Graph | UI + domain mutations implemented, source tested | Large-company pagination, full scoped-policy integration, runtime verification |
| 0.507 Resource Graph/Search/Permissions | Project-scoped server-authorized Resource Picker and Action Registry, tested in Access | Scoped roles/bundles, graph exposure, paginated cross-tool discovery and wider picker/action adoption |
| 0.508 People/Forms/Packets/Inventory/Vault | In development: People atomic lifecycle entry | Account lifecycle, authoring/publishing, inventory, secrets and entitlements |
| 0.509 Work System | Planned major overhaul | Consolidate Boards, Whiteboards, Tickets, dependencies, comments, approvals and workflows |
| 0.510 Planning/Projects/Library/Admin | Planned major overhaul | Timeline, Calendar, asset management, Project control, admin policy/configuration |
| 0.511 Communications/Integrations/Packages | Planned major overhaul | Notifications, Git/LFS/Unreal, Discord, controlled immutable distributions |
| 0.512 Certification/hardening | **Deferred at user's request** | Full Windows/PostgreSQL/auth/multi-user/GPU/mobile/DPI/performance/privacy certification |
| 1.0 certified release | Not achieved | All critical gates green |

Every major version must still account for **Major Systems + Small Wins + Cleanup + Certification**. Feature lifecycle remains: Planned → Backend Ready → UI Ready → Integrated → Tested → Certified. Full certification is a final phase, not a brake on feature development.

## Shared actions continuation (October 8, 2026)

- Implemented typed, resource-bound action resolver for Work Actions and taskbar Project tabs, with explicit domain-provided visibility/availability decisions. This is a UI adapter, not a new ACL/command dispatcher.
- Project Access's Create Rule target now uses the canonical Resource Picker already used by Access Explorer. Both receive a single memoized scoped target set.
- Added per-intent in-flight coalescing and busy UI for Project Access rules and restricted share links; server API idempotency remains authoritative where eligible.
- Improved stale asynchronous Access Explorer decision protection.
- Explicitly excluded one-time restricted share-link bearer token responses from persisted idempotency receipts.
- 19 focused checks, including real execution/concurrency checks for coalescing; complete Windows/PostgreSQL/authorization/UX certification still deferred.

## Authorized discovery / Access Explorer hardening (October 8, 2026)

- Project-scoped server Resource Picker discovery now applies live Project/target ACLs, Access Rules, and Library inherited source/folder permissions before returning names; bounded query/search and no-store responses.
- Project Access Rule Builder and Access Explorer use server-returned authorized targets, never local project entities as permission evidence.
- Explain previews now check the **request actor's** own visibility and target-to-Project relationship before showing another person's access decisions.
- 7 new executable checks plus 86 existing focused checks passed. PostgreSQL/Windows/Pass 15 conflict merge and general studio-wide discovery remain open.

## Scoped roles / Permission Bundles continuation (October 8, 2026)

- Studio Settings stores versioned, bounded permission bundles and ordered Department/Role attachments; no second ACL table.
- Shared authorization uses inherited bundle layers with provenance and user overrides still final.
- Bundle management, disabled/archived behavior and preview UI are implemented in Studio Settings.
- Studio Setting writes validate revisions, bundle IDs, supported tools, and dangling assignments before publishing through pre-existing PIN + optimistic-concurrency safeguards.
- Admin-only proposed policy preview compares effective access without applying settings.
- 28 contract/source assertions and 14 executable authorization-engine runtime assertions passed.
- Project/resource-scoped role assignment and full runtime certification remain future milestones.

## Project-scoped roles / Access Rule impact continuation (October 8, 2026)

- Eight canonical ProjectMembership role presets with scoped manage/contribute/view defaults; only one designated primary Project Lead.
- Project Team UI uses a typed role selector, validates lead selection, and exposes role-level access. Roles persist through existing ProjectMembership records and canonical auth.
- Removed privilege inference from mutable role labels; browser fallback respects actual membership access levels and active windows.
- Added no-write `POST /api/access/rule-impact-preview` using existing authorization resolver, target-manager guard and normalized Team/Workspace subjects.
- Bounded, anonymized before/after permission matrix with stale-request handling in Project Access.
- New targeted suite: 25 assertions. Release gates unchanged.

## Atomic Project membership / secure cursor continuation (October 8, 2026)

- Project revision compare-and-set and crew replacement share a single Prisma interactive transaction; interrupted/stale Project writes no longer leave split Project header and crew in the source path.
- Canonical Resource Picker discovery has encrypted per-actor/per-Project cursor pagination and per-page ACL enforcement, replacing the fixed 301-per-kind ceiling. Search + Load More are wired in both Project Access locations.
- Authorization reads reuse one per-request canonical Project rule snapshot and separately fetch only older direct-target rules without a projectId.
- 19 new atomic/authorization paging assertions; all eight 0.507 focused suites pass. Live PostgreSQL and full dependency build remain unverified.
- **Still outstanding** in 0.507: Project/Team scoped bundle inheritance and wider picker/action adoption; Pass 14/15 source reconciliation and runtime certification are separate gates.

## Studio Team bundles / shared discovery continuation (October 8, 2026)

- StudioTeam owns validated `permissionBundleIds`, with one additive Prisma migration. **Studio Team is not Project scoped.** Admin-only writes, existing revision guard and authoritative catalog validation.
- Canonical resolver adds active Team Bundle layers between Department and Role. Explanations retain team ID, catalog bundle ID and bundle revision. User and explicit Role overrides still win.
- Other-user Access Explorer previews now hydrate normalized Studio Team memberships. Disabled/suspended/archived/expired Owner/Admin accounts fail closed.
- Shared authorized project-resource hook powers Project Access with server-backed kind-scoped paging, cursor validation, stale-result rejection and failures clearing stale names.
- All nine 0.507 source/runtime-mock regression suites pass (175 checks). Full TypeScript/Prisma/Windows/PostgreSQL certification and P14/P15 merge are outstanding.
- Next: Project-specific bundle scoping and broader cross-tool picker/action adoption, then v0.508.

## Project ceiling + Board projection picker continuation (October 8, 2026)

- Studio Settings can now assign existing Studio bundles as **restrictive per-Project ceilings**. Explicit tool levels only reduce access; missing keys never grant it. Project-specific grant bundles and user/Team scope are **not** implemented by this restriction layer.
- Direct Project and resource authorization, Access Rule allowances and archive helper respect the ceilings; admin recovery is restricted to active identities. Admin Settings writes validate catalog/Project references and use the existing PIN/CAS publication.
- Card Projection uses shared kind-restricted server-authorized Board Resource Picker with paging, lazy loading, error/denial handling and selected-target checks.
- Source/mock-runtime regression suites: 202 assertions pass. Repository parsing and CSS parsing pass; Prisma-generated client and full dependency-backed build still unavailable. Live DB/Windows/multi-user and Pass 14/15 reconciliation remain pending.

## Resource Graph discovery + authorized focus continuation (October 8, 2026)

- ProjectRelationship remains the single canonical graph store. SQL-filtered categories, critical-only and blocking-only graph neighborhoods are bounded in depth, edge count, scan count and concurrency.
- Existing Project/target/Library authorization decides visibility for **both** endpoints. Names are hydrated only after access-filtered neighborhood traversal.
- Project Control graph adopts the shared server-authorized Resource Picker (search, kind filtering, continuation) and keeps record focus; displayed graph degrees and truncated warning corrected.
- New source/mock-runtime suite covers 21 behavior and integration assertions; regression suites pass. No full TypeScript, live PostgreSQL, Windows, browser or Pass 14/15 certification claim.

## Project Control privacy and Library References continuation (October 8, 2026)

- Fixed unfiltered Project Control overview relationship metadata and candidate/title exposure; limited authorization to bounded batches and redacted hidden linked IDs in response records.
- Added project-scoped Library References inspector showing visible incoming/outgoing linked work with Work Action menus and category/direction filters; no global Library graph authority created.
- 23 dedicated Project Control/Library focused assertions, 12 cumulative suites/246 assertions, static parser/import checks. Pass 14/15 merge and live PostgreSQL/Windows/browser certification remain pending.

## v0.507 → v0.508 source transition (October 8, 2026)

- Access Explorer shows canonical tool + Project + target decisions and source/provenance; personal explanations are `no-store` and bypass persistent client query caches.
- Project Access rule lists resolve names only from server-authorized Resource Picker candidates, not raw locally loaded Board/Library/Review titles.
- Project Overview, Project Control and People action menus now use the canonical action adapter, not duplicate action authority.
- Open backlog carried forward: per-member scoped **grant** administration, person-specific full impact simulation, wider cross-tool Resource Picker/Action adoption, and Resource Graph global discovery. These are **not** marked certified.
- First actual v0.508 implementation begins with atomic People account provisioning and profile/role edits; details in `FEATURE_PROGRESS_0508.md`.
