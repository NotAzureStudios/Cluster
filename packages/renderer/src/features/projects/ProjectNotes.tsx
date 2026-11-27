import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../core/api";
import { formatRelativeTime } from "../../core/format";
import { ClusterButton, ClusterIconButton } from "../../components/ClusterButton";
import { ClusterIcon } from "../../components/ClusterIcon";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import type { LibraryItem } from "../library/library-types";
import type { Project } from "../application/application-models";
import { NoteDocument } from "../notes/NoteDocument";
import { ensureProjectSubfolder, findProjectSubfolder, listLibraryFolder } from "./project-subfolders";

const NOTES = { source: "project-notes", title: "Notes" };
const plain = (text: string) => text.replace(/\[[ xX]\]/g, "").replace(/[#*_>`~-]/g, "").replace(/\s+/g, " ").trim().slice(0, 90);

/** Project documents: Markdown notes kept in the project's Notes folder. */
export function ProjectNotes({ project, canContribute }: { project: Project; canContribute: boolean }) {
  const [list, setList] = useState<LibraryItem[] | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const scope = useRef(project.id);
  scope.current = project.id;

  const loadList = useCallback(async () => {
    const projectId = project.id;
    try {
      const folder = await findProjectSubfolder(project, NOTES);
      const items = folder ? (await listLibraryFolder(folder.id)).filter((item) => item.type === "note") : [];
      if (scope.current === projectId) setList(items);
    } catch (reason) {
      if (scope.current === projectId) { setList([]); setError(reason instanceof Error ? reason.message : "Notes could not be loaded."); }
    }
  }, [project.id, project.libraryFolderId]);
  useEffect(() => { setList(null); setOpenId(null); setError(""); void loadList(); }, [loadList]);

  async function create() {
    try {
      const parentId = await ensureProjectSubfolder(project, NOTES);
      const item = await api<LibraryItem>("/api/library", { method: "POST", body: JSON.stringify({ title: "Untitled", type: "note", body: "", parentId, projectId: project.id }) });
      setFresh(item.id);
      setOpenId(item.id);
      await loadList();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The note was not created."); }
  }

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (list || []).filter((item) => !needle || `${item.title} ${item.snippet || ""}`.toLowerCase().includes(needle));
  }, [list, query]);

  if (!project.libraryFolderId) return <p className="pv-empty">This project has no Library folder.</p>;

  return <section className="pj-notes" data-open={openId ? "true" : undefined}>
    <aside className="pj-notes__list">
      <header>
        <ClusterTextInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search notes" aria-label="Search notes" />
        {canContribute ? <ClusterIconButton size="compact" label="New note" onClick={() => void create()}><ClusterIcon name="plus" /></ClusterIconButton> : null}
      </header>
      {error ? <p className="pj-work__error" role="alert">{error}</p> : null}
      {list === null ? <p className="pv-empty">Loading…</p> : shown.length ? <ul>{shown.map((item) => <li key={item.id}>
        <button type="button" aria-current={openId === item.id || undefined} onClick={() => setOpenId(item.id)}>
          <strong>{item.title}</strong>
          <small><span>{item.updatedAt ? formatRelativeTime(item.updatedAt) : ""}</span> {plain(item.snippet || "")}</small>
        </button>
      </li>)}</ul> : <div className="pj-notes__none">
        <p>{query ? "No matches." : "No notes yet."}</p>
        {canContribute && !query ? <ClusterButton size="compact" variant="primary" onClick={() => void create()}>New note</ClusterButton> : null}
      </div>}
    </aside>

    {openId ? <NoteDocument key={openId} id={openId} canEdit={canContribute} autoFocusTitle={fresh === openId}
      onChange={(doc) => setList((items) => items?.map((item) => item.id === doc.id ? { ...item, title: doc.title, snippet: doc.body.slice(0, 280), updatedAt: doc.updatedAt || item.updatedAt } : item) || items)}
      onDelete={() => { setOpenId(null); void loadList(); }}
      onClose={() => setOpenId(null)} closeLabel="All notes" />
      : <div className="pj-notes__empty"><ClusterIcon name="note" /><p>{list?.length ? "Pick a note." : "Write specs, meeting notes and docs here."}</p></div>}
  </section>;
}
