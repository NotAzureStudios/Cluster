# UX-G25-WS13 | Conflict review protects local work

- **Problem:** automatic background discard and generic retry/merge could make offline work disappear or suggest a save succeeded even though server authority was absent.
- **Current goal:** preserve work by default and give users explicit, informed choices without forcing whole-object replacement.
- **Guide authority:** Official Cluster Studio Style Guide v1.3.0 (2026-10-20), Section 6 canonical save states, Section 11 anti-pattern 7, Sections 12–14 governance and recovery acceptance.
- **Historical decision status:** existing shared Sync Center controls and semantic status tokens remain **active**; automatic silent disposal is **superseded**; preserving local work and real server-confirmed completion remain **active**; clipboard-based export is **provisional** as a lightweight recovery path, not a substitute for durable encrypted backup.
- **Reuse:** `offline-runtime.ts`, `offline-policy.ts`, `offline-conflicts.ts`, `SyncStatusIndicator.tsx`, existing server conflict authority. No new local state vocabulary, queue engine, stylesheet ownership or theme.
- **Behavior:** background poll never clears work; user-initiated Discard confirms and, for registered conflicts, awaits server resolution; Copy exposes the queued request only on user action; Retry only for eligible transient failures. Missing permission/revision never permits Keep mine/Merge.
- **Focus/keyboard:** same native button controls, accessible status feedback. Clipboard denials are visible. Destructive confirmation is explicit.
- **States:** queued / conflict / review / copied locally / server resolution accepted / failed (draft retained) / manual discard. Clipboard copy is not server commit.
- **Accessibility and surface:** retains existing popover constraints, responsive queue, semantic status, screenreader feedback via role=status; no decorative spacing or new fixed-width UI.
- **Validation:** 19 functional client conflict tests, 6 concurrency CAS tests, inherited source regression, TD5 source closeout, source scan. Actual browser clipboard, mobile sizes, high-DPI native window and live multiuser database acceptance deferred and must be run later.
- **Exception:** native `window.confirm` currently provides a reliable deliberate destructive guard, but should be reconciled with canonical accessible dialog behavior during G27 UI refinement; no permission or data-integrity exception is authorized.
