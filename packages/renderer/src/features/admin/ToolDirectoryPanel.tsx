import { useMemo, useState } from "react";
import {
  CLUSTER_APP_ROUTE_IDS, CLUSTER_APP_ROUTE_MANIFEST,
  CLUSTER_TOOL_PERMISSION_KEYS, CLUSTER_TOOL_PERMISSION_MANIFEST,
  type ClusterToolPermissionKey,
} from "@cluster/shared";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterIcon, type ClusterIconName } from "../../components/ClusterIcon";
import { openClusterWorkNavigation } from "../workflow/work-navigation";

/** Tool discovery is not a health monitor or a permission editor. Keep those
 * authoritative workflows in each workspace; never infer a runtime state
 * from a static route manifest. */
const GROUPS = ["Production", "Planning", "Resources", "Studio", "Platform"] as const;
type ToolGroup = (typeof GROUPS)[number];
const TOOL_GROUPS: Record<ClusterToolPermissionKey, ToolGroup> = {
  mywork: "Production", inbox: "Production", projects: "Production", boards: "Production",
  whiteboards: "Production", viewer: "Production", builds: "Production", qa: "Production", tickets: "Production",
  timeline: "Planning", calendar: "Planning", scheduler: "Planning",
  library: "Resources", packets: "Resources", inventory: "Resources", vault: "Resources", sourceControl: "Resources",
  integrations: "Studio", people: "Studio", activity: "Studio",
  settings: "Platform", serverConfig: "Platform",
};
const TOOL_ICONS: Record<ClusterToolPermissionKey, ClusterIconName> = {
  mywork: "work", inbox: "bell", projects: "project", boards: "grid", whiteboards: "palette",
  viewer: "video", builds: "code", qa: "check", tickets: "ticket", timeline: "timeline",
  calendar: "calendar", scheduler: "clock", library: "library", packets: "packet", inventory: "inventory",
  vault: "lock", sourceControl: "code", integrations: "link", people: "users", activity: "activity",
  settings: "settings", serverConfig: "tools",
};
export const BUILTIN_TOOL_DIRECTORY = CLUSTER_TOOL_PERMISSION_KEYS.map((id) => {
  const definition = CLUSTER_TOOL_PERMISSION_MANIFEST[id];
  const directRoute = CLUSTER_APP_ROUTE_IDS.find((route) => {
    const manifest = CLUSTER_APP_ROUTE_MANIFEST[route];
    return "tool" in manifest && manifest.tool === id && "sidebar" in manifest && Boolean(manifest.sidebar);
  });
  return {
    id, label: definition.label, description: definition.description,
    lifecycle: definition.lifecycle, configurable: "adminConfigurable" in definition && definition.adminConfigurable === true,
    route: directRoute || null, group: TOOL_GROUPS[id], icon: TOOL_ICONS[id],
  };
});

export function ToolDirectoryPanel({ onConfigure }: { onConfigure: (id: ClusterToolPermissionKey) => void }) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"all" | "configurable">("all");
  const [groupFilter, setGroupFilter] = useState<"all" | ToolGroup>("all");
  const [expandedId, setExpandedId] = useState<ClusterToolPermissionKey | null>(null);
  const visible = useMemo(() => {
    const search = query.trim().toLowerCase();
    return BUILTIN_TOOL_DIRECTORY.filter((tool) => (groupFilter === "all" || tool.group === groupFilter) && (scope === "all" || tool.configurable)
      && (!search || `${tool.label} ${tool.description} ${tool.id} ${tool.group}`.toLowerCase().includes(search)));
  }, [query, scope, groupFilter]);
  const configuredCount = BUILTIN_TOOL_DIRECTORY.filter((tool) => tool.configurable).length;
  return <section className="cluster-tool-hub" aria-label="Built-in tools">
    <header className="cluster-tool-hub__head">
      <div><span className="eyebrow">Tool Infrastructure</span><h2>Tool directory</h2><p>Find a workspace or configure its defaults.</p></div>
      <div className="cluster-tool-hub__stats" aria-label="Tool directory coverage"><strong>{BUILTIN_TOOL_DIRECTORY.length}</strong><span>Built-in</span><strong>{configuredCount}</strong><span>Configurable</span></div>
    </header>
    <div className="cluster-tool-hub__toolbar">
      <ClusterTextInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a tool…" aria-label="Search built-in tools" />
      <div className="cluster-tool-hub__filters" role="group" aria-label="Filter tools">
        <ClusterButton size="compact" variant={scope === "all" ? "primary" : "secondary"} onClick={() => setScope("all")}>All</ClusterButton>
        <ClusterButton size="compact" variant={scope === "configurable" ? "primary" : "secondary"} onClick={() => setScope("configurable")}>Configurable</ClusterButton>
      </div>
    </div>
    <nav className="cluster-tool-hub__categories" aria-label="Tool groups">
      <ClusterButton size="compact" variant={groupFilter === "all" ? "primary" : "secondary"} onClick={() => setGroupFilter("all")}>All groups</ClusterButton>
      {GROUPS.map((group) => <ClusterButton key={group} size="compact" variant={groupFilter === group ? "primary" : "secondary"} onClick={() => setGroupFilter(group)}>{group}</ClusterButton>)}
    </nav>
    {GROUPS.map((group) => {
      const rows = visible.filter((tool) => tool.group === group);
      return rows.length ? <section className="cluster-tool-hub__group" key={group} aria-label={`${group} tools`}>
        <header><h3>{group}</h3><span>{rows.length}</span></header>
        <div className="cluster-tool-hub__grid">
          {rows.map((tool) => <article key={tool.id} className={`cluster-tool-hub__card${expandedId === tool.id ? " is-expanded" : ""}`}>
            <div className="cluster-tool-hub__card-main"><span className="cluster-tool-hub__icon"><ClusterIcon name={tool.icon} treatment="duotone" /></span>
              <div className="cluster-tool-hub__identity"><h4>{tool.label}</h4><small>{tool.configurable ? "Dedicated settings" : "Workspace managed"}</small></div>
              <ClusterButton size="compact" variant="quiet" onClick={() => setExpandedId((previous) => previous === tool.id ? null : tool.id)} aria-expanded={expandedId === tool.id} aria-label={`${expandedId === tool.id ? "Hide" : "Show"} ${tool.label} details`}><ClusterIcon name={expandedId === tool.id ? "chevron-up" : "chevron-down"} /></ClusterButton>
            </div>
            {expandedId === tool.id && <p className="cluster-tool-hub__description">{tool.description}</p>}
            <footer>
              {tool.route ? <ClusterButton size="compact" variant="secondary" onClick={() => openClusterWorkNavigation({ screen: tool.route! })}>Open</ClusterButton> : <span className="cluster-tool-hub__no-route">Available through its parent workspace</span>}
              {tool.configurable && <ClusterButton size="compact" onClick={() => onConfigure(tool.id)}>Configure</ClusterButton>}
            </footer>
          </article>)}
        </div>
      </section> : null;
    })}
    {visible.length === 0 && <div className="cluster-tool-hub__empty" role="status">No matching tools. <ClusterButton size="compact" variant="secondary" onClick={() => { setScope("all"); setQuery(""); setGroupFilter("all"); }}>Clear filters</ClusterButton></div>}
  </section>;
}
