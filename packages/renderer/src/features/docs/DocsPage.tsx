import { useEffect, useState } from "react";
import { api } from "../../core/api";
import { formatRelativeTime } from "../../core/format";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterIcon } from "../../components/ClusterIcon";
import { NoteDocument } from "../notes/NoteDocument";
import "../notes/notes.css";
import "./docs.css";

type DocItem = { id: string; title: string; snippet?: string | null; updatedAt: string; project?: { id: string; name: string } | null };
const plain = (text?: string | null) => (text || "").replace(/\[[ xX]\]/g, "").replace(/[#*_>`~]|^\s*-\s/gm, "").replace(/\s+/g, " ").trim();

/** Docs: every document in the studio, newest first, edited in place. Each
 *  doc is a Library note, so search, sharing, versions and trash come free. */
export function DocsPage() {
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [query, setQuery] = useState("");
  const [openId, setOpenId] = useState<string | null>(() => new URLSearchParams(window.location.search).get("doc"));
  const [error, setError] = useState("");
  const [freshId, setFreshId] = useState<string | null>(null);

  async function load(q = query) {
    try {
      const params = new URLSearchParams({ scope: "all", type: "note", sort: "updated-desc", limit: "100", includeContext: "0", q });
      const result = await api<{ items: DocItem[] }>(`/api/library/workspace?${params}`);
      setDocs(result.items || []); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Docs are unavailable."); }
  }
  useEffect(() => { const timer = window.setTimeout(() => void load(query), query ? 200 : 0); return () => window.clearTimeout(timer); }, [query]);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (openId) url.searchParams.set("doc", openId); else url.searchParams.delete("doc");
    window.history.replaceState(window.history.state, "", url);
  }, [openId]);

  async function create() {
    try {
      const item = await api<DocItem>("/api/library", { method: "POST", body: JSON.stringify({ title: "Untitled", type: "note", body: "" }) });
      setDocs((current) => [item, ...current]); setFreshId(item.id); setQuery(""); setOpenId(item.id);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The doc wasn't created."); }
  }

  return <main className="docs" aria-label="Docs">
    <aside className="docs-list" data-hidden={openId ? "narrow" : undefined}>
      <header className="docs-list__head">
        <h1>Docs</h1>
        <ClusterButton size="compact" variant="primary" onClick={() => void create()}><ClusterIcon name="plus" /> New</ClusterButton>
      </header>
      <input className="docs-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search docs" aria-label="Search docs" />
      <div className="docs-items">
        {docs.map((doc) => <ClusterButton unstyled type="button" key={doc.id} className={`docs-item ${doc.id === openId ? "is-active" : ""}`} onClick={() => setOpenId(doc.id)}>
          <strong>{doc.title || "Untitled"}</strong>
          <span>{plain(doc.snippet) || "Empty"}</span>
          <small>{formatRelativeTime(doc.updatedAt)}{doc.project ? ` · ${doc.project.name}` : ""}</small>
        </ClusterButton>)}
        {!docs.length && !error ? <p className="docs-empty">{query ? "No matches." : "No docs yet."}</p> : null}
        {error ? <p className="docs-empty" role="alert">{error}</p> : null}
      </div>
    </aside>
    <section className="docs-editor">
      {openId ? <NoteDocument key={openId} id={openId} canEdit autoFocusTitle={openId === freshId}
        onChange={(doc: any) => setDocs((current) => current.map((item) => item.id === doc.id ? { ...item, title: doc.title, snippet: doc.body, updatedAt: new Date().toISOString() } : item))}
        onDelete={() => { setOpenId(null); void load(); }} onClose={() => setOpenId(null)} closeIcon="close" closeLabel="Close" />
        : <div className="docs-blank"><ClusterIcon name="note" /><p>Open a doc or start a new one.</p><ClusterButton variant="primary" onClick={() => void create()}>New doc</ClusterButton></div>}
    </section>
  </main>;
}
