# Cluster Server 1.2.3 — Windows installer extraction visibility

**Release scope:** Server-only maintenance to the native Windows installer. The native Qt Desktop **1.2.2** installer and portable ZIP remain the exact, hash-pinned artifacts from published v1.2.2. Signed Server update sequence: **200003**.

## Reproduction and cause

The published Cluster Server 1.2.2 installer embeds a **236,897,684-byte ZIP (roughly 226 MiB compressed) containing 28,487 source/runtime files**. After logging `[1/6] Verifying the source archive in isolated staging` and `Extracting validated source into isolated build directory`, its Windows PowerShell implementation called `[IO.Compression.ZipFile]::ExtractToDirectory` synchronously. It displayed no further progress until completing extraction and its 28,488 per-file SHA-256 manifest checks. On the successful GitHub Windows clean-install smoke, that silent stage lasted **about 80 seconds** (20:41:50 to 20:43:10 UTC); this is not evidence of a deadlock on the studio machine. Antivirus, slower storage, insufficient space or access-denied errors can make it longer.

## Fix

- Iterate the still fully ZIP-path-validated revision inside the isolated Build folder, reporting total file count and uncompressed size before work, and progress at most every 500 files or after five seconds, plus a final extraction-completed line.
- Preflight available disk capacity to hold the entire uncompressed archive plus 256 MiB before starting extraction; fail with an explicit reason rather than running until the volume fills.
- Log SHA-256 manifest verification every 500 files and retain the complete-file allowlist check.
- Preserve the original process/port preflight, source digest, symlink/path/ZIP-bomb checks, built-runtime verification, rollback, Library/PostgreSQL preservation and existing managed Server safety contracts. **This change does not skip verification or remove the large prebuilt payload**.
- Give the operator independent visibility in `C:\Cluster\installer.log`.

## On the affected 1.2.2 installer

The screenshot does **not** prove the installer is frozen. If `powershell.exe` is active and `C:\Cluster\Build` is gaining files, allow the ongoing safe staging to finish. Do not start a second installer or modify the existing managed `C:\Cluster\Server` while upgrading. Check the installer log and task manager; if it has actually stopped responding with no output/file/CPU/disk changes for an extended period, terminate only after recording diagnostics and confirm the managed Server is intact. Do not delete `Server`, `runtime`, `data`, `Revisions` or `Rollback`.

## Release admission

Publish only after exact-source Windows installer compile, clean install, Windows upgrade and signed-update CI are green, then verify `v1.2.3` installer receipt and `server-v1.2.3` signed feed SHA-256. Real Windows antivirus interactions and populated studio database upgrade/rollback remain to be tested.
