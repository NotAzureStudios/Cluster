# Cluster RC40 development checkpoint

This checkpoint builds on RC39 and implements cross-workspace chart-led summaries for Operations, background jobs, People, Vault, Discord and Inbox, plus My Work text cleanup. Read `RC40_VISUAL_FIRST_WORKSPACE_RELEASE_NOTES.md` for the exact scope and limitations.

Run `node --experimental-strip-types tools/scripts/cluster-rc40-cross-workspace-visual-tests.mjs`, `node tools/scripts/cluster-rc37-source-checks.mjs`, and `node tools/scripts/cluster-rc35-source-audit.mjs` in the source root to reproduce the available checks.

**Source package only.** Do not use this ZIP as a Windows installer or overwrite the installed Cluster directory. The most recent installer verified as an EXE was RC37; RC38–RC40 development changes are not yet in an installable build.
