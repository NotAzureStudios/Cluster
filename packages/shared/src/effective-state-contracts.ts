export const CLUSTER_EFFECTIVE_STATE_SCOPES = [
  "default",
  "studio",
  "department",
  "team",
  "role",
  "project_type",
  "project",
  "user",
  "session",
  "explicit",
] as const;
export type ClusterEffectiveStateScope = (typeof CLUSTER_EFFECTIVE_STATE_SCOPES)[number];

export type ClusterEffectiveStateLayer = {
  scope: ClusterEffectiveStateScope;
  sourceId: string;
  label: string;
  values: Record<string, unknown>;
};

export type ClusterEffectiveValueTrace = {
  scope: ClusterEffectiveStateScope;
  sourceId: string;
  label: string;
  order: number;
  value: unknown;
};

export type ClusterEffectiveValueProvenance = {
  effective: ClusterEffectiveValueTrace;
  chain: ClusterEffectiveValueTrace[];
};

export type ClusterEffectiveStateResolution = {
  values: Record<string, unknown>;
  provenance: Record<string, ClusterEffectiveValueProvenance>;
  layers: Array<Omit<ClusterEffectiveStateLayer, "values"> & { keys: string[] }>;
};

/**
 * Resolve inherited configuration with explicit, inspectable precedence.
 * Later layers win. `undefined` means "no opinion" while null remains an
 * intentional value. The complete contribution chain is retained per key so
 * callers can explain where the effective value came from.
 */
export function resolveClusterEffectiveState(layers: readonly ClusterEffectiveStateLayer[]): ClusterEffectiveStateResolution {
  const values: Record<string, unknown> = {};
  const chains = new Map<string, ClusterEffectiveValueTrace[]>();
  const normalizedLayers: ClusterEffectiveStateResolution["layers"] = [];
  layers.forEach((layer, order) => {
    const keys: string[] = [];
    for (const [key, value] of Object.entries(layer.values || {})) {
      if (value === undefined) continue;
      keys.push(key);
      const trace: ClusterEffectiveValueTrace = { scope: layer.scope, sourceId: layer.sourceId, label: layer.label, order, value };
      const chain = chains.get(key) || [];
      chain.push(trace);
      chains.set(key, chain);
      values[key] = value;
    }
    normalizedLayers.push({ scope: layer.scope, sourceId: layer.sourceId, label: layer.label, keys });
  });
  const provenance: Record<string, ClusterEffectiveValueProvenance> = {};
  for (const [key, chain] of chains) provenance[key] = { effective: chain[chain.length - 1], chain };
  return { values, provenance, layers: normalizedLayers };
}
