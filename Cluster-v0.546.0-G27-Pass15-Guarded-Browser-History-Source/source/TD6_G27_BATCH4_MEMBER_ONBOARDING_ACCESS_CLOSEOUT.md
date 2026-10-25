# Cluster v0.546.0 | TD6 G27 Batch 4 — Member onboarding, attention and access explanation

**Parent:** G27 Batch 3 Application & Onboarding Integration. **Status:** source implemented and source tested, no new Prisma migration or native executable changes. Production certification remains separate per project direction.

## Connected workflow delivered

1. Existing `GET /api/onboarding` remains the sole source of member onboarding progress; an authenticated response is explicitly private/no-store. It composes published/active assignments, canonical Packet completion, current Policy acceptance (including matching content hash), and submitted/approved Form completion. No parallel completion table or user-maintained checkmark state was added.
2. Missing/restricted Packet, Policy, or Form steps show as unavailable, and do not leak previously stored restricted source IDs, titles or versions. Packet action construction now handles deleted Packet definitions without throwing, including an independent audience check before providing a navigation target.
3. First-login no longer turns a failed `/api/onboarding` request into an apparently empty onboarding list. It differentiates loading, true empty state and unavailable state, with retry; entry can continue so policy gating and canonical My Work remain authoritative.
4. My Work likewise retains the last known onboarding projection and visibly warns if refresh fails. Onboarding uses a fresh member API call rather than replaying a renderer cache after access changes.
5. Unfinished plans participate in the existing My Work Attention queue. Their urgency reflects actual per-assignment progress and due date, with an exact-assignment link back to the Today onboarding panel. Finished required steps do not appear as new attention items.
6. Onboarding Inbox action navigation resolves to `mywork` and a scoped onboarding inspector intent. My Work only scrolls to an assignment after finding it in the authenticated member projection. Navigation works on initial mount and when another Inbox link arrives while My Work remains open; native desktop route mapping is supported.
7. New on-demand **Why can I access this?** panel in My Work Attention uses existing `GET /api/access/explain?tool=...&action=view`, without accepting a user ID. It shows current tool-level allow/deny reasons and contributors, explicitly noting that Project/Library/record ACLs remain separate. No polling, duplicate access engine, or new database authority was introduced.
8. Administrator onboarding version reports are marked private/no-store because they contain named people, current completion, and lifecycle details.

## Validation

- New G27 member onboarding checks: **12/12 passed**, including actual registered handler tests for identity, restricted/deleted resources, genuine completed Packet evidence, action navigation and UI failure cases.
- G27 Batch 3 application conversion: **21/21 passed**; G27 People lifecycle **13**, renewal **17**, offboarding **21**, return-to-studio **18**, config rollback **16**, setup guidance **14**, all passed.
- Existing G07 cross-tool UX **12/12**, 0.538 onboarding publication runtime **6/6** passed. The 0.538 suite requires `node --experimental-strip-types` under the available Node 22 runtime; an initial invocation without that flag failed before its tests executed and was repeated correctly.
- Source scanner: **1,104 TS/TSX** files, **3,239 renderer relative imports**, **110 CSS**, no reported syntax, unresolved import, or brace findings.
- Full Node24 dependency-backed build and PostgreSQL/browser/Windows runtime certification not performed.

## Remaining work

- Broader effective access explanations in People profiles and Admin Access Explorer, Account/People tooltips, Home attention widgets, and onboarding lifecycle reporting across large audiences.
- Shared Search/Create, navigation semantics, announcement and communications integration are still part of G27. G28 and TD7 remain future milestones.
- G26 safety hold: destructive physical storage disposal, automatic MSI repair and direct external credential revocation remain unverified/disabled; do not infer completion.
