import { useEffect, useMemo, useState } from "react";
import {
  CLUSTER_RESOURCE_GRAPH_CATEGORIES,
  CLUSTER_WORKFLOW_RELATIONSHIP_META,
  type ClusterResourceAddress,
  type ClusterResourceGraphCategory,
  type ClusterResourceGraphDirection,
  type ClusterResourceGraphNeighborhood,
} from "@cluster/shared";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterResourcePicker } from "../../components/ClusterResourcePicker";
import { useAuthorizedProjectResources } from "../../components/useAuthorizedProjectResources";
import { ClusterNativeSelect } from "../../components/ClusterNativeControls";
import { ClusterSegmentedControl } from "../../components/ClusterSegmentedControl";
import { api } from "../../core/api";
import type { Project } from "../application/application-models";
import type { ProjectControlRecord } from "./project-control-model";

function keyOf(resource: ClusterResourceAddress) {
  return `${resource.kind}:${resource.id}`;
}

function shortId(value: string) {
  return value.length > 12 ? `${value.slice(0, 8)}…` : value;
}

export function ProjectWorkflowGraphPanel({ project, projects, records }: { project: Project; projects: Project[]; records: ProjectControlRecord[] }) {
  const [subject, setSubject] = useState<ClusterResourceAddress>({ kind: "project", id: project.id, projectId: project.id });
  const [direction, setDirection] = useState<ClusterResourceGraphDirection>("both");
  const [depth, setDepth] = useState(2);
  const [category, setCategory] = useState<ClusterResourceGraphCategory | "all">("all");
  const [criticalOnly, setCriticalOnly] = useState(false);
  const [blockingOnly, setBlockingOnly] = useState(false);
  const [graph, setGraph] = useState<ClusterResourceGraphNeighborhood | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  // Same permission-filtered discovery authority as Project Access and Card
  // Projection. Graph-neighbor buttons still require server graph validation.
  const resourceKinds = useMemo(() => ["project", "board", "whiteboard", "library", "review_asset"] as const, []);
  const picker = useAuthorizedProjectResources({ projectId: project.id, minimum: "view", kinds: resourceKinds, limit: 60 });

  useEffect(() => {
    setSubject({ kind: "project", id: project.id, projectId: project.id });
  }, [project.id]);

  useEffect(() => {
    let active = true;
    setBusy(true);
    setStatus("");
    setGraph(null);
    if (subject.projectId && subject.projectId !== project.id) {
      setBusy(false);
      return () => { active = false; };
    }
    const params = new URLSearchParams({ kind: subject.kind, id: subject.id, direction, depth: String(depth), maxEdges: "250" });
    if (category !== "all") params.set("category", category);
    if (criticalOnly) params.set("criticalOnly", "true");
    if (blockingOnly) params.set("blockingOnly", "true");
    void api<ClusterResourceGraphNeighborhood>(`/api/projects/${encodeURIComponent(project.id)}/workflow-graph?${params}`)
      .then((result) => { if (active) setGraph(result); })
      .catch((error) => { if (active) { setGraph(null); setStatus(error instanceof Error ? error.message : "Workflow graph could not be loaded."); } })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [project.id, subject.kind, subject.id, subject.projectId, direction, depth, category, criticalOnly, blockingOnly]);

  const recordMap = useMemo(() => new Map(records.map((record) => [record.id, record])), [records]);
  const projectMap = useMemo(() => new Map(projects.map((item) => [item.id, item])), [projects]);
  const depthLanes = useMemo(() => {
    const map = new Map<number, ClusterResourceGraphNeighborhood["nodes"]>();
    for (const node of graph?.nodes || []) map.set(node.depth, [...(map.get(node.depth) || []), node]);
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [graph]);
  const edgeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const edge of graph?.edges || []) {
      for (const node of [edge.source, edge.target]) counts.set(keyOf(node), (counts.get(keyOf(node)) || 0) + 1);
    }
    return counts;
  }, [graph]);
  const graphLabels = useMemo(() => new Map((graph?.nodes || []).map((node) => [keyOf(node.resource), node.label])), [graph]);

  function label(resource: ClusterResourceAddress) {
    const authorizedLabel = graphLabels.get(keyOf(resource));
    if (authorizedLabel) return authorizedLabel;
    if (resource.kind === "project") return projectMap.get(resource.id)?.name || (resource.id === project.id ? project.name : `Project ${shortId(resource.id)}`);
    if (resource.kind === "control") return recordMap.get(resource.id)?.title || `Control ${shortId(resource.id)}`;
    return `${resource.kind.replaceAll("_", " ")} · ${shortId(resource.id)}`;
  }

  function focus(resource: ClusterResourceAddress) {
    setSubject(resource.projectId ? resource : { ...resource, projectId: project.id });
  }

  const subjectKey = keyOf(subject);
  return <div className="project-workflow-graph-v16c">
    <div className="project-workflow-graph-toolbar-v16c">
      <div className="project-workflow-graph-resource-focus-v0507"><span>Authorized resource focus</span>
        <ClusterResourcePicker resources={picker.resources} value={picker.resources.some((item) => `${item.kind}:${item.id}` === subjectKey) ? subjectKey : ""} onChange={(value) => {
          const resource = picker.resources.find((item) => `${item.kind}:${item.id}` === value);
          if (resource) focus(resource);
        }} ariaLabel="Choose an authorized project resource" projectId={project.id} allowedKinds={resourceKinds} onSearchChange={picker.setQuery} disabled={picker.loading} emptyMessage={picker.loading ? "Loading authorized resources…" : "No authorized matching resources"} />
        {picker.error ? <small role="alert">{picker.error}</small> : null}
        {picker.nextCursor ? <ClusterButton size="compact" variant="quiet" disabled={picker.loadingMore} onClick={() => void picker.loadMore()}>{picker.loadingMore ? "Loading…" : "More resources"}</ClusterButton> : null}
      </div>
      <label><span>Project control focus</span><ClusterNativeSelect value={subject.kind === "control" ? subject.id : ""} onChange={(event) => { const record = records.find((item) => item.id === event.target.value && !item.archived); if (record) focus({ kind: "control", id: record.id, projectId: project.id }); }}><option value="">Choose control record</option>{records.filter((record) => !record.archived).map((record) => <option key={record.id} value={record.id}>{record.title} · {record.kind.replaceAll("_", " ")}</option>)}</ClusterNativeSelect></label>
      <div><span>Direction</span><ClusterSegmentedControl value={direction} onChange={(value) => setDirection(value as ClusterResourceGraphDirection)} label="Workflow graph direction" options={[{ value: "both", label: "Both" }, { value: "incoming", label: "Incoming" }, { value: "outgoing", label: "Outgoing" }]} /></div>
      <label><span>Depth</span><ClusterNativeSelect value={String(depth)} onChange={(event) => setDepth(Number(event.target.value))}><option value="1">1 hop</option><option value="2">2 hops</option><option value="3">3 hops</option><option value="4">4 hops</option></ClusterNativeSelect></label>
      <label><span>Relationship type</span><ClusterNativeSelect value={category} onChange={(event) => setCategory(event.target.value as ClusterResourceGraphCategory | "all")}><option value="all">All types</option>{CLUSTER_RESOURCE_GRAPH_CATEGORIES.map((kind) => <option key={kind} value={kind}>{kind[0].toUpperCase() + kind.slice(1)}</option>)}</ClusterNativeSelect></label>
      <label className="project-workflow-graph-filter-v0507"><input type="checkbox" checked={criticalOnly} onChange={(event) => setCriticalOnly(event.target.checked)} /> Critical only</label>
      <label className="project-workflow-graph-filter-v0507"><input type="checkbox" checked={blockingOnly} onChange={(event) => setBlockingOnly(event.target.checked)} /> Blocking only</label>
      <ClusterButton size="compact" variant="quiet" disabled={busy || subject.kind === "project" && subject.id === project.id} onClick={() => setSubject({ kind: "project", id: project.id, projectId: project.id })}>Reset focus</ClusterButton>
    </div>

    {status ? <div className="project-workflow-graph-status-v16c">{status}</div> : null}
    {graph ? <>
      <div className="project-workflow-graph-summary-v16c"><span><strong>{graph.nodes.length}</strong> visible nodes</span><span><strong>{graph.edges.length}</strong> visible relationships</span><span><strong>{graph.requestedDepth}</strong> hop depth</span>{graph.truncated ? <span className="warning">Result limited by traversal budget; refocus or filter</span> : null}</div>
      <div className="project-workflow-graph-canvas-v16c" aria-label="Project workflow relationship graph">
        {depthLanes.map(([laneDepth, nodes]) => <section key={laneDepth} className="project-workflow-graph-lane-v16c"><header><span>{laneDepth === 0 ? "Focus" : `Depth ${laneDepth}`}</span></header><div>{nodes.map((node) => { const focused = keyOf(node.resource) === subjectKey; const connected = edgeCounts.get(keyOf(node.resource)) || 0; return <article key={keyOf(node.resource)} className={focused ? "focused" : ""}><div><span>{node.resource.kind.replaceAll("_", " ")}</span><strong>{label(node.resource)}</strong><small>{connected} relationship{connected === 1 ? "" : "s"}</small></div>{!focused ? <ClusterButton size="compact" variant="quiet" onClick={() => focus(node.resource)}>Focus</ClusterButton> : <span className="project-workflow-focus-badge-v16c">Current</span>}</article>; })}</div></section>)}
      </div>
      <div className="project-workflow-edge-list-v16c">
        {(graph.edges || []).map((edge) => { const meta = CLUSTER_WORKFLOW_RELATIONSHIP_META[edge.relationship]; return <article key={edge.id} className={edge.critical ? "critical" : ""}><button type="button" onClick={() => focus(edge.source)}>{label(edge.source)}</button><span>{meta?.outgoing || edge.relationship.replaceAll("_", " ")}{edge.blocking ? " · blocking" : ""}{edge.critical ? " · critical" : ""}</span><button type="button" onClick={() => focus(edge.target)}>{label(edge.target)}</button>{edge.description ? <small>{edge.description}</small> : null}</article>; })}
        {!graph.edges.length ? <div className="project-workflow-graph-empty-v16c"><strong>No relationships in this neighborhood</strong><span>Use linked work and Project Control relationships to build traceability without creating another graph store.</span></div> : null}
      </div>
    </> : busy ? <div className="project-workflow-graph-status-v16c">Loading workflow graph…</div> : null}
  </div>;
}
