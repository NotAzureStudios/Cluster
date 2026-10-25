-- WIP50: remove the historical KnowledgeItem database identity.
-- Cluster has no deployed instances, so Library is the only launch authority.
ALTER TABLE "KnowledgeItem" RENAME TO "LibraryItem";

ALTER TABLE "LibraryItem" RENAME CONSTRAINT "KnowledgeItem_pkey" TO "LibraryItem_pkey";
ALTER TABLE "LibraryItem" RENAME CONSTRAINT "KnowledgeItem_projectId_fkey" TO "LibraryItem_projectId_fkey";
ALTER TABLE "LibraryItem" RENAME CONSTRAINT "KnowledgeItem_ownerId_fkey" TO "LibraryItem_ownerId_fkey";
ALTER TABLE "LibraryItem" RENAME CONSTRAINT "KnowledgeItem_reviewerId_fkey" TO "LibraryItem_reviewerId_fkey";
ALTER TABLE "LibraryItem" RENAME CONSTRAINT "KnowledgeItem_parentId_fkey" TO "LibraryItem_parentId_fkey";

ALTER INDEX "KnowledgeItem_projectId_idx" RENAME TO "LibraryItem_projectId_idx";
ALTER INDEX "KnowledgeItem_projectId_parentId_status_idx" RENAME TO "LibraryItem_projectId_parentId_status_idx";
ALTER INDEX "KnowledgeItem_parentId_status_updatedAt_idx" RENAME TO "LibraryItem_parentId_status_updatedAt_idx";
ALTER INDEX "KnowledgeItem_ownerId_idx" RENAME TO "LibraryItem_ownerId_idx";
ALTER INDEX "KnowledgeItem_reviewerId_idx" RENAME TO "LibraryItem_reviewerId_idx";
ALTER INDEX "KnowledgeItem_type_idx" RENAME TO "LibraryItem_type_idx";
ALTER INDEX "KnowledgeItem_status_idx" RENAME TO "LibraryItem_status_idx";
ALTER INDEX "KnowledgeItem_visibility_idx" RENAME TO "LibraryItem_visibility_idx";
ALTER INDEX "KnowledgeItem_mimeType_idx" RENAME TO "LibraryItem_mimeType_idx";
ALTER INDEX "KnowledgeItem_source_idx" RENAME TO "LibraryItem_source_idx";
ALTER INDEX "KnowledgeItem_pinned_updatedAt_idx" RENAME TO "LibraryItem_pinned_updatedAt_idx";
ALTER INDEX "KnowledgeItem_reviewDueAt_idx" RENAME TO "LibraryItem_reviewDueAt_idx";
ALTER INDEX "KnowledgeItem_updatedAt_idx" RENAME TO "LibraryItem_updatedAt_idx";
ALTER INDEX "KnowledgeItem_creatorId_idx" RENAME TO "LibraryItem_creatorId_idx";
ALTER INDEX "KnowledgeItem_uploaderId_idx" RENAME TO "LibraryItem_uploaderId_idx";
ALTER INDEX "KnowledgeItem_lastEditorId_idx" RENAME TO "LibraryItem_lastEditorId_idx";
ALTER INDEX "KnowledgeItem_generatedForUserId_idx" RENAME TO "LibraryItem_generatedForUserId_idx";
ALTER INDEX "KnowledgeItem_lifecycleState_updatedAt_idx" RENAME TO "LibraryItem_lifecycleState_updatedAt_idx";
ALTER INDEX "KnowledgeItem_classification_idx" RENAME TO "LibraryItem_classification_idx";
ALTER INDEX "KnowledgeItem_retentionUntil_idx" RENAME TO "LibraryItem_retentionUntil_idx";
ALTER INDEX "KnowledgeItem_legalHold_retentionUntil_idx" RENAME TO "LibraryItem_legalHold_retentionUntil_idx";
ALTER INDEX "KnowledgeItem_deletedAt_idx" RENAME TO "LibraryItem_deletedAt_idx";
ALTER INDEX "KnowledgeItem_integrityState_updatedAt_idx" RENAME TO "LibraryItem_integrityState_updatedAt_idx";
ALTER INDEX "KnowledgeItem_originKind_idx" RENAME TO "LibraryItem_originKind_idx";
ALTER INDEX "KnowledgeItem_generatedByKind_generatedById_idx" RENAME TO "LibraryItem_generatedByKind_generatedById_idx";
ALTER INDEX "KnowledgeItem_reviewState_updatedAt_idx" RENAME TO "LibraryItem_reviewState_updatedAt_idx";
ALTER INDEX "KnowledgeItem_active_updatedAt_idx" RENAME TO "LibraryItem_active_updatedAt_idx";
ALTER INDEX "KnowledgeItem_active_folder_title_idx" RENAME TO "LibraryItem_active_folder_title_idx";
