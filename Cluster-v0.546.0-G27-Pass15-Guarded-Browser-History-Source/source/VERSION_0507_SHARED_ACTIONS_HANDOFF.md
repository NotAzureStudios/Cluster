# Cluster v0.507 | Shared resource actions & permission mutation quality

**Source-based continuation of:** `Cluster-v0.507-Resource-Picker` (uploaded October 8, 2026).
**Development status:** Source-implemented, syntactically checked, focused assertions passed. Not merged with authoritative Pass 15; not live PostgreSQL/Windows-certified.

## Implemented

1. `resource-action-registry.ts` resolves typed action descriptors using `CLUSTER_RESOURCE_MANIFEST` and requires explicit domain-provided `allowed()` decisions. Denied actions disappear; temporarily unavailable actions are disabled with a reason. This is not a new ACL engine; the server still decides authorization.
2. WorkActionMenu and TaskbarProjectTabs use the same resolver and existing `ClusterActionMenu`. Existing domain actions/handlers remain authoritative; no duplicate resource/command model was created.
3. `cluster-action-run-gate.ts` coalesces the same pending operation, shares its result, and releases keys after resolve/reject. Different targets remain independently operable. `useClusterMutationGate` exposes UI pending state.
4. Project Access single-flights create/pause/renew/delete rules and create/extend/revoke share links. Busy controls prevent lag-induced repeated submission. New Rule and Access Explorer now use the same Resource Picker candidates.
5. Access Explorer ignores out-of-date async authorization explanations. Project switches reset the selected target.
6. Restricted share links return a bearer-token URL only once. Excluded `/api/projects/:id/share-links` from persisted generic idempotency receipt replay so one-time secrets are not retained as replayable mutation responses. This deliberately favors token secrecy; lost-response recovery must be handled by checking the link list rather than replaying the secret.

## Validation

- 19/19 shared-action focused checks, including running Promise single-flight, failure retry, and cross-target isolation cases.
- Existing 0.507 Resource Picker 10/10; Company Graph 28/28; 0.506 Resource Identity 14/14; P16C closeout 15/15.
- Full source parse: 935 TS/TSX, 0 syntax errors.
- `tsc` does **not** pass in this lean source package because dependencies (`react`, `@cluster/shared`, etc.) and generated runtime artifacts are absent. This is not evidence of a clean end-to-end compile.
- No Prisma schema change / migration. No Windows executable rebuilt.

## Next coherent v0.507 work

- Server-authorized, scope-aware Resource Picker discovery using existing Search/Access/Graph authority; never trust client-side filtering as authorization.
- Scoped role and Permission Bundle definitions with Access Explorer previews, inherited/effective access and no fallback legacy permission tables.
- Expand the Action Registry into inspectors/context menus/search without inventing a second server mutation authority.
- Reconcile 0.506/0.507 staged source with historical Pass 14/15 by conflict review **before** final release; never overwrite it blindly.
- Then execute 0.508 People/Forms/Packets/Inventory/Vault feature wave; retain feature-first testing policy and final 0.512 certification gate.

## Nonnegotiables

- Packet entitlement does not confer source Library access. Derived Delivery Only remains default.
- Access decisions are request-time server policy decisions; UI availability is not security.
- One user intent produces one operation; retry uncertain mutations deliberately.
- Retain evidence and clear Planned / Backend / UI / Integrated / Tested / Certified distinctions. No runtime certification claims from source assertions.
