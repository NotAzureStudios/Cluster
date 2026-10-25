# Cluster v0.506 | Setup Foundation Continuation

**Artifact type:** development source checkpoint; **NOT** a certified Windows release.

## Implemented here

- First-run setup choices: Guided, Quick, Import Configuration, and Skip Optional Settings.
- First-owner setup remains mandatory and is followed by passkey/security-key enrollment and one-time recovery-code issuance.
- Guided mode can set Studio identity and IANA timezone.
- `.clusterconfig` schema 1 import applies only safe studio identity/timezone and starter Project tool defaults. Envelope/settings are rejected if they contain extra keys, secrets, server paths, security changes or unsupported types. Both UI and server limit import size to 16 KiB. Server validation remains authoritative.
- Administrator-only configuration export uses the **same** fixed, non-secret server allowlist.
- Admin Command Center now includes a server-derived Setup Checklist: owner passkey, issued recovery codes, Studio identity, backup setting, second administrator, and first Project.
- Optional checklist items support persistent skip/restore, separately from actual configured state. Mandatory security items cannot be skipped.
- Admin-only API and security audit for optional checklist changes. The public setup endpoint never leaks internal checklist posture.

## What is NOT claimed

- A stored, unconsumed recovery code does **not** prove the owner printed or saved the code offline.
- A checked backup-enabled setting does **not** prove restore/recovery works.
- No live database migration/deploy, owner authentication hardware, Windows launcher/Qt, request load, or real client rendering was tested.
- The source remains assembled from older **Pass 13 + P16C** staging. The authoritative **Pass 15** bytes were not materializable. Do not overwrite the newer Pass 14/15 Library, Projects, Admin or Project-Type implementation with the staging tree.

## Merge/recovery order

1. Obtain the original Pass 15 source (verified SHA-256: `c758d4edfa38e8bde538b89c1c200a7cf7fbd2fbe08295bc43d5d1e1b0616c1f`).
2. Apply the P16A/P16B/P16C capability overlay with conflict review against Pass 15.
3. Apply the v0.506 security patch from the prior checkpoint (`Cluster-v0.506.patch`) with conflict review.
4. Apply `Cluster-v0.506-Setup.patch` for the present continuation. It was tested against the previous packaged v0.506 tree, not against Pass 15.
5. Run `npm run verify:source-foundation` and the full official Node 24 + Prisma + PostgreSQL + Windows/native runtime matrix on the merged source. Retain the Qt 0.482.0 parity hold until native certification.

## User-facing version

**0.506**. Internal npm/toolchain SemVer **0.506.0**. Do not introduce RC/WIP/pass labels into new package filenames. Proceed to **0.507** only after an authoritative merge and version advancement.

## Continuation: Reviewed administrator configuration import

See `VERSION_0506_CONFIGURATION_HANDOFF.md`. The safe starter `.clusterconfig` now also supports an authenticated, server-generated **preview → explicit apply** path from the Admin Setup Checklist. Applies are audited and stale previews rejected. This is source-validated only. The updated incremental patch is `Cluster-v0.506-Configuration.patch`; previous security and setup patches must still be applied in order.
