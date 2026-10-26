import { useMemo, useState } from "react";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterModal } from "../../components/ClusterModal";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { type AppScreen } from "../../core/navigation";
import { canNavigateFromHelp, searchHelpTopics, visibleHelpTopics } from "./contextual-help";
import "./contextual-help.css";

export function ClusterHelpDialog({ open, screen, onClose, canAccess, onNavigate, onOpenShortcuts }: {
  open: boolean; screen: AppScreen; onClose: () => void;
  canAccess: (screen: AppScreen) => boolean;
  onNavigate: (screen: AppScreen) => void;
  onOpenShortcuts: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<AppScreen | null>(null);
  const topics = useMemo(() => visibleHelpTopics(canAccess), [canAccess]);
  const results = searchHelpTopics(topics, query);
  const active = results.find((topic) => topic.screen === selected)
    || results.find((topic) => topic.screen === screen) || results[0] || null;
  return <ClusterModal open={open} onClose={onClose} labelledBy="cluster-help-title" className="modal panel cluster-help-dialog">
    <header className="modal-header">
      <div><p className="eyebrow">Cluster guidance</p><h2 id="cluster-help-title">Help & common tasks</h2></div>
      <ClusterButton type="button" variant="quiet" size="compact" onClick={onClose}>Close</ClusterButton>
    </header>
    <div className="cluster-help-search">
      <label htmlFor="cluster-help-filter">Find a tool or task</label>
      <ClusterTextInput id="cluster-help-filter" type="search" value={query} onChange={(event) => { setQuery(event.target.value); setSelected(null); }} placeholder="Search Help" autoFocus />
    </div>
    <div className="cluster-help-layout">
      <nav className="cluster-help-topics" aria-label="Help topics">
        {results.map((topic) => <ClusterButton unstyled type="button" key={topic.screen} aria-current={active?.screen === topic.screen ? "page" : undefined} className={active?.screen === topic.screen ? "active" : ""} onClick={() => setSelected(topic.screen)}>{topic.title}</ClusterButton>)}
        {!results.length && <span>No matching topics. Try fewer words.</span>}
      </nav>
      <section className="cluster-help-article" aria-live="polite">
        {active && <>
          <h3>{active.title}</h3><p>{active.purpose}</p>
          <h4>Common tasks</h4><ul>{active.tasks.map((task) => <li key={task}>{task}</li>)}</ul>
          <h4>If something isn't working</h4><p>{active.recovery}</p>
          <p className="cluster-help-note">For studio-specific instructions, use the Packets knowledge base. This guide works offline and does not change permissions.</p>
          {canNavigateFromHelp(active.screen, canAccess) && <ClusterButton type="button" variant="secondary" size="compact" onClick={() => { if (canNavigateFromHelp(active.screen, canAccess)) onNavigate(active.screen); }}>Open {active.title}</ClusterButton>}
        </>}
      </section>
    </div>
    <footer className="cluster-help-footer"><ClusterButton type="button" variant="quiet" onClick={onOpenShortcuts}>Keyboard shortcuts</ClusterButton></footer>
  </ClusterModal>;
}
