import { z } from "zod";
import { CLUSTER_RESOURCE_KINDS, CLUSTER_RESOURCE_MANIFEST, type ClusterResourceKind } from "./cluster-manifest.js";

export { CLUSTER_RESOURCE_KINDS };
export type { ClusterResourceKind };

/**
 * Stable identity for a Cluster resource. This deliberately describes data,
 * not where the current renderer happens to display that data.
 */
export type ClusterResourceAddress = {
  kind: ClusterResourceKind;
  id: string;
  projectId?: string | null;
};

export const clusterResourceAddressSchema = z.object({
  kind: z.enum(CLUSTER_RESOURCE_KINDS as [ClusterResourceKind, ...ClusterResourceKind[]]),
  id: z.string().trim().min(1).max(200),
  projectId: z.string().trim().max(200).optional().nullable(),
});

const CLUSTER_RESOURCE_ENTITY_ALIASES: Readonly<Record<string, ClusterResourceKind>> = Object.freeze({
  project: "project",
  board: "board",
  card: "card",
  ticket: "ticket",
  whiteboard: "whiteboard",
  review: "review_asset",
  review_asset: "review_asset",
  build: "build",
  qa_plan: "qa_plan",
  qa_session: "qa_session",
  release: "release",
  meeting: "meeting",
  control: "control",
  project_control: "control",
  project_control_record: "control",
  calendar: "calendar",
  calendar_event: "calendar",
  scheduler: "scheduler",
  scheduler_block: "scheduler",
  schedule_block: "scheduler",
  timeline: "timeline",
  timeline_item: "timeline",
  library: "library",
  file: "file",
  user: "user",
  person: "user",
  team: "team",
  department: "department",
  job_role: "job_role",
  packet: "packet",
  studio_form: "studio_form",
  form: "studio_form",
  form_submission: "form_submission",
  application: "application",
  onboarding_assignment: "onboarding_assignment",
  policy: "policy",
  studio_policy: "policy",
  announcement: "announcement",
  automation_rule: "automation_rule",
  automation_run: "automation_run",
  source_repository: "source_repository",
  source_review: "source_review",
  source_commit: "source_commit",
  approval: "approval",
  background_job: "background_job",
  job: "background_job",
  integration_connection: "integration_connection",
});

export function clusterResourceKindFromEntityType(value: unknown): ClusterResourceKind | null {
  const key = String(value || "").trim().toLowerCase();
  return CLUSTER_RESOURCE_ENTITY_ALIASES[key] || null;
}

export function clusterResourceAddressFromEntity(input: {
  entityType?: unknown;
  entityId?: unknown;
  projectId?: unknown;
}): ClusterResourceAddress | null {
  const kind = clusterResourceKindFromEntityType(input.entityType);
  if (!kind) return null;
  const projectId = typeof input.projectId === "string" ? input.projectId.trim() : "";
  const id = typeof input.entityId === "string" ? input.entityId.trim() :
    (kind === "project" ? projectId : "");
  if (!id || id.length > 200 || projectId.length > 200) return null;
  // Global resources have one canonical identity, regardless of the project
  // whose Activity/notification originally mentioned them.
  return { kind, id, ...(CLUSTER_RESOURCE_MANIFEST[kind].projectScoped && projectId ? { projectId } : {}) };
}


export type ClusterDeepLinkTarget =
  | { type: "resource"; resource: ClusterResourceAddress; boardId?: string }
  | { type: "source_commit"; repositoryId: string; revision: string }
  | { type: "settings_security" };

const CLUSTER_DEEP_LINK_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const CLUSTER_DEEP_LINK_REVISION = /^[0-9a-f]{7,64}$/i;
const CLUSTER_DEEP_LINK_MAX_LENGTH = 512;

function deepLinkSegment(value: unknown) {
  const segment = String(value || "").trim();
  return CLUSTER_DEEP_LINK_SEGMENT.test(segment) ? segment : null;
}

/**
 * Parse the intentionally small external Cluster URI grammar. This is resource
 * addressing, never arbitrary renderer routing. Authorization still occurs at
 * the destination resource after navigation.
 */
export function parseClusterDeepLink(value: unknown): ClusterDeepLinkTarget | null {
  const raw = String(value || "").trim();
  if (!raw || raw.length > CLUSTER_DEEP_LINK_MAX_LENGTH || raw.includes("%") || /[\\\u0000-\u001f\u007f]/.test(raw)) return null;
  // WHATWG URL normalization erases literal dot-segments before pathname
  // inspection. Reject them from the unmodified protocol input instead.
  const literalPath = /^cluster:\/\/[^/?#]+(\/[^?#]*)$/i.exec(raw)?.[1];
  if (literalPath?.split("/").some((part) => part === "." || part === "..")) return null;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  if (url.protocol.toLowerCase() !== "cluster:" || url.username || url.password || url.port || url.search || url.hash) return null;
  const host = url.hostname.toLowerCase();
  const pathname = url.pathname;
  if (!pathname.startsWith("/") || pathname.endsWith("/") || pathname.includes("//")) return null;
  const parts = pathname.slice(1).split("/");
  if (parts.some((part) => !deepLinkSegment(part))) return null;

  if (host === "settings" && parts.length === 1 && parts[0] === "security") return { type: "settings_security" };
  if (host === "repo" && parts.length === 3 && parts[1] === "commit") {
    const repositoryId = deepLinkSegment(parts[0]);
    const revision = parts[2];
    return repositoryId && CLUSTER_DEEP_LINK_REVISION.test(revision) ? { type: "source_commit", repositoryId, revision: revision.toLowerCase() } : null;
  }
  // A single canonical URI grammar carries stable resource identity and its
  // optional Project scope. The destination must still load/authorize the record.
  if (host === "resource") {
    if (parts.length < 2 || parts.length > 4) return null;
    const kind = parts[0] as ClusterResourceKind;
    const id = deepLinkSegment(parts[1]);
    const projectId = parts.length >= 3 ? deepLinkSegment(parts[2]) : null;
    const boardId = parts.length === 4 ? deepLinkSegment(parts[3]) : null;
    const definition = Object.hasOwn(CLUSTER_RESOURCE_MANIFEST, kind) ? CLUSTER_RESOURCE_MANIFEST[kind] : null;
    if (!definition || !id || (parts.length >= 3 && (!projectId || !definition.projectScoped))) return null;
    if (parts.length === 4 && (kind !== "card" || !boardId)) return null;
    return {
      type: "resource", resource: { kind, id, ...(projectId ? { projectId } : {}) },
      ...(boardId ? { boardId } : {}),
    };
  }
  if (parts.length !== 1) return null;
  const id = deepLinkSegment(parts[0]);
  if (!id) return null;
  const kindByHost: Readonly<Record<string, ClusterResourceKind | undefined>> = {
    project: "project",
    ticket: "ticket",
    library: "library",
    repo: "source_repository",
    build: "build",
    person: "user",
    whiteboard: "whiteboard",
  };
  const kind = kindByHost[host];
  return kind ? { type: "resource", resource: { kind, id } } : null;
}

export function serializeClusterDeepLink(target: ClusterDeepLinkTarget): string | null {
  if (target.type === "settings_security") return "cluster://settings/security";
  if (target.type === "source_commit") {
    const repositoryId = deepLinkSegment(target.repositoryId);
    const revision = String(target.revision || "").trim().toLowerCase();
    return repositoryId && CLUSTER_DEEP_LINK_REVISION.test(revision) ? `cluster://repo/${repositoryId}/commit/${revision}` : null;
  }
  const { kind } = target.resource;
  const definition = Object.hasOwn(CLUSTER_RESOURCE_MANIFEST, kind) ? CLUSTER_RESOURCE_MANIFEST[kind] : null;
  const id = deepLinkSegment(target.resource.id);
  const projectId = deepLinkSegment(target.resource.projectId);
  const boardId = target.boardId ? deepLinkSegment(target.boardId) : null;
  if (!definition || !id || (target.boardId && !boardId)) return null;
  // A Card's Board is mutable. A Card-only link is safe now that the
  // authenticated renderer resolves its current Board via GET /api/cards/:id
  // before switching the workspace. Supplying an old Board is only a hint.
  if (kind !== "card" && boardId) return null;
  // Project-owned records that cannot be opened standalone must carry the
  // authority-scoping Project context, rather than a misleading broken link.
  if (definition.projectScoped && kind !== "card" && !("standaloneAllowed" in definition && definition.standaloneAllowed) && !projectId) return null;
  if (!definition.projectScoped && target.resource.projectId) return null;
  const supported: readonly ClusterResourceKind[] = [
    "project", "board", "card", "ticket", "whiteboard", "meeting", "review_asset",
    "build", "qa_plan", "qa_session", "release", "control", "calendar",
    "scheduler", "timeline", "library", "file", "user", "packet", "policy",
    "source_repository", "source_review", "source_commit", "studio_form", "form_submission", "approval",
  ];
  if (!supported.includes(kind)) return null;
  const link = `cluster://resource/${kind}/${id}${projectId ? `/${projectId}` : ""}${boardId ? `/${boardId}` : ""}`;
  return link.length <= CLUSTER_DEEP_LINK_MAX_LENGTH ? link : null;
}
