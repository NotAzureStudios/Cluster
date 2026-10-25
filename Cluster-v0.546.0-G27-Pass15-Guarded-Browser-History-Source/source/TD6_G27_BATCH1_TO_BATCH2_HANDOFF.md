# G27 Batch 1 → Batch 2 continuation

Use the current G27 Batch 1 packaged source. Do not revert G25/G26, especially Vault atomic audit, retained Library media/retention permission guards, and native Package source safeguards.

G27 Batch 1 delivers reviewed, transactional configuration rollback + audit-atomic safe config import, connected Admin UI and regression tests. No migration; StudioConfigurationRevision rows contain the inverse change including `after:null` when deleting an explicit override, while `requestedJson` remains strictly typed and excludes nulls.

Next grouped G27 work should prioritize a completed **People onboarding → temporary access → work → offboarding** journey with server ACL and Admin UI, then notification/action context integration. Audit existing source first; there are already canonical People account types, reviewed access grants, invitations, application/approval, security recovery, and offboarding services. Do not create parallel stores or new sidebar tools.

Test new work alongside `npm run cluster:td6:g27:config-recovery`, `npm run techdebt:td5:source-closeout`, relevant People/Notification suites and the TD6 source scan. Postpone full release certification at the user's direction, but preserve unverified high-risk G26 blockers rather than marking them finished.
