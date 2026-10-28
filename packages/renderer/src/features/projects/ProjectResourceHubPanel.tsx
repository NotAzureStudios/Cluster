import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterIcon } from "../../components/ClusterIcon";
import { useMemo, useState } from "react";
import { formatRelativeTime } from "../../core/format";
import { runtimeStyle } from "../../core/runtime-style";
import type { BoardSummary, Project, WhiteboardSummary } from "../application/application-models";
import { ProjectEmptyState, ProjectSectionHeader, ProjectSurface } from "./ProjectWorkspacePrimitives";

type ResourceKind = "boards" | "whiteboards" | "library";

export function ProjectResourceHubPanel({ kind, project, boards = [], whiteboards = [], busy = false, status, onCreate, onOpen, onOpenLibrary }: {
  kind: ResourceKind;
  project: Project;
  boards?: BoardSummary[];
  whiteboards?: WhiteboardSummary[];
  busy?: boolean;
  status?: string;
  onCreate?: (name: string) => Promise<void> | void;
  onOpen?: (id: string) => void;
  onOpenLibrary?: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const resources = kind === "boards" ? boards : whiteboards;
  const title = kind === "boards" ? "Boards" : kind === "whiteboards" ? "Whiteboards" : "Project Library";
  const description = kind === "boards" ? "Plan delivery in focused Kanban workspaces tied to this project." : kind === "whiteboards" ? "Map systems, flows, references, and collaborative thinking without leaving the project." : "Files, references, links, and working documents managed through the project folder.";
  const defaultName = kind === "boards" ? `${project.name} Board` : `${project.name} Whiteboard`;
  const updated = useMemo(() => resources.reduce<string | undefined>((latest, item) => !latest || (item.updatedAt || "") > latest ? item.updatedAt : latest, undefined), [resources]);
  if (kind === "library") {
    const folder = project.libraryItems?.find((item) => item.id === project.libraryFolderId);
    return <section className="project-subpage-v312 project-resource-hub-v312"><ProjectSectionHeader eyebrow="Project resources" title={title} description={description} metrics={[{ label: "Folder", value: project.libraryFolderId ? "Linked" : "Missing", tone: project.libraryFolderId ? "good" : "warning" }, { label: "Library items", value: project.libraryItems?.length || 0 }, { label: "Access", value: "Folder rules" }]} actions={project.libraryFolderId ? <ClusterButton type="button" className="" onClick={() => onOpenLibrary?.(project.libraryFolderId!)} variant="primary">Open folder</ClusterButton> : null} /><ProjectSurface title={folder?.title || `${project.name} Library`} description="The project folder is the canonical home for files and reference material." tone="accent"><div className="project-library-modern-v312"><div><span>Storage</span><strong>Project-bound Library folder</strong><small>Organized, searchable, and permission-aware.</small></div><div><span>Permissions</span><strong>Inherited folder access</strong><small>Manage access without duplicating project roles.</small></div><div><span>Workflow</span><strong>Files stay attached to context</strong><small>Open assets from Projects, Boards, QA, and Builds.</small></div></div></ProjectSurface></section>;
  }
  return (
    <section className="project-subpage-v312 project-resource-hub-v312">
      <ProjectSectionHeader eyebrow="Project workspaces" title={title} description={description} metrics={[{ label: "Total", value: resources.length, tone: resources.length ? "accent" : "neutral" }, { label: "Recently updated", value: updated ? formatRelativeTime(updated) : "Never" }, { label: "Project", value: project.name }]} actions={<div className="project-inline-create-v312"><ClusterTextInput value={name} onChange={(event) => setName(event.target.value)} placeholder={defaultName} onKeyDown={(event) => { if (event.key === "Enter" && onCreate) { void onCreate(name.trim() || defaultName); setName(""); } }} /><ClusterButton type="button" className="" disabled={busy} onClick={() => { if (onCreate) void onCreate(name.trim() || defaultName); setName(""); }} variant="primary">{busy ? "Creating…" : `New ${kind === "boards" ? "board" : "whiteboard"}`}</ClusterButton></div>} />
      {status ? <div className="project-section-status-v312 neutral">{status}</div> : null}
      {resources.length ? <div className="project-resource-grid-v312">{resources.map((item) => <ClusterButton unstyled type="button" key={item.id} className="project-resource-card-v312" onClick={() => onOpen?.(item.id)} style={kind === "boards" ? runtimeStyle({ "--resource-accent": (item as BoardSummary).backgroundColor || project.color || "var(--cluster-blue-400)" }) : undefined}><span className="project-resource-icon-v312" aria-hidden="true"><ClusterIcon name={kind === "boards" ? "grid" : "project"} treatment="duotone" /></span><div><strong>{item.name}</strong><p>{item.description || (kind === "boards" ? "Project board" : "Planning canvas")}</p><footer><span>{kind === "boards" ? `${(item as BoardSummary).lists?.length || 0} lists` : `${(item as WhiteboardSummary).canvasWidth || 0} × ${(item as WhiteboardSummary).canvasHeight || 0}`}</span><span>{item.updatedAt ? `Updated ${formatRelativeTime(item.updatedAt)}` : "Ready"}</span></footer></div><em>Open</em></ClusterButton>)}</div> : <ProjectEmptyState title={`No ${kind} yet`} description={kind === "boards" ? "Create a delivery board for tasks, milestones, and ownership." : "Create a canvas for diagrams, references, and collaborative planning."} action={<ClusterButton type="button" className="" onClick={() => { if (onCreate) void onCreate(defaultName); }} variant="primary">Create {kind === "boards" ? "board" : "whiteboard"}</ClusterButton>} />}
    </section>
  );
}
