# Cluster Tool Development: built-in module contract (v0.546)

Cluster tools are **versioned, compiled first-party modules**. This is not a dynamic extension marketplace or a mechanism to execute downloaded code. Server authorization stays authoritative. The goal is to reduce the number of places engineers change when creating or evolving a workspace.

## Architecture and ownership

| Concern | Authority | What to change |
|---|---|---|
| Identity, description, capability, Tool Config grouping | `packages/shared/src/cluster-manifest.ts` → `CLUSTER_TOOL_PERMISSION_MANIFEST` | Declare the tool key and description; `adminConfigurable` only for tools with a real backed configuration endpoint |
| Route, sidebar, command discovery, visibility | Same file → `CLUSTER_APP_ROUTE_MANIFEST` | Declare route, `tool` key, `surface: "standalone-tool"`, `sidebar` and `action` metadata; add `adminOnly` where necessary |
| Lazy UI and prefetch | `packages/renderer/src/features/application/modules/application-standalone-tool-registry.tsx` | One typed entry per standalone route with `preload` and `render` |
| Work page content | `packages/renderer/src/features/<tool>/` | Own the tool's page, styles, reusable components and client APIs |
| Backend | `apps/server/src/domains/<domain>/` | Register verified routes and validate inputs with shared contracts. Authorize both tool-level and object-level access server-side |
| Administrator Tool Config | Existing Tool Config system | Add only if operational defaults, inheritance and configuration endpoints actually exist |
| Tool discovery/management | Tool Infrastructure → All tools | Automatically derived from canonical permission and route manifests; does not confer permissions or claim runtime health |
| Tests | `tools/scripts/cluster-tool.mjs` + tool-specific suites | Registry completeness and real behavior, especially direct unauthorized requests |

Adding a standalone tool no longer requires conditional route rendering in `ClusterApplication.tsx`, duplicate lazy exports in `application-lazy-workspaces.ts`, or a separate module-loader entry in `feature-prefetch.ts`. The sidebar and action discovery were already generated from the canonical route manifest.

## Developer commands

From the source root:

```bash
npm run tool:check
npm run tool:registry:tests
npm run tool:new -- --id studioNotes --label "Studio Notes" --admin-only
```

`tool:new` writes an **unregistered** scaffold into `tools/tool-scaffolds/<id>/` for review. It never enables a route, creates permissions, loads arbitrary plugins or starts a server. Follow its `INTEGRATION.md`, move the component into the renderer, register the tool and API intentionally, then run tests. Existing scaffolds cannot be overwritten.

## Safe development sequence

1. Decide whether an independent tool is warranted. Prefer project-contextual workspaces for Boards, Builds and QA. Shared utilities such as alerts, validation, draft/history and file selection belong in existing shared engines rather than new sidebar destinations.
2. Introduce canonical permission identity and default role policy. Explicitly decide owner, member, guest, and admin access. For sensitive actions, require step-up and audit as supported by the domain.
3. Define resource schemas, API endpoints, validation, audit and object-level authorization. **Never** authorize using client-supplied module descriptors.
4. Add route manifest metadata and a single typed standalone registry entry. Lazy load the feature; prefetching should not start unrelated background work or leak sensitive data.
5. Build an end-to-end user flow, including loading, empty, pending, errors, retry/reconciliation, conflicts, save and navigation. Put admin *working* controls inside the tool; keep policy/defaults in Tool Config.
6. Run `tool:check` and tests, including missing-module, invalid-permission, session loss, unauthorized direct API calls, and regression behavior. Run the real browser/PostgreSQL/Windows matrix before calling the final release certified.
7. To evolve a tool, update the existing module, contract and tests. To retire one, first remove sidebar/action entry and module, then update canonical route/permission usage and back-end access as part of an explicit breaking source change; no dead aliases for zero-active-instance Cluster.

## Boundaries

- This pass migrates **Inventory, Vault and Integrations** to the new module host. Complex project/session routes still have specialized rendering and should be migrated only when their context fits the contract.
- `Tool Config` currently supports only its explicitly configured tool subset. The directory lists all canonical tool identities; it does not pretend each has an enable/disable endpoint.
- No new database schema, server permission grant, plugin execution, remote code download, or native modification is introduced here.
- A green `tool:check` proves registry consistency, not runtime fitness or authorization correctness for every feature. Validate API permissions separately.
