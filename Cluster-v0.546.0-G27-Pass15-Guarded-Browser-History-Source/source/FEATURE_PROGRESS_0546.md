# v0.546: Built-in tool extensibility infrastructure

## Implemented in source

- Canonical app route manifest now identifies `standalone-tool` surfaces with a derived, type-safe route set.
- One typed renderer module registry owns lazy loading, render adapters and prefetch for **Inventory, Vault and Integrations**. Their duplicate route conditions and loader/prefetch declarations have been removed from the application shell.
- Tool Infrastructure has an **All tools** directory automatically built from canonical tool permission and route manifests. Search all 22 current permission identities, distinguish backed Tool Config from normal operational workspaces, and open or configure tools via existing navigation and permissions.
- Work navigation supports any canonical app route through a single event path; it now validates route identity and current user permissions before mutating history or navigation. Sidebar authorization and server policies remain authoritative.
- New `npm run tool:check`, `npm run tool:registry:tests`, `npm run tool:new -- --id ... --label ...`. The AST-based checker catches missing/unregistered modules and unknown permission identities; the generator writes a safe, unregistered scaffold with integration instructions.
- `TOOLS_DEVELOPER_GUIDE.md` explains how to add, evolve and retire tools without multiplying application switches and duplicate sidebar definitions.

## Caveats and next work

- This is a compiled-in modular host, **not** runtime third-party plugins. Do not allow downloaded UI modules or dynamic privilege grants.
- It simplifies *new standalone workspace registration*, not server-side domain design. Complex tool routing, centralized admin configuration and a generalized per-tool diagnostics/runtime health authority require follow-up based on actual use.
- Source tests and structural checks are not a substitute for full dependency-backed compilation and live browser/PostgreSQL testing.
- The Inventory/Vault file updater, Prisma schema and native Windows helper remain unchanged.
