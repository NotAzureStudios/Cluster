import { useEffect, useMemo, useState } from "react";
import {
  CLUSTER_RESOURCE_GRAPH_CATEGORIES, CLUSTER_WORKFLOW_RELATIONSHIP_META,
  type ClusterResourceGraphCategory, type ClusterResourceGraphDirection,
  type ClusterResourceGraphNeighborhood, type ClusterResourceAddress,
} from "@cluster/shared";
import { api } from "../../core/api";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterNativeSelect } from "../../components/ClusterNativeControls";
import { WorkActionMenu } from "../workflow/WorkActionMenu";
import { clusterResourceNavigation } from "../workflow/resource-navigation";
import "./library-resource-references.css";

function addressKey(resource: ClusterResourceAddress) {
  return `${resource.kind}:${resource.id}`;
}

/** Relationship view over the same permission-filtered Project Graph used by Project Control.
 * Nothing is queried until the References tab is mounted. Global Library items
 * without a Project scope cannot be queried through a Project graph. */
export function LibraryResourceReferencesPanel({ itemId, projectId }: { itemId: string; projectId: string | null }) {
  const [direction, setDirection] = useState<ClusterResourceGraphDirection>("both");
  const [category, setCategory] = useState<ClusterResourceGraphCategory | "all">("all");
  const [graph, setGraph] = useState<ClusterResourceGraphNeighborhood | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [request, setRequest] = useState(0);

  useEffect(() => {
    let active = true;
    setGraph(null);
    setError("");
    if (!projectId) { setLoading(false); return () => { active = false; }; }
    setLoading(true);
    const params = new URLSearchParams({ kind: "library", id: itemId, direction, depth: "1", maxEdges: "100" });
    if (category !== "all") params.set("category", category);
    void api<ClusterResourceGraphNeighborhood>(`/api/projects/${encodeURIComponent(projectId)}/workflow-graph?${params.toString()}`)
      .then((result) => { if (active) setGraph(result); })
      .catch((failure) => { if (active) { setGraph(null); setError(failure instanceof Error ? failure.message : "References could not be loaded."); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [itemId, projectId, direction, category, request]);

  const names = useMemo(() => new Map((graph?.nodes || []).map((node) => [addressKey(node.resource), node.label || `${node.resource.kind.replaceAll("_", " ")} · ${node.resource.id.slice(0, 8)}`])), [graph]);
  const edges = graph?.edges || [];
  const inbound = edges.filter((edge) => edge.target.kind === "library" && edge.target.id === itemId);
  const outbound = edges.filter((edge) => edge.source.kind === "library" && edge.source.id === itemId);
  const other = edges.filter((edge) => !inbound.includes(edge) && !outbound.includes(edge));

  function renderEdges(rows: typeof edges, title: string) {
    return <section className="library-references-group-v0507"><strong>{title} · {rows.length}</strong>
      {rows.map((edge) => {
        const related = edge.source.kind === "library" && edge.source.id === itemId ? edge.target : edge.source;
        const label = names.get(addressKey(related)) || related.kind.replaceAll("_", " ");
        const relation = CLUSTER_WORKFLOW_RELATIONSHIP_META[edge.relationship];
        const incoming = edge.target.kind === "library" && edge.target.id === itemId;
        const scopedResource = { ...related, projectId: related.projectId || projectId };
        return <article key={edge.id}>
          <div className="library-references-details-v0507"><span>{related.kind.replaceAll("_", " ")}{edge.critical ? " · critical" : ""}{edge.blocking ? " · blocking" : ""}</span><strong>{label}</strong><small>{(incoming ? relation?.incoming : relation?.outgoing) || edge.relationship.replaceAll("_", " ")}</small>{edge.description ? <p>{edge.description}</p> : null}</div>
          <WorkActionMenu iconOnly context={{ source: { ...scopedResource, label }, projectId, navigation: clusterResourceNavigation(scopedResource) }} label={`Actions for ${label}`} />
        </article>;
      })}
      {!rows.length ? <p className="muted">No visible {title.toLowerCase()} relationships.</p> : null}
    </section>;
  }

  return <div className="library-inspector-scroll-v217 library-references-v0507" aria-label="Library references and usage">
    <p className="muted">Only relationships whose resources you can access are shown. Counts do not include hidden resources.</p>
    {!projectId ? <p className="muted">This Library item has no Project scope. Project relationships are not available here.</p> : <>
      <div className="library-references-controls-v0507">
        <label><span>Direction</span><ClusterNativeSelect value={direction} onChange={(event) => setDirection(event.target.value as ClusterResourceGraphDirection)}><option value="both">Both</option><option value="incoming">Used by</option><option value="outgoing">References</option></ClusterNativeSelect></label>
        <label><span>Category</span><ClusterNativeSelect value={category} onChange={(event) => setCategory(event.target.value as ClusterResourceGraphCategory | "all")}><option value="all">All</option>{CLUSTER_RESOURCE_GRAPH_CATEGORIES.map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</ClusterNativeSelect></label>
        <ClusterButton variant="secondary" size="compact" disabled={loading} onClick={() => setRequest((value) => value + 1)}>{loading ? "Loading…" : "Refresh"}</ClusterButton>
      </div>
      {error ? <div role="alert" className="error-box slim">{error} <ClusterButton variant="secondary" size="compact" onClick={() => setRequest((value) => value + 1)}>Retry</ClusterButton></div> : null}
      {loading ? <p role="status">Loading authorized relationships…</p> : null}
      {graph && !loading ? <>
        <p className="muted">{edges.length} visible relationship{edges.length === 1 ? "" : "s"}{graph.truncated ? " · Limited by the graph traversal budget; narrow the filter to see more." : ""}</p>
        {direction !== "outgoing" ? renderEdges(inbound, "Used by") : null}
        {direction !== "incoming" ? renderEdges(outbound, "References") : null}
        {other.length ? renderEdges(other, "Related") : null}
      </> : null}
    </>}
  </div>;
}
