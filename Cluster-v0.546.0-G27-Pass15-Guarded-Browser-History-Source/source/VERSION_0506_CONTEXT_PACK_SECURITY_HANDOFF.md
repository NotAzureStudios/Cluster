# Cluster v0.506 | Context Pack sensitive-export security

**Status:** Source-implemented development checkpoint, not a native build or live security certification.

## Connected changes

1. Ordinary Context Pack API serialization is **redacted by default**, including import/create responses and the existing GET export. A new central `core/context-pack-policy.ts` allowlist drives import validation, safe projection, sensitive field classification, and an explicit reveal mode. Unexpected settings and unrecognized opaque metadata never enter export responses.
2. Existing `POST /api/context-packs/from-settings` rejects `includeSecrets: true`. A separate `POST /api/context-packs/from-settings-with-secrets` accepts an explicit audit reason and stores a protected snapshot, but **does not echo the credentials in the response**.
3. `POST /api/context-packs/:packId/secret-export` is the only Context Pack export endpoint that returns secret fields. It requires the global administrator gate, a **single-use phishing-resistant** `context_secret_export` verification grant (fresh login and ordinary PIN/password are insufficient), a recorded reason (12–500 characters), `Cache-Control: no-store`, and activity evidence **without secret values**.
4. Applying a Context Pack is also classified as privileged `context_secret_export` because an imported pack may change protected integration credentials.
5. Context Pack imports now validate a bounded schema-1 allowlist: reject unrecognized setting keys, arrays/objects as values, overlong values, overlarge JSON and unsupported pack kinds/versions. The accepted settings continue through the existing encrypted Context Pack store.
6. The shared reauthentication host now collects required reasons and sends them to passkey challenge and PIN/password verification where applicable. When a passkey is mandatory, the host cannot offer a password/PIN downgrade.

## Regression evidence

- `npm run cluster:0506:context:sensitive` checks actual redaction/import helper behavior, route behavior, policy, reason enforcement, and required-reason UI integration.
- `npm run cluster:0506:context:routes` retains authorization and mutation behavior tests for all eight routes.
- `npm run cluster:0506:config:writers` includes the consolidated admin-route assertions.
- All are wired into `npm run verify:source-foundation`.
- Parser/import/CSS scan and SHA-256 package manifest verification are documented separately in the release `SOURCE_VALIDATION.txt`.

## Deliberate limitations / next work

- Existing Context Pack schema 1 remains a **legacy integration-configuration container**, distinct from new secret-free `.clusterconfig` exports. Sensitive exports are permitted only by explicit elevated consent. Longer-term, prefer Vault-backed secret references instead of exportable values.
- The new privileged endpoints are API-first; there is no dedicated Context Pack visual management feature in the current reconstructed renderer to certify. If a UI is added, it must invoke the same reauthentication flow, present the sensitive-data warning, and never display secrets in logs or toasts.
- This is **not** live PostgreSQL, Windows, device-bound WebAuthn, multi-admin, audit durability, or disk crash-injection certification.
- The development tree descends from Pass 13 + staged P16C + v0.506 deltas and **must not overwrite the trusted Pass 14/Pass 15 source**. Conflict-review the patch against Pass 15 first.

## Resume priorities

1. Retrieve and merge the authoritative Pass 15 source without overwriting its Admin/Project Type and Library/Media/Projects refinements.
2. Live-test PostgreSQL migrations, Context Pack authorization and single-use WebAuthn grants, audit records, and configuration publication/recovery on Windows; fix measured defects.
3. Finish v0.506 certification, then continue the **0.507 Company/Resource Graph, permission engine, search, and shared-subsystem roadmap**. Do not pivot back into endless GPU or settings micro-passes.
