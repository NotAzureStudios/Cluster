# Production Polish Phase 3 — Interaction State System

Cluster v0.426.0 standardizes interaction and operational state across shared renderer controls. The goal is predictable behavior under pressure: users should be able to tell what is selected, what is working, what is unavailable, and what needs intervention without learning a different visual dialect on every screen.

## State contract

The canonical state vocabulary is defined in `packages/renderer/src/components/interaction-state.ts`:

- `default` — resting state.
- `hover` — pointer affordance. Implemented with CSS pseudo state rather than React state.
- `focus` — keyboard/active-descendant focus. Native focus uses `:focus-visible`; composite widgets may expose this state on the active descendant.
- `pressed` — momentary press feedback. Native buttons use `:active`; persistent toggles use `aria-pressed` plus `selected`.
- `selected` — persistent user selection.
- `disabled` — unavailable interaction.
- `loading` — work is in progress and duplicate activation is blocked where appropriate.
- `success` — current operation or service is healthy.
- `warning` — usable but requires awareness.
- `error` — operation/service failed.
- `offline` — network connectivity is unavailable.
- `stale` — local information is usable but differs from or awaits the authoritative source.
- `conflict` — two valid states require explicit resolution.

Persistent states use `data-cluster-state`. Native semantics remain authoritative: `disabled`, `aria-busy`, `aria-selected`, `aria-checked`, `aria-expanded`, and `aria-pressed` are not replaced by styling attributes.

## Production behavior

Hover, focus, and pressed feedback must never move surrounding layout. Focus remains visible for keyboard users. Loading controls retain their dimensions and label intent, disable duplicate submission when required, and expose `aria-busy`. Selected controls expose the appropriate ARIA selection/toggle semantic instead of relying only on an `active` class.

Operational state is always conveyed with text or accessible context in addition to color. Offline, stale, error, and conflict are intentionally distinct because they imply different recovery actions.

## First migration cut

Phase 3 moves the highest-value shared and operational surfaces onto the contract:

- `ClusterButton`, `ClusterStatus`, `ClusterField`, and `ClusterToolbar` expose canonical state.
- `ClusterSelect` exposes selected, focused, and disabled option state while preserving listbox semantics.
- `CompactSectionNav` exposes selected tab/menu state while preserving roving keyboard navigation.
- request errors and status lines expose semantic error/operational state.
- the server-health footer maps checking, healthy, degraded, unavailable, draining, offline, and version mismatch into the canonical state model.
- offline synchronization maps syncing, pending local work, failures, offline operation, and conflicts into canonical states and uses shared recovery actions.

## Rules for feature work

Do not invent a new feature-local synonym such as `problem`, `critical-ish`, `unsynced-red`, or another magic class when the canonical state already describes the condition. Feature-specific domain statuses may still exist, but their interaction/operational presentation should map onto this state vocabulary.

Do not manage pointer hover in React merely to change appearance. Prefer CSS `:hover`, `:focus-visible`, and `:active`. JavaScript state is for persistent application state and composite-widget focus where the browser cannot express the active descendant directly.

Do not communicate selection, error, offline state, or conflicts by color alone.

## Release gate

`tools/scripts/interaction-state-audit.mjs` verifies the canonical vocabulary, semantic tokens, shared primitive mappings, high-value migrations, reduced-motion handling, and package/release integration. Literal `data-cluster-state` values outside the canonical vocabulary fail the audit.
