# F4 P12: Operations API contract inventory closeout

Parent: F4 P11. Reviewed routes in `registerHealthOperationsRoutes()` against the published versioned OpenAPI contract. Six real operations had no discoverable entry: maintenance preflight; configured-acceleration compatibility check; cached storage lifecycle GET; confirmed storage lifecycle POST; cached integrity GET; confirmed integrity POST.

All six are now documented with the actual HTTP verbs, secured administrator access by default and explicit read-only vs mutation distinctions. The new source-registry test enumerates registered `/api/admin/operations/` endpoints in the health/Operations route module, canonicalizes route parameter placeholders and verifies both path and method coverage in `openapi.ts`. It fails when another route is added to this module without documentation.

This fixes documentation and API discovery only; authorization and runtime fences remain enforced by the existing handlers. The scanner does not claim complete OpenAPI coverage across every other domain's route module.

New suite: 48/48 assertions; 30/30 selected regression suites pass. No schema migration or Windows executable change. Live HTTP/OpenAPI exposure still requires a Node 24 app run.
