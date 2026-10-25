# G26 Pass 29: Read-only MSI boot-continuity observation

## Scope delivered

A per-Package MSI recovery report now includes a **non-authorizing** OS-uptime/UTC comparison for any existing MSI attempt receipt. The same bounded observation appears inside the profile-wide MSI inventory. The native Windows helper samples `GetTickCount64` and a near-simultaneous UTC timestamp; a pure Go classifier compares the resulting estimated boot timestamp against the receipt's start/launch/finish times, using a five-minute ambiguity band.

States are `reboot_indicated_unverified`, `same_boot_indicated_unverified`, `boot_relation_ambiguous`, or `os_uptime_unavailable`. The estimate can be skewed by system clock correction, suspension, or imperfect observation. **None of these states confirms a reboot**, validates an application installation, or supports retry/repair/uninstall, and `rebootConfirmed=false`, `osAttested=false`, `readOnly=true` are mandatory. Existing immutable MSI receipts were not rewritten. The current-user and machine-wide ProductCode registration query remains an independent, read-only observation.

The Qt native capability broker independently validates the boot observation before publishing either a per-Package response or a profile inventory record. The renderer performs the same safety validation, blocks malformed or contradictory reports, and shows an explicitly advisory assessment. New tests exercise the production renderer validators against tampered, omitted, malformed, over-bound, and falsely attested observations. Portable Go table tests exercise absence, same-boot indication, later-boot indication, ambiguous timing and malformed timestamps.

## Non-goals and release gates

There is no automatic reboot, no installation/OS health attestation, no retry, no repair, no uninstall, no rollback, no clearing of interrupted locks, and no new installation grant. Real Windows reboot observation requires a Windows 10/11 VM and deliberate test MSI execution with clock-correction/restart fault cases; linked Qt runtime and live PostgreSQL integration were not available here. Existing G26-10/G26-11 and release gates stay open.

## Reproduction

- `npm run cluster:g26:p29:msi-boot-observation`
- `cd tools/native/package-stager-go && go test ./... && go test -race ./... && go vet ./...`
- `cd tools/native/package-stager-go && GOOS=windows GOARCH=amd64 go build -o <local-output> .`
- `node tools/scripts/cluster-td6-source-scan.mjs`

The full source ZIP is canonical. The Pass 28 → 29 overlay is a byte-for-byte reconstructable diff of source ZIP contents, and the SHA-256 manifest inside the source ZIP is regenerated.
