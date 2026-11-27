import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterIcon } from "../../components/ClusterIcon";
import { useState } from "react";
import { formatRelativeTime } from "../../core/format";
import { runtimeStyle } from "../../core/runtime-style";
import type { BoardSummary, Project, WhiteboardSummary } from "../application/application-models";
import { ProjectEmptyState } from "./ProjectWorkspacePrimitives";
import "./project-shelf.css";

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
  if (kind === "library") {
    // The project's files, newest first; the Library itself does the rest.
    const items = (project.libraryItems || []).filter((item) => item.id !== project.libraryFolderId)
      .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))).slice(0, 60);
    if (!project.libraryFolderId) return <section className="project-subpage-v312"><ProjectEmptyState title="No project folder" description="This project has no Library folder yet." /></section>;
    return <section className="project-subpage-v312 pj-files">
      <header className="pj-files__head"><strong>{items.length ? `${items.length} item${items.length === 1 ? "" : "s"}` : "Empty folder"}</strong><ClusterButton type="button" variant="primary" size="compact" onClick={() => onOpenLibrary?.(project.libraryFolderId!)}>Open in Library</ClusterButton></header>
      {items.length ? <ul className="pj-files__list">{items.map((item) => <li key={item.id}><ClusterButton unstyled type="button" onClick={() => onOpenLibrary?.(item.id)}>
        <ClusterIcon name={item.type === "folder" ? "folder" : "file"} /><span>{item.title}</span><small>{item.updatedAt ? formatRelativeTime(item.updatedAt) : ""}</small>
      </ClusterButton></li>)}</ul> : <p className="pj-files__empty">Drop files into the project folder in the Library to see them here.</p>}
    </section>;
  }

  return <ProjectSpaces project={project} boards={boards} whiteboards={whiteboards} onCreateBoard={kind === "boards" ? onCreate : undefined} onOpenBoard={onOpen} />;
}

/** The project's boards and whiteboards side by side, one tab. */
export function ProjectSpaces({ project, boards, whiteboards, onCreateBoard, onCreateWhiteboard, onOpenBoard, onOpenWhiteboard }: {
  project: Project;
  boards: BoardSummary[];
  whiteboards: WhiteboardSummary[];
  onCreateBoard?: (name: string) => Promise<void> | void;
  onCreateWhiteboard?: (name: string) => Promise<void> | void;
  onOpenBoard?: (id: string) => void;
  onOpenWhiteboard?: (id: string) => void;
}) {
  const [creating, setCreating] = useState<"board" | "whiteboard" | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  async function create() {
    const action = creating === "board" ? onCreateBoard : onCreateWhiteboard;
    if (!action) return;
    setBusy(true);
    try { await action(name.trim() || `${project.name} ${creating === "board" ? "Board" : "Whiteboard"}`); setCreating(null); setName(""); } finally { setBusy(false); }
  }
  const tile = (kind: "board" | "whiteboard", item: BoardSummary | WhiteboardSummary) => <li key={item.id}>
    <button type="button" className="pj-space" data-kind={kind} style={kind === "board" ? runtimeStyle({ "--space-accent": (item as BoardSummary).backgroundColor || project.color || "var(--accent)" }) : undefined} onClick={() => kind === "board" ? onOpenBoard?.(item.id) : onOpenWhiteboard?.(item.id)}>
      <span className="pj-space__art" aria-hidden="true"><ClusterIcon name={kind === "board" ? "grid" : "shapes"} /></span>
      <span className="pj-space__copy"><strong>{item.name}</strong><small>{[kind === "board" ? `${(item as BoardSummary).lists?.length || 0} lists` : "Whiteboard", item.updatedAt ? formatRelativeTime(item.updatedAt) : ""].filter(Boolean).join(" · ")}</small></span>
    </button>
  </li>;
  const group = (kind: "board" | "whiteboard", items: Array<BoardSummary | WhiteboardSummary>, canCreate: boolean) => <section className="pj-spaces__group">
    <header><h3>{kind === "board" ? "Boards" : "Whiteboards"}</h3>{items.length ? <span className="pv-count">{items.length}</span> : null}
      {canCreate ? <ClusterButton size="compact" variant="quiet" onClick={() => { setCreating(kind); setName(""); }}><ClusterIcon name="plus" />New</ClusterButton> : null}</header>
    {creating === kind ? <form className="pv-quick" onSubmit={(event) => { event.preventDefault(); void create(); }}>
      <ClusterTextInput autoFocus value={name} disabled={busy} placeholder={`${project.name} ${kind === "board" ? "Board" : "Whiteboard"}`} aria-label={`New ${kind} name`} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") setCreating(null); }} />
      <ClusterButton type="submit" size="compact" variant="primary" disabled={busy}>Create</ClusterButton>
      <ClusterButton type="button" size="compact" variant="quiet" onClick={() => setCreating(null)}>Cancel</ClusterButton>
    </form> : null}
    {items.length ? <ul className="pj-spaces__grid">{items.map((item) => tile(kind, item))}</ul> : creating === kind ? null : <p className="pv-empty">{kind === "board" ? "No boards." : "No whiteboards."}</p>}
  </section>;
  return <div className="pj-spaces">
    {group("board", boards, Boolean(onCreateBoard))}
    {group("whiteboard", whiteboards, Boolean(onCreateWhiteboard))}
  </div>;
}
