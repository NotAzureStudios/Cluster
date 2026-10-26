/** Canonical project-scoped membership roles. These govern one Project only.
 * Studio tool permissions, explicit project overrides, and Access Rules remain
 * separate authorities. Never infer privileges from a freeform display label.
 */
export const CLUSTER_PROJECT_ROLES = [
  { key: "lead", label: "Project Lead", accessLevel: "manage" },
  { key: "producer", label: "Producer", accessLevel: "manage" },
  { key: "designer", label: "Designer", accessLevel: "contribute" },
  { key: "engineer", label: "Engineer", accessLevel: "contribute" },
  { key: "artist", label: "Artist", accessLevel: "contribute" },
  { key: "qa", label: "QA", accessLevel: "contribute" },
  { key: "contributor", label: "Contributor", accessLevel: "contribute" },
  { key: "reviewer", label: "Reviewer", accessLevel: "view" },
] as const;

export type ClusterProjectRoleKey = typeof CLUSTER_PROJECT_ROLES[number]["key"];
export type ClusterProjectAccessLevel = "view" | "contribute" | "manage";

export function resolveClusterProjectRole(value: unknown) {
  const identifier = String(value || "").trim().toLowerCase();
  return CLUSTER_PROJECT_ROLES.find((role) => role.key === identifier || role.label.toLowerCase() === identifier) || null;
}

export function requireClusterProjectRole(value: unknown) {
  const role = resolveClusterProjectRole(value);
  if (!role) throw new Error(`Unknown Project role: ${String(value || "(empty)")}`);
  return role;
}
