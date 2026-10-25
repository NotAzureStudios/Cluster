# G26 Pass 30: MSI boot anchor and registration observation continuity

## Implementation

New MSI installation attempts optionally capture an OS uptime+UTC **boot anchor** and persist it in the original pre-launch receipt before consuming the one-use grant. A missing/unsupported system uptime probe records no anchor and does **not** grant retry authority. Historical schema-1 receipts without an anchor remain readable. The anchor is bounded, timestamp-validated against the receipt's start, and never edited after installation. Read-only recovery compares the original anchor to a new `GetTickCount64`+UTC observation, detecting a counter reset or changed estimated boot epoch; results remain `*_unverified`, with `rebootConfirmed=false`, `osAttested=false`, `readOnly=true`. Clock adjustments and VM/sleep behavior can mislead any estimated boot epoch. A reboot observation does **not** prove successful MSI installation or application health.

The native helper now also performs two Windows Installer registration probes per MSI attempt inspection. An inconsistent ProductCode/version/probe-scope result or query-success transition fails the read-only inspection rather than mixing observations. Profile-wide inventory additionally reprobes registration for each recorded Package after inspection and before its terminal filesystem snapshot. Registration can still change immediately after the final read. No query result is used to authorize repair, uninstall, or retry.

Qt independently validates both optional receipt anchors and observation contracts for per-Package and profile reports. Desktop checks the anchor shape, non-authorizing flags, and agreement between recorded anchor existence and the observation's `anchorRecorded` flag. The recovery view distinguishes modern anchored reports from legacy timestamp-only comparisons.

## Tests and operational limits

- Executed Go table tests cover anchored same-boot estimates, indicated boot changes, injected clock jumps, unavailable uptime, oversized/invalid receipt anchors, old unanchored receipts, and registration snapshot disagreement.
- Node tests execute the actual Desktop read-only validator against consistent and tampered boot-anchor/report objects; inherited MSI/transfer test chain remains unchanged in scope.
- This does **not** implement a verified reboot marker, Windows Installer file-health validation, automatic package repair, uninstall or dependency-aware rollback.
- No real Windows MSI process, boot cycle, Qt-linked Desktop, or PostgreSQL system was exercised in this environment. G26-10/11 and Windows release gates remain open.

Commands: `npm run cluster:g26:p30:msi-boot-anchor`; `cd tools/native/package-stager-go && go test ./... && go test -race ./... && go vet ./...`; Windows x64 cross-build and `cluster-td6-source-scan.mjs`.
