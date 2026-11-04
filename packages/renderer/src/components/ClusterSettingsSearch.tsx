import { useId, useMemo, useState, type KeyboardEvent } from "react";
import { findClusterSettings, type ClusterSettingsSearchEntry } from "./cluster-settings-search";
import "./cluster-settings-search.css";

/** A reusable section/field locator that never persists drafts or mutates preferences. */
export function ClusterSettingsSearch<Id extends string>({
  label = "Search settings",
  entries,
  onNavigate,
  className = "",
}: {
  label?: string;
  entries: readonly ClusterSettingsSearchEntry<Id>[];
  onNavigate: (entry: ClusterSettingsSearchEntry<Id>) => void;
  className?: string;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const results = useMemo(() => findClusterSettings(entries, query), [entries, query]);
  const visible = expanded && Boolean(query.trim());
  const listId = id + "-results";
  const active = visible && results.length ? Math.max(0, Math.min(activeIndex, results.length - 1)) : -1;

  function choose(entry: ClusterSettingsSearchEntry<Id>) {
    setExpanded(false);
    setQuery("");
    setActiveIndex(0);
    setAnnouncement("Showing " + entry.label + " settings.");
    onNavigate(entry);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      if (visible) { event.preventDefault(); setExpanded(false); }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!query.trim()) return;
      event.preventDefault();
      setExpanded(true);
      setActiveIndex((old) => results.length
        ? (Math.max(0, Math.min(old, results.length - 1)) + (event.key === "ArrowDown" ? 1 : results.length - 1)) % results.length
        : 0);
      return;
    }
    if (event.key === "Enter" && visible && active >= 0) {
      event.preventDefault();
      choose(results[active]);
    }
  }

  return <div className={("cluster-settings-search-v11 " + className).trim()}>
    <label htmlFor={id}>{label}</label>
    <div className="cluster-settings-search-field-v11">
      <input
        id={id} type="search" autoComplete="off" placeholder="Find a setting or control…"
        value={query} role="combobox" aria-autocomplete="list" aria-controls={listId}
        aria-expanded={visible}
        aria-activedescendant={active >= 0 ? id + "-option-" + active : undefined}
        onFocus={() => setExpanded(true)}
        onBlur={(event) => {
          if (!event.currentTarget.parentElement?.parentElement?.contains(event.relatedTarget as Node)) setExpanded(false);
        }}
        onKeyDown={onKeyDown}
        onChange={(event) => { setQuery(event.target.value); setExpanded(true); setActiveIndex(0); }}
      />
      <span className="cluster-settings-search-symbol-v11" aria-hidden="true">⌕</span>
    </div>
    <span className="cluster-settings-search-announcement-v11" role="status" aria-live="polite">{announcement}</span>
    {visible && <div className="cluster-settings-search-results-v11">
      <span className="cluster-settings-search-count-v11" role="status">
        {results.length ? results.length + (results.length === 1 ? " result" : " results") : "No matching settings"}
      </span>
      <div id={listId} role="listbox" aria-label="Matching settings">
        {results.map((entry, index) => <button
          key={entry.id} type="button" role="option" id={id + "-option-" + index}
          tabIndex={-1} aria-selected={active === index}
          data-active={active === index ? "true" : "false"}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => choose(entry)}
        >
          <strong>{entry.label}</strong>
          <span>{entry.description || entry.section}</span>
        </button>)}
      </div>
    </div>}
  </div>;
}
