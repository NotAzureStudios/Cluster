import { lazy, type ReactNode } from "react";
import { CLUSTER_APP_ROUTE_MANIFEST, CLUSTER_STANDALONE_TOOL_ROUTE_IDS, type ClusterStandaloneToolRouteId } from "@cluster/shared";
import type { AppScreen } from "../../../core/navigation";
import { LazyFeatureBoundary } from "../../../components/FeatureBoundary";

/** Only the presentation layer lives here. Access remains enforced by the
 * canonical route permission gate and each tool's server API. */
export type StandaloneToolContext = Readonly<{
  isAdmin: boolean;
  pinConfigured: boolean;
}>;
export type StandaloneToolModule = Readonly<{
  preload: () => Promise<unknown>;
  render: (context: StandaloneToolContext) => ReactNode;
}>;

const inventoryLoader = () => import("../../inventory/InventoryWorkspacePage");
const integrationsLoader = () => import("../../admin/ProductionIntegrationAdminPages");
const Inventory = lazy(() => inventoryLoader().then((module) => ({ default: module.InventoryWorkspacePage })));
const Vault = lazy(() => inventoryLoader().then((module) => ({ default: module.VaultWorkspacePage })));
const Integrations = lazy(() => integrationsLoader().then((module) => ({ default: module.IntegrationsAdminPage })));

/** One entry per canonical standalone route. Adding a tool should never
 * require another conditional branch in ClusterApplication or prefetch. */
export const STANDALONE_TOOL_MODULES: Readonly<Record<ClusterStandaloneToolRouteId, StandaloneToolModule>> = {
  inventory: {
    preload: inventoryLoader,
    render: ({ isAdmin, pinConfigured }) => <Inventory isAdmin={isAdmin} pinConfigured={pinConfigured} />,
  },
  vault: {
    preload: inventoryLoader,
    render: () => <Vault />,
  },
  integrations: {
    preload: integrationsLoader,
    render: () => <Integrations />,
  },
} satisfies Record<ClusterStandaloneToolRouteId, StandaloneToolModule>;

export function isStandaloneToolRoute(screen: AppScreen): screen is ClusterStandaloneToolRouteId {
  return Object.hasOwn(STANDALONE_TOOL_MODULES, screen);
}

export function preloadStandaloneTool(screen: ClusterStandaloneToolRouteId): Promise<unknown> {
  return STANDALONE_TOOL_MODULES[screen].preload();
}

/** Registry completeness is checked by tools/scripts/cluster-tool.mjs. */
export function StandaloneToolRoute({ screen, context }: { screen: ClusterStandaloneToolRouteId; context: StandaloneToolContext }) {
  const definition = CLUSTER_APP_ROUTE_MANIFEST[screen];
  // Defense in depth. The app already rejects unauthorized navigation.
  if ("adminOnly" in definition && definition.adminOnly && !context.isAdmin) return null;
  return <LazyFeatureBoundary label={definition.label}>
    {STANDALONE_TOOL_MODULES[screen].render(context)}
  </LazyFeatureBoundary>;
}

export { CLUSTER_STANDALONE_TOOL_ROUTE_IDS };
