import { ClusterDisclosureGroup } from "../../components/ClusterDisclosureGroup";
import { useMemo, useState } from "react";
import type { SensitiveMetadataEnvelope } from "@cluster/shared";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterInspectorPanel } from "../../components/ClusterWorkspacePanel";
import type { ViewerAssetSession, ViewerDiagnosticsSnapshot, ViewerInspectorSection } from "./viewer-contracts";

function humanBytes(value: number) {
  const bytes = Math.max(0, Number(value || 0));
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let current = bytes / 1024;
  let index = 0;
  while (current >= 1024 && index < units.length - 1) { current /= 1024; index += 1; }
  return `${current >= 100 ? current.toFixed(0) : current >= 10 ? current.toFixed(1) : current.toFixed(2)} ${units[index]}`;
}

function displayValue(value: unknown): string {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return Number.isFinite(value) ? value.toLocaleString() : "—";
  if (typeof value === "string") return value.length > 180 ? `${value.slice(0, 177)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 12).map((item) => displayValue(item)).join(", ");
  return "Available";
}

function entries(value: unknown, max = 24) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [] as Array<[string, unknown]>;
  return Object.entries(value as Record<string, unknown>).slice(0, max);
}

function KeyValueSection({ title, value, empty = "No data reported.", open = true }: { title: string; value: unknown; empty?: string; open?: boolean }) {
  const rows = entries(value);
  return <ClusterDisclosureGroup className="cluster-viewer-inspector-section" title={title} headerTrailing={rows.length ? <span>{rows.length}</span> : null} defaultOpen={open}>
    {rows.length ? <dl>{rows.map(([key, item]) => <div key={key}><dt>{key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ")}</dt><dd title={typeof item === "string" ? item : undefined}>{displayValue(item)}</dd></div>)}</dl> : <p className="muted">{empty}</p>}
  </ClusterDisclosureGroup>;
}

export function ViewerInspector({
  session,
  diagnostics,
  onLoadSensitiveMetadata,
  adapterSections = [],
  onClose,
  onDetach,
}: {
  session: ViewerAssetSession;
  diagnostics: ViewerDiagnosticsSnapshot;
  onLoadSensitiveMetadata?: () => Promise<SensitiveMetadataEnvelope | null>;
  adapterSections?: readonly ViewerInspectorSection[];
  onClose?: () => void;
  onDetach?: () => void;
}) {
  const [loadingSensitive, setLoadingSensitive] = useState(false);
  const source = session.resource.source;
  const asset = session.asset || {};
  const metadata = session.metadata || {};
  const overview = useMemo(() => ({
    File: source.originalName,
    Medium: source.medium,
    Format: source.mimeType,
    Size: humanBytes(source.sizeBytes),
    Provider: source.provider,
    Support: source.support,
    Version: source.versionId || "—",
    Project: source.projectId || "—",
    Checksum: source.checksumSha256 ? `${source.checksumSha256.slice(0, 12)}…` : "—",
  }), [source]);
  const review = session.review ? {
    Status: session.review.status || "—",
    Approval: session.review.approvalState || "—",
    "Review round": session.review.reviewRound ?? "—",
    "Unresolved notes": session.review.unresolvedCount ?? 0,
    Assignee: session.review.assigneeId || "—",
    Reviewers: session.review.reviewerIds?.length || 0,
  } : {};
  const { adapter: adapterDiagnostics, ...shellDiagnostics } = diagnostics;
  const versions = {
    "Current version": source.versionId || source.id,
    Derivatives: session.resource.derivatives.length,
    "Preferred derivative": session.resource.preferredDerivativeId || "—",
    "Uploaded at": asset.versionUploadedAt || asset.uploadedAt || "—",
    "Modified at": asset.modifiedAt || "—",
  };

  async function revealSensitive() {
    if (!onLoadSensitiveMetadata || loadingSensitive) return;
    setLoadingSensitive(true);
    try { await onLoadSensitiveMetadata(); } finally { setLoadingSensitive(false); }
  }

  return <ClusterInspectorPanel className="cluster-viewer-inspector" label="Asset inspector" title="Inspector" detail="Asset facts, review state, provenance, and diagnostics." onClose={onClose} onDetach={onDetach} detachLabel="Open viewer in new window">
    <KeyValueSection title="Overview" value={overview} />
    {session.review ? <KeyValueSection title="Review" value={review} /> : null}
    <KeyValueSection title={source.medium === "pdf" ? "Document" : source.medium === "3d" ? "Model" : "Media"} value={metadata.production} />
    <KeyValueSection title="Versions" value={versions} />
    <KeyValueSection title="Details" value={{ ...(metadata.identity || {}), ...(metadata.derived || {}) }} />
    {adapterSections.map((section) => <KeyValueSection key={section.title} title={section.title} value={section.value} empty={section.empty} open={section.open ?? true} />)}
    {session.capabilities.viewSensitiveMetadata ? <ClusterDisclosureGroup className="cluster-viewer-inspector-section" title="Sensitive metadata" headerTrailing={<span>{session.sensitiveMetadata ? entries(session.sensitiveMetadata).length : "locked"}</span>}>
      {session.sensitiveMetadata ? <KeyValueSection title="Authorized fields" value={session.sensitiveMetadata} empty="No sensitive metadata is stored for this asset." /> : <div className="cluster-viewer-sensitive-gate"><p>Sensitive metadata is fetched only after an authorized user explicitly requests it. The server remains the authorization boundary.</p><ClusterButton size="compact" variant="secondary" busy={loadingSensitive} busyLabel="Loading…" onClick={() => void revealSensitive()}>Load sensitive metadata</ClusterButton></div>}
    </ClusterDisclosureGroup> : null}
    {session.capabilities.accessDiagnostics ? <><KeyValueSection title="Diagnostics" value={shellDiagnostics} />{adapterDiagnostics ? <KeyValueSection title="Adapter diagnostics" value={adapterDiagnostics} /> : null}</> : null}
  </ClusterInspectorPanel>;
}
