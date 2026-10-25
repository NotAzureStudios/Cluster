# Cluster dependency policy

`config/toolchain-versions.json` is the source of truth for major external toolchains that are also referenced outside package-manager manifests.

## Update rules

- **Security updates:** propose immediately; merge only after required CI passes.
- **Patch updates:** may be proposed automatically and can use GitHub auto-merge after required CI passes.
- **Minor updates:** automatic detection, manual approval.
- **Major updates:** dedicated migration review; never blindly auto-merged.

Dependabot owns normal npm and GitHub Actions package updates. `tools/scripts/check-dependency-updates.mjs` monitors non-npm toolchains and selected cross-package pins.

## Version synchronization

Run:

```bash
npm run versions:sync
npm run versions:verify
```

The synchronizer updates runtime launchers, workspace versions, Qt/CMake requirements, Prisma/Three pins, Docker PostgreSQL, and CI toolchain versions from the central manifest.

## Lockfile policy

A committed lockfile remains preferred for day-to-day development. Until the repository lock is regenerated and committed from the authoritative dependency graph, tagged release certification resolves a fresh `package-lock.json`, immediately reinstalls with `npm ci`, and preserves that exact build graph inside the canonical source artifact.

Certified server packages additionally generate a runtime-specific lock after staging their package/workspace manifests. The server launcher therefore uses `npm ci` for certified artifacts. Source/local packages may still fall back to `npm install` when no valid lock exists.

## Release reproducibility

All third-party direct npm dependencies are exact-version pinned. Internal `@cluster/*` workspaces may use local workspace references. Dependabot owns proposed version changes, so a dependency move appears as a reviewable diff rather than being selected silently during a production install.

The release pipeline treats the generated build lock and staged runtime lock as certification evidence. They are verified and shipped with certified artifacts so a production install does not silently resolve a different transitive graph later.
