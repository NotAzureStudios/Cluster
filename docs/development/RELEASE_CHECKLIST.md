# Cluster 1.0 release readiness checklist

This checklist is for **future certification**. It does not mean any release candidate has passed. The current GitHub source is RC50 until a newer verified source import is merged.

## 0. Cross-client integration
- [ ] All active client/platform lanes are reconciled with `development` and reviewed for shared API/renderer drift
- [ ] Web, Qt Desktop and Windows Server are built from the same candidate commit and version/protocol contract
- [ ] Any non-shipping client is explicitly excluded with documentation; no silent parity claims
- [ ] External RC73/RC74 sources are compared and imported only from a verified source archive
- [ ] The historical `ReleaseCanidate` branch is not mistaken for a current release

## 1. Reproducible source and build
- [ ] Correct candidate source is integrated and diff-reviewed on `development`
- [ ] Toolchain versions and package manifests agree
- [ ] `package-lock.json` is generated, verified and committed
- [ ] Clean `npm ci` succeeds on pinned Node/npm
- [ ] Full web, API and shared package builds pass
- [ ] Go and Qt/native artifacts compile for the supported Windows target

## 2. Runtime and persistence
- [ ] PostgreSQL/Prisma setup, migration and recovery work on a clean install
- [ ] Server starts, stops, repairs and restarts without unexpected rebuilds
- [ ] Authentication, roles and direct file/download authorization are tested
- [ ] Library uploads, resumptions, downloads and media opening are tested
- [ ] Requests/background jobs are bounded under realistic idle and active load

## 3. Distribution and safety
- [ ] Installer and native binaries are built from the matching committed revision
- [ ] Release artifacts have verified SHA-256 hashes and appropriate signatures
- [ ] Version compatibility and update/rollback paths are exercised
- [ ] Backups, restore and storage preservation are verified
- [ ] No secrets or runtime data are bundled or committed

## 4. Release declaration
- [ ] GitHub checks are green, with separate Windows acceptance evidence attached
- [ ] README, operator documentation, release notes and known limitations are updated
- [ ] Candidate version and shipped artifacts match the tested revision
- [ ] Only then create a release tag and publish verified installer artifacts

See [client work lanes and 1.0 gates](CLIENT_BRANCHES_1_0.md). **Do not** treat passing source-only CI as completion of any Windows runtime or release acceptance check. Track test evidence and known gaps in the release notes.
