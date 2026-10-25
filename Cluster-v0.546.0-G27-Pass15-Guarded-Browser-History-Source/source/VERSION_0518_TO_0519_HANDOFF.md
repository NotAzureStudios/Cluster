# Cluster v0.518.0 → v0.519.0 source handoff

Use the **full** `Cluster-v0.519.zip` `source/` tree; patch `Cluster-v0.519.patch` applies to verified `Cluster-v0.518.zip` source. Retain 0.518 v0.517/v0.516 deltas for history.

**New:** native Qt manual kit verification/isolated staging from the Account Desktop panel; Go `--kit` strict in-memory import; separately provisioned local per-profile pin and OS picker, user confirmation; single-flight async QProcess with status event; Go anti-tamper tests.

**Trust root:** a trusted administrator must independently provision the DER/SPKI SHA-256 fingerprint into a UTF-8/ASCII text file at Qt's `QStandardPaths::AppConfigLocation/package-trust/<activeProfileId>.pin`. It must be 64 lowercase hex digits, optionally with one newline. The directory and file must not be symbolic links. Renderer code cannot supply/overwrite the pin through this capability. Do not copy a fingerprint calculated from the `public-key.pem` *inside* an untrusted staging kit. The pin file is per-OS-user and is not a protected machine credential store.

**How to use:** sign into an active Qt Desktop session → Account Settings → Desktop → Check eligible Packages → Prepare staging kit → Verify and stage downloaded kit → select saved ZIP in OS file picker → confirm. Qt launches only the separately bundled Go stager. No content starts executing or becomes selected/installed. Test signed input using `node tools/scripts/cluster-0519-native-staging-assertions.mjs` and `go -C tools/native/package-stager-go test ./...`.

**Security gap:** the renderer rechecks an authorized target on-demand but the kit the human selects in Qt is not cryptographically bound to that target's current server entitlement. Only treat staging as locally verified, not approved for activation. A future protocol must let the native coordinator validate digest+release+device against current server authorization through the signed device-proof path, not via untrusted browser claim. No receipt state should call staging an OS installation.

**Certification left:** compile real Qt6 Desktop, test native profile/session cancellation, trust-path protections, helper error handling and Windows deployment; full dependencies/typecheck, fresh PostgreSQL bootstrap, multi-user permissions, OS install/rollback remain open. Preserve previous source and roadmap entries.
