# Cluster Server 1.2.4 — bridge to Cluster 2

**Release scope:** Server launcher only. Signed Server update sequence: **200004**. Native Qt Desktop stays at the published **1.2.2** artifacts.

## Why

Launchers up to 1.2.3 accept only `1.x.y` release identities in the signed update manifest and in the GitHub release check. Cluster 2.0.0 (sequence 200000000) is therefore invisible to them. 1.2.4 ships the launcher from Cluster 2 that accepts majors 2–20 (`major × 100000000 + minor × 100000 + patch`), so an installation that reaches 1.2.4 sees 2.0.0 and later as updates.

## Changes

- `serverUpdateSequence` accepts `N.minor.patch` for majors 2–20; 1.x sequences are unchanged.
- The installed-release label accepts any stable `N.minor.patch` marker instead of only `1.0.x`.
- Version identity 1.2.4 across workspaces, release metadata and native launchers.

## Upgrade order

1. Publish 1.2.4 (this branch merged to `main`; `publish-cluster-1-2-4-manual.yml` releases it after the Windows build and release CI pass).
2. Installations on 1.2.3 or earlier update to 1.2.4 through the signed channel or the manual installer.
3. Publish 2.0.0 from `development`.
