import { CLUSTER_APP_ROUTE_IDS, clusterAppRouteDefinition } from "@cluster/shared";
import { screenLabel, type AppScreen } from "./navigation";

export type ApplicationActionGroup = "navigation" | "desktop";

export type ApplicationActionDefinition = {
  id: string;
  route: AppScreen;
  group: ApplicationActionGroup;
  title?: string;
  description: string;
  aliases?: readonly string[];
  keywords?: readonly string[];
  paletteKey?: string;
};

export const APPLICATION_ACTION_DEFINITIONS = Object.freeze(
  CLUSTER_APP_ROUTE_IDS.flatMap((route) => {
    const definition = clusterAppRouteDefinition(route);
    if (!("action" in definition) || !definition.action) return [];
    return [{
      id: definition.action.id,
      route,
      group: definition.action.group,
      title: definition.label,
      description: definition.action.description,
      aliases: "aliases" in definition.action ? definition.action.aliases : undefined,
      keywords: "keywords" in definition.action ? definition.action.keywords : undefined,
      paletteKey: definition.action.paletteKey,
    } satisfies ApplicationActionDefinition];
  }),
);

export type ApplicationActionId = (typeof APPLICATION_ACTION_DEFINITIONS)[number]["id"];

const APPLICATION_ACTION_MAP = new Map<string, ApplicationActionDefinition>(
  APPLICATION_ACTION_DEFINITIONS.map((action) => [action.id, action]),
);

export function applicationAction(id: ApplicationActionId) {
  return APPLICATION_ACTION_MAP.get(id)!;
}

export function applicationActionTitle(action: ApplicationActionDefinition) {
  return action.title || screenLabel(action.route);
}
