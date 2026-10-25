# UX polish pass 1

Cluster v0.390.0 begins the post-roadmap visual polish program with measurable debt reduction and shared loading/status primitives.

## Runtime styling boundary

Direct JSX style-object literals are no longer permitted. Static styling belongs in CSS. Values that genuinely depend on runtime geometry, progress, media position, virtualization, or user-selected colors must pass through `core/runtime-style.ts`, whose development-time allowlist rejects unreviewed CSS properties.

The UX debt baseline is now zero for direct inline-style objects, browser-native dialogs, and buttons without explicit type semantics.

## Skeleton loading system

`components/LoadingState.tsx` now provides shared list, card-grid, settings, policy, and full-workspace skeletons. The design-system skeleton layer uses semantic surface tokens, respects reduced-motion preferences, and avoids raw colors. Settings, Scheduler, legal-policy routes, and lazy legal/release surfaces now use structural skeletons instead of blank cards or plain loading text.

## Server status

The sidebar version control now opens a live server-status popover instead of only acting as a release-history shortcut. It reports reachability, operational state, readiness, client/server version mismatch, round-trip latency, uptime, API p95/error rate, event-loop p95, heap posture, runtime profile, and sanitized health-signal states. Detailed dependency data remains administrator-only.

The public `/health` response exposes only aggregate signal keys and pass/warn/fail states; it does not expose database URLs, storage paths, credentials, private hosts, or diagnostic details.

## Color migration

The first palette-token migration moves recurring blue, cyan, slate, green, amber, and red literals into canonical design-system tokens. The raw-color ratchet drops from 3,795 to 3,428 occurrences and may only decrease from this release forward.
