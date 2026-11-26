import { useEffect, useRef, useState } from "react";
import { api } from "../../core/api";
import { formatRelativeTime } from "../../core/format";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterIcon } from "../../components/ClusterIcon";
import { ClusterTextArea } from "../../components/ClusterTextArea";
import type { Project } from "../application/application-models";

// Overview working area: shared project notes beside the newest files.
export function ProjectOverviewWorkbench({ project, canEdit, onSaved, onOpenFiles, onOpenLibrary }: {
  project: Project;
  canEdit: boolean;
  onSaved: () => Promise<void> | void;
  onOpenFiles: () => void;
  onOpenLibrary?: (id: string) => void;
}) {
  const saved = project.description || "";
  const [notes, setNotes] = useState(saved);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const dirty = useRef(false);
  useEffect(() => { if (!dirty.current) setNotes(saved); }, [saved]);

  async function save() {
    if (!dirty.current || notes === saved) { dirty.current = false; return; }
    setState("saving");
    try {
      await api(`/api/projects/${project.id}`, { method: "PATCH", body: JSON.stringify({ description: notes.trim() ? notes : null }) });
      dirty.current = false;
      setState("saved");
      await onSaved();
    } catch {
      setState("error");
    }
  }

  useEffect(() => {
    if (!dirty.current) return;
    const timer = window.setTimeout(() => void save(), 1500);
    return () => window.clearTimeout(timer);
  }, [notes]);

  const files = (project.libraryItems || []).filter((item) => item.id !== project.libraryFolderId && item.type !== "folder")
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))).slice(0, 8);

  return <div className="pj-bench">
    <section className="pv-card pj-notes">
      <header><h3>Notes</h3><small className="pj-bench__state">{state === "saving" ? "Saving…" : state === "saved" ? "Saved" : state === "error" ? "Not saved" : ""}</small></header>
      <ClusterTextArea value={notes} readOnly={!canEdit} placeholder={canEdit ? "Decisions, links, to-dos…" : "No notes yet."}
        aria-label="Project notes"
        onChange={(event) => { dirty.current = true; setState("idle"); setNotes(event.target.value); }}
        onBlur={() => void save()} />
    </section>
    <section className="pv-card pj-recent">
      <header><h3>Recent files</h3>{project.libraryFolderId ? <ClusterButton type="button" size="compact" variant="quiet" onClick={onOpenFiles}>All files</ClusterButton> : null}</header>
      {files.length ? <ul>{files.map((item) => <li key={item.id}><ClusterButton unstyled type="button" onClick={() => onOpenLibrary?.(item.id)}>
        <ClusterIcon name="file" /><span>{item.title}</span><small>{item.updatedAt ? formatRelativeTime(item.updatedAt) : ""}</small>
      </ClusterButton></li>)}</ul> : <p className="pv-empty">{project.libraryFolderId ? "No files yet." : "No project folder."}</p>}
    </section>
  </div>;
}
