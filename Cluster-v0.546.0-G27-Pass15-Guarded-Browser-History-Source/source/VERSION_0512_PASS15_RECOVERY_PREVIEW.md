# Cluster v0.512.2: Pass 15 behavioral recovery (not the original Pass 15 merge)

This checkpoint reconciles **available evidence**, not a substitute for the unavailable authoritative source archive.

## Verified inputs
- All three user-uploaded Pass 13 archives are identical; only one is needed.
- Exact P16C patch bytes already exist in the v0.512.2 current source; its functionality and P16A/B/C assertions are retained. **Do not reapply P16C**.
- Pass 16A patch overlaps the cumulative P16C overlay and must not be independently overlaid on the newer branch.
- Pass 15 source ZIP **is not available as raw bytes**. A Library filename and handoff SHA alone are not a merge input. No exact 3-way merge has been performed.

## Implemented recovery in current 0.512.2 source
1. Canonical five Operations destinations: Command Center, Incidents, Governance, Systems, Data & Audit. Specialist working destinations are retained via a contextual navigation rail rather than duplicate peer tabs. Tests ensure links render a destination.
2. Studio Settings separates **People & Access** from Studio, retaining Projects, Delivery and Automation.
3. Project Type tools use a single **On/Optional/Off** matrix sourced from the canonical shared manifest. One shared normalizer disallows duplicate membership in contradictory sets; malformed input uses On > Optional > Off precedence, on both server and renderer.
4. Production technology profiles have explicit `standard`/`specialized` classification. New studios advertise generic only. Admins can enable specific specializations from Studio Settings via a typed array; normal Project creation hides the technology selector when there is no choice. Server create and changed-profile updates require Studio enablement, while retained existing profile references remain valid.

## Known differences from authoritative Pass 15
This is **feature-level recovery**, not byte-identical archival recovery. Exact Pass 15 implementation and its conflict set cannot be derived from Pass 13 plus later patches. Server Configuration four-domain visual refocus and Tool Infrastructure's Advanced time administration remain untransplanted. An authoritative merge remains blocked, explicitly.

## Testing and certification boundary
- 29 focused regression suites passed, including P16A/B/C and 19 new recovery assertions.
- 999 TypeScript/TSX files parsed with 0 syntax diagnostics; 3,100 renderer relative import links resolved; 108 CSS files passed delimiter checks.
- No full TypeScript dependency-backed build, Prisma/PostgreSQL runtime test, Windows native compile, browser verification, or source-authoritative Pass 15 merge claimed.

## Next engineering action
Use the actual Pass 15 ZIP with SHA-256 `c758d4edfa38e8bde538b89c1c200a7cf7fbd2fbe08295bc43d5d1e1b0616c1f` to compare against the Pass 13 ancestor, then reconcile its exact changed hunks into this v0.512.2-derived branch. After that, build and run against PostgreSQL. Until then, this preview is optional and revertible via the included incremental patch.
