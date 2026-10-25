import { z } from "zod";
import { CLUSTER_DATA_EXPORT_FORMATS, CLUSTER_DATA_EXPORT_SCOPES, type ClusterDataExportFormat, type ClusterDataQuery, type ClusterResourceKind } from "@cluster/shared";
import type { ClusterDataLayout } from "../../core/data-layout.js";
import { CLUSTER_DATA_EXPORT_LIMITS, prepareClusterDataExport, prepareClusterDerivedExport, renderClusterDataExport, type ClusterDataExportRegistry } from "../../core/data-export.js";
import { normalizeClusterDataQuery } from "../../core/data-query.js";
import { createClusterXlsxWorkbook } from "../../core/xlsx-workbook.js";
import type { DurableJobWorker } from "../jobs/job-worker.js";
import { createDataExportLibraryArtifact } from "./data-export-artifact-service.js";
import { recordLibraryBacklink } from "../library/library-governance.js";

const payloadSchema = z.object({
  resourceKind: z.string().trim().min(1).max(100),
  actorId: z.string().trim().min(1).max(200),
  format: z.enum(CLUSTER_DATA_EXPORT_FORMATS),
  scope: z.enum(CLUSTER_DATA_EXPORT_SCOPES),
  fieldIds: z.array(z.string().trim().min(1).max(160)).max(200).optional(),
  query: z.unknown().optional(),
  selectedIds: z.array(z.string().trim().min(1).max(200)).max(CLUSTER_DATA_EXPORT_LIMITS.selectedRows).optional(),
  fileName: z.string().trim().max(160).nullable().optional(),
});

function artifactMime(format: ClusterDataExportFormat) {
  if (format === "xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (format === "json") return "application/json; charset=utf-8";
  return "text/csv; charset=utf-8";
}

export function registerDataExportJobHandler(input: {
  worker: DurableJobWorker;
  registry: ClusterDataExportRegistry;
  prisma: any;
  dataLayout: ClusterDataLayout;
  logSecurityEvent?: (input: any) => Promise<unknown>;
  logActivity?: (input: any) => Promise<unknown>;
}) {
  input.worker.register("data-export.generate", async ({ job, payload, updateProgress, throwIfCancelled }) => {
    const parsed = payloadSchema.parse(payload || {});
    const resourceKind = parsed.resourceKind as ClusterResourceKind;
    const adapter = input.registry.get(resourceKind);
    if (!adapter) throw Object.assign(new Error("The requested export resource is no longer registered."), { code: "DATA_EXPORT_UNSUPPORTED" });
    if (!adapter.authorizeActor) throw Object.assign(new Error("This export resource cannot be authorized for background delivery."), { code: "DATA_EXPORT_BACKGROUND_UNSUPPORTED" });
    const actor = await adapter.authorizeActor(parsed.actorId);
    if (!actor) throw Object.assign(new Error("Export authorization is no longer valid for this user."), { code: "DATA_EXPORT_ACCESS_REVOKED" });
    await throwIfCancelled();
    await updateProgress(10, "Resolving authorized export rows");

    const selectedIds: string[] = Array.from(new Set<string>((parsed.selectedIds || []).map((value) => String(value)))).slice(0, CLUSTER_DATA_EXPORT_LIMITS.selectedRows);
    if (parsed.scope === "selection" && !selectedIds.length) throw Object.assign(new Error("Selected-row exports require at least one selected resource."), { code: "DATA_EXPORT_SELECTION_REQUIRED" });
    const maxRows = parsed.scope === "selection" ? CLUSTER_DATA_EXPORT_LIMITS.selectedRows : CLUSTER_DATA_EXPORT_LIMITS.backgroundRows;
    const requestedQuery = (parsed.query || {}) as ClusterDataQuery;
    const query = normalizeClusterDataQuery({ ...requestedQuery, page: { cursor: null, limit: maxRows } }, { fields: adapter.fields, defaultLimit: maxRows, maxLimit: maxRows });
    const loaded = await adapter.loadRows({ context: { actor }, query, selectedIds, limit: maxRows });
    const derived = prepareClusterDerivedExport({ baseFields: adapter.fields, query, rows: loaded.rows });
    await throwIfCancelled();
    await updateProgress(55, `Rendering ${loaded.rows.length} export row${loaded.rows.length === 1 ? "" : "s"}`);

    let fileName: string;
    let content: Buffer;
    let evidence: ReturnType<typeof prepareClusterDataExport>["evidence"];
    if (parsed.format === "xlsx") {
      const prepared = prepareClusterDataExport({ resourceKind, adapterLabel: adapter.label, format: parsed.format, scope: parsed.scope, delivery: "library", fields: derived.fields, requestedFieldIds: parsed.fieldIds, rows: derived.rows, truncated: loaded.truncated, fileName: parsed.fileName, maxRows });
      fileName = prepared.fileName;
      evidence = prepared.evidence;
      content = createClusterXlsxWorkbook({ sheetName: adapter.label, fields: prepared.fields, rows: prepared.rows });
    } else {
      const rendered = renderClusterDataExport({ resourceKind, adapterLabel: adapter.label, format: parsed.format, scope: parsed.scope, delivery: "library", fields: derived.fields, requestedFieldIds: parsed.fieldIds, rows: derived.rows, truncated: loaded.truncated, fileName: parsed.fileName, maxRows });
      fileName = rendered.fileName;
      evidence = rendered.evidence;
      content = Buffer.from(rendered.body, "utf8");
    }

    await throwIfCancelled();
    await updateProgress(80, "Saving export to Library");
    const artifact = await createDataExportLibraryArtifact({ prisma: input.prisma, dataLayout: input.dataLayout, ownerId: actor.id, resourceKind, fileName, mimeType: artifactMime(parsed.format), content, evidence });
    await recordLibraryBacklink(input.prisma, {
      itemId: artifact.libraryItemId,
      sourceResourceKind: "data_export",
      sourceResourceId: job.id,
      relationKind: "generated",
      label: `${adapter.label} export`,
    });
    for (const sourceId of selectedIds.slice(0, 1000)) {
      await recordLibraryBacklink(input.prisma, {
        itemId: artifact.libraryItemId,
        sourceResourceKind: resourceKind,
        sourceResourceId: sourceId,
        relationKind: "exported_from",
        label: adapter.label,
      });
    }
    await input.logSecurityEvent?.({ event: "data_export.background_generated", actorUserId: actor.id, result: "SUCCESS", reasonCode: "DATA_EXPORT_BACKGROUND_GENERATED", metadata: { ...evidence, libraryItemId: artifact.libraryItemId, sizeBytes: artifact.sizeBytes } });
    await input.logActivity?.({
      userId: actor.id,
      type: "data_export_ready",
      entityType: "library",
      entityId: artifact.libraryItemId,
      title: "Data export ready",
      message: `${artifact.fileName} · ${evidence.rowCount} row${evidence.rowCount === 1 ? "" : "s"}`,
      metadata: {
        notifyInbox: true,
        userIds: [actor.id],
        notificationTool: "library",
        notificationSignal: "activity",
        notificationCategory: "activity",
        notificationPriority: "normal",
        notificationGroupKey: `data-export:${job.id}`,
        dataExportJobId: job.id,
        source: { kind: "library", id: artifact.libraryItemId },
        dataExport: evidence,
      },
    });
    await updateProgress(98, "Export saved to Library");
    return { artifact };
  });
}
