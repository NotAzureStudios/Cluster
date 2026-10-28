# Cluster 1.0 RC41 | Visual-first merge and polish

**Baseline:** RC40, which already includes RC37 Discord managed bot, RC38 project visual identities and custom Git logo, RC39 charts, and RC40 visual workspace changes.

**Delivery:** Complete development source, RC40-to-RC41 incremental source patch, and a Windows x64 **source-building test installer**. RC41 is not stable or production-certified.

## New visuals and corrections

- **Projects:** The browser shows the **loaded filtered project's** health composition (healthy / attention) and average loaded readiness meter. When server pagination remains, its label explicitly says more Projects are available. Charts do not claim Studio-wide coverage.
- **Inventory catalog:** Replaced repeated Shown / Active / Digital counters with one loaded-catalog status distribution; types are available in a compact ranked bar disclosure. Distinguishes active, retired and other status rather than silently treating unknown status as retired. Audit action and asset inspector workflows remain.
- **Home coverage:** Source Control and Discord adoption now use two named coverage meters against the existing project denominator, alongside the Board and Whiteboard counts.
- **Home Departments / Integrations:** Staffing and provider configuration use existing-authorized-data meters instead of repeating count grids.
- **Home Reviews / Library / Administration:** Ranked comparison bars show state, file type, and queue relative magnitudes; the exact counts remain on the bars.
- **Home Tickets:** Priority tickets relative to the explicitly labeled loaded sample, not the entire server. The existing scoped-aggregate protection is untouched.
- **Home QA:** Removed the misleading trend indicator that calculated an alleged previous sample from the *current failed count*, which was not history. Current open/failed/blocked measures remain visible.
- **Shared model:** Pure `summarizeLoadedAssets` and `summarizeLoadedProjectHealth` helpers preserve unknown status and invalid/empty readiness semantics. No new routes, reads, polling, packages or migrations.
- **Version:** `config/release-candidate.json` now identifies RC41 so the embedded installer upgrades managed RC37 installs instead of silently using the older release sequence.

## Verification here

- Inherited RC36 12/12 groups; RC37 Discord 11 checks; RC38 visual identity 13; RC39 checks; RC40 52 checks.
- RC41 visual-merge math / contract checks: 26/26.
- Source audit: 1,195 TS/TSX files, 121 CSS, 4,919 relative imports, zero syntax errors and zero missing authored imports (one existing missing generated Prisma reference in lean source).
- TypeScript renderer comparison with RC40 yielded **zero new normalized error signatures**. This does not constitute a dependency-backed build: no `node_modules` or `package-lock.json` is present here, and most `tsc` diagnostics are missing external modules/types.
- Go installer unit tests passed and Windows x64 PE compiled successfully.

## Important limits

The compiled EXE is the installer, not a fully precompiled production Cluster Server. On Windows, the installer must download its private toolchains and build the complete server/UI. Its Node 24/Prisma 7/Postgres 18 migration process, UI in a real browser, bot life cycle, and the actual install/rollback path have **not** been exercised here. Do not call this Stable or assume live Discord is verified.

No extra dependencies or data collection were added just for charts. Run `node --experimental-strip-types tools/scripts/cluster-rc41-visual-merge-tests.mjs` for focused checks.
