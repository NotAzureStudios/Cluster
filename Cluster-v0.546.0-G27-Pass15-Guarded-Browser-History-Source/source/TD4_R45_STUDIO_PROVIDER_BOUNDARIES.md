# TD4 R45 | Studio provider privacy and authorization

## Baseline

TD4 R44 is the sole parent source. TD3 remains source-closed. No database schema changes, native binary changes, or altered public resource-change envelopes.

## Confirmed source defects

- `studio_form`, `form_submission`, `application`, and `packet` invalidations fell through general target authorization and the administrator fast path. A resource ID and event timing can disclose a private form, an applicant's identity, or a Packet even without payload bytes.
- The Studio Audience read helper intentionally recovered from transient Employment/Team/Project lookup failures with an empty projection. That behavior is unsuitable for privacy-sensitive streaming, particularly `exclude` audiences, which could invert into grants.
- Packet invalidations did not require the same audience, Packet tool permission, and Library folder visibility as `/api/packets`.

## Implemented

- Enroll four canonical resource kinds in the existing change-provider registry, proving identity through StudioForm, StudioFormSubmission, PacketDefinition/LibraryItem records. Application events require application-purpose submissions and Studio Systems reviewer permission.
- Studio Form: an authorized Studio Systems editor may see its real forms; members need an active non-application published form matching their current audience.
- Submission: an authorized reviewer can receive existing submissions; members see only their own submission for a currently accessible non-application form. Public respondents receive nothing from authenticated streams.
- Packet: the canonical Packet folder must exist, be a non-archived folder, pass Packet tool permission and the strict Library ACL, and match the current Studio Audience unless the user has Studio reviewer authority. This is **not** a Packet delivery entitlement and does not grant source-file access.
- Extend the existing Studio Audience loader with an explicit `strict` mode; keep the legacy/default recovery behavior unchanged for unrelated callers. The change feed uses strict reads once per batch, invalid or empty non-all audiences fail closed, and Packet ACL context is loaded only when Packet changes occur. Failed reads abort authorization; the existing SSE path resets/closes on provider errors.
- Reject fabricated project scopes on these global kinds. Preserve provider snapshot batching and per-batch live session revalidation.
- Update R42–R44 isolated test harnesses for the new provider dependency; add a route-to-provider R45 harness invoking the actual Studio Audience logic with mocked persistence.

## Executable evidence

Run `node tools/scripts/cluster-td4-r45-studio-provider-visibility-tests.mjs` from the source root. The tests cover audience allow/deny, draft/public-application isolation, reviewer authority, owner-only submission invalidations, Packet ACL/tool checks, nonexistent/archived records, forged scopes, revocation, strict read failures and inactive sessions. See `TD4_R45_VALIDATION.json` for inherited regressions and source scan.

## Open work

The remaining kinds, Source Control repository bindings, People privacy, typed producer/consumer events, feature enable/drain state in feed providers, shared Search/Action adapters, durable large hierarchy operations and write-fenced storage disposal remain TD4 tasks. Node 24 compiled runtime, real PostgreSQL authorization, authenticated SSE and Windows/Qt acceptance remain separate certification gates.
