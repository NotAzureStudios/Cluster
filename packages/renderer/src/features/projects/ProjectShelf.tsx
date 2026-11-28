import { useCallback, useEffect, useRef, useState } from "react";
import { openLinkedLibraryItem } from "../library/library-linked-items";
import { FormItemModal } from "../forms/FormEditor";
import { api, API_URL } from "../../core/api";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterIcon, type ClusterIconName } from "../../components/ClusterIcon";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { libraryFileUrl } from "../library/library-file-url";
import type { LibraryItem } from "../library/library-types";
import type { Project } from "../application/application-models";
import { ProjectFileDropZone } from "./ProjectOverviewWorkbench";
import { ensureProjectSubfolder, findProjectSubfolder, listLibraryFolder } from "./project-subfolders";
import "./project-shelf.css";

export type ProjectShelfKind = "media" | "references";

const SHELF: Record<ProjectShelfKind, { title: string; source: string; accept: string; empty: string }> = {
  media: { title: "Media", source: "project-media", accept: "image/*,video/*,audio/*,.fbx,.glb,.gltf,.obj,.usd,.usdz", empty: "Drop images, video, audio or models." },
  references: { title: "References", source: "project-references", accept: "", empty: "Drop reference images and documents, or add a link." },
};


function iconFor(item: LibraryItem): ClusterIconName {
  if (item.previewKind === "video") return "video";
  if (item.previewKind === "audio") return "audio";
  if (item.previewKind === "pdf" || item.previewKind === "document" || item.previewKind === "text") return "file";
  if (item.externalUrl) return "link";
  if (item.type === "board") return "grid";
  if (item.type === "whiteboard") return "palette";
  if (item.type === "form") return "list";
  if (item.type === "note") return "note";
  return "file";
}

function host(url?: string | null) {
  try { return url ? new URL(url).hostname.replace(/^www\./, "") : ""; } catch { return ""; }
}

/** A project's Media or References folder, shown as a visual grid. */
export function ProjectShelf({ project, kind, canContribute, onOpenLibrary }: { project: Project; kind: ProjectShelfKind; canContribute: boolean; onOpenLibrary?: (id: string) => void }) {
  const shelf = SHELF[kind];
  const [folderId, setFolderId] = useState<string | null>(null);
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [error, setError] = useState("");
  const [formOpenId, setFormOpenId] = useState<string | null>(null);
  const [link, setLink] = useState<{ url: string; title: string } | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const uploadRef = useRef<((files: File[]) => void) | null>(null);
  const scope = useRef("");
  scope.current = `${project.id}:${kind}`;

  const findFolder = useCallback(() => findProjectSubfolder(project, shelf), [project.libraryFolderId, shelf]);

  const load = useCallback(async () => {
    const key = `${project.id}:${kind}`;
    try {
      const folder = await findFolder();
      const items = folder ? await listLibraryFolder(folder.id) : [];
      if (scope.current !== key) return;
      setFolderId(folder?.id || null);
      setItems(items);
      setError("");
    } catch (reason) {
      if (scope.current === key) { setItems([]); setError(reason instanceof Error ? reason.message : `${shelf.title} could not be loaded.`); }
    }
  }, [findFolder, project.id, kind, shelf.title]);
  useEffect(() => { setItems(null); setFolderId(null); setLink(null); void load(); }, [load]);

  // The folder is made the first time something is added.
  async function ensureFolder() {
    if (folderId) return folderId;
    const id = await ensureProjectSubfolder(project, shelf);
    setFolderId(id);
    return id;
  }

  async function addLink() {
    const url = link?.url.trim();
    if (!url) return;
    try {
      const parentId = await ensureFolder();
      await api("/api/library", { method: "POST", body: JSON.stringify({ title: link?.title.trim() || host(url) || url, type: "link", externalUrl: /^https?:\/\//i.test(url) ? url : `https://${url}`, parentId, projectId: project.id }) });
      setLink(null);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "That link was not added."); }
  }

  if (!project.libraryFolderId) return <p className="pv-empty">This project has no Library folder.</p>;
  const count = items?.length || 0;

  return <>{formOpenId ? <FormItemModal formId={formOpenId} onClose={() => { setFormOpenId(null); void load(); }} /> : null}<ProjectFileDropZone project={project} enabled={canContribute} label={shelf.title} resolveFolder={ensureFolder} uploadRef={uploadRef} onUploaded={load}>
    <section className="pj-shelf" data-kind={kind}>
      <header className="pj-shelf__head">
        <h2>{shelf.title}{count ? <small>{count}</small> : null}</h2>
        {canContribute ? <>
          {kind === "references" && !link ? <ClusterButton size="compact" variant="quiet" onClick={() => setLink({ url: "", title: "" })}><ClusterIcon name="link" />Add link</ClusterButton> : null}
          <ClusterButton size="compact" variant="primary" onClick={() => fileInput.current?.click()}><ClusterIcon name="upload" />Upload</ClusterButton>
          <input ref={fileInput} type="file" multiple hidden accept={shelf.accept || undefined} onChange={(event) => {
            const files = Array.from(event.target.files || []);
            event.target.value = "";
            if (files.length) uploadRef.current?.(files);
          }} />
        </> : null}
        {folderId ? <ClusterButton size="compact" variant="quiet" onClick={() => onOpenLibrary?.(folderId)}>Open in Library</ClusterButton> : null}
      </header>
      {link ? <form className="pv-quick pj-shelf__link" onSubmit={(event) => { event.preventDefault(); void addLink(); }}>
        <ClusterTextInput autoFocus value={link.url} placeholder="https://" aria-label="Link" onChange={(event) => setLink({ ...link, url: event.target.value })} onKeyDown={(event) => { if (event.key === "Escape") setLink(null); }} />
        <ClusterTextInput value={link.title} placeholder="Title (optional)" aria-label="Link title" onChange={(event) => setLink({ ...link, title: event.target.value })} />
        <ClusterButton type="submit" size="compact" variant="primary" disabled={!link.url.trim()}>Add</ClusterButton>
        <ClusterButton type="button" size="compact" variant="quiet" onClick={() => setLink(null)}>Cancel</ClusterButton>
      </form> : null}
      {error ? <p className="pj-work__error" role="alert">{error}</p> : null}
      {items === null ? <p className="pv-empty">Loading…</p> : items.length ? <ul className="pj-shelf__grid">{items.map((item) => {
        const url = libraryFileUrl(item);
        const thumb = item.previewKind === "image" && url ? <img src={url} alt="" loading="lazy" decoding="async" />
          : item.previewKind === "video" && url ? <video src={`${url}#t=0.5`} preload="metadata" muted playsInline />
          : item.previewKind === "model" ? <img src={`${API_URL}/api/library/${item.id}/model-thumbnail`} alt="" loading="lazy" onError={(event) => { event.currentTarget.style.display = "none"; }} />
          : <span className="pj-shelf__glyph"><ClusterIcon name={iconFor(item)} /></span>;
        return <li key={item.id} data-preview={item.previewKind}>
          <button type="button" className="pj-shelf__tile" onClick={() => item.type === "link" && item.externalUrl ? window.open(item.externalUrl, "_blank", "noopener") : openLinkedLibraryItem(item, setFormOpenId) || onOpenLibrary?.(item.id)}>
            <span className="pj-shelf__thumb">{thumb}{item.previewKind === "video" ? <i className="pj-shelf__badge"><ClusterIcon name="play" /></i> : null}</span>
            <span className="pj-shelf__caption"><strong>{item.title}</strong><small>{item.externalUrl ? host(item.externalUrl) : item.snippet && kind === "references" ? item.snippet : (item.extension || item.previewKind || "").toString().toUpperCase()}</small></span>
          </button>
        </li>;
      })}</ul> : <div className="pj-shelf__empty">
        <ClusterIcon name={kind === "media" ? "image" : "link"} />
        <p>{shelf.empty}</p>
        {canContribute ? <ClusterButton size="compact" variant="secondary" onClick={() => fileInput.current?.click()}>Choose files</ClusterButton> : null}
      </div>}
    </section>
  </ProjectFileDropZone></>;
}
