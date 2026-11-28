import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openLinkedLibraryItem } from "../library/library-linked-items";
import { FormItemModal } from "../forms/FormEditor";
import { NoteDocument } from "../notes/NoteDocument";
import { api, API_URL } from "../../core/api";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterIcon, type ClusterIconName } from "../../components/ClusterIcon";
import { ClusterModal } from "../../components/ClusterModal";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterActionMenu } from "../../components/ClusterContextActions";
import { libraryFileUrl } from "../library/library-file-url";
import type { LibraryItem } from "../library/library-types";
import type { Project } from "../application/application-models";
import { ProjectFileDropZone } from "./ProjectOverviewWorkbench";
import { ensureProjectSubfolder, findProjectSubfolder, listLibraryFolder, type ProjectSubfolder } from "./project-subfolders";
import "./project-shelf.css";
import "../notes/notes.css";

// A project's Media tab reads three Library subfolders: uploads land in
// Media, notes in Notes and links in References.
const MEDIA: ProjectSubfolder = { source: "project-media", title: "Media" };
const NOTES: ProjectSubfolder = { source: "project-notes", title: "Notes" };
const REFERENCES: ProjectSubfolder = { source: "project-references", title: "References" };

type Filter = "all" | "visual" | "create" | "links" | "files";
const FILTERS: Array<[Filter, string]> = [["all", "All"], ["visual", "Photos & videos"], ["create", "Create suite"], ["links", "Links"], ["files", "Files"]];
const CREATE_SUITE = new Set(["note", "form", "board", "whiteboard"]);
const isLink = (item: LibraryItem) => Boolean(item.externalUrl) && !CREATE_SUITE.has(item.type);
const isVisual = (item: LibraryItem) => item.previewKind === "image" || item.previewKind === "video";
const matches: Record<Filter, (item: LibraryItem) => boolean> = {
  all: () => true,
  visual: isVisual,
  create: (item) => CREATE_SUITE.has(item.type),
  links: isLink,
  files: (item) => item.type === "file" && !isVisual(item),
};

function iconFor(item: LibraryItem): ClusterIconName {
  if (item.type === "board") return "grid";
  if (item.type === "whiteboard") return "palette";
  if (item.type === "form") return "list";
  if (item.type === "note") return "note";
  if (item.previewKind === "video") return "video";
  if (item.previewKind === "audio") return "audio";
  if (item.previewKind === "model") return "model";
  if (item.externalUrl) return "link";
  return "file";
}
const KIND_LABEL: Record<string, string> = { note: "Note", form: "Form", board: "Board", whiteboard: "Whiteboard" };
const plain = (text: string) => text.replace(/\[[ xX]\]/g, "").replace(/[#*_>`~-]/g, "").replace(/\s+/g, " ").trim().slice(0, 90);
function host(url?: string | null) {
  try { return url ? new URL(url).hostname.replace(/^www\./, "") : ""; } catch { return ""; }
}

/** Everything a project makes or collects, in one grid: photos, video,
 *  audio, models, Create suite items (notes, forms, boards, whiteboards)
 *  and links. Filters narrow it to one kind. */
export function ProjectMedia({ project, canContribute, canCreateForms, onOpenLibrary }: { project: Project; canContribute: boolean; canCreateForms: boolean; onOpenLibrary?: (id: string) => void }) {
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [mediaFolderId, setMediaFolderId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [error, setError] = useState("");
  const [noteId, setNoteId] = useState<{ id: string; fresh: boolean } | null>(null);
  const [formOpenId, setFormOpenId] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; title: string } | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const uploadRef = useRef<((files: File[]) => void) | null>(null);
  const scope = useRef(project.id);
  scope.current = project.id;

  const load = useCallback(async () => {
    const projectId = project.id;
    try {
      const folders = await Promise.all([MEDIA, NOTES, REFERENCES].map((folder) => findProjectSubfolder(project, folder)));
      const lists = await Promise.all(folders.map((folder) => folder ? listLibraryFolder(folder.id) : Promise.resolve([] as LibraryItem[])));
      if (scope.current !== projectId) return;
      setMediaFolderId(folders[0]?.id || null);
      setItems(lists.flat().filter((item) => item.type !== "folder").sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))));
      setError("");
    } catch (reason) {
      if (scope.current === projectId) { setItems([]); setError(reason instanceof Error ? reason.message : "Media could not be loaded."); }
    }
  }, [project.id, project.libraryFolderId]);
  useEffect(() => { setItems(null); setLink(null); setFilter("all"); void load(); }, [load]);

  const ensureMedia = async () => {
    if (mediaFolderId) return mediaFolderId;
    const id = await ensureProjectSubfolder(project, MEDIA);
    setMediaFolderId(id);
    return id;
  };

  async function create(body: Record<string, unknown>, folder: ProjectSubfolder) {
    const parentId = await ensureProjectSubfolder(project, folder);
    return api<LibraryItem>("/api/library", { method: "POST", body: JSON.stringify({ ...body, parentId, projectId: project.id }) });
  }
  async function newNote() {
    try { const item = await create({ title: "Untitled", type: "note", body: "" }, NOTES); setNoteId({ id: item.id, fresh: true }); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "The note was not created."); }
  }
  async function newForm() {
    try { const item = await create({ title: "Untitled form", type: "form" }, MEDIA); if (item.originRef) setFormOpenId(item.originRef); await load(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "The form was not created."); }
  }
  async function addLink() {
    const url = link?.url.trim();
    if (!url) return;
    try {
      await create({ title: link?.title.trim() || host(url) || url, type: "link", externalUrl: /^https?:\/\//i.test(url) ? url : `https://${url}` }, REFERENCES);
      setLink(null);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "That link was not added."); }
  }

  function open(item: LibraryItem) {
    if (item.type === "note") { setNoteId({ id: item.id, fresh: false }); return; }
    if (isLink(item) && item.externalUrl) { window.open(item.externalUrl, "_blank", "noopener"); return; }
    if (!openLinkedLibraryItem(item, setFormOpenId)) onOpenLibrary?.(item.id);
  }

  const counts = useMemo(() => Object.fromEntries(FILTERS.map(([id]) => [id, (items || []).filter(matches[id]).length])) as Record<Filter, number>, [items]);
  const shown = (items || []).filter(matches[filter]);

  if (!project.libraryFolderId) return <p className="pv-empty">This project has no Library folder.</p>;

  return <>
    {formOpenId ? <FormItemModal formId={formOpenId} onClose={() => { setFormOpenId(null); void load(); }} /> : null}
    {noteId ? <ClusterModal open onClose={() => { setNoteId(null); void load(); }} className="modal panel pj-media__note" ariaLabel="Note">
      <NoteDocument key={noteId.id} id={noteId.id} canEdit={canContribute} autoFocusTitle={noteId.fresh}
        onDelete={() => { setNoteId(null); void load(); }} onClose={() => { setNoteId(null); void load(); }} closeIcon="close" closeLabel="Close" />
    </ClusterModal> : null}
    <ProjectFileDropZone project={project} enabled={canContribute} label="Media" resolveFolder={ensureMedia} uploadRef={uploadRef} onUploaded={load}>
      <section className="pj-shelf pj-media">
        <header className="pj-shelf__head">
          <nav className="pj-media__filters" aria-label="Show">
            {FILTERS.map(([id, label]) => (id === "all" || counts[id] || filter === id) ? <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}{counts[id] ? <small>{counts[id]}</small> : null}</button> : null)}
          </nav>
          {canContribute ? <>
            <ClusterActionMenu label="New in Media" triggerLabel="New" icon="plus" align="end" items={[
              { id: "note", label: "Note", icon: "note", onSelect: () => void newNote() },
              ...(canCreateForms ? [{ id: "form", label: "Form", icon: "list" as const, onSelect: () => void newForm() }] : []),
              { id: "link", label: "Link", icon: "link", onSelect: () => setLink({ url: "", title: "" }) },
            ]} />
            <ClusterButton size="compact" variant="primary" onClick={() => fileInput.current?.click()}><ClusterIcon name="upload" />Upload</ClusterButton>
            <input ref={fileInput} type="file" multiple hidden onChange={(event) => {
              const files = Array.from(event.target.files || []);
              event.target.value = "";
              if (files.length) uploadRef.current?.(files);
            }} />
          </> : null}
          {project.libraryFolderId ? <ClusterButton size="compact" variant="quiet" onClick={() => onOpenLibrary?.(project.libraryFolderId!)}>Open in Library</ClusterButton> : null}
        </header>
        {link ? <form className="pv-quick pj-shelf__link" onSubmit={(event) => { event.preventDefault(); void addLink(); }}>
          <ClusterTextInput autoFocus value={link.url} placeholder="https://" aria-label="Link" onChange={(event) => setLink({ ...link, url: event.target.value })} onKeyDown={(event) => { if (event.key === "Escape") setLink(null); }} />
          <ClusterTextInput value={link.title} placeholder="Title (optional)" aria-label="Link title" onChange={(event) => setLink({ ...link, title: event.target.value })} />
          <ClusterButton type="submit" size="compact" variant="primary" disabled={!link.url.trim()}>Add</ClusterButton>
          <ClusterButton type="button" size="compact" variant="quiet" onClick={() => setLink(null)}>Cancel</ClusterButton>
        </form> : null}
        {error ? <p className="pj-work__error" role="alert">{error}</p> : null}
        {items === null ? <p className="pv-empty">Loading…</p> : shown.length ? <ul className="pj-shelf__grid">{shown.map((item) => {
          const url = libraryFileUrl(item);
          const thumb = item.previewKind === "image" && url ? <img src={url} alt="" loading="lazy" decoding="async" />
            : item.previewKind === "video" && url ? <video src={`${url}#t=0.5`} preload="metadata" muted playsInline />
            : item.previewKind === "model" ? <img src={`${API_URL}/api/library/${item.id}/model-thumbnail`} alt="" loading="lazy" onError={(event) => { event.currentTarget.style.display = "none"; }} />
            : item.type === "note" && item.snippet ? <span className="pj-media__excerpt">{plain(item.snippet)}</span>
            : <span className="pj-shelf__glyph"><ClusterIcon name={iconFor(item)} /></span>;
          const detail = KIND_LABEL[item.type] || (isLink(item) ? host(item.externalUrl) : (item.extension || item.previewKind || "").toString().toUpperCase());
          return <li key={item.id} data-preview={item.previewKind} data-type={item.type}>
            <button type="button" className="pj-shelf__tile" onClick={() => open(item)}>
              <span className="pj-shelf__thumb">{thumb}{item.previewKind === "video" ? <i className="pj-shelf__badge"><ClusterIcon name="play" /></i> : null}</span>
              <span className="pj-shelf__caption"><strong>{item.title}</strong><small>{detail}</small></span>
            </button>
          </li>;
        })}</ul> : <div className="pj-shelf__empty">
          <p>{filter === "all" ? "Drop files here, or make a note, form or link." : "Nothing here yet."}</p>
          {canContribute && filter === "all" ? <ClusterButton size="compact" variant="secondary" onClick={() => fileInput.current?.click()}>Choose files</ClusterButton> : null}
        </div>}
      </section>
    </ProjectFileDropZone>
  </>;
}
