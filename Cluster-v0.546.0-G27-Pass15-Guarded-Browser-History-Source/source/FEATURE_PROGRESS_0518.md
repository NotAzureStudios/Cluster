# Cluster 0.518.0 | Desktop signed Package handoff

**Scope:** continued development from the complete v0.517.0 source, retaining authoritative Pass 15 reconciliation. This is a development source checkpoint, **not a certified Desktop installer**.

## Implemented

1. In signed-in **Account Settings → Desktop**, a new opt-in *Managed Packages for this device* panel requests eligible signed Package targets only when the user presses **Check eligible Packages**. No new automatic background polling.
2. Uses the existing browser API transport and the device-proof signing configuration, keeping the non-exportable ES256 device key in the renderer. A Qt client must not copy or impersonate that private key.
3. Allows choice of channel and a **simulated, nonattested** platform. Release selection still occurs server-side via current device-specific authority; the selected platform is not OS proof.
4. A **Prepare staging kit** command downloads an authorized Package release from the canonical signed endpoint, bounds the received ZIP to 4 MiB, verifies its byte length and SHA-256 against both manifest and endpoint header, and rechecks the manifest against the selected release metadata. Duplicate concurrent downloads are suppressed in the UI.
5. Constructs a deterministic five-entry ZIP: `release.zip`, `manifest.json`, `signature.txt`, `public-key.pem` and `README.txt`. Receipt challenges, cookies, access tokens and a trusted key pin are deliberately excluded. The bundled public key is **informational only**, never an independent trust anchor.
6. The Desktop distribution build script now compiles and bundles the existing nonprivileged Go Package verifier/stager utility, accompanied by a security notice. It does **not** call the helper to stage, select, activate or install anything automatically.
7. The staging kit is usable with the existing Go helper only if an independently provisioned signing-key SPKI SHA-256 pin is supplied. The helper's `stage` and local pointer `activate`/`rollback` actions never install or execute OS software.

## Validation

- **34/34 regression scripts passed** in this source-only environment, including the new v0.518 assertions.
- New v0.518 test uses an independent ZIP reader and the actual Go stager with a newly signed Ed25519 package fixture. Eight checks passed, including refusal without or with a mismatched independent key pin and acceptance with the correct pin.
- `go test ./... -count=1` passed for the native stager; no Go source changes were required.
- TypeScript parsing, CSS delimiter scan, import scan, source-manifest integrity, reproducible incremental patch, and ZIP integrity results appear in `CLUSTER_0518_VALIDATION_RESULTS.md`.

## Important limitations and follow-on priorities

- The **native Desktop UI currently creates a manual staging kit**. There is **no automated Qt/native invocation**, no independently provisioned trust pin through the running app, and no OS-level installation, health check or attestation.
- Device reports remain device-authored claims, not authenticated OS observations. Platform selection is explicitly simulated.
- Real Windows Qt release build, full dependency-backed TypeScript/Prisma build, live PostgreSQL migration/runtime tests and operational rollout recovery tests remain open.
- Next connected implementation: native orchestration with explicit independent trust configuration and authoritative entitlement recheck, followed by supervised OS installation with health checks and rollback; separately Packet original-media delivery, Work collaboration, and Library/Admin coverage.
