import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError } from "../../core/api";
import { formatRelativeTime } from "../../core/format";
import { renderMarkdown, toggleMarkdownCheck } from "../../core/markdown";
import { ClusterButton, ClusterIconButton } from "../../components/ClusterButton";
import { ClusterIcon } from "../../components/ClusterIcon";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import type { LibraryItem } from "../library/library-types";
import type { Project } from "../application/application-models";
import { ensureProjectSubfolder, findProjectSubfolder, listLibraryFolder } from "./project-subfolders";
import "./project-notes.css";

const NOTES = { source: "project-notes", title: "Notes" };
type Doc = { id: string; title: string; body: string; revision: number; updatedAt?: string };
type SaveState = "saved" | "dirty" | "saving" | "conflict" | "error";

const toDoc = (item: LibraryItem & { body?: string | null }): Doc => ({ id: item.id, title: item.title, body: item.body || "", revision: Number(item.revision || 0), updatedAt: item.updatedAt });

/** Project documents: Markdown notes kept in the project's Notes folder. */
export function ProjectNotes({ project, canContribute }: { project: Project; canContribute: boolean }) {
  const [list, setList] = useState<LibraryItem[] | null>(null);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [mode, setMode] = useState<"write" | "read">("write");
  const [save, setSave] = useState<SaveState>("saved");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const editor = useRef<HTMLTextAreaElement | null>(null);
  const timer = useRef<number | null>(null);
  const latest = useRef<Doc | null>(null);
  latest.current = doc;
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
  useEffect(() => { setList(null); setDoc(null); setError(""); void loadList(); }, [loadList]);

  async function open(id: string) {
    await flush();
    setConfirmDelete(false);
    try {
      const item = await api<LibraryItem & { body?: string | null }>(`/api/library/${id}`);
      setDoc(toDoc(item)); setSave("saved");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "That note could not be opened."); }
  }

  async function create() {
    await flush();
    try {
      const parentId = await ensureProjectSubfolder(project, NOTES);
      const item = await api<LibraryItem & { body?: string | null }>("/api/library", { method: "POST", body: JSON.stringify({ title: "Untitled", type: "note", body: "", parentId, projectId: project.id }) });
      setDoc(toDoc(item)); setSave("saved"); setMode("write");
      await loadList();
      window.setTimeout(() => document.querySelector<HTMLInputElement>(".pj-notes__title input")?.select(), 0);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The note was not created."); }
  }

  async function persist(next: Doc) {
    setSave("saving");
    try {
      const saved = await api<LibraryItem>(`/api/library/${next.id}`, { method: "PATCH", body: JSON.stringify({ title: next.title.trim() || "Untitled", body: next.body, expectedRevision: next.revision }) });
      // Keep typing that happened while saving; only adopt the new revision.
      setDoc((current) => current && current.id === next.id ? { ...current, revision: Number(saved.revision || current.revision + 1), updatedAt: saved.updatedAt } : current);
      const stillDirty = latest.current?.id === next.id && (latest.current.title !== next.title || latest.current.body !== next.body);
      setSave(stillDirty ? "dirty" : "saved");
      if (stillDirty) schedule();
      setList((items) => items?.map((item) => item.id === next.id ? { ...item, title: next.title.trim() || "Untitled", snippet: next.body.slice(0, 280), updatedAt: saved.updatedAt } : item) || items);
    } catch (reason) {
      setSave(reason instanceof ApiError && reason.status === 409 ? "conflict" : "error");
    }
  }

  function schedule() {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { timer.current = null; if (latest.current) void persist(latest.current); }, 700);
  }

  async function flush() {
    if (!timer.current) return;
    window.clearTimeout(timer.current);
    timer.current = null;
    if (latest.current) await persist(latest.current);
  }
  useEffect(() => () => { if (timer.current) { window.clearTimeout(timer.current); if (latest.current) void persist(latest.current); } }, []);

  function edit(patch: Partial<Pick<Doc, "title" | "body">>) {
    if (!doc || !canContribute) return;
    setDoc({ ...doc, ...patch });
    setSave("dirty");
    schedule();
  }

  // Wrap the selection (or insert at the cursor) with Markdown syntax.
  function format(kind: "h" | "b" | "i" | "list" | "check" | "link" | "code") {
    const area = editor.current;
    if (!doc || !area) return;
    const { selectionStart: start, selectionEnd: end, value } = area;
    const selected = value.slice(start, end);
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    let next = value;
    let caret = end;
    const wrap = (before: string, after = before, placeholder = "text") => {
      const body = selected || placeholder;
      next = value.slice(0, start) + before + body + after + value.slice(end);
      caret = start + before.length + body.length;
    };
    const prefix = (mark: string) => {
      next = value.slice(0, lineStart) + mark + value.slice(lineStart);
      caret = end + mark.length;
    };
    if (kind === "b") wrap("**");
    else if (kind === "i") wrap("*");
    else if (kind === "code") wrap("`");
    else if (kind === "link") wrap("[", "](https://)", "link");
    else if (kind === "h") prefix("## ");
    else if (kind === "list") prefix("- ");
    else prefix("- [ ] ");
    edit({ body: next });
    window.requestAnimationFrame(() => { area.focus(); area.setSelectionRange(caret, caret); });
  }

  async function remove() {
    if (!doc) return;
    if (!confirmDelete) { setConfirmDelete(true); return; }
    try {
      if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
      await api(`/api/library/${doc.id}`, { method: "DELETE" });
      setDoc(null); setConfirmDelete(false);
      await loadList();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The note was not deleted."); }
  }

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (list || []).filter((item) => !needle || `${item.title} ${item.snippet || ""}`.toLowerCase().includes(needle));
  }, [list, query]);
  const saveLabel = save === "saving" ? "Saving…" : save === "dirty" ? "Edited" : save === "conflict" ? "Changed elsewhere" : save === "error" ? "Not saved" : "Saved";

  if (!project.libraryFolderId) return <p className="pv-empty">This project has no Library folder.</p>;

  return <section className="pj-notes" data-open={doc ? "true" : undefined}>
    <aside className="pj-notes__list">
      <header>
        <ClusterTextInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search notes" aria-label="Search notes" />
        {canContribute ? <ClusterIconButton size="compact" label="New note" onClick={() => void create()}><ClusterIcon name="plus" /></ClusterIconButton> : null}
      </header>
      {error ? <p className="pj-work__error" role="alert">{error}</p> : null}
      {list === null ? <p className="pv-empty">Loading…</p> : shown.length ? <ul>{shown.map((item) => <li key={item.id}>
        <button type="button" aria-current={doc?.id === item.id || undefined} onClick={() => void open(item.id)}>
          <strong>{doc?.id === item.id ? (doc.title.trim() || "Untitled") : item.title}</strong>
          <small><span>{item.updatedAt ? formatRelativeTime(item.updatedAt) : ""}</span> {(doc?.id === item.id ? doc.body : item.snippet || "").replace(/\[[ xX]\]/g, "").replace(/[#*_>`~-]/g, "").replace(/\s+/g, " ").trim().slice(0, 90)}</small>
        </button>
      </li>)}</ul> : <div className="pj-notes__none">
        <p>{query ? "No matches." : "No notes yet."}</p>
        {canContribute && !query ? <ClusterButton size="compact" variant="primary" onClick={() => void create()}>New note</ClusterButton> : null}
      </div>}
    </aside>

    {doc ? <article className="pj-notes__doc">
      <header className="pj-notes__bar">
        <ClusterIconButton size="compact" className="pj-notes__back" label="All notes" onClick={() => { void flush(); setDoc(null); }}><ClusterIcon name="chevron-left" /></ClusterIconButton>
        <div className="pj-notes__modes" role="tablist" aria-label="Note view">
          <button type="button" role="tab" aria-selected={mode === "write"} onClick={() => setMode("write")}>Write</button>
          <button type="button" role="tab" aria-selected={mode === "read"} onClick={() => { void flush(); setMode("read"); }}>Read</button>
        </div>
        {mode === "write" && canContribute ? <div className="pj-notes__tools" aria-label="Formatting">
          <button type="button" title="Heading" onClick={() => format("h")}>H</button>
          <button type="button" title="Bold" onClick={() => format("b")}><b>B</b></button>
          <button type="button" title="Italic" onClick={() => format("i")}><i>I</i></button>
          <button type="button" title="List" onClick={() => format("list")}><ClusterIcon name="list" /></button>
          <button type="button" title="Checklist" onClick={() => format("check")}><ClusterIcon name="check" /></button>
          <button type="button" title="Link" onClick={() => format("link")}><ClusterIcon name="link" /></button>
          <button type="button" title="Code" onClick={() => format("code")}><ClusterIcon name="code" /></button>
        </div> : null}
        <span className="pj-notes__state" data-state={save}>{saveLabel}</span>
        {save === "conflict" ? <ClusterButton size="compact" variant="secondary" onClick={() => void open(doc.id)}>Reload</ClusterButton> : null}
        {canContribute ? <ClusterButton size="compact" variant={confirmDelete ? "danger" : "quiet"} onClick={() => void remove()} onBlur={() => setConfirmDelete(false)}>{confirmDelete ? "Delete?" : <ClusterIcon name="trash" />}</ClusterButton> : null}
      </header>
      <div className="pj-notes__title"><ClusterTextInput value={doc.title} readOnly={!canContribute} onChange={(event) => edit({ title: event.target.value })} placeholder="Untitled" aria-label="Note title" /></div>
      {mode === "write" && canContribute
        ? <textarea ref={editor} className="pj-notes__editor" value={doc.body} spellCheck onChange={(event) => edit({ body: event.target.value })} placeholder="Start writing… Markdown works: # heading, **bold**, - [ ] task" aria-label="Note text"
            onKeyDown={(event) => {
              const mod = event.metaKey || event.ctrlKey;
              if (mod && event.key.toLowerCase() === "b") { event.preventDefault(); format("b"); }
              else if (mod && event.key.toLowerCase() === "i") { event.preventDefault(); format("i"); }
              else if (mod && event.key.toLowerCase() === "s") { event.preventDefault(); void flush(); }
            }} />
        : <div className="pj-notes__read">{doc.body.trim() ? renderMarkdown(doc.body, canContribute ? (line) => edit({ body: toggleMarkdownCheck(doc.body, line) }) : undefined) : <p className="pv-empty">Empty note.</p>}</div>}
    </article> : <div className="pj-notes__empty"><ClusterIcon name="note" /><p>{list?.length ? "Pick a note." : "Write specs, meeting notes and docs here."}</p></div>}
  </section>;
}
