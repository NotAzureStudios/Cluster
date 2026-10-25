import { clusterApiFetch } from "@cluster/api-client";
import type { ClusterDataExportDelivery, ClusterDataExportFormat, ClusterDataExportScope, ClusterDataQuery, ClusterResourceKind } from "@cluster/shared";

export type ClusterDataExportClientRequest = {
  resourceKind: ClusterResourceKind;
  format: ClusterDataExportFormat;
  scope: ClusterDataExportScope;
  delivery: ClusterDataExportDelivery;
  fieldIds: readonly string[];
  query?: ClusterDataQuery;
  selectedIds?: readonly string[];
  fileName: string;
};

export type ClusterDataExportClientResult =
  | { mode: "background"; jobId: string }
  | { mode: "download"; fileName: string; rowCount: number; truncated: boolean };

export async function requestClusterDataExport(input: ClusterDataExportClientRequest): Promise<ClusterDataExportClientResult> {
  const background = input.delivery === "library" || input.format === "xlsx";
  const response = await clusterApiFetch(`/api/data-exports/${encodeURIComponent(input.resourceKind)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: background ? "application/json" : input.format === "csv" ? "text/csv" : "application/json" },
    body: JSON.stringify({
      format: input.format,
      scope: input.scope,
      delivery: input.format === "xlsx" ? "library" : input.delivery,
      fieldIds: [...input.fieldIds],
      query: input.query || {},
      selectedIds: input.scope === "selection" ? [...(input.selectedIds || [])] : undefined,
      fileName: input.fileName,
    }),
  });
  if (!response.ok) {
    const failure = await response.text();
    throw new Error(failure || `Export failed with status ${response.status}.`);
  }
  if (response.status === 202) {
    const receipt = await response.json() as { jobId?: string };
    if (!receipt.jobId) throw new Error("The export was queued without a job identifier.");
    return { mode: "background", jobId: receipt.jobId };
  }
  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") || "";
  const match = disposition.match(/filename="([^"]+)"/i);
  const fileName = match?.[1] || `${input.fileName}.${input.format}`;
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
  return {
    mode: "download",
    fileName,
    rowCount: Number(response.headers.get("x-cluster-export-rows") || 0),
    truncated: response.headers.get("x-cluster-export-truncated") === "1",
  };
}
