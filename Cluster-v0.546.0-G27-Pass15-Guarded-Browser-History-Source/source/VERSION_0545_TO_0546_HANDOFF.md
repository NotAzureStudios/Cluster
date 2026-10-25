# Cluster v0.545 → v0.546 handoff

**Baseline:** `Cluster-v0.545.zip`, complete source, not production-certified. The new v0.546 milestone focuses solely on extending and maintaining built-in Cluster tools.

**What changed:** typed standalone route descriptors, central module/preload/render registry, migrated Inventory/Vault/Integrations, Admin all-tools directory, route-safe cross-tool navigation, AST validator, source scaffold CLI, tests and developer guide. No runtime plugin loading, data migrations, or native helper modifications.

**How to continue:** read `TOOLS_DEVELOPER_GUIDE.md` and `FEATURE_PROGRESS_0546.md`; run `npm run tool:check` and `npm run tool:registry:tests`; implement future tools using shared manifest + one standalone renderer registry entry + separately authorized server domain. Preserve per-tool workspaces and backend policy boundaries. Do not reopen architectural rewrites without an identified duplicated integration problem.

**Next priority:** use the registry for promoting Forms/Packages/Communications to real operational tools only when each workflow is ready, not to create empty sidebar shells. Full browser, PostgreSQL and Qt testing remains deferred.
