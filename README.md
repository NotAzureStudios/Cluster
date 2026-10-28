# Cluster 1.0 RC36 | Source-only release closeout

This source checkpoint continues RC35, which itself contains the earlier Projects, Boards, Whiteboards, Inventory, Vault, Transfer Center, chart and optimization work. RC36 fixes additional stale-data races in foreground and durable caching, and clears previous-server/session client cooldowns after context changes. It does **not** include an RC36 Windows installer or claim stable certification.

- See `RC36_RELEASE_NOTES.md` for concrete code changes, regression evidence and limitations.
- Run `node tools/scripts/cluster-rc36-source-checks.mjs` for the full source-only regression group.
- See `RC36_WINDOWS_CERTIFICATION.md` for the outstanding build, PostgreSQL, security, transfer and performance acceptance.
- Existing `RC35_RELEASE_NOTES.md` and `RC35_WINDOWS_CERTIFICATION.md` are preserved for implementation history.

**Important:** `config/release-candidate.json` still represents the last installable **rc.32** source lineage, not a certified RC36 binary. Release metadata must only be promoted when a matching native Windows installer is actually compiled, verified and packaged. Do not overwrite a running Cluster installation with the development source ZIP.
