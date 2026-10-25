# Cluster 0.541 | Inventory asset-management completion ledger

| Workflow | Code status | Evidence / boundary |
|---|---|---|
| Asset create, edit, retirement/reactivation | Backend + UI | Revision/capacity/admin behavior tests; real DB pending |
| Asset search across large lists | Backend + UI | Cursor paging and remote search tests; browser pending |
| Asset / license allocation | Backend + UI | Existing row lock/capacity tests retained |
| Transfer assignments | Backend + UI | Closed source record + new active recipient atomically; simulated DB |
| Physical equipment return vs write-off | Backend + UI | Explicit closure evidence, stock reduction and retirement tested |
| Digital seat revocation | Backend + UI | Generic revoke refused for physical custody |
| Active and historical assignment browsing | Backend + UI | History projection tested, up to 500 entries per request |
| Production certification | Deferred | Prisma migration, native Windows/browser/real PostgreSQL not tested |

Commercial key pools, Vault reveal/distribution, generalized Entitlements and account-specific licensing remain separate future workstreams; **not** mislabeled complete.
