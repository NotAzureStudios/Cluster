import { ClusterNativeSelect, ClusterInput } from "../../components/ClusterNativeControls";
import { ClusterButton } from "../../components/ClusterButton";
import { useCallback, useEffect, useMemo, useState } from "react";
import { confirmCluster } from "../../components/cluster-dialog-service";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { api, formatApiError } from "../../core/api";
import type { Project } from "../application/application-models";

type StructureTemplate = {
  id: string;
  kind: "board" | "whiteboard";
  title: string;
  sourceId?: string | null;
  sourceLabel?: string | null;
  includeCards?: boolean;
  itemCount?: number;
  updatedAt?: string;
};

export function ProjectStructureTemplates({ project, canManage, onCreated }: { project: Project; canManage: boolean; onCreated?: () => Promise<void> | void }) {
  const [templates, setTemplates] = useState<StructureTemplate[]>([]);
  const [kind, setKind] = useState<"board" | "whiteboard">("board");
  const [sourceId, setSourceId] = useState("");
  const [title, setTitle] = useState("");
  const [includeCards, setIncludeCards] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [status, setStatus] = useState("");
  const sources = useMemo(() => kind === "board" ? project.boards || [] : project.whiteboards || [], [kind, project.boards, project.whiteboards]);

  const load = useCallback(async () => {
    try {
      const result = await api<{ templates: StructureTemplate[] }>(`/api/projects/${project.id}/structure-templates`);
      setTemplates(result.templates || []);
    } catch (error) {
      setStatus(formatApiError(error));
    }
  }, [project.id]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!sources.some((source) => source.id === sourceId)) setSourceId(sources[0]?.id || "");
  }, [sources, sourceId]);

  async function capture() {
    if (!sourceId) return setStatus(`Create a ${kind} first, then save its structure.`);
    setBusyId("capture"); setStatus("");
    try {
      await api(`/api/projects/${project.id}/structure-templates/capture`, { method: "POST", body: JSON.stringify({ kind, sourceId, title: title.trim() || undefined, includeCards: kind === "board" && includeCards }) });
      setTitle("");
      setStatus("Reusable structure saved for this project.");
      await load();
    } catch (error) { setStatus(formatApiError(error)); }
    finally { setBusyId(""); }
  }

  async function apply(template: StructureTemplate) {
    setBusyId(template.id); setStatus("");
    try {
      const result = await api<{ id: string; kind: "board" | "whiteboard"; name: string }>(`/api/projects/${project.id}/structure-templates/${template.id}/apply`, { method: "POST", body: "{}" });
      await onCreated?.();
      setStatus(`${result.name} created from ${template.title}.`);
    } catch (error) { setStatus(formatApiError(error)); }
    finally { setBusyId(""); }
  }

  async function remove(template: StructureTemplate) {
    if (!(await confirmCluster({ title: "Remove reusable structure?", message: `${template.title} will be removed from this project template library. Existing Boards and Whiteboards are untouched.`, confirmLabel: "Remove", tone: "danger" }))) return;
    setBusyId(template.id); setStatus("");
    try {
      await api(`/api/projects/${project.id}/structure-templates/${template.id}`, { method: "DELETE" });
      setTemplates((current) => current.filter((item) => item.id !== template.id));
      setStatus("Reusable structure removed.");
    } catch (error) { setStatus(formatApiError(error)); }
    finally { setBusyId(""); }
  }

  return <div className="project-structure-templates-v494">
    {status ? <div className="inline-status">{status}</div> : null}
    <div className="project-structure-capture-v494">
      <label><span>Structure type</span><ClusterNativeSelect disabled={!canManage} value={kind} onChange={(event) => setKind(event.target.value as "board" | "whiteboard")}><option value="board">Board</option><option value="whiteboard">Whiteboard</option></ClusterNativeSelect></label>
      <label><span>Source</span><ClusterNativeSelect disabled={!canManage || !sources.length} value={sourceId} onChange={(event) => setSourceId(event.target.value)}>{sources.length ? sources.map((source) => <option key={source.id} value={source.id}>{source.name}</option>) : <option value="">No {kind}s</option>}</ClusterNativeSelect></label>
      <label><span>Template name</span><ClusterTextInput disabled={!canManage} value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} placeholder="Use source name" /></label>
      {kind === "board" ? <label className="tool-check compact"><ClusterInput type="checkbox" disabled={!canManage} checked={includeCards} onChange={(event) => setIncludeCards(event.target.checked)} /> Include reusable card skeletons</label> : <span className="muted-copy">Whiteboard links to production objects are intentionally stripped when captured.</span>}
      <ClusterButton type="button" className="" disabled={!canManage || !sourceId || busyId === "capture"} onClick={() => void capture()} variant="secondary" size="compact">{busyId === "capture" ? "Saving…" : "Save reusable structure"}</ClusterButton>
    </div>
    {templates.length ? <div className="project-structure-template-list-v494">{templates.map((template) => <article key={template.id}><div><span>{template.kind}</span><strong>{template.title}</strong><small>{template.sourceLabel || "Project structure"} · {template.itemCount || 0} reusable item{template.itemCount === 1 ? "" : "s"}{template.includeCards ? " · card skeletons included" : ""}</small></div><footer><ClusterButton type="button" className="" disabled={!canManage || busyId === template.id} onClick={() => void apply(template)} variant="quiet" size="compact">{busyId === template.id ? "Working…" : "Create copy"}</ClusterButton><ClusterButton type="button" className="" disabled={!canManage || busyId === template.id} onClick={() => void remove(template)} variant="danger" size="compact">Remove</ClusterButton></footer></article>)}</div> : <p className="muted-copy">No reusable Board or Whiteboard structures yet.</p>}
  </div>;
}
