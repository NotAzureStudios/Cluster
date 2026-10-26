import type { ClusterWorkNavigationTarget } from "./work-navigation-types";

/** Only ClusterApplication publishes this after the live recipient check. */
export const CLUSTER_AUTHORIZED_PACKET_NAVIGATION_EVENT = "cluster:authorized-packet-navigation";

type PacketCatalogRead = { packets?: Array<{ id?: unknown }> } | null;
type PolicyCatalogRead = { policies?: Array<{ policy?: { id?: unknown } }> } | null;

export type PacketNavigationCatalogRead = PacketCatalogRead | PolicyCatalogRead;

/** The Packets workspace intentionally has no direct per-Packet detail GET.
 * Admission therefore uses the authoritative, recipient-filtered catalog
 * only on explicit deep-link activation. Ordinary index browsing is unchanged.
 */
export function requiresAuthorizedPacketNavigation(target: ClusterWorkNavigationTarget): boolean {
  return target.screen === "packets" && Boolean(target.packetId || target.policyId);
}

export async function resolveAuthorizedPacketNavigation(
  target: ClusterWorkNavigationTarget,
  input: { read: (path: string) => Promise<PacketNavigationCatalogRead>; isCurrent: () => boolean },
): Promise<ClusterWorkNavigationTarget | null> {
  if (!input.isCurrent() || !requiresAuthorizedPacketNavigation(target)) return null;
  // A packet and a policy cannot both be the target of a single open intent.
  if (target.packetId && target.policyId) return null;
  const packet = Boolean(target.packetId);
  const id = packet ? target.packetId : target.policyId;
  if (typeof id !== "string" || !id.trim() || id.length > 200) return null;
  try {
    const path = packet ? "/api/packets" : "/api/studio-policies/required";
    const result = await input.read(path);
    if (!input.isCurrent() || !result || typeof result !== "object") return null;
    // The server's catalog already enforces Packet source visibility and
    // audience, or the policy's current recipient eligibility. Do not use
    // cached favorites, past notifications or a fallback first-row selection.
    const records = packet ? (result as PacketCatalogRead).packets : (result as PolicyCatalogRead).policies;
    if (!Array.isArray(records)) return null;
    const found = records.some((row) => packet ? row?.id === id : (row as { policy?: { id?: unknown } })?.policy?.id === id);
    if (!found) return null;
    return { ...target, projectId: null };
  } catch {
    return null;
  }
}
