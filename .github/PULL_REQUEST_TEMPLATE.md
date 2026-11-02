## Work lane / integration
- [ ] Web client (client/web)
- [ ] Qt Desktop (client/desktop-qt)
- [ ] Windows Server (server/windows)
- [ ] Shared platform (platform/shared)
- [ ] Cross-cutting focused task

**Target:** `development` for client changes. Explain any cross-client API/renderer compatibility impact and confirm any required other-lane follow-up.

## Summary
<!-- What changed, and why? -->

## Scope
- [ ] Affects server/API
- [ ] Affects web/renderer
- [ ] Affects Qt/native/Windows installer
- [ ] Changes data, migrations, permissions, authentication or file storage
- [ ] Docs, tests or tooling only

## Validation
- [ ] Impacted client/platform build or focused source tests
- [ ] Cross-client contract and version compatibility checked where affected
- [ ] Permissions, transfers and failure states checked where affected
- [ ] Windows/Qt manual evidence linked if applicable; untested gates identified
<!-- List exact commands, results, and checks that could not run. -->
- [ ] Source hygiene / RC source preflight
- [ ] Relevant focused regression tests
- [ ] Build/runtime checks as applicable

## Risk and recovery
<!-- Note compatibility, schema, data safety, rollback or deployment implications. "Not applicable" if none. -->

## Release impact
<!-- Note if this should change candidate metadata, release notes, or installer artifacts. Do not claim certification without evidence. -->
