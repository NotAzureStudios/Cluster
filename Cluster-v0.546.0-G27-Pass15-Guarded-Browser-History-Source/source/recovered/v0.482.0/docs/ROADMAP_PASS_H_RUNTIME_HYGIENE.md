# Roadmap Pass H — foreground runtime hygiene

Cluster v0.464 reduces background work without weakening realtime behavior or recovery.

## Foreground-aware refresh

Status and administrative performance surfaces no longer poll while the document is hidden or the device is offline. Focus, visibility return, and reconnect events trigger an immediate guarded refresh so operators still see current state when they return.

## Collaboration fallback

Boards and Whiteboards continue to prefer the collaboration stream. When stream transport is unavailable, fallback refreshes run at a 20-second cadence only while visible and online. Each fallback is single-flight to prevent slow requests from stacking.

## Release correctness

The malformed v0.463 changelog insertion is repaired and Pass H adds a release-specific static audit covering polling guards, single-flight behavior, professional status copy, changelog structure, version lineage, and packaging participation.
