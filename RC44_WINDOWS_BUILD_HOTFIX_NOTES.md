# Cluster 1.0.0-rc.44: Windows renderer build hotfix

Based on RC43. Fixes four independently reproduced TypeScript compiler errors reported by the Windows RC43 installer on October 27, 2026. Source version remains `0.546.0`; only the testing release sequence increases to 44.

- Operations: show worker capacity only when both online and total counts are reported; avoid dereferencing optional totals.
- Whiteboard draft: use its current editable name rather than referencing a nonexistent `nameOverride`.
- New Whiteboard prompt: provide the required accessible message.
- Whiteboard creation: apply an explicitly chosen creation name to the API payload instead of discarding it.
- Whiteboard toolbar, More menu and details panel: use zero-argument callback wrappers so click/action events cannot become the name override.

The installer embeds the entire patched source, not just a delta. On Windows the installer still performs native toolchain, Prisma and npm builds. Full application build requires Windows execution. RC43's missing package-lock warning remains unresolved; a clean lockfile must be generated and frozen after a successful verified build before 1.0 Stable.

## Windows retest

Run `Cluster-Installer-RC44-BUILD-FIX-TEST.exe`. The embedded RC44 sequence forces a clean candidate and protects an earlier managed installation until builds succeed. Inspect `D:\Cluster-Server\Cluster\installer.log` if it fails. Do not use the previous RC43 installer again.
