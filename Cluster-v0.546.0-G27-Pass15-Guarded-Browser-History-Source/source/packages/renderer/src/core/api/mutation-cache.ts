import { invalidateApiQueries, invalidateApiQueryTags } from "./cache";

type MutationCachePlan = { prefixes: string[]; tags: string[] } | "all" | "none";

const DOMAIN_PLANS: Array<{ pattern: RegExp; prefixes: string[]; tags: string[] }> = [
  { pattern: /^\/api\/(cards|tickets)(?:\/|$)/, prefixes: ["/api/cards", "/api/tickets", "/api/team/assignments", "/api/activity", "/api/projects"], tags: ["work", "tickets", "activity", "home", "projects"] },
  { pattern: /^\/api\/boards(?:\/|$)/, prefixes: ["/api/boards", "/api/cards", "/api/activity"], tags: ["boards", "work", "activity"] },
  { pattern: /^\/api\/whiteboards(?:\/|$)/, prefixes: ["/api/whiteboards", "/api/activity"], tags: ["whiteboards", "work", "activity"] },
  { pattern: /^\/api\/timeline(?:\/|$)/, prefixes: ["/api/timeline", "/api/activity"], tags: ["timeline", "work", "activity"] },
  { pattern: /^\/api\/calendar(?:\/|$)/, prefixes: ["/api/calendar", "/api/team/assignments", "/api/activity"], tags: ["calendar", "work", "activity", "home"] },
  { pattern: /^\/api\/(schedule|time)(?:\/|$)/, prefixes: ["/api/schedule", "/api/time", "/api/team/assignments", "/api/activity"], tags: ["scheduler", "time", "work", "activity", "home"] },
  { pattern: /^\/api\/(users|team|workforce|departments|roles)(?:\/|$)/, prefixes: ["/api/users", "/api/team", "/api/workforce", "/api/departments", "/api/roles", "/api/team/assignments", "/api/activity"], tags: ["users", "people", "workforce", "work", "activity", "home"] },
  { pattern: /^\/api\/notifications(?:\/|$)/, prefixes: ["/api/notifications"], tags: ["notifications", "inbox"] },
  { pattern: /^\/api\/(library|project-files|mounted-libraries)(?:\/|$)/, prefixes: ["/api/library", "/api/project-files", "/api/mounted-libraries", "/api/activity"], tags: ["library", "activity", "home"] },
  { pattern: /^\/api\/(review-assets|review-comments)(?:\/|$)/, prefixes: ["/api/review-assets", "/api/review-comments", "/api/activity"], tags: ["project-media", "media-processing", "activity"] },
  { pattern: /^\/api\/admin\/media-processing(?:\/|$)/, prefixes: ["/api/admin/media-processing", "/api/activity"], tags: ["project-media", "media-processing", "activity"] },
  { pattern: /^\/api\/(projects|project-workflows|builds|qa|releases)(?:\/|$)/, prefixes: ["/api/projects", "/api/project-workflows", "/api/builds", "/api/qa", "/api/releases", "/api/activity"], tags: ["projects", "work", "activity", "home", "readiness", "delivery"] },
  { pattern: /^\/api\/packets(?:\/|$)/, prefixes: ["/api/packets", "/api/activity"], tags: ["packets", "library", "activity"] },
  { pattern: /^\/api\/(comments|entity-comments|collaboration)(?:\/|$)/, prefixes: ["/api/comments", "/api/entity-comments", "/api/collaboration", "/api/activity"], tags: ["collaboration", "work", "activity"] },
  { pattern: /^\/api\/custom-fields(?:\/|$)/, prefixes: ["/api/custom-fields", "/api/projects"], tags: ["custom-fields", "projects", "work"] },
  { pattern: /^\/api\/automation(?:\/|$)/, prefixes: ["/api/automation", "/api/activity"], tags: ["automation", "work", "activity"] },
  { pattern: /^\/api\/(integrations|source-control)(?:\/|$)/, prefixes: ["/api/integrations", "/api/source-control", "/api/activity"], tags: ["integrations", "source-control", "activity"] },
  { pattern: /^\/api\/(activity|audit)(?:\/|$)/, prefixes: ["/api/activity", "/api/audit"], tags: ["activity", "home"] },
  { pattern: /^\/api\/client-state(?:\/|$)/, prefixes: ["/api/client-state"], tags: ["client-state"] },
];

function genericDomainPlan(cleanPath: string): MutationCachePlan {
  const match = cleanPath.match(/^\/api\/([^/]+)/);
  if (!match) return "none";
  const domain = match[1];
  // Unknown mutation domains invalidate only their own API family. This is deliberately
  // conservative: a new feature must not silently turn every mutation into a global refetch storm.
  return { prefixes: [`/api/${domain}`], tags: [domain] };
}

function mutationCachePlan(path: string): MutationCachePlan {
  const cleanPath = path.split("?")[0];
  if (/^\/api\/(auth|setup)(?:\/|$)/.test(cleanPath)) return "all";
  if (cleanPath === "/api/me/presence") return {
    prefixes: ["/api/users", "/api/team/assignments", "/api/activity"],
    tags: ["users", "people", "work", "activity", "home"],
  };
  if (/^\/api\/projects\/[^/]+\/(?:review-assets|video-production|media-processing)(?:\/|$)/.test(cleanPath)) return {
    prefixes: ["/api/review-assets", "/api/review-comments", "/api/admin/media-processing", "/api/projects", "/api/activity"],
    tags: ["project-media", "media-processing", "projects", "activity"],
  };
  for (const plan of DOMAIN_PLANS) {
    if (plan.pattern.test(cleanPath)) return { prefixes: plan.prefixes, tags: plan.tags };
  }
  return genericDomainPlan(cleanPath);
}

export function invalidateMutationCache(path: string) {
  const plan = mutationCachePlan(path);
  if (plan === "none") return;
  if (plan === "all") {
    invalidateApiQueries();
    return;
  }
  if (plan.tags.length) invalidateApiQueryTags(plan.tags);
  plan.prefixes.forEach((prefix) => invalidateApiQueries(prefix));
}
