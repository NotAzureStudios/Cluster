import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../../core/api";
import { renderMarkdown, toggleMarkdownCheck } from "../../core/markdown";
import { ClusterButton, ClusterIconButton } from "../../components/ClusterButton";
import { ClusterIcon } from "../../components/ClusterIcon";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import type { LibraryItem } from "../library/library-types";
import "./notes.css";

export type NoteDoc = { id: string; title: string; body: string; revision: number; updatedAt?: string };
type SaveState = "loading" | "saved" | "dirty" | "saving" | "conflict" | "error";

const toDoc = (item: LibraryItem & { body?: string | null }): NoteDoc => ({ id: item.id, title: item.title, body: item.body || "", revision: Number(item.revision || 0), updatedAt: item.updatedAt });

/**
 * One Markdown note from the Library: Write / Read, formatting, autosave with
 * conflict detection, checklists you can tick while reading. Mount with
 * key={id}; pending edits are saved when it unmounts.
 */
export function NoteDocument({ id, canEdit, autoFocusTitle = false, onChange, onDelete, onClose, closeIcon = "chevron-left", closeLabel = "Back", className = "" }: {
  id: string;
  canEdit: boolean;
  autoFocusTitle?: boolean;
  onChange?: (doc: NoteDoc) => void;
  onDelete?: () => void;
  onClose?: () => void;
  closeIcon?: "chevron-left" | "close";
  closeLabel?: string;
  className?: string;
}) {
  const [doc, setDoc] = useState<NoteDoc | null>(null);
  const [mode, setMode] = useState<"write" | "read">("write");
  const [save, setSave] = useState<SaveState>("loading");
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const editor = useRef<HTMLTextAreaElement | null>(null);
  const timer = useRef<number | null>(null);
  const latest = useRef<NoteDoc | null>(null);
  latest.current = doc;
  const changeRef = useRef(onChange);
  changeRef.current = onChange;

  async function load() {
    try {
      const item = await api<LibraryItem & { body?: string | null }>(`/api/library/${id}`);
      setDoc(toDoc(item)); setSave("saved"); setError("");
      if (autoFocusTitle) window.setTimeout(() => document.querySelector<HTMLInputElement>(`[data-note-id="${id}"] .pj-notes__title input`)?.select(), 60);
    } catch (reason) { setSave("error"); setError(reason instanceof Error ? reason.message : "That note could not be opened."); }
  }
  useEffect(() => { void load(); }, [id]);

  async function persist(next: NoteDoc) {
    setSave("saving");
    try {
      const saved = await api<LibraryItem>(`/api/library/${next.id}`, { method: "PATCH", body: JSON.stringify({ title: next.title.trim() || "Untitled", body: next.body, expectedRevision: next.revision }) });
      const revision = Number(saved.revision || next.revision + 1);
      // Keep typing that happened while saving; only adopt the new revision.
      setDoc((current) => current && current.id === next.id ? { ...current, revision, updatedAt: saved.updatedAt } : current);
      if (latest.current) latest.current = { ...latest.current, revision };
      const stillDirty = latest.current?.id === next.id && (latest.current.title !== next.title || latest.current.body !== next.body);
      setSave(stillDirty ? "dirty" : "saved");
      if (stillDirty) schedule();
      changeRef.current?.({ ...next, title: next.title.trim() || "Untitled", revision, updatedAt: saved.updatedAt });
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

  function edit(patch: Partial<Pick<NoteDoc, "title" | "body">>) {
    if (!doc || !canEdit) return;
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
    if (!doc || !onDelete) return;
    if (!confirmDelete) { setConfirmDelete(true); return; }
    try {
      if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
      await api("/api/library/bulk", { method: "POST", body: JSON.stringify({ ids: [doc.id], action: "trash", expectedRevisions: { [doc.id]: doc.revision } }) });
      onDelete();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The note was not moved to Trash."); setConfirmDelete(false); }
  }

  const saveLabel = save === "loading" ? "Opening…" : save === "saving" ? "Saving…" : save === "dirty" ? "Edited" : save === "conflict" ? "Changed elsewhere" : save === "error" ? "Not saved" : "Saved";

  return <article className={`pj-notes__doc ${className}`.trim()} data-note-id={id}>
    <header className="pj-notes__bar">
      {onClose ? <ClusterIconButton size="compact" className={closeIcon === "close" ? undefined : "pj-notes__back"} label={closeLabel} onClick={() => { void flush(); onClose(); }}><ClusterIcon name={closeIcon} /></ClusterIconButton> : null}
      <div className="pj-notes__modes" role="tablist" aria-label="Note view">
        <button type="button" role="tab" aria-selected={mode === "write"} onClick={() => setMode("write")}>Write</button>
        <button type="button" role="tab" aria-selected={mode === "read"} onClick={() => { void flush(); setMode("read"); }}>Read</button>
      </div>
      {mode === "write" && canEdit ? <div className="pj-notes__tools" aria-label="Formatting">
        <button type="button" title="Heading" onClick={() => format("h")}>H</button>
        <button type="button" title="Bold" onClick={() => format("b")}><b>B</b></button>
        <button type="button" title="Italic" onClick={() => format("i")}><i>I</i></button>
        <button type="button" title="List" onClick={() => format("list")}><ClusterIcon name="list" /></button>
        <button type="button" title="Checklist" onClick={() => format("check")}><ClusterIcon name="check" /></button>
        <button type="button" title="Link" onClick={() => format("link")}><ClusterIcon name="link" /></button>
        <button type="button" title="Code" onClick={() => format("code")}><ClusterIcon name="code" /></button>
      </div> : null}
      <span className="pj-notes__state" data-state={save}>{saveLabel}</span>
      {save === "conflict" ? <ClusterButton size="compact" variant="secondary" onClick={() => void load()}>Reload</ClusterButton> : null}
      {canEdit && onDelete && doc ? <ClusterButton size="compact" variant={confirmDelete ? "danger" : "quiet"} onClick={() => void remove()} onBlur={() => setConfirmDelete(false)} aria-label="Move note to Trash">{confirmDelete ? "Move to Trash?" : <ClusterIcon name="trash" />}</ClusterButton> : null}
    </header>
    {error ? <p className="pj-work__error" role="alert">{error}</p> : null}
    {!doc ? <p className="pv-empty">{save === "error" ? "" : "Opening…"}</p> : <>
      <div className="pj-notes__title"><ClusterTextInput value={doc.title} readOnly={!canEdit} onChange={(event) => edit({ title: event.target.value })} placeholder="Untitled" aria-label="Note title"
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); document.querySelector<HTMLTextAreaElement>(`[data-note-id="${id}"] textarea`)?.focus(); } }} /></div>
      {mode === "write" && canEdit
        ? <textarea ref={editor} className="pj-notes__editor" value={doc.body} spellCheck onChange={(event) => edit({ body: event.target.value })} placeholder="Start writing… Markdown works: # heading, **bold**, - [ ] task" aria-label="Note text"
            onKeyDown={(event) => {
              const mod = event.metaKey || event.ctrlKey;
              if (mod && event.key.toLowerCase() === "b") { event.preventDefault(); format("b"); }
              else if (mod && event.key.toLowerCase() === "i") { event.preventDefault(); format("i"); }
              else if (mod && event.key.toLowerCase() === "s") { event.preventDefault(); void flush(); }
            }} />
        : <div className="pj-notes__read">{doc.body.trim() ? renderMarkdown(doc.body, canEdit ? (line) => edit({ body: toggleMarkdownCheck(doc.body, line) }) : undefined) : <p className="pv-empty">Empty note.</p>}</div>}
    </>}
  </article>;
}
