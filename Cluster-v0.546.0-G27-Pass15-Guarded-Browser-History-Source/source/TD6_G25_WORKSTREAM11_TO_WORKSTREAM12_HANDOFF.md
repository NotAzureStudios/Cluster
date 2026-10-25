# G25 Workstream 11 → continuation handoff

Canonical complete source: `Cluster-v0.546.0-TD6-G25-Workstream11-Review-Provenance-Offline-History-Source.zip`. Direct parent WS10. G25 OPEN.

Do not regress:
- Linked Source review publication requires `merged`, matching repository/project, exact `mergedRevision === Build.sourceRevision`, and captured provenance consistency after nullable FK deletion. The `source_review` mandatory gate uses the existing lifecycle snapshot and is surfaced as a blocker; it must not become an optional bypass.
- QA failed/blocked test-case counts override contradictory pass evidence in lifecycle, Build QA roll-up and release publication preflight.
- Whiteboard global keyboard ownership and Card editor-only Ctrl/Cmd+Z; native text inputs win. Saved Card Undo/Redo is blocked while unsynced or disconnected, without bypassing server revision checks.
- Project lifecycle header displays blocking gate count rather than `0 open fixes` when other gates fail.

Verify: `npm run cluster:td6:g25:ws11`, `npm run cluster:td6:g25`, `npm run techdebt:td5:source-closeout`. Regression reports and integrity manifest in source archive. No full Node24 build, live DB, Windows Qt or actual multiuser runtime certification performed.

Next prioritized source work: reconcile remaining cross-editor saved history/collaborative reconnect gaps, verify Project/QA/Review object lineage, then G25 source closeout audit before moving to G26. Do not restart TD5 or claim TD7 has started. G26 Library/distribution and G27 UI should use official CL-DS-001 v1.3.0 when source bytes are available; G25 WS11 includes a design change record, not an invented copy of the official guide.
