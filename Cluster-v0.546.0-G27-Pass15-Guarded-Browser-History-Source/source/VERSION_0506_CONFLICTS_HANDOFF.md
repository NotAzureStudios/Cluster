# Cluster v0.506 | Studio Settings Same-Field Conflict Protection

**Status:** Source-implemented and source-tested. Not a runtime-certified release, not merged into the authoritative Pass 15 source.

## Implemented

- The existing `mutateSettingsKeys` writer accepts an optional field-by-field compare-and-swap precondition (`exists` + `value`). The validation and comparison happen inside the **existing** PostgreSQL Serializable transaction and advisory lock `(506, 1)`, before any writes occur.
- An absent setting is distinguished from one whose stored value is `null`, `false`, or an empty string. Conflicts return `STUDIO_SETTINGS_CONFLICT` with the conflicting keys; the server Studio Settings endpoint maps this to **HTTP 409**.
- Studio Settings PUT requires an `expectedSettings` entry for **every field actually being changed**. Omitting the expected map returns HTTP **428 Precondition Required**, rather than silently falling back to last-write-wins.
- The editor captures the raw server settings separately from its local defaulted/normalized view, and sends expected values for changed keys only.
- On conflict, the editor offers **Refresh and review edits**, not an infinite Save retry. It fetches fresh server truth and carries forward **only the user's edited fields**, preserving the working draft without reapplying an old full snapshot.
- Existing internal writers of independent settings can still use the two-argument mutation API, avoiding gratuitous protocol churn across unrelated tools.
- Reused the shared API error presentation, marking `STUDIO_SETTINGS_CONFLICT` as a review-type conflict.
- Added `npm run cluster:0506:settings:conflicts` with **11 behavioral/structural checks**, including two concurrent writers, stale edits, missing vs null, independent fields, and forbidden preconditions.

## Verification

- `npm run verify:source-foundation` passes, including all inherited gates and the new conflict gate.
- TypeScript parse + renderer-relative-import + CSS sweep is required before packaging, along with SHA-256 source manifest and ZIP integrity checks. These are **source checks**, not evidence of a working PostgreSQL deployment.
- Existing `cluster:0506:settings:assertions` updated to assert the new, intentional request payload shape.

## Known limitations and remaining 0.506 work

1. **Authoritative merge blocked:** this development source is still reconstructed Pass 13 + the cumulative P16C overlay + v0.506 continuations, not the trusted Pass 15 master source. Do **not** replace Pass 15 with this tree. Perform a deliberate conflict-reviewed transplant once Pass 15 bytes are available.
2. **Other writers:** Tool Configuration, People profile-field administration, setup checklist, and additional Studio/Server configuration surfaces do not all expose per-field CAS to their respective editors. They may safely patch unrelated fields, but same-field edits can still race until migrated.
3. **Database/file consistency:** server-managed configuration spans PostgreSQL and `cluster.config.json`; this requires a separate atomic publication/recovery design. Do not run it through the DB-only patch API.
4. **Runtime gates remain:** real PostgreSQL concurrent-admin and migration testing, owner passkey/WebAuthn recovery, Windows host/process shutdown, native Qt parity, GPU/media jobs, responsive/DPI and privacy/permission testing.
5. **No release promotion:** do not claim this package runs on Windows solely because its code parses or mocks pass.

## Immediate next plan

Obtain the latest Pass 15 full source; merge reviewed v0.506 changes; run live PostgreSQL and Windows integration evidence. Then begin v0.507 Company/Resource Graph, permissions and shared-engine work, retaining the full master feature ledger and all small wins.

**Version naming:** public package `Cluster-v0.506.zip`. No RC/WIP/pass suffixes. Node/npm use `0.506.0` only for mandatory SemVer.
