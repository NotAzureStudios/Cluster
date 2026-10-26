import { useMemo, useState } from "react";
import {
  CLUSTER_APP_ROUTE_IDS, CLUSTER_APP_ROUTE_MANIFEST,
  CLUSTER_TOOL_PERMISSION_KEYS, CLUSTER_TOOL_PERMISSION_MANIFEST,
  type ClusterToolPermissionKey,
} from "@cluster/shared";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterButton } from "../../components/ClusterButton";
import { openClusterWorkNavigation } from "../workflow/work-navigation";

/** An inventory of all built-in capabilities, not merely the six tools with
 * server-backed Tool Config. Never claim a feature is disabled/healthy from
 * navigation metadata; live state belongs to each tool's runtime. */
export const BUILTIN_TOOL_DIRECTORY = CLUSTER_TOOL_PERMISSION_KEYS.map((id) => {
  const definition = CLUSTER_TOOL_PERMISSION_MANIFEST[id];
  const directRoute = CLUSTER_APP_ROUTE_IDS.find((route) => {
    const manifest = CLUSTER_APP_ROUTE_MANIFEST[route];
    return "tool" in manifest && manifest.tool === id && "sidebar" in manifest && Boolean(manifest.sidebar);
  });
  return {
    id,
    label: definition.label,
    description: definition.description,
    lifecycle: definition.lifecycle,
    configurable: "adminConfigurable" in definition && definition.adminConfigurable === true,
    route: directRoute || null,
  };
});

export function ToolDirectoryPanel({ onConfigure }: { onConfigure: (id: ClusterToolPermissionKey) => void }) {
  const [query, setQuery] = useState("");
  const visible = useMemo(() => {
    const search = query.trim().toLowerCase();
    return BUILTIN_TOOL_DIRECTORY.filter((tool) => !search || `${tool.label} ${tool.description} ${tool.id}`.toLowerCase().includes(search));
  }, [query]);
  return <section className="panel cluster-tool-directory" aria-label="Built-in tool directory">
    <header className="cluster-tool-directory__header">
      <div><h2>Built-in tools</h2><p>See every Cluster tool, its identity, where work happens, and whether dedicated configuration is available. This catalogue does not change permissions.</p></div>
      <span>{visible.length} of {BUILTIN_TOOL_DIRECTORY.length}</span>
    </header>
    <ClusterTextInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search tools and capabilities" aria-label="Search tools" />
    <div className="cluster-tool-directory__grid">
      {visible.map((tool) => <article key={tool.id} className="cluster-tool-directory__item">
        <div><h3>{tool.label}</h3><p>{tool.description}</p></div>
        <div className="cluster-tool-directory__footer">
          <small>{tool.lifecycle} · {tool.configurable ? "Tool Config available" : "Managed by its workspace or owner"}</small>
          <div className="button-row">
            {tool.route && <ClusterButton size="compact" variant="secondary" onClick={() => openClusterWorkNavigation({ screen: tool.route! })}>Open tool</ClusterButton>}
            {tool.configurable && <ClusterButton size="compact" variant="secondary" onClick={() => onConfigure(tool.id)}>Configure</ClusterButton>}
          </div>
        </div>
      </article>)}
      {visible.length === 0 && <p role="status">No tools match this search.</p>}
    </div>
  </section>;
}
