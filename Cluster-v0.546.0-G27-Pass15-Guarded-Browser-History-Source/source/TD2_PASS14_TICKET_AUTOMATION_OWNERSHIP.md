# TD2 Pass 14 — Ticket automation ownership

Baseline: TD2 Pass 13, product v0.546.0.

## Problem
Ticket-related activity could still trigger Studio and Project automations after the Studio Tickets switch was disabled. Both subscribers share their activity stream with independent Project and Board features, so unsubscribing the whole handler is incorrect.

## Changes
- Add an authoritative `isTicketsEnabled` callback to both bridges, checking local owner status and fresh database Studio Settings.
- Suppress explicit `ticket` events before fetching Card records.
- For generic `card` events, load the Card first, then suppress only records with `workItemKind === "ticket"`.
- Keep independent Board/Project activity operational. Database unavailability must not silently grant Ticket execution.
- Preserve the existing durable worker/Calendar/Library settings and job control paths.

## Exact scope
This is event-ingress suppression. It does not cancel an already-running event, nor does it pause existing durable generic automation jobs containing Ticket context. Tool-level API and collaboration guards remain independently enforced.

## Certification debt
Live Postgres coordination and competing-worker tests, Node 24 full builds, Windows runtime, and before/after CPU/DB/network measurements are still outstanding.
