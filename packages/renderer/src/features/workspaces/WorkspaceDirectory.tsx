import { useMemo, useState, type ReactNode } from "react";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterIcon, type ClusterIconName } from "../../components/ClusterIcon";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import "./workspace-directory.css";

export type WorkspaceDirectoryItem = { id: string; name: string; projectName?: string | null; detail?: string | null; count?: number | null };

/** One browser surface for both Board and Whiteboard resources; domain editors stay separate. */
export function WorkspaceDirectory({ kind, icon, items, onOpen, onCreate, creating = false, children }: {
  kind: "Boards" | "Whiteboards"; icon: ClusterIconName; items: WorkspaceDirectoryItem[];
  onOpen: (id: string) => void; onCreate: () => void; creating?: boolean; children?: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const [project, setProject] = useState("all");
  const [view, setView] = useState<"grid" | "list">("grid");
  const projects = useMemo(() => Array.from(new Set(items.map((item) => item.projectName).filter((name): name is string => Boolean(name)))).sort(), [items]);
  const filtered = useMemo(() => items.filter((item) => {
    const match = !query.trim() || [item.name, item.projectName, item.detail].some((part) => (part || "").toLowerCase().includes(query.trim().toLowerCase()));
    return match && (project === "all" || item.projectName === project);
  }), [items, project, query]);
  return <main className="cluster-workspace-directory-v28 page" aria-label={`${kind} browser`}>
    <header className="workspace-directory-header-v28">
      <div><ClusterIcon name={icon} /><h1>{kind}</h1><span>{items.length}</span></div>
      <ClusterButton variant="primary" onClick={onCreate}><ClusterIcon name="plus" /> New {kind === "Boards" ? "board" : "whiteboard"}</ClusterButton>
    </header>
    {creating && <section className="workspace-directory-creator-v28" aria-label={`Create ${kind === "Boards" ? "board" : "whiteboard"}`}>{children}</section>}
    <div className="workspace-directory-filters-v28">
      <ClusterTextInput type="search" aria-label={`Search ${kind.toLowerCase()}`} placeholder={`Search ${kind.toLowerCase()}`} value={query} onChange={(event) => setQuery(event.target.value)} />
      <select aria-label="Filter project" value={project} onChange={(event) => setProject(event.target.value)}><option value="all">All projects</option>{projects.map((name) => <option key={name} value={name}>{name}</option>)}</select>
      <div className="workspace-directory-view-v28" aria-label="Layout"><ClusterButton size="compact" variant="quiet" selected={view === "grid"} onClick={() => setView("grid")} aria-label="Grid"><ClusterIcon name="project" /></ClusterButton><ClusterButton size="compact" variant="quiet" selected={view === "list"} onClick={() => setView("list")} aria-label="List"><ClusterIcon name="list" /></ClusterButton></div>
    </div>
    {filtered.length ? <div className={`workspace-directory-results-v28 is-${view}`}>
      {filtered.map((item) => <ClusterButton unstyled type="button" key={item.id} className="workspace-directory-item-v28" onClick={() => onOpen(item.id)}>
        <span className="workspace-directory-icon-v28"><ClusterIcon name={icon}/></span>
        <span className="workspace-directory-copy-v28"><strong>{item.name}</strong><small>{item.projectName || "Studio"}</small></span>
        {typeof item.count === "number" && <span className="workspace-directory-count-v28">{item.count}</span>}
        <ClusterIcon name="chevron-right" />
      </ClusterButton>)}
    </div> : <div className="workspace-directory-empty-v28"><ClusterIcon name={icon}/><strong>{items.length ? "No matches" : `No ${kind.toLowerCase()} yet`}</strong><span>{items.length ? "Try another search or project." : "Create one to get started."}</span></div>}
  </main>;
}
