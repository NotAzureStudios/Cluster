# TD4 R43 | Resource-change provider enrollment

## Source-verified gap

R42 provided separate Library, Card and Calendar visibility paths, but generic Board, Whiteboard and Timeline invalidations trusted a change envelope's claimed project association. A missing/archived record or forged parent could leak identifiers through a generic permission check. Administrator fast-path batches without Library changes could also bypass Card/Calendar existence and parent checks.

## Implementation

- `resource-change-providers.ts` enrolls three read providers using the canonical Cluster resource vocabulary and rejects duplicate registrations.
- Board loads active records and requires Boards tool view plus Board target view in the canonical project.
- Project Whiteboard requires target access in its real project; standalone Whiteboard requires tool view.
- Project Timeline item requires target access; standalone item requires owner view or Timeline manage permission.
- Providers batch-load identity fields, compare the supplied project to the authoritative row, and deny missing/mismatched resources. A provider database error aborts feed evaluation, not a fallback allow.
- REST polling and SSE delivery share the same provider-based filter. The administrator fast path no longer skips Card/Ticket and Calendar existence checks.

## What remains

Only three resource kinds are enrolled. The remaining generic fallback, broader action/search adapters, typed event producers and provider lifecycles still need implementation. This is not a full resource registry closeout. No schema migration, native binary modifications or release runtime certification.

## Tests

`tools/scripts/cluster-td4-r43-provider-registration-tests.mjs` runs 26 focused/inherited visibility scenarios. Selected inherited storage, Library, TD2 job ownership, TD3 shared actions and authorized discovery checks pass with test-only TypeScript availability and Node 22 type stripping. The lean source excludes generated Prisma/dependency-backed compilation. See `TD4_R43_VALIDATION.json`.
