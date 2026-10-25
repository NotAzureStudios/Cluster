# v0.543 → v0.544 handoff

**New baseline:** `Cluster-v0.544.zip` (complete source). Its patch is only for overlaying v0.543. Original v0.543 remains the trusted Inventory checkpoint; its native file updater binary is unchanged here.

**Subsystem completed this pass:** Forms authoring/assignment/published version → available to audience → member submission → admin review/outcome. Key changed files: `apps/server/src/domains/studio-systems/studio-systems-routes.ts`, `packages/renderer/src/features/settings/StudioSystemsSettingsSection.tsx`, `MyFormsPanel.tsx`, `StudioFormSubmissionsPanel.tsx`, Account Settings navigation/type registry, and `StudioFormRunner.tsx`. Focused behavioral route suite: `tools/scripts/cluster-0544-forms-closeout-tests.mjs`.

**Source-level only:** do not claim PostgreSQL/browser/Windows runtime or full dependency build passed. The non-application general form review queue is separate from application review. Audience updates do not disclose previously submitted response data; old submissions remain administrative records. Published versions remain immutable. Existing policy/packet/onboarding form runners remain integrated.

**Next feature focus:** forms advanced drafts/reminders only if essential to 1.0; otherwise leave Forms after this connected milestone and select the next major unfinished subsystem (not Library/Package micro-cleanup). Preserve the 1.0 Feature Ledger. Certification follows feature implementation, as requested.
