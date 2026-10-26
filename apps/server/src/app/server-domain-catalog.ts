export type ServerDomainDescriptor = {
  key: string;
  label: string;
  routeRoots: string[];
  ownerModules: string[];
  asyncWork: boolean;
  notes?: string;
};

export const SERVER_DOMAIN_CATALOG: readonly ServerDomainDescriptor[] = [
  { key: "auth", label: "Authentication", routeRoots: ["/api/auth"], ownerModules: ["domains/auth", "domains/sessions"], asyncWork: false },
  { key: "access", label: "Authorization & access", routeRoots: ["/api/access", "/api/roles", "/api/departments"], ownerModules: ["domains/access", "domains/roles", "domains/departments"], asyncWork: false },
  { key: "users", label: "Users & team", routeRoots: ["/api/users", "/api/team"], ownerModules: ["domains/users", "domains/presence"], asyncWork: false },
  { key: "projects", label: "Projects & workflows", routeRoots: ["/api/projects"], ownerModules: ["domains/projects", "domains/custom-fields"], asyncWork: true },
  { key: "home-layouts", label: "Home layout sharing", routeRoots: ["/api/home-layouts"], ownerModules: ["domains/home-layouts"], asyncWork: false, notes: "Authenticated Studio members can read templates/shared profiles; template mutation is admin-only and shared-profile mutation is owner-bound." },
  { key: "boards", label: "Boards & cards", routeRoots: ["/api/boards", "/api/lists", "/api/cards"], ownerModules: ["domains/boards", "domains/cards"], asyncWork: false },
  { key: "tickets", label: "Tickets", routeRoots: ["/api/tickets"], ownerModules: ["domains/tickets"], asyncWork: false },
  { key: "library", label: "Library & packets", routeRoots: ["/api/library", "/api/packets", "/api/desktop-libraries"], ownerModules: ["domains/library"], asyncWork: true },
  { key: "studio-systems", label: "Forms, policies & studio systems", routeRoots: ["/api/studio-systems", "/api/studio-audience", "/api/onboarding", "/api/forms", "/api/studio-policies", "/api/public/v1/studio-cover", "/api/public/v1/applications"], ownerModules: ["domains/studio-systems"], asyncWork: false, notes: "Administrative definition routes are settings-owned; audience catalogs, onboarding assignments, form submissions, and policy acceptance remain authenticated self-service flows." },
  { key: "time", label: "Scheduler & time", routeRoots: ["/api/time", "/api/schedule"], ownerModules: ["domains/time"], asyncWork: false },
  { key: "planning", label: "Calendar & timeline", routeRoots: ["/api/calendar", "/api/timeline"], ownerModules: ["domains/planning"], asyncWork: false },
  { key: "collaboration", label: "Realtime collaboration", routeRoots: ["/api/collaboration", "/api/presence"], ownerModules: ["domains/collaboration", "domains/presence"], asyncWork: true },
  { key: "work", label: "Shared work, subscriptions & assignments", routeRoots: ["/api/shared-work"], ownerModules: ["domains/work", "domains/comments"], asyncWork: true },
  { key: "decisions", label: "Decisions & approvals", routeRoots: ["/api/admin/approvals"], ownerModules: ["domains/decisions", "app/server-routes-access-media"], asyncWork: false },
  { key: "sync", label: "Offline synchronization", routeRoots: ["/api/sync"], ownerModules: ["domains/sync"], asyncWork: true },
  { key: "data-views", label: "Saved Data Views", routeRoots: ["/api/data-views"], ownerModules: ["domains/data-views"], asyncWork: false },
  { key: "data-metrics", label: "Metrics & analytical read models", routeRoots: ["/api/data-metrics"], ownerModules: ["domains/data-metrics", "core/data-metrics"], asyncWork: false, notes: "Canonical permission-aware Metric Registry definitions execute through the same authorized Data Query semantics and expose comparison/drilldown read models without feature-local metric formulas." },
  { key: "data-exports", label: "Data exports", routeRoots: ["/api/data-exports"], ownerModules: ["domains/data-exports"], asyncWork: true, notes: "Permission-safe Data View exports use semantic field allowlists, bounded immediate delivery, and durable Library-backed CSV/JSON/XLSX artifacts through the canonical Background Job runtime." },
  { key: "data-imports", label: "Data imports", routeRoots: ["/api/data-imports"], ownerModules: ["domains/data-imports"], asyncWork: true, notes: "Schema-aware previews and domain-owned durable mutation adapters use explicit writable fields, reauthorization, checksummed private Library source/report artifacts, idempotent row application, and the canonical Background Job runtime." },
  { key: "search", label: "Search", routeRoots: ["/api/command/search"], ownerModules: ["domains/search"], asyncWork: true },
  { key: "notifications", label: "Notifications & activity", routeRoots: ["/api/notifications", "/api/activity"], ownerModules: ["domains/notifications", "domains/activity"], asyncWork: true },
  { key: "integrations", label: "Integrations & provider contracts", routeRoots: ["/api/admin/integrations", "/api/admin/discord", "/api/projects/:projectId/discord", "/api/integrations/discord"], ownerModules: ["domains/integrations", "app/server-routes-configuration-integrations", "app/server-routes-context-packs"], asyncWork: true, notes: "Provider manifests are trusted server registrations; arbitrary runtime plugin code loading is disabled." },
  { key: "source-control", label: "Source Control", routeRoots: ["/api/admin/source-control", "/api/projects/:projectId/source-control"], ownerModules: ["domains/source-control", "app/server-source-control-runtime"], asyncWork: true },
  { key: "automation", label: "Automation", routeRoots: ["/api/automation"], ownerModules: ["domains/automation", "domains/projects/project-automation-*"], asyncWork: true },
  { key: "uploads", label: "Upload sessions", routeRoots: ["/api/uploads"], ownerModules: ["domains/uploads"], asyncWork: true },
  { key: "legal", label: "Legal & privacy", routeRoots: ["/api/legal", "/api/privacy", "/api/admin/legal", "/api/admin/privacy"], ownerModules: ["domains/legal"], asyncWork: true },
  { key: "admin", label: "Administration", routeRoots: ["/api/admin"], ownerModules: ["domains/admin", "app/server-routes-*"], asyncWork: true },
  { key: "jobs", label: "Durable background jobs", routeRoots: ["/api/admin/operations/jobs"], ownerModules: ["domains/jobs"], asyncWork: true },
  { key: "audit", label: "Audit & security evidence", routeRoots: ["/api/audit"], ownerModules: ["domains/audit"], asyncWork: false },
] as const;

export function serverDomainCatalogSnapshot() {
  return {
    schemaVersion: 1,
    domainCount: SERVER_DOMAIN_CATALOG.length,
    asyncDomainCount: SERVER_DOMAIN_CATALOG.filter((domain) => domain.asyncWork).length,
    domains: SERVER_DOMAIN_CATALOG.map((domain) => ({ ...domain, routeRoots: [...domain.routeRoots], ownerModules: [...domain.ownerModules] })),
  };
}
