import type { AppScreen } from "../../core/navigation";

/** First-party, offline-readable guidance. Packets remains Cluster's wiki;
 * this panel is a compact guide to controls rather than a second content store.
 */
export type ClusterHelpTopic = {
  screen: AppScreen;
  title: string;
  purpose: string;
  tasks: readonly string[];
  recovery: string;
};

export const CLUSTER_HELP_TOPICS: readonly ClusterHelpTopic[] = [
  { screen: "dashboard", title: "Home", purpose: "Your command brief for work and studio activity.", tasks: ["Review assigned and overdue work.", "Open a Project or resource from its card.", "Customize available Home widgets."], recovery: "If a metric looks old, check the connection status and refresh the relevant tool." },
  { screen: "projects", title: "Projects", purpose: "Find and manage authorized studio Projects.", tasks: ["Search or filter Projects.", "Open a Project to reach its team, Boards, Builds and QA.", "Create a Project with its configured workspace defaults."], recovery: "A missing Project may be archived, hidden by access policy, or unavailable while offline." },
  { screen: "project", title: "Project workspace", purpose: "Work from a Project's current plan and resources.", tasks: ["Use tabs for planning, Builds, QA and Source Control.", "Open exact linked records from Search or Inbox.", "Review access before sharing a Project link."], recovery: "A link to a moved or revoked record will be refused instead of opening another Project's record." },
  { screen: "board", title: "Boards", purpose: "Organize work into lists and Cards.", tasks: ["Select a Board and open a Card.", "Assign and prioritize Cards, then link related work.", "Use Search to find an individual Card."], recovery: "An inaccessible Card link cannot be opened merely because its old Board still exists." },
  { screen: "whiteboard", title: "Whiteboards", purpose: "Visual planning and collaboration on a canvas.", tasks: ["Create shapes and connections.", "Use the Project association when applicable.", "Open links to the current Whiteboard rather than relying on older tab history."], recovery: "If a Whiteboard was moved, open the latest authorized location." },
  { screen: "tickets", title: "Tickets", purpose: "Track reports, bugs, and QA issues.", tasks: ["Review assigned or open Tickets.", "Open a Ticket's exact detail view.", "Create a linked follow-up when work is blocked."], recovery: "A Board Card is not automatically a Ticket; use the correct ticket workspace." },
  { screen: "timeline", title: "Timeline", purpose: "Track scheduled work and project milestones.", tasks: ["Change the period or filter.", "Open a Timeline item to inspect its details.", "Schedule related work from supported resource actions."], recovery: "Calendar, Scheduler and Timeline objects have different owners; choose the correct tool." },
  { screen: "calendar", title: "Calendar", purpose: "View events, meetings, and commitments with visibility rules.", tasks: ["Open an event for notes and participants.", "Check the active calendar layers and time zone.", "Create a new event from the global Create action."], recovery: "Private and participant-only events never become visible by following an old link." },
  { screen: "scheduler", title: "Scheduler", purpose: "Manage work-time scheduling and availability.", tasks: ["Inspect schedule blocks.", "Submit time-related requests where permitted.", "Review approvals and pending changes."], recovery: "Some changes require administrator approval and are not applied immediately." },
  { screen: "library", title: "Library", purpose: "Browse canonical files, folders, metadata and permissions.", tasks: ["Search, filter and inspect files.", "Use versions and relationships before replacing a source.", "Verify access before copying a link."], recovery: "Packet recipient access does not grant access to the source Library folder." },
  { screen: "packets", title: "Packets", purpose: "Read published training, policies and the studio knowledge base.", tasks: ["Open assigned published material.", "Complete required acknowledgements when prompted.", "Use authorized Packet links rather than direct source-file URLs."], recovery: "Revoked or no-longer-assigned Packets do not redirect to a different document." },
  { screen: "people", title: "People", purpose: "Find members and manage profiles according to your role.", tasks: ["Open a person's profile.", "Check presence and Project associations.", "Use admin controls only for permissions you actually hold."], recovery: "Personal fields and privileged controls may be hidden by authorization." },
  { screen: "mywork", title: "My Work", purpose: "See your assigned work and actionable requests.", tasks: ["Review your task list and onboarding items.", "Open the linked resource for full details.", "Follow up from the relevant Project or Board."], recovery: "If access was revoked, open the authorized tool rather than an old item URL." },
  { screen: "inbox", title: "Inbox", purpose: "Review actions, announcements and notifications in one place.", tasks: ["Filter by unread, action or priority.", "Acknowledge, snooze or dismiss as appropriate.", "Open a linked resource after Cluster checks your current access."], recovery: "When an exact link is unavailable, your Inbox remains open; it will not guess another destination." },
  { screen: "settings", title: "My Settings", purpose: "Manage your personal preferences and records.", tasks: ["Review appearance and accessibility.", "Adjust personal notifications and quiet hours.", "Use My Forms and My Resources for your assigned records."], recovery: "Some studio-wide settings require an administrator and cannot be edited here." },
  { screen: "studioSettings", title: "Studio Settings", purpose: "Configure studio-wide identity and policies.", tasks: ["Review changes before saving.", "Use appropriate security assurance for sensitive actions.", "Manage forms, announcements and domain ownership where authorized."], recovery: "An expired or stale revision must be refreshed before retrying a protected save." },
  { screen: "serverConfig", title: "Server Config", purpose: "Configure this Cluster installation and managed services.", tasks: ["Review diagnostics and dependency health.", "Distinguish saved from restart-required settings.", "Use the recovery workflow rather than editing private runtime files."], recovery: "Native gateway activation and restart execution can require local Server Manager support." },
  { screen: "admin", title: "Operations", purpose: "Review studio-wide health, approvals and operational issues.", tasks: ["Triage actionable alerts and approvals.", "Inspect the evidence behind health states.", "Confirm service and permission impact before changes."], recovery: "Do not treat an unverified background service state as a successful recovery." },
  { screen: "toolInfrastructure", title: "Tool Configuration", purpose: "Configure available tools and their runtime behavior.", tasks: ["Check which tools are enabled.", "Review inheritance and access policy.", "Confirm that disabling a tool also suspends optional work."], recovery: "An intentionally disabled tool should report why it cannot be opened." },
  { screen: "desktop", title: "Desktop", purpose: "Use native workspaces, offline support and operating-system integration.", tasks: ["Check current server connection.", "Use managed transfers and windows where available.", "Reconnect before replaying offline changes."], recovery: "Unsynced offline changes should not be discarded to hide a connectivity error." },
  { screen: "myRecords", title: "My Records", purpose: "Find personal records delivered through the Packets workspace.", tasks: ["Review records assigned to you.", "Open the current published document when available.", "Complete required acknowledgements without requesting source Library access."], recovery: "An unavailable record may have been revoked, superseded, or restricted by audience policy." },
  { screen: "builds", title: "Builds", purpose: "Find Project-associated build and release evidence.", tasks: ["Select a Project to see its Builds.", "Review build status, version, and provenance.", "Inspect release blockers before sharing or publishing."], recovery: "Build records require current Project access; use Projects if a prior link is unavailable." },
  { screen: "qa", title: "Quality Assurance", purpose: "Review Project test plans, sessions, and validation evidence.", tasks: ["Open an authorized Project's QA workspace.", "Check current plan and session status.", "Link findings to Tickets and affected Builds where supported."], recovery: "Missing test results may reflect Project access, missing sessions, or an unavailable Build." },
  { screen: "activity", title: "Activity & Audit", purpose: "Inspect authorized Studio activity and operational evidence.", tasks: ["Filter the activity timeline.", "Follow an exact related record only while authorized.", "Use Operations for administrative audit and incident review."], recovery: "This view is limited to administrators; evidence visibility is governed by the server." },
  { screen: "inventory", title: "Inventory", purpose: "Track assigned equipment, licenses, entitlements, and managed key pools.", tasks: ["Find an Inventory record or assigned asset.", "Review owner, location, entitlement, and lifecycle state.", "Use authorized issuance or return workflows rather than copying protected keys."], recovery: "Inventory access does not automatically grant secret reveal or distribution rights." },
  { screen: "vault", title: "Vault", purpose: "Manage protected credentials with independent reveal and rotation authority.", tasks: ["Locate authorized secret records without exposing their values.", "Review access, expiration, and rotation requirements.", "Use audited reveal, rotation or revocation actions where permitted."], recovery: "Do not paste secret values into diagnostics, tickets, or regular Help requests." },
  { screen: "integrations", title: "Integrations", purpose: "Inspect connected services, providers, and delivery configurations.", tasks: ["Check provider connection and authorization status.", "Review configured webhooks and event delivery.", "Use health evidence to diagnose failures before reconnecting."], recovery: "A disconnected provider may require new credentials or an administrator-managed repair." },
  { screen: "changelog", title: "Changelog", purpose: "Read the changes and fixes included in Cluster versions.", tasks: ["Review recent features and behavior changes.", "Check whether a problem was addressed in a later release.", "Use diagnostics for current runtime information rather than assuming the changelog is live health data."], recovery: "Release notes describe shipped code; they do not certify the current server's health." },
] as const;

export function visibleHelpTopics(allowed: (screen: AppScreen) => boolean): ClusterHelpTopic[] {
  return CLUSTER_HELP_TOPICS.filter((topic) => allowed(topic.screen));
}

export function searchHelpTopics(topics: readonly ClusterHelpTopic[], query: string): ClusterHelpTopic[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [...topics];
  return topics.filter((topic) => tokens.every((token) => [topic.title, topic.purpose, ...topic.tasks, topic.recovery].join(" ").toLowerCase().includes(token)));
}

export const CLUSTER_OPEN_CONTEXTUAL_HELP_EVENT = "cluster:open-contextual-help";

/** Only standalone, permission-checked destinations may be opened from Help.
 * Record-specific screens (Project, Board, Whiteboard) require an explicit
 * authorized resource admission and are intentionally excluded. */
export const CLUSTER_HELP_NAVIGABLE_SCREENS: readonly AppScreen[] = [
  "dashboard", "projects", "tickets", "timeline", "calendar", "scheduler", "library",
  "packets", "people", "mywork", "inbox", "settings", "studioSettings",
  "serverConfig", "admin", "toolInfrastructure", "myRecords", "builds", "qa",
  "activity", "inventory", "vault", "integrations", "changelog",
];

export function canNavigateFromHelp(screen: AppScreen, allowed: (screen: AppScreen) => boolean): boolean {
  return CLUSTER_HELP_NAVIGABLE_SCREENS.includes(screen) && allowed(screen);
}
