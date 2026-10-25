# Cluster v0.546.0 · TD3 Pass 15 | Workspace control convergence

**Baseline:** TD3 Pass 14 (preserving TD1/TD2 closeout and TD4 Create/Search reliability). This is an implementation-source checkpoint, not release certification.

## Implemented

1. **Taskbar Quick Ticket is now single-intent.** Before awaiting React state, the submission calls the existing `createClusterCreateIntentControl()` synchronous gate. It sends an `X-Cluster-Idempotency-Key` derived from method, route, and exact serialized request body. Uncertain retries reuse the same key; a confirmed creation is committed before list reload. Opening a genuinely new form explicitly resets the receipt lifetime. This closes an actual duplicate-create path outside Global Create.
2. **Ticket popover and list lifecycle.** The ticket popover cannot dismiss, navigate away through its utility action, or switch the form while submission is pending. Fetches use monotonically increasing request tokens so an older request cannot replace later results or clear a successful submission message. Effect cleanup invalidates inflight results.
3. **One disclosure authority for Projects + People data tools.** Both advanced Data Tools panels now consume `ClusterDisclosureGroup` instead of parallel HTML `<details>` implementations. Their saved views, analytics, aggregation, data projections, formulas and drilldown controls are retained. `contentClassName` provides the existing workspace-specific grid/padding stylesheet contract without duplicating disclosure logic or rewriting all analytics UI.
4. **Qt accessibility.** Native `ClusterComboBox` exposes an explicit accessible label/Tab-stop, and `ClusterSwitch` gets a visible keyboard focus ring driven by existing Theme focus/contrast settings plus accessible naming. No Qt binary changes are claimed.
5. **Source-CSS previews.** Eight dark/light desktop/phone static Chromium fixtures depict People, Projects, Data Tools, and Quick Ticket context, plus a desktop comparison board. These are **not mounted React or actual native Qt screenshots**. The fixture includes simulated sample data and keeps taskbar utilities / user-color identity markers visible.

## Preservation gates

- Floating/docked sidebar and floating/full-width sticky taskbar are untouched.
- Project Tabs replacement Search and separate My Work / Tickets / Transfer Center / Inbox are untouched.
- People user-accent border, rounded-square identity treatment, and separate presence indicator remain in canonical avatar source.
- TD1 Settings Authority and TD2 Tool Runtime remain closed; no release certification is mixed into this implementation roadmap.
- No PostgreSQL migration, API contract rename, or native executable modification.

## Development evidence

- 13 selected prior+current development regression commands passed, including TD1/TD2 and TD3 Passes 7–15.
- 14/14 new tests passed, with actual `create-intent-control.ts` execution for synchronous gating, stable retry receipts, commit and explicit reset semantics.
- Static syntax/relative-import/CSS scan and ZIP/manifest/patch verification results are in `TD3_PASS15_DEVELOPMENT_RESULTS.json`.
- Desktop/mobile source-CSS browser fixtures: 8/8 rendered with no document-level horizontal overflow (not runtime app certification).

## Remaining TD3 implementation

- Audit remaining ad hoc workspace action popovers and migrate the ones that perform authorization-sensitive mutations to canonical action owners without losing their domain-specific controls.
- Gradually retire conflicting legacy CSS selectors **only when** the owned component and its visual identity are preserved by regression assertions and source-grounded previews.
- Continue Qt source parity for preferences/surface behaviors that still diverge from web; avoid falsely claiming native parity from static inspection.
- Close TD3 on concrete implementation criteria; release certification remains a separate roadmap.
