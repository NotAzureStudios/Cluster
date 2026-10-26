import { CLUSTER_TOOL_PERMISSION_KEYS } from './cluster-manifest.js';

/** Bundles are reusable configuration layers, never a second ACL or an access-rule bypass. */
export type ClusterPermissionLevel = 'none' | 'view' | 'edit' | 'manage';
export type ClusterPermissionBundle = {
  id: string;
  label: string;
  description?: string;
  revision: number;
  enabled?: boolean;
  toolPermissions: Partial<Record<(typeof CLUSTER_TOOL_PERMISSION_KEYS)[number], ClusterPermissionLevel>>;
};
export type ClusterBundleAssignment = { permissionBundleIds?: string[] };
export const CLUSTER_PERMISSION_BUNDLE_MAX = 64;
const toolSet = new Set<string>(CLUSTER_TOOL_PERMISSION_KEYS);
const levels = new Set(['none', 'view', 'edit', 'manage']);
const bundleIdPattern = /^[a-z][a-z0-9_-]{1,63}$/;

export function validateClusterPermissionBundles(value: unknown): ClusterPermissionBundle[] {
  if (!Array.isArray(value) || value.length > CLUSTER_PERMISSION_BUNDLE_MAX) throw new Error('Permission bundles must be an array of at most 64 entries.');
  const seen = new Set<string>();
  return value.map((raw: any) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !bundleIdPattern.test(raw.id)) throw new Error('Permission bundle ID must be a stable lowercase identifier.');
    if (seen.has(raw.id)) throw new Error(`Duplicate permission bundle ID: ${raw.id}`);
    seen.add(raw.id);
    if (typeof raw.label !== 'string' || !raw.label.trim() || raw.label.length > 100) throw new Error(`Invalid label for bundle ${raw.id}.`);
    if (raw.description !== undefined && (typeof raw.description !== 'string' || raw.description.length > 600)) throw new Error(`Invalid description for bundle ${raw.id}.`);
    if (!Number.isSafeInteger(raw.revision) || raw.revision < 1) throw new Error(`Invalid revision for bundle ${raw.id}.`);
    if (raw.enabled !== undefined && typeof raw.enabled !== 'boolean') throw new Error(`Invalid enabled flag for bundle ${raw.id}.`);
    if (!raw.toolPermissions || typeof raw.toolPermissions !== 'object' || Array.isArray(raw.toolPermissions)) throw new Error(`Tool permissions must be an object for bundle ${raw.id}.`);
    for (const [tool, level] of Object.entries(raw.toolPermissions)) {
      if (!toolSet.has(tool) || !levels.has(String(level))) throw new Error(`Invalid tool permission ${tool} in bundle ${raw.id}.`);
    }
    return { id: raw.id, label: raw.label.trim(), description: raw.description || '', revision: raw.revision, enabled: raw.enabled !== false, toolPermissions: { ...raw.toolPermissions } };
  });
}

export function validateClusterBundleAssignments(value: unknown, bundles: readonly ClusterPermissionBundle[], label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 16) throw new Error(`${label}: choose at most 16 permission bundles.`);
  const known = new Set(bundles.map((bundle) => bundle.id));
  const chosen = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string' || !known.has(item) || chosen.has(item)) throw new Error(`${label}: unknown or duplicate bundle reference.`);
    chosen.add(item);
  }
  return [...chosen];
}

export function resolveAssignedPermissionBundles(bundles: readonly ClusterPermissionBundle[], assignedIds: readonly string[] = []) {
  const byId = new Map(bundles.filter((bundle) => bundle.enabled !== false).map((bundle) => [bundle.id, bundle]));
  return assignedIds.map((id) => byId.get(id)).filter((item): item is ClusterPermissionBundle => Boolean(item));
}

/** Rev bumps are mandatory for material changes. Old revisions may not be rewritten or IDs reassigned. */
export function validateClusterBundleRevisionChanges(previous: readonly ClusterPermissionBundle[], next: readonly ClusterPermissionBundle[]) {
  const old = new Map(previous.map((bundle) => [bundle.id, bundle]));
  for (const bundle of next) {
    const prior = old.get(bundle.id);
    if (!prior) { if (bundle.revision !== 1) throw new Error(`New bundle ${bundle.id} must start at revision 1.`); continue; }
    const signature = (entry: ClusterPermissionBundle) => JSON.stringify({
      label: entry.label.trim(), description: entry.description || '', enabled: entry.enabled !== false,
      permissions: Object.entries(entry.toolPermissions).sort(([a], [b]) => a.localeCompare(b)),
    });
    const changed = signature(prior) !== signature(bundle);
    if (bundle.revision !== prior.revision + (changed ? 1 : 0)) throw new Error(`Bundle ${bundle.id} must ${changed ? 'increment its revision exactly once' : 'retain its revision'}.`);
  }
  for (const bundle of previous) if (!next.some((candidate) => candidate.id === bundle.id)) throw new Error(`Archive bundle ${bundle.id} instead of deleting its revision history.`);
}

/** Project assignments are ceilings, not additive Studio grants. They may only
 * reduce a person's existing Project/Resource access, including AccessRule allows. */
export type ClusterProjectBundlePolicy = { projectId: string; permissionBundleIds: string[] };
export function validateClusterProjectBundlePolicies(value: unknown, bundles: readonly ClusterPermissionBundle[]): ClusterProjectBundlePolicy[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 256) throw new Error('Project policies must contain at most 256 Projects.');
  const seen = new Set<string>();
  return value.map((raw: any) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some((key) => !['projectId', 'permissionBundleIds'].includes(key))) throw new Error('Invalid Project policy.');
    if (typeof raw.projectId !== 'string' || !raw.projectId.trim() || raw.projectId.length > 128 || seen.has(raw.projectId)) throw new Error('Project policy IDs must be distinct nonempty Project IDs.');
    seen.add(raw.projectId);
    return { projectId: raw.projectId, permissionBundleIds: validateClusterBundleAssignments(raw.permissionBundleIds, bundles, `Project ${raw.projectId}`) };
  });
}

/** Only explicit bundle keys restrict access. Missing keys never grant permissions.
 * Multiple active assigned bundles combine by their strictest explicit ceiling. */
export function clusterProjectBundleCap(
  projectId: string | null | undefined, tool: string,
  policies: readonly ClusterProjectBundlePolicy[], bundles: readonly ClusterPermissionBundle[],
): ClusterPermissionLevel | null {
  if (!projectId || !toolSet.has(tool)) return null;
  const policy = policies.find((entry) => entry.projectId === projectId);
  if (!policy) return null;
  const order: Record<ClusterPermissionLevel, number> = { none: 0, view: 1, edit: 2, manage: 3 };
  let cap: ClusterPermissionLevel | null = null;
  for (const bundle of resolveAssignedPermissionBundles(bundles, policy.permissionBundleIds)) {
    const level = bundle.toolPermissions[tool as keyof typeof bundle.toolPermissions];
    if (level && (cap === null || order[level] < order[cap])) cap = level;
  }
  return cap;
}
