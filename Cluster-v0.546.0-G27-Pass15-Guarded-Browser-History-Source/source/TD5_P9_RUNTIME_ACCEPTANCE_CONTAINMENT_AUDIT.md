# TD5 P9: certification subprocess output-containment audit

## Confirmed issues

- P8 filtered full known database credentials, but `redactor.end()` flushed any unfinished matching prefix if a process stopped midway through a URL or password. Example: `postgresql://alice:...` could become a visible partial secret when the child crashes.
- The P8 child runner imposed a time limit but no byte limit. A verbose or malfunctioning build step could flood logs and write an unbounded output stream to the operator's terminal.
- The reusable helper permitted `stdio: inherit`, letting another sensitive caller unintentionally bypass the filtering contract. A throwing output sink also needed explicit failure containment.

## Fix

- On finalization, any suffix that is a possible unfinished known secret is rendered as `[REDACTED]`, even if it could also be harmless text. Longer token-prefix ambiguity resolves conservatively.
- Accumulate raw Buffer.byteLength across stdout **and** stderr, default 16 MiB. Overflow terminates the whole child process group/tree (the existing native platform helper handles termination) and fails the step; the exceeding chunk is not logged.
- Only `pipe` with a nonempty redaction inventory or `ignore` are accepted. Raw inherited stdio is rejected by the helper.
- Flushing/marshalling output after a child exits is exception-safe and cannot turn an output failure into a successful certification stage.

## Executable proof and limitations

- P9's real-child tests cover partial credentials at child exit/deadline, prefix-overlap, concurrent stdout/stderr accumulation, newline-free flooding, post-overflow child termination, output sink errors, bad limits and ordinary successful output.
- P8 inherited tests were updated in one place to reflect the intentional stricter partial-secret masking.
- 71/71 TD4/TD5 selected script checks passed in a lean Node 22 source environment with a temporary globally available TypeScript toolchain linked solely for testing. This is not pinned Node 24 acceptance.
- A malicious child could print unknown tokens, obfuscated credentials, or split a secret between stdout and stderr. Only known secret patterns are protected; access to certification logs must remain restricted.
- `stdio: ignore` intentionally discards child output. `pipe` provides a finite byte budget but does not replace independent OS-level CPU/memory quotas.

## Runtime status

**NOT_PERFORMED:** dependency-backed compilation, live PostgreSQL 18 schema migration/transactions and crash/recovery, Windows native launch/shutdown, NTFS/SMB, NAS/S3, safe quarantine and physical deletion.
