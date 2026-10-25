# Cluster v0.519.0 | Native Package kit staging integration

**Baseline:** complete source checkpoint v0.518, with authoritative Pass 15 source and previous v0.506–0.518 work retained.

## Completed source changes

1. `tools/native/package-stager-go/kit.go` reads the exact five-entry `release.zip`, `manifest.json`, `signature.txt`, `public-key.pem`, `README.txt` kit **in memory** with archive/member size bounds, ZIP CRC read verification, regular-file-only entries, fixed filenames, no extras or duplicates, and no staging before signature verification.
2. Go `--kit` mode is only permitted for `stage`, cannot mix input sidecar paths, requires an independent Ed25519 SPKI SHA-256 trusted key fingerprint, applies preexisting manifest signature/hash/platform and ZIP traversal defenses, and does not install or activate.
3. Qt `NativeCapabilityBroker` exposes `package.stageKit` and `package.stageStatus` with zero renderer-supplied options. Qt requires native session claim, online server, valid profile and a native-local `AppConfigLocation/package-trust/<profileId>.pin` trust file obtained out of band. It rejects unsafe pin/kit/helper, prompts natively, and launches only the shipped `cluster-package-stager` helper into the profile-specific `AppLocalDataLocation/package-staging/<profileId>` directory.
4. A single Qt `QProcess` stages at a time, emits completion state, times out after 30s, and is killed when the native profile/epoch is cleared. Renderer registers an event listener and shows `staged_not_installed` versus failure.
5. The signed-in Account Desktop panel offers **Verify and stage downloaded kit**, doing a fresh device-authorized Package target check before the native picker, but the selected local file is **not strongly bound to that target**; no claim of cryptographic entitlement revalidation on the file itself.
6. New `cluster-0519-native-staging-assertions.mjs` adds real Go CLI integration and bad-kit test cases, plus static Qt boundary checks. No schema migration, server API addition or native executable prebuild.

## Explicit limitations

- Independent trust pin must be administered outside the downloaded kit and untrusted webpage. The local pin file may be modified by anyone with write access to the relevant OS user profile: this is **not** a privileged, tamper-resistant machine trust store.
- UI target refresh authenticates the user/device and rechecks the chosen release metadata, **but Qt cannot yet bind its arbitrary selected ZIP to that signed authorization**. Only local verification/staging is supported. Fresh server authorization and receipt issuance remain mandatory before *any* future content activation/installation.
- No OS install, OS health observation, real device attestation, remote rollback, durable installer/rollback engine, or execution of signed content. Native Windows/MSVC/Qt compilation and runtime certification, PostgreSQL integration and full semantic TS build remain open.
- Qt native source is forward-ported from older recovered Desktop source; its actual runtime is not certified even if source checks are green.

## Next connected roadmap slice

Provide a native authenticated transfer coordinator that binds each verified kit/archive digest to an authorized release and per-device entitlement **at the moment of native action**, with OS-protected trust-policy provisioning, cancellation/revocation checks, and safe activation controls. Only then begin supervised managed-root installation, local-change detection, health evaluation and rollback. Separately continue original-media Packet delivery, Work collaboration/Undo, Library and remaining Admin UX.
