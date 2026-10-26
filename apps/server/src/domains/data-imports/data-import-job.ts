import { createHash } from "node:crypto";
import { z } from "zod";
import type {
  ClusterDataImportApplyEvidence,
  ClusterDataImportApplyRequest,
  ClusterDataImportRowOutcome,
  ClusterResourceKind,
} from "@cluster/shared";
import type { ClusterDataLayout } from "../../core/data-layout.js";
import { CLUSTER_DATA_IMPORT_LIMITS, previewClusterDataImport, type ClusterDataImportRegistry } from "../../core/data-import.js";
import type { DurableJobWorker } from "../jobs/job-worker.js";
import { createDataImportReportArtifact, readDataImportSourceArtifact } from "./data-import-artifact-service.js";
import { recordLibraryBacklink } from "../library/library-governance.js";

const payloadSchema = z.object({
  resourceKind: z.string().trim().min(1).max(100),
  actorId: z.string().trim().min(1).max(200),
  sourceArtifactId: z.string().trim().min(1).max(200),
  sourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});

function deterministicImportId(resourceKind: string, sourceFingerprint: string, row: number) {
  return `imp_${createHash("sha256").update(`${resourceKind}:${sourceFingerprint}:${row}`).digest("hex").slice(0, 28)}`;
}

function errorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) return String((error as any).code || "DATA_IMPORT_ROW_FAILED").slice(0, 120);
  return "DATA_IMPORT_ROW_FAILED";
}

function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error || "Import row failed.")).slice(0, 1000);
}

export function registerDataImportJobHandler(input: {
  worker: DurableJobWorker;
  registry: ClusterDataImportRegistry;
  prisma: any;
  dataLayout: ClusterDataLayout;
  logSecurityEvent?: (input: any) => Promise<unknown>;
  logActivity?: (input: any) => Promise<unknown>;
}) {
  input.worker.register("data-import.apply", async ({ job, payload, updateProgress, throwIfCancelled }) => {
    const parsed = payloadSchema.parse(payload || {});
    const resourceKind = parsed.resourceKind as ClusterResourceKind;
    const adapter = input.registry.get(resourceKind);
    if (!adapter?.authorizeActor || !adapter.applyRow) throw Object.assign(new Error("The requested import resource no longer exposes a durable mutation adapter."), { code: "DATA_IMPORT_APPLY_UNSUPPORTED" });
    const actor = await adapter.authorizeActor(parsed.actorId);
    if (!actor) throw Object.assign(new Error("Import edit authorization is no longer valid for this user."), { code: "DATA_IMPORT_ACCESS_REVOKED" });

    const startedAt = new Date();
    let sourceArtifact: any = null;
    try {
      await throwIfCancelled();
      await updateProgress(4, "Verifying durable import source");
      const source = await readDataImportSourceArtifact({ prisma: input.prisma, dataLayout: input.dataLayout, artifactId: parsed.sourceArtifactId, ownerId: actor.id });
      sourceArtifact = {
        libraryItemId: source.item.id,
        fileName: source.item.originalName || source.item.title,
        mimeType: source.item.mimeType || "application/json; charset=utf-8",
        sizeBytes: Number(source.item.sizeBytes || source.content.length),
        downloadUrl: `/api/library/${source.item.id}/file?download=1`,
      };
      const fingerprint = createHash("sha256").update(source.content).digest("hex");
      if (fingerprint !== parsed.sourceFingerprint) throw Object.assign(new Error("The import source fingerprint no longer matches the queued request."), { code: "DATA_IMPORT_SOURCE_FINGERPRINT" });
      const request = JSON.parse(source.content.toString("utf8")) as ClusterDataImportApplyRequest;
      if (request.resourceKind !== resourceKind) throw Object.assign(new Error("The import source resource kind does not match the queued job."), { code: "DATA_IMPORT_SOURCE_RESOURCE" });
      if (!Array.isArray(request.rows) || request.rows.length > CLUSTER_DATA_IMPORT_LIMITS.applyRows) throw Object.assign(new Error(`Import apply is limited to ${CLUSTER_DATA_IMPORT_LIMITS.applyRows} rows per job.`), { code: "DATA_IMPORT_ROW_LIMIT" });

      await updateProgress(8, "Revalidating import mapping");
      const preview = previewClusterDataImport(adapter, request, { maxRows: CLUSTER_DATA_IMPORT_LIMITS.applyRows });
      const mappingIssues = preview.issues.filter((issue) => issue.row === 0);
      if (mappingIssues.length) throw Object.assign(new Error(mappingIssues[0]?.message || "Import mapping is invalid."), { code: mappingIssues[0]?.code || "DATA_IMPORT_MAPPING_INVALID" });

      const outcomes: ClusterDataImportRowOutcome[] = [];
      const rowIssues = new Map<number, string[]>();
      for (const issue of preview.issues) {
        if (!issue.row) continue;
        const messages = rowIssues.get(issue.row) || [];
        messages.push(issue.message);
        rowIssues.set(issue.row, messages);
      }
      const counts = { created: 0, updated: 0, skipped: 0, already_applied: 0, failed: 0 };
      const rows = preview.rows;
      for (let index = 0; index < rows.length; index += 1) {
        await throwIfCancelled();
        const row = rows[index];
        if (!row.valid) {
          counts.failed += 1;
          outcomes.push({ row: row.row, action: "failed", code: "DATA_IMPORT_ROW_INVALID", message: (rowIssues.get(row.row) || ["Row validation failed."]).join(" ").slice(0, 1000) });
        } else {
          try {
            const result = await adapter.applyRow({
              actor,
              row: row.row,
              values: row.values,
              conflictPolicy: preview.conflictPolicy,
              sourceFingerprint: parsed.sourceFingerprint,
              deterministicId: deterministicImportId(resourceKind, parsed.sourceFingerprint, row.row),
            });
            if (result.action === "created") counts.created += 1;
            else if (result.action === "updated") counts.updated += 1;
            else if (result.action === "skipped") counts.skipped += 1;
            else counts.already_applied += 1;
            outcomes.push({ row: row.row, action: result.action, resourceId: result.resourceId || null, identity: result.identity || null, message: result.message || null });
          } catch (error) {
            counts.failed += 1;
            outcomes.push({ row: row.row, action: "failed", code: errorCode(error), message: errorMessage(error) });
          }
        }
        const progress = 10 + Math.floor(((index + 1) / Math.max(1, rows.length)) * 76);
        if ((index + 1) % 5 === 0 || index === rows.length - 1) await updateProgress(progress, `Applied ${index + 1} of ${rows.length} rows`);
      }

      const finishedAt = new Date();
      const evidence: ClusterDataImportApplyEvidence = {
        resourceKind,
        format: request.format,
        conflictPolicy: preview.conflictPolicy,
        sourceFingerprint: parsed.sourceFingerprint,
        sourceArtifactId: parsed.sourceArtifactId,
        sourceRowCount: request.rows.length,
        processedRows: rows.length,
        validRows: preview.validRows,
        invalidRows: preview.invalidRows,
        createdRows: counts.created,
        updatedRows: counts.updated,
        skippedRows: counts.skipped,
        alreadyAppliedRows: counts.already_applied,
        failedRows: counts.failed,
        partialFailure: counts.failed > 0,
        rollbackAvailable: false,
        recovery: "rerun_safe",
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
      };
      await updateProgress(90, "Writing import report to Library");
      const reportArtifact = await createDataImportReportArtifact({
        prisma: input.prisma,
        dataLayout: input.dataLayout,
        ownerId: actor.id,
        resourceKind,
        sourceFingerprint: parsed.sourceFingerprint,
        evidence,
        report: {
          evidence,
          columns: preview.columns,
          ignoredColumns: preview.ignoredColumns,
          issues: preview.issues,
          outcomes,
          recovery: {
            rerunSafe: true,
            rollbackAvailable: false,
            note: "Rows are applied independently. Re-running the same source fingerprint is idempotent for already-applied rows; there is no automatic bulk rollback.",
          },
        },
      });
      await recordLibraryBacklink(input.prisma, {
        itemId: reportArtifact.libraryItemId,
        sourceResourceKind: "library",
        sourceResourceId: sourceArtifact.libraryItemId,
        relationKind: "imported_from",
        label: sourceArtifact.fileName,
      });
      await recordLibraryBacklink(input.prisma, {
        itemId: reportArtifact.libraryItemId,
        sourceResourceKind: "data_import",
        sourceResourceId: job.id,
        relationKind: "generated",
        label: `${adapter.label} import`,
      });
      for (const outcome of outcomes) {
        if (!outcome.resourceId || outcome.action === "failed" || outcome.action === "skipped") continue;
        await recordLibraryBacklink(input.prisma, {
          itemId: reportArtifact.libraryItemId,
          sourceResourceKind: resourceKind,
          sourceResourceId: outcome.resourceId,
          relationKind: "import_result",
          label: outcome.identity || adapter.label,
        });
      }
      await input.logSecurityEvent?.({ event: "data_import.background_completed", actorUserId: actor.id, result: counts.failed ? "PARTIAL" : "SUCCESS", reasonCode: counts.failed ? "DATA_IMPORT_PARTIAL" : "DATA_IMPORT_COMPLETED", metadata: { ...evidence, reportLibraryItemId: reportArtifact.libraryItemId } });
      await input.logActivity?.({
        userId: actor.id,
        type: counts.failed ? "data_import_partial" : "data_import_ready",
        entityType: "library",
        entityId: reportArtifact.libraryItemId,
        title: counts.failed ? "Data import completed with issues" : "Data import complete",
        message: `${adapter.label}: ${evidence.createdRows} created · ${evidence.updatedRows} updated · ${evidence.skippedRows + evidence.alreadyAppliedRows} unchanged · ${evidence.failedRows} failed`,
        metadata: {
          notifyInbox: true,
          userIds: [actor.id],
          notificationTool: "library",
          notificationSignal: counts.failed ? "warning" : "activity",
          notificationCategory: "activity",
          notificationPriority: counts.failed ? "high" : "normal",
          notificationGroupKey: `data-import:${job.id}`,
          dataImportJobId: job.id,
          source: { kind: "library", id: reportArtifact.libraryItemId },
          dataImport: evidence,
        },
      });
      await updateProgress(98, "Import report saved to Library");
      return { evidence, sourceArtifact, reportArtifact };
    } catch (error) {
      await input.logSecurityEvent?.({ event: "data_import.background_failed", actorUserId: parsed.actorId, result: "FAILURE", reasonCode: errorCode(error), metadata: { resourceKind, jobId: job.id, sourceArtifactId: parsed.sourceArtifactId, sourceFingerprint: parsed.sourceFingerprint, message: errorMessage(error) } }).catch(() => undefined);
      await input.logActivity?.({
        userId: parsed.actorId,
        type: "data_import_failed",
        entityType: "library",
        entityId: parsed.sourceArtifactId,
        title: "Data import failed",
        message: errorMessage(error),
        metadata: {
          notifyInbox: true,
          userIds: [parsed.actorId],
          notificationTool: "library",
          notificationSignal: "warning",
          notificationCategory: "activity",
          notificationPriority: "high",
          notificationGroupKey: `data-import:${job.id}`,
          dataImportJobId: job.id,
          source: { kind: "library", id: parsed.sourceArtifactId },
        },
      }).catch(() => undefined);
      throw error;
    }
  });
}
