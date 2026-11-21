import {
  CLUSTER_APP_ROUTE_IDS, CLUSTER_APP_ROUTE_MANIFEST,
  CLUSTER_TOOL_PERMISSION_KEYS, CLUSTER_TOOL_PERMISSION_MANIFEST,
  type ClusterToolPermissionKey,
} from "@cluster/shared";
import type { ClusterIconName } from "../../components/ClusterIcon";

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
