import type { ClusterResourceChange, ClusterResourceKind } from "@cluster/shared";
import { invalidateApiQueries, invalidateApiQueryTags } from "./api";
import { emitClusterCohesionEvent, subscribeClusterCohesionEvent } from "./cohesion-events";

export const CLUSTER_RESOURCE_CHANGED_EVENT = "cluster-resource-changed";
export const CLUSTER_RESOURCE_FEED_STATE_EVENT = "cluster-resource-feed-state";
export const CLUSTER_RESOURCE_FEED_RESET_EVENT = "cluster-resource-feed-reset";

export type ClusterResourceFeedReset = { reason: string; cursor?: string };

/** A reset invalidates snapshots even when no visible resource-change event was emitted. */
export function emitResourceChangeFeedReset(reset: ClusterResourceFeedReset) {
  emitClusterCohesionEvent(CLUSTER_RESOURCE_FEED_RESET_EVENT, reset);
}

export function subscribeResourceChangeFeedResets(handler: (reset: ClusterResourceFeedReset) => void) {
  return subscribeClusterCohesionEvent(CLUSTER_RESOURCE_FEED_RESET_EVENT, handler);
}

export type ClusterResourceChangeInvalidation = {
  change: ClusterResourceChange;
  tags: string[];
  prefixes: string[];
};

const KIND_TAGS: Partial<Record<ClusterResourceKind, readonly string[]>> = {
  project: ["projects", "home", "readiness", "work"],
  board: ["boards", "work", "activity"],
  card: ["boards", "work", "activity", "home"],
  ticket: ["tickets", "work", "activity", "home"],
  whiteboard: ["whiteboards", "work", "activity"],
  review_asset: ["project-media", "media-processing", "review-assets", "activity"],
  build: ["builds", "delivery", "readiness", "project-delivery", "activity", "home"],
  qa_plan: ["qa", "delivery", "readiness", "project-delivery", "activity"],
  qa_session: ["qa", "delivery", "readiness", "project-delivery", "activity"],
  release: ["releases", "delivery", "readiness", "project-delivery", "activity"],
  meeting: ["calendar", "work", "activity", "home"],
  control: ["project-control", "projects", "delivery", "activity"],
  calendar: ["calendar", "work", "activity", "home"],
  scheduler: ["scheduler", "time", "work", "activity", "home"],
  timeline: ["timeline", "calendar", "work", "activity", "home"],
  library: ["library", "activity", "home"],
  file: ["library", "activity", "home"],
  user: ["users", "people", "workforce", "activity", "home"],
  team: ["users", "people", "teams", "workforce", "activity"],
  department: ["users", "people", "departments", "workforce", "activity"],
  job_role: ["users", "people", "roles", "workforce", "activity"],
  packet: ["packets", "library", "work", "activity"],
  studio_form: ["studio-systems", "forms", "packets", "activity"],
  form_submission: ["studio-systems", "forms", "packets", "people", "activity"],
  application: ["studio-systems", "applications", "people", "activity"],
  onboarding_assignment: ["studio-systems", "onboarding", "people", "work", "activity"],
  policy: ["studio-systems", "policies", "packets", "work", "activity"],
  announcement: ["studio-systems", "announcements", "activity", "home"],
  automation_rule: ["automation", "studio-systems", "operations", "activity"],
  automation_run: ["automation", "operations", "activity"],
  source_repository: ["source-control", "integrations", "projects", "activity", "home"],
  source_review: ["source-control", "reviews", "integrations", "projects", "work", "activity", "home"],
  source_commit: ["source-control", "source-changes", "integrations", "projects", "activity"],
  approval: ["approvals", "operations", "work", "activity", "home"],
  background_job: ["jobs", "operations", "activity"],
  integration_connection: ["integrations", "source-control", "activity"],
};

const KIND_PREFIXES: Partial<Record<ClusterResourceKind, readonly string[]>> = {
  project: ["/api/projects"],
  board: ["/api/boards", "/api/cards", "/api/team/assignments", "/api/projects"],
  card: ["/api/cards", "/api/boards", "/api/team/assignments", "/api/projects"],
  ticket: ["/api/tickets", "/api/cards", "/api/team/assignments", "/api/projects"],
  whiteboard: ["/api/whiteboards", "/api/projects"],
  review_asset: ["/api/review-assets", "/api/review-comments", "/api/admin/media-processing", "/api/projects"],
  build: ["/api/builds", "/api/projects", "/api/releases"],
  qa_plan: ["/api/qa", "/api/projects"],
  qa_session: ["/api/qa", "/api/projects"],
  release: ["/api/releases", "/api/builds", "/api/projects"],
  meeting: ["/api/calendar", "/api/projects"],
  control: ["/api/projects", "/api/project-control"],
  calendar: ["/api/calendar", "/api/team/assignments"],
  scheduler: ["/api/schedule", "/api/time", "/api/team/assignments"],
  timeline: ["/api/timeline", "/api/calendar", "/api/projects"],
  library: ["/api/library", "/api/project-files", "/api/mounted-libraries", "/api/projects"],
  file: ["/api/library", "/api/project-files", "/api/mounted-libraries", "/api/projects"],
  user: ["/api/users", "/api/team", "/api/workforce", "/api/team/assignments"],
  team: ["/api/users", "/api/team", "/api/workforce", "/api/team/assignments"],
  department: ["/api/users", "/api/departments", "/api/workforce"],
  job_role: ["/api/users", "/api/roles", "/api/workforce"],
  packet: ["/api/packets", "/api/library", "/api/studio-policies"],
  studio_form: ["/api/studio-systems/forms", "/api/packets"],
  form_submission: ["/api/studio-systems", "/api/packets", "/api/users"],
  application: ["/api/studio-systems/applications", "/api/users"],
  onboarding_assignment: ["/api/studio-systems/onboarding", "/api/users"],
  policy: ["/api/studio-policies", "/api/studio-systems/policies", "/api/packets"],
  announcement: ["/api/studio-systems/announcements"],
  automation_rule: ["/api/automation"],
  automation_run: ["/api/automation"],
  source_repository: ["/api/admin/source-control", "/api/source-control", "/api/projects"],
  source_review: ["/api/source-control", "/api/projects"],
  source_commit: ["/api/source-control", "/api/projects"],
  approval: ["/api/approvals", "/api/admin/operations"],
  background_job: ["/api/jobs", "/api/admin/operations"],
  integration_connection: ["/api/admin/integrations", "/api/admin/source-control"],
};

export function invalidationForResourceChange(change: ClusterResourceChange): ClusterResourceChangeInvalidation {
  const tags = new Set<string>(["activity", ...(KIND_TAGS[change.resource.kind] || [])]);
  const prefixes = new Set<string>(KIND_PREFIXES[change.resource.kind] || []);
  const projectId = String(change.resource.projectId || "").trim();
  if (projectId) {
    tags.add("projects");
    tags.add(`project:${projectId}`);
    prefixes.add("/api/projects");
  }
  if (change.resource.kind === "project") tags.add(`project:${change.resource.id}`);
  return { change, tags: [...tags], prefixes: [...prefixes] };
}

export function applyResourceChangeInvalidation(change: ClusterResourceChange) {
  const detail = invalidationForResourceChange(change);
  if (detail.tags.length) invalidateApiQueryTags(detail.tags);
  detail.prefixes.forEach((prefix) => invalidateApiQueries(prefix));
  emitClusterCohesionEvent<ClusterResourceChangeInvalidation>(CLUSTER_RESOURCE_CHANGED_EVENT, detail);
  return detail;
}

export function subscribeResourceChanges(handler: (detail: ClusterResourceChangeInvalidation) => void) {
  return subscribeClusterCohesionEvent<ClusterResourceChangeInvalidation>(CLUSTER_RESOURCE_CHANGED_EVENT, handler);
}

export function resourceChangeMatches(detail: ClusterResourceChangeInvalidation, options: {
  kinds?: readonly ClusterResourceKind[];
  projectId?: string | null;
  tags?: readonly string[];
}) {
  const { change } = detail;
  if (options.kinds?.length && !options.kinds.includes(change.resource.kind)) return false;
  if (options.projectId) {
    const projectId = String(options.projectId);
    const changeProjectId = change.resource.kind === "project" ? change.resource.id : String(change.resource.projectId || "");
    if (changeProjectId !== projectId) return false;
  }
  if (options.tags?.length && !options.tags.some((tag) => detail.tags.includes(tag))) return false;
  return true;
}
