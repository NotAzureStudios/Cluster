import { z } from "zod";
import { CLUSTER_PROJECT_TOOL_IDS, type ClusterProjectToolId } from "./cluster-manifest.js";

export type { ClusterProjectToolId };

export type ClusterProjectTypeCategory = "general" | "video" | "game" | "software" | "creative" | "marketing" | "event" | "operations";

export type ClusterProjectSourceControlMode = "off" | "optional" | "default" | "required";
export type ClusterProjectCapabilities = {
  sourceControl: ClusterProjectSourceControlMode;
  builds: boolean;
  qa: boolean;
  videoReview: boolean;
  library: boolean;
  boards: boolean;
  whiteboards: boolean;
  timeline: boolean;
  deliveries: boolean;
};
export type ClusterProjectSourceControlDefaults = {
  defaultBranch: string;
  lfs: boolean;
  ignoreTemplate: "generic" | "unreal" | "software";
};

export const CLUSTER_PROJECT_STATUSES = ["active", "on_hold", "paused", "completed", "cancelled"] as const;
export type ClusterProjectStatus = (typeof CLUSTER_PROJECT_STATUSES)[number];
export type ClusterProjectStatusTone = "good" | "warning" | "neutral" | "danger";
export const CLUSTER_PROJECT_STATUS_DEFINITIONS: ReadonlyArray<{
  value: ClusterProjectStatus;
  label: string;
  tone: ClusterProjectStatusTone;
  description: string;
}> = [
  { value: "active", label: "Active", tone: "good", description: "Currently moving." },
  { value: "on_hold", label: "On Hold", tone: "warning", description: "Temporarily paused for scheduling, staffing, or dependency reasons." },
  { value: "paused", label: "Paused", tone: "neutral", description: "Inactive but not closed." },
  { value: "completed", label: "Completed", tone: "good", description: "Delivered or wrapped." },
  { value: "cancelled", label: "Cancelled", tone: "danger", description: "Closed without further work." },
];

export type ClusterProjectWorkspaceEntityDefinition = {
  id: string;
  label: string;
  plural: string;
  baseKind: "phase" | "milestone" | "deliverable" | "issue" | "change_request" | "decision" | "baseline";
  statuses: string[];
  defaultStatus: string;
  stage?: string;
  description?: string;
};

export type ClusterProjectTypeDefinition = {
  id: string;
  label: string;
  category?: ClusterProjectTypeCategory | string;
  tracks: string[];
  note: string;
  buildProfileKey: string;
  boardColumns: string[];
  starterBoardName?: string;
  createFields?: string[];
  requiredFields?: string[];
  buildFields?: string[];
  qaFields?: string[];
  releaseFields?: string[];
  metadataFields?: string[];
  defaultStatuses?: string[];
  taskTemplates?: string[];
  timelineTemplate?: string;
  approvalRoles?: string[];
  defaultTools?: ClusterProjectToolId[];
  optionalTools?: ClusterProjectToolId[];
  hiddenTools?: ClusterProjectToolId[];
  capabilities?: Partial<ClusterProjectCapabilities>;
  sourceControlDefaults?: Partial<ClusterProjectSourceControlDefaults>;
  terminology?: Record<string, string>;
  productionHierarchy?: string[];
  deliveryStages?: string[];
  reviewStages?: string[];
  dashboardWidgets?: string[];
  productionTemplates?: string[];
  stageOwnership?: Record<string, string[]>;
  deliveryGatePolicy?: { requiredGateIds: string[]; optionalGateIds: string[]; channels?: string[] };
  workspaceEntities?: ClusterProjectWorkspaceEntityDefinition[];
  enabled?: boolean;
  locked?: boolean;
};

const toolIds: ClusterProjectToolId[] = [...CLUSTER_PROJECT_TOOL_IDS];
const commonTools: ClusterProjectToolId[] = ["overview", "intelligence", "plan", "control", "tickets", "boards", "whiteboards", "library", "assets", "people", "links", "access", "closeout"];
const deliveryTools: ClusterProjectToolId[] = ["builds", "qa"];

export const CLUSTER_PROJECT_TYPE_DEFINITIONS: ClusterProjectTypeDefinition[] = [
  {
    id: "general", label: "General", category: "general", tracks: ["studio"], note: "General planning, internal delivery, client work, or repository-backed projects.", buildProfileKey: "generic",
    boardColumns: ["Backlog", "To Do", "In Progress", "Review", "Done"], starterBoardName: "Project Delivery",
    defaultTools: [...commonTools, ...deliveryTools], optionalTools: ["source"], productionHierarchy: ["milestone", "workstream"], deliveryStages: ["plan", "production", "review", "complete"],
  },
  {
    id: "video", label: "Video Production", category: "video", tracks: ["video", "review", "media", "delivery"], note: "Production workspace for footage, editorial versions, frame-accurate review, approvals, and final deliverables.", buildProfileKey: "generic",
    boardColumns: ["Intake", "Production", "Review", "Changes", "Approved", "Delivered"], starterBoardName: "Video Production",
    defaultTools: [...commonTools, "viewer", "qa"], hiddenTools: ["source", "builds"], terminology: { qa: "Review QA", library: "Media Library", viewer: "Video Review" },
    productionHierarchy: ["episode", "sequence", "scene", "shot", "take"], deliveryStages: ["intake", "edit", "review", "picture_lock", "finishing", "master", "delivered"],
    reviewStages: ["rough_cut", "fine_cut", "picture_lock", "vfx", "color", "audio", "client", "final"], dashboardWidgets: ["video-review", "open-notes", "deliverables", "review-sessions"],
    productionTemplates: ["YouTube Video", "Commercial", "Short Film", "Social Campaign"], stageOwnership: { edit: ["editorial"], review: ["producer", "director"], picture_lock: ["editorial", "producer"], finishing: ["vfx", "color", "audio"], master: ["producer"], delivered: ["producer"] }, deliveryGatePolicy: { requiredGateIds: ["fixes_clear", "reviewer_approval", "no_active_hold"], optionalGateIds: ["release_notes", "delivery_schedule"], channels: ["internal", "release"] },
  },
  {
    id: "game", label: "Game Development", category: "game", tracks: ["game", "builds", "qa", "playtest", "release"], note: "Game production with features, content, builds, QA, playtests, platforms, milestones, and releases.", buildProfileKey: "generic",
    boardColumns: ["Backlog", "Ready", "In Progress", "Review", "QA", "Done"], starterBoardName: "Game Production",
    defaultTools: [...commonTools, "source", ...deliveryTools, "production"], productionHierarchy: ["milestone", "feature", "system", "level", "asset", "playtest"], workspaceEntities: [
      { id: "feature", label: "Feature", plural: "Features", baseKind: "deliverable", statuses: ["backlog", "ready", "in_progress", "review", "qa", "done"], defaultStatus: "backlog", stage: "development", description: "Player-facing or production feature tracked through implementation and validation." },
      { id: "system", label: "System", plural: "Systems", baseKind: "deliverable", statuses: ["design", "implementation", "integration", "qa", "done"], defaultStatus: "design", stage: "development", description: "Gameplay, engine, online, tools, or content system." },
      { id: "level", label: "Level / Map", plural: "Levels / Maps", baseKind: "deliverable", statuses: ["blockout", "production", "lighting", "review", "qa", "done"], defaultStatus: "blockout", stage: "development", description: "Playable world, map, level, or environment production unit." },
      { id: "asset", label: "Asset", plural: "Assets", baseKind: "deliverable", statuses: ["brief", "production", "review", "integration", "done"], defaultStatus: "brief", stage: "development", description: "Art, audio, animation, UI, narrative, or content asset." },
      { id: "playtest", label: "Playtest", plural: "Playtests", baseKind: "milestone", statuses: ["planned", "recruiting", "scheduled", "running", "analysis", "complete"], defaultStatus: "planned", stage: "playtest", description: "Structured internal or external playtest with findings and follow-up work." },
      { id: "platform", label: "Platform", plural: "Platforms", baseKind: "baseline", statuses: ["planned", "supported", "certification", "blocked", "released"], defaultStatus: "planned", stage: "release_candidate", description: "Target platform, certification surface, or distribution channel." },
      { id: "release", label: "Release", plural: "Releases", baseKind: "milestone", statuses: ["planned", "content_lock", "qa", "release_candidate", "released"], defaultStatus: "planned", stage: "release", description: "Playable release, update, candidate, or launch milestone." },
    ], deliveryStages: ["development", "content_lock", "playtest", "qa", "release_candidate", "release"], deliveryGatePolicy: { requiredGateIds: ["qa_pass", "fixes_clear", "rebuild_clear", "build_approval", "reviewer_approval", "no_active_hold"], optionalGateIds: ["release_notes", "delivery_schedule"], channels: ["internal", "release"] }, dashboardWidgets: ["build-health", "qa-status", "milestones", "playtests"], productionTemplates: ["Vertical Slice", "Content Update", "Release Candidate"], stageOwnership: { development: ["engineering", "design"], content_lock: ["production"], playtest: ["qa", "design"], qa: ["qa"], release_candidate: ["production", "qa"], release: ["production"] },
  },
  {
    id: "software", label: "Software Development", category: "software", tracks: ["software", "builds", "qa", "deployments", "release"], note: "Software delivery with features, bugs, environments, builds, QA, deployments, and releases.", buildProfileKey: "generic",
    boardColumns: ["Backlog", "Ready", "In Progress", "Review", "QA", "Released"], starterBoardName: "Software Delivery",
    defaultTools: [...commonTools, "source", ...deliveryTools, "production"], productionHierarchy: ["release", "epic", "feature", "bug", "change", "deployment"], workspaceEntities: [
      { id: "release", label: "Release", plural: "Releases", baseKind: "milestone", statuses: ["planned", "development", "qa", "staging", "released"], defaultStatus: "planned", stage: "production", description: "Versioned software release or production promotion milestone." },
      { id: "environment", label: "Environment", plural: "Environments", baseKind: "baseline", statuses: ["planned", "healthy", "degraded", "maintenance", "retired"], defaultStatus: "planned", stage: "staging", description: "Development, staging, production, or specialized runtime environment." },
      { id: "deployment", label: "Deployment", plural: "Deployments", baseKind: "deliverable", statuses: ["planned", "ready", "deploying", "verifying", "complete", "rolled_back"], defaultStatus: "planned", stage: "production", description: "Promotion of a release or change into a target environment." },
      { id: "incident", label: "Incident", plural: "Incidents", baseKind: "issue", statuses: ["open", "investigating", "mitigating", "monitoring", "resolved"], defaultStatus: "open", stage: "production", description: "Operational incident, regression, outage, or production defect." },
      { id: "change_request", label: "Change request", plural: "Change requests", baseKind: "change_request", statuses: ["draft", "review", "approved", "scheduled", "complete", "rejected"], defaultStatus: "draft", stage: "review", description: "Controlled product, infrastructure, scope, or release change." },
    ], deliveryStages: ["development", "review", "qa", "staging", "production"], deliveryGatePolicy: { requiredGateIds: ["qa_pass", "fixes_clear", "rebuild_clear", "build_approval", "reviewer_approval", "signed_artifact", "no_active_hold"], optionalGateIds: ["release_notes", "delivery_schedule"], channels: ["internal", "release", "production"] }, dashboardWidgets: ["build-health", "qa-status", "release-readiness", "deployments"], productionTemplates: ["Feature Release", "Hotfix", "Infrastructure Change"], stageOwnership: { development: ["engineering"], review: ["engineering"], qa: ["qa"], staging: ["engineering", "qa"], production: ["engineering", "operations"] },
  },
  {
    id: "creative", label: "Design / Creative", category: "creative", tracks: ["creative", "assets", "review", "delivery"], note: "Creative production with concepts, assets, iterations, review rounds, approvals, and deliverables.", buildProfileKey: "generic",
    boardColumns: ["Brief", "Concept", "Production", "Review", "Approved", "Delivered"], starterBoardName: "Creative Production",
    defaultTools: [...commonTools, "production"], optionalTools: ["viewer", "qa"], productionHierarchy: ["campaign", "collection", "concept", "asset", "variant"], workspaceEntities: [
      { id: "concept", label: "Concept", plural: "Concepts", baseKind: "deliverable", statuses: ["brief", "exploration", "review", "selected", "rejected"], defaultStatus: "brief", stage: "concept", description: "Creative direction, concept, treatment, or exploratory option." },
      { id: "asset", label: "Asset", plural: "Assets", baseKind: "deliverable", statuses: ["brief", "production", "review", "approved", "delivered"], defaultStatus: "brief", stage: "production", description: "Creative asset moving from brief through production and delivery." },
      { id: "iteration", label: "Iteration", plural: "Iterations", baseKind: "deliverable", statuses: ["working", "internal_review", "stakeholder_review", "changes", "approved"], defaultStatus: "working", stage: "review", description: "A reviewable design or creative iteration." },
      { id: "review_round", label: "Review round", plural: "Review rounds", baseKind: "milestone", statuses: ["planned", "open", "changes", "approved", "complete"], defaultStatus: "planned", stage: "review", description: "Internal, stakeholder, or client review checkpoint." },
      { id: "approval", label: "Approval", plural: "Approvals", baseKind: "decision", statuses: ["pending", "approved", "changes_requested", "rejected"], defaultStatus: "pending", stage: "approved", description: "Formal approval decision tied to a creative output or review round." },
      { id: "deliverable", label: "Deliverable", plural: "Deliverables", baseKind: "deliverable", statuses: ["planned", "production", "review", "approved", "delivered"], defaultStatus: "planned", stage: "delivered", description: "Final required creative output and delivery state." },
    ], deliveryStages: ["brief", "concept", "production", "review", "approved", "delivered"], reviewStages: ["internal", "stakeholder", "client", "final"], productionTemplates: ["Brand Asset", "Campaign Creative", "Design Review"], stageOwnership: { brief: ["creative", "production"], concept: ["creative"], production: ["creative"], review: ["creative", "stakeholder"], approved: ["creative"], delivered: ["production"] },
  },
  {
    id: "marketing", label: "Marketing / Campaign", category: "marketing", tracks: ["marketing", "campaign", "creative", "delivery"], note: "Campaign planning, creative production, channel delivery, review, launch, and performance follow-through.", buildProfileKey: "generic",
    boardColumns: ["Planning", "Production", "Review", "Scheduled", "Live", "Complete"], starterBoardName: "Campaign Delivery",
    defaultTools: [...commonTools, "production"], optionalTools: ["viewer", "qa"], productionHierarchy: ["campaign", "audience", "channel", "deliverable", "activation"], workspaceEntities: [
      { id: "campaign", label: "Campaign", plural: "Campaigns", baseKind: "milestone", statuses: ["planning", "production", "review", "scheduled", "live", "complete"], defaultStatus: "planning", stage: "planning", description: "Campaign-level outcome, launch window, audience, and delivery scope." },
      { id: "audience", label: "Audience", plural: "Audiences", baseKind: "baseline", statuses: ["draft", "validated", "active", "retired"], defaultStatus: "draft", stage: "planning", description: "Target audience or segment with messaging and channel assumptions." },
      { id: "channel", label: "Channel", plural: "Channels", baseKind: "baseline", statuses: ["planned", "ready", "scheduled", "live", "paused", "complete"], defaultStatus: "planned", stage: "scheduled", description: "Distribution channel, placement, publication surface, or campaign destination." },
      { id: "deliverable", label: "Campaign deliverable", plural: "Campaign deliverables", baseKind: "deliverable", statuses: ["brief", "production", "review", "approved", "scheduled", "delivered"], defaultStatus: "brief", stage: "production", description: "Creative, copy, media, landing page, or other campaign output." },
      { id: "activation", label: "Activation", plural: "Activations", baseKind: "deliverable", statuses: ["planned", "ready", "live", "monitoring", "complete"], defaultStatus: "planned", stage: "live", description: "Launch, placement, send, publish, or live campaign activation." },
      { id: "performance_report", label: "Performance report", plural: "Performance reports", baseKind: "baseline", statuses: ["planned", "collecting", "analysis", "complete"], defaultStatus: "planned", stage: "complete", description: "Post-launch measurement, findings, and follow-up recommendations." },
    ], deliveryStages: ["planning", "production", "review", "scheduled", "live", "complete"], dashboardWidgets: ["campaign-status", "deliverables", "launch-calendar", "channel-health"], productionTemplates: ["Campaign Launch", "Content Campaign", "Product Announcement"], stageOwnership: { planning: ["marketing", "strategy"], production: ["marketing", "creative"], review: ["marketing", "stakeholder"], scheduled: ["marketing"], live: ["marketing", "operations"], complete: ["marketing", "analytics"] },
  },
  {
    id: "event", label: "Event / Production", category: "event", tracks: ["event", "schedule", "resources", "delivery"], note: "Live or staged production with planning, crew, resources, run-of-show, execution, and wrap.", buildProfileKey: "generic",
    boardColumns: ["Planning", "Booked", "Ready", "Live", "Wrap", "Complete"], starterBoardName: "Event Production",
    defaultTools: [...commonTools, "production"], optionalTools: ["viewer"], productionHierarchy: ["event", "day", "session", "segment", "resource"], workspaceEntities: [
      { id: "event", label: "Event", plural: "Events", baseKind: "milestone", statuses: ["planning", "preproduction", "ready", "live", "wrap", "complete"], defaultStatus: "planning", stage: "planning", description: "Primary event, production day, or live delivery milestone." },
      { id: "session", label: "Session", plural: "Sessions", baseKind: "milestone", statuses: ["draft", "confirmed", "ready", "live", "complete", "cancelled"], defaultStatus: "draft", stage: "preproduction", description: "Session, segment, panel, performance, recording, or run-of-show block." },
      { id: "run_item", label: "Run-of-show item", plural: "Run-of-show items", baseKind: "deliverable", statuses: ["planned", "ready", "live", "complete", "skipped"], defaultStatus: "planned", stage: "live", description: "Timed cue, transition, action, or delivery item in the run of show." },
      { id: "resource", label: "Resource", plural: "Resources", baseKind: "baseline", statuses: ["requested", "held", "booked", "checked_out", "returned", "unavailable"], defaultStatus: "requested", stage: "preproduction", description: "Room, stage, equipment, vehicle, or production resource." },
      { id: "booking", label: "Booking", plural: "Bookings", baseKind: "baseline", statuses: ["requested", "tentative", "confirmed", "complete", "cancelled"], defaultStatus: "requested", stage: "preproduction", description: "Crew, vendor, venue, talent, or service booking." },
      { id: "event_issue", label: "Event issue", plural: "Event issues", baseKind: "issue", statuses: ["open", "triage", "mitigating", "resolved"], defaultStatus: "open", stage: "live", description: "Operational issue, contingency, safety concern, or delivery blocker." },
    ], deliveryStages: ["planning", "preproduction", "ready", "live", "wrap", "complete"], dashboardWidgets: ["run-of-show", "resource-readiness", "crew-coverage", "event-issues"], productionTemplates: ["Live Event", "Recording Day", "Conference Session"], stageOwnership: { planning: ["producer", "production"], preproduction: ["production", "operations"], ready: ["producer", "operations"], live: ["producer", "operations", "technical"], wrap: ["production"], complete: ["producer"] },
  },
  {
    id: "operations", label: "Internal / Operations", category: "operations", tracks: ["operations", "process", "service"], note: "Internal initiatives, recurring operations, service work, incidents, and process improvement.", buildProfileKey: "generic",
    boardColumns: ["Intake", "Queued", "In Progress", "Review", "Complete"], starterBoardName: "Operations",
    defaultTools: [...commonTools, "production"], hiddenTools: ["builds", "qa", "viewer"], productionHierarchy: ["initiative", "service", "run", "procedure", "improvement"], workspaceEntities: [
      { id: "initiative", label: "Initiative", plural: "Initiatives", baseKind: "milestone", statuses: ["intake", "planned", "active", "review", "complete"], defaultStatus: "intake", stage: "intake", description: "Internal operational initiative or coordinated improvement effort." },
      { id: "service_request", label: "Service request", plural: "Service requests", baseKind: "issue", statuses: ["intake", "queued", "active", "waiting", "resolved"], defaultStatus: "intake", stage: "active", description: "Internal request, service task, or operational support item." },
      { id: "procedure", label: "Procedure", plural: "Procedures", baseKind: "baseline", statuses: ["draft", "review", "active", "superseded", "retired"], defaultStatus: "draft", stage: "review", description: "Standard operating procedure, checklist, runbook, or policy-backed process." },
      { id: "recurring_run", label: "Recurring run", plural: "Recurring runs", baseKind: "deliverable", statuses: ["planned", "queued", "active", "complete", "missed"], defaultStatus: "planned", stage: "active", description: "Recurring operational cycle, maintenance run, review, or routine execution." },
      { id: "incident", label: "Operational incident", plural: "Operational incidents", baseKind: "issue", statuses: ["open", "investigating", "mitigating", "monitoring", "resolved"], defaultStatus: "open", stage: "active", description: "Operational interruption, service failure, or internal incident requiring coordinated response." },
      { id: "improvement", label: "Process improvement", plural: "Process improvements", baseKind: "change_request", statuses: ["proposed", "review", "approved", "active", "complete", "rejected"], defaultStatus: "proposed", stage: "review", description: "Controlled improvement to a recurring process, service, or operating standard." },
    ], deliveryStages: ["intake", "active", "review", "complete"], dashboardWidgets: ["service-queue", "recurring-runs", "incidents", "process-improvements"], productionTemplates: ["Operational Initiative", "Recurring Service", "Process Improvement"], stageOwnership: { intake: ["operations"], active: ["operations"], review: ["operations", "owner"], complete: ["operations"] },
  },
];

export type ClusterProductionProfileOverrides = Partial<Pick<ClusterProjectTypeDefinition,
  "tracks" | "boardColumns" | "starterBoardName" | "defaultTools" | "optionalTools" | "hiddenTools" | "productionHierarchy" | "deliveryStages"
>>;

export type ClusterProductionProfileDefinition = {
  id: string;
  label: string;
  purposeType: string;
  buildProfileKey: string;
  tracks: string[];
  note: string;
  classification: "standard" | "specialized";
  provider?: string;
  projectOverrides?: ClusterProductionProfileOverrides;
};

export const CLUSTER_PRODUCTION_PROFILE_DEFINITIONS: ClusterProductionProfileDefinition[] = [
  { id: "generic", label: "Generic", purposeType: "general", buildProfileKey: "generic", tracks: ["studio"], note: "No technology-specific production assumptions.", classification: "standard" },
  { id: "unreal", label: "Unreal Engine", purposeType: "game", buildProfileKey: "unreal", tracks: ["game", "unreal", "builds"], note: "Unreal Engine production, cooked builds, QA, and release candidates.", classification: "specialized", provider: "Epic", projectOverrides: { boardColumns: ["Backlog", "To Do", "In Progress", "Review", "Done"], starterBoardName: "Unreal Production", productionHierarchy: ["milestone", "feature", "system", "level", "asset"], deliveryStages: ["development", "content_lock", "qa", "release_candidate", "release"] } },
  { id: "unreal_video", label: "Unreal + Video", purposeType: "game", buildProfileKey: "unreal", tracks: ["game", "unreal", "video", "review", "builds"], note: "Game production with Unreal Engine plus capture/editorial delivery.", classification: "specialized", provider: "Epic", projectOverrides: { boardColumns: ["Backlog", "Production", "Capture", "Review", "Done"], starterBoardName: "Game + Video Delivery", productionHierarchy: ["milestone", "feature", "sequence", "shot"], deliveryStages: ["development", "capture", "edit", "review", "delivery"] } },
  { id: "blender", label: "Blender", purposeType: "creative", buildProfileKey: "blender", tracks: ["art", "export", "assets"], note: "Blender asset production, exports, renders, and review.", classification: "specialized", provider: "Blender", projectOverrides: { boardColumns: ["Brief", "Model", "Export", "Review", "Delivered"], starterBoardName: "Blender Asset Pipeline", optionalTools: ["qa", "viewer"], productionHierarchy: ["collection", "asset", "version"], deliveryStages: ["brief", "production", "review", "approved", "delivered"] } },
  { id: "uefn", label: "UEFN / Fortnite", purposeType: "game", buildProfileKey: "fortnite_island", tracks: ["game", "fortnite", "submission"], note: "UEFN island production, validation, playtests, and Creator Portal submission.", classification: "specialized", provider: "Epic", projectOverrides: { boardColumns: ["Layout", "Devices", "Playtest", "Submit"], starterBoardName: "Fortnite Island Pipeline", productionHierarchy: ["milestone", "island", "system", "content"], deliveryStages: ["development", "playtest", "validation", "submission", "published"] } },
  { id: "curseforge", label: "CurseForge Publishing", purposeType: "game", buildProfileKey: "generic", tracks: ["game", "curseforge", "publishing"], note: "CurseForge packaging, changelogs, QA, dependencies, and publishing.", classification: "specialized", provider: "Publishing", projectOverrides: { boardColumns: ["Dev", "Package", "Test", "Publish"], starterBoardName: "CurseForge Publishing", productionHierarchy: ["release", "package"], deliveryStages: ["development", "package", "test", "publish"] } },
  { id: "ark_mod", label: "ARK Mod", purposeType: "game", buildProfileKey: "ark_mod", tracks: ["game", "ark", "mod", "curseforge"], note: "ARK mod cooking, validation, and publishing.", classification: "specialized", provider: "Publishing", projectOverrides: { boardColumns: ["Dev", "Cook", "Test", "Publish"], starterBoardName: "ARK Mod Pipeline", productionHierarchy: ["release", "feature", "asset"], deliveryStages: ["development", "cook", "test", "publish"] } },
  { id: "ark_map", label: "ARK Map", purposeType: "game", buildProfileKey: "ark_map", tracks: ["game", "ark", "map", "curseforge"], note: "ARK map cooking, validation, and publishing.", classification: "specialized", provider: "Publishing", projectOverrides: { boardColumns: ["Dev", "Cook", "Test", "Publish"], starterBoardName: "ARK Map Pipeline", productionHierarchy: ["release", "region", "content"], deliveryStages: ["development", "cook", "test", "publish"] } },
  { id: "minecraft_map", label: "Minecraft Map", purposeType: "game", buildProfileKey: "minecraft_map", tracks: ["game", "minecraft", "map", "curseforge"], note: "Minecraft world packaging, QA, and publishing.", classification: "specialized", provider: "Publishing", projectOverrides: { boardColumns: ["Ideas", "Build", "Test", "Publish"], starterBoardName: "Minecraft Map Pipeline", productionHierarchy: ["release", "region", "content"], deliveryStages: ["development", "package", "test", "publish"] } },
  { id: "minecraft_mod", label: "Minecraft Mod", purposeType: "game", buildProfileKey: "minecraft_mod", tracks: ["game", "minecraft", "mod", "curseforge"], note: "Minecraft mod packaging, loader/dependency validation, QA, and publishing.", classification: "specialized", provider: "Publishing", projectOverrides: { boardColumns: ["Ideas", "Dev", "Test", "Publish"], starterBoardName: "Minecraft Mod Pipeline", productionHierarchy: ["release", "feature", "package"], deliveryStages: ["development", "package", "test", "publish"] } },
];

/** Studio opt-in: specialized profiles are unavailable for NEW projects by default.
 * An existing profile can still be presented for a retained Project. */
export function enabledClusterProductionProfiles(enabledIds: unknown, purposeType?: unknown, existingProfile?: unknown): ClusterProductionProfileDefinition[] {
  const enabled = new Set(Array.isArray(enabledIds) ? enabledIds.filter((id): id is string => typeof id === "string") : []);
  const purpose = typeof purposeType === "object" && purposeType !== null
    ? normalizeClusterProjectTypeId((purposeType as Partial<ClusterProjectTypeDefinition>).category || (purposeType as Partial<ClusterProjectTypeDefinition>).id)
    : purposeType ? normalizeClusterProjectTypeId(purposeType) : null;
  const retained = existingProfile ? normalizeClusterProjectTypeId(existingProfile) : null;
  return CLUSTER_PRODUCTION_PROFILE_DEFINITIONS.filter((profile) =>
    (profile.classification === "standard" || enabled.has(profile.id) || profile.id === retained)
    && (profile.id === "generic" || !purpose || profile.purposeType === purpose)
  );
}

export function resolveClusterProductionProfile(profile: unknown, projectType?: unknown) {
  const id = normalizeClusterProjectTypeId(profile || "generic");
  const direct = CLUSTER_PRODUCTION_PROFILE_DEFINITIONS.find((item) => item.id === id) || CLUSTER_PRODUCTION_PROFILE_DEFINITIONS[0];
  if (direct.id === "generic" || projectType === undefined || projectType === null || projectType === "") return direct;
  const projectDefinition = typeof projectType === "object" && projectType !== null ? projectType as Partial<ClusterProjectTypeDefinition> : null;
  const rawProjectType = normalizeClusterProjectTypeId(projectDefinition?.id || projectType);
  const knownPurpose = projectDefinition?.category
    ? normalizeClusterProjectTypeId(projectDefinition.category)
    : CLUSTER_PROJECT_TYPE_DEFINITIONS.find((item) => item.id === rawProjectType)?.category || null;
  if (!knownPurpose) return direct;
  return direct.purposeType === normalizeClusterProjectTypeId(knownPurpose) ? direct : CLUSTER_PRODUCTION_PROFILE_DEFINITIONS[0];
}

export function resolveClusterProjectDefinitionForProfile(definition: ClusterProjectTypeDefinition, productionProfile?: unknown): ClusterProjectTypeDefinition {
  const profile = resolveClusterProductionProfile(productionProfile, definition);
  const overrides = profile.projectOverrides || {};
  return {
    ...definition,
    ...overrides,
    id: definition.id,
    label: definition.label,
    category: definition.category,
    buildProfileKey: profile.id === "generic" ? definition.buildProfileKey : profile.buildProfileKey,
    tracks: Array.from(new Set([...(definition.tracks || []), ...(profile.tracks || []), ...(overrides.tracks || [])])),
  };
}

export const CLUSTER_PROJECT_LIFECYCLE_TRANSITIONS: Readonly<Record<ClusterProjectStatus, readonly ClusterProjectStatus[]>> = {
  active: ["on_hold", "paused", "completed", "cancelled"],
  on_hold: ["active", "paused", "cancelled"],
  paused: ["active", "on_hold", "cancelled"],
  completed: ["active"],
  cancelled: ["active"],
};

export function canTransitionClusterProjectStatus(from: unknown, to: unknown) {
  const source = String(from || "active") as ClusterProjectStatus;
  const target = String(to || "active") as ClusterProjectStatus;
  return source === target || Boolean(CLUSTER_PROJECT_LIFECYCLE_TRANSITIONS[source]?.includes(target));
}

export const clusterProjectTypeDefinitionSchema = z.object({
  id: z.string().trim().min(1).max(64), label: z.string().trim().min(1).max(80), category: z.string().trim().max(40).optional(),
  tracks: z.array(z.string().trim().min(1).max(48)).max(12).default([]), note: z.string().trim().max(400).default(""), buildProfileKey: z.string().trim().min(1).max(64).default("generic"),
  boardColumns: z.array(z.string().trim().min(1).max(80)).min(1).max(12), starterBoardName: z.string().trim().max(100).optional(),
  createFields: z.array(z.string().trim().min(1).max(80)).max(24).optional(), requiredFields: z.array(z.string().trim().min(1).max(80)).max(24).optional(),
  buildFields: z.array(z.string().trim().min(1).max(80)).max(24).optional(), qaFields: z.array(z.string().trim().min(1).max(80)).max(24).optional(), releaseFields: z.array(z.string().trim().min(1).max(80)).max(24).optional(),
  metadataFields: z.array(z.string().trim().min(1).max(80)).max(24).optional(), defaultStatuses: z.array(z.string().trim().min(1).max(48)).max(16).optional(), taskTemplates: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  timelineTemplate: z.string().trim().max(240).optional(), approvalRoles: z.array(z.string().trim().min(1).max(80)).max(16).optional(),
  defaultTools: z.array(z.enum(toolIds as [ClusterProjectToolId, ...ClusterProjectToolId[]])).max(toolIds.length).optional(), optionalTools: z.array(z.enum(toolIds as [ClusterProjectToolId, ...ClusterProjectToolId[]])).max(toolIds.length).optional(), hiddenTools: z.array(z.enum(toolIds as [ClusterProjectToolId, ...ClusterProjectToolId[]])).max(toolIds.length).optional(),
  capabilities: z.object({ sourceControl: z.enum(["off", "optional", "default", "required"]).optional(), builds: z.boolean().optional(), qa: z.boolean().optional(), videoReview: z.boolean().optional(), library: z.boolean().optional(), boards: z.boolean().optional(), whiteboards: z.boolean().optional(), timeline: z.boolean().optional(), deliveries: z.boolean().optional() }).optional(),
  sourceControlDefaults: z.object({ defaultBranch: z.string().trim().min(1).max(80).optional(), lfs: z.boolean().optional(), ignoreTemplate: z.enum(["generic", "unreal", "software"]).optional() }).optional(),
  terminology: z.record(z.string().trim().max(80)).optional(), productionHierarchy: z.array(z.string().trim().min(1).max(48)).max(12).optional(), deliveryStages: z.array(z.string().trim().min(1).max(48)).max(16).optional(), reviewStages: z.array(z.string().trim().min(1).max(48)).max(16).optional(), dashboardWidgets: z.array(z.string().trim().min(1).max(64)).max(16).optional(),
  productionTemplates: z.array(z.string().trim().min(1).max(120)).max(20).optional(), stageOwnership: z.record(z.array(z.string().trim().min(1).max(80)).max(12)).optional(), deliveryGatePolicy: z.object({ requiredGateIds: z.array(z.string().trim().min(1).max(80)).max(20).default([]), optionalGateIds: z.array(z.string().trim().min(1).max(80)).max(20).default([]), channels: z.array(z.string().trim().min(1).max(40)).max(8).optional() }).optional(),
  workspaceEntities: z.array(z.object({ id: z.string().trim().min(1).max(48), label: z.string().trim().min(1).max(80), plural: z.string().trim().min(1).max(100), baseKind: z.enum(["phase", "milestone", "deliverable", "issue", "change_request", "decision", "baseline"]), statuses: z.array(z.string().trim().min(1).max(48)).min(1).max(12), defaultStatus: z.string().trim().min(1).max(48), stage: z.string().trim().max(48).optional(), description: z.string().trim().max(240).optional() })).max(16).optional(),
  enabled: z.boolean().optional(), locked: z.boolean().optional(),
});

function uniqueStrings(values: unknown, fallback: string[] = [], limit = 24) {
  const source = Array.isArray(values) ? values : fallback;
  return Array.from(new Set(source.map((item) => String(item || "").trim()).filter(Boolean))).slice(0, limit);
}

export function normalizeClusterProjectTypeId(value: unknown) {
  return (String(value || "general").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64) || "general");
}

/** Disjoint On/Optional/Off categories. A tool has exactly one state.
 * Priority for malformed persisted input: On > Optional > Off.
 * Unspecified tools remain optional in UI, not force-hidden. */
export function resolveClusterProjectToolSets(
  defaultTools: readonly ClusterProjectToolId[],
  optionalTools: readonly ClusterProjectToolId[],
  hiddenTools: readonly ClusterProjectToolId[],
): Pick<ClusterProjectTypeDefinition, "defaultTools" | "optionalTools" | "hiddenTools"> {
  const on = Array.from(new Set(defaultTools.filter((tool) => toolIds.includes(tool))));
  const onSet = new Set(on);
  const optional = Array.from(new Set(optionalTools.filter((tool) => toolIds.includes(tool) && !onSet.has(tool))));
  const visibleSet = new Set([...on, ...optional]);
  const off = Array.from(new Set(hiddenTools.filter((tool) => toolIds.includes(tool) && !visibleSet.has(tool))));
  return { defaultTools: on, optionalTools: optional, hiddenTools: off };
}

export function setClusterProjectToolState(
  preset: Pick<ClusterProjectTypeDefinition, "defaultTools" | "optionalTools" | "hiddenTools">,
  tool: ClusterProjectToolId,
  state: "on" | "optional" | "off",
) {
  const current = resolveClusterProjectToolSets(preset.defaultTools || [], preset.optionalTools || [], preset.hiddenTools || []);
  if (!toolIds.includes(tool)) return current;
  const without = (arr: readonly ClusterProjectToolId[]) => arr.filter((value) => value !== tool);
  return resolveClusterProjectToolSets(
    state === "on" ? [...(current.defaultTools || []), tool] : without(current.defaultTools || []),
    state === "optional" ? [...(current.optionalTools || []), tool] : without(current.optionalTools || []),
    state === "off" ? [...(current.hiddenTools || []), tool] : without(current.hiddenTools || []),
  );
}

export function sanitizeClusterProjectTypeDefinition(input: Partial<ClusterProjectTypeDefinition> | null | undefined, fallback?: ClusterProjectTypeDefinition): ClusterProjectTypeDefinition {
  const base = fallback || CLUSTER_PROJECT_TYPE_DEFINITIONS[0];
  const label = String(input?.label || base.label || "Custom Project").trim().slice(0, 80) || "Custom Project";
  const category = String(input?.category || base.category || "general").trim().slice(0, 40);
  const categoryBase = CLUSTER_PROJECT_TYPE_DEFINITIONS.find((item) => item.id === category);
  const defaultToolDefaults = [...(base.defaultTools || commonTools)];
  if (["game", "software", "creative"].includes(category) && !defaultToolDefaults.includes("production")) defaultToolDefaults.push("production");
  const cleanTools = (values: unknown, defaults: ClusterProjectToolId[] = []) => uniqueStrings(values, defaults, toolIds.length).filter((item): item is ClusterProjectToolId => toolIds.includes(item as ClusterProjectToolId));
  const hiddenTools = cleanTools(input?.hiddenTools, base.hiddenTools || []);
  const hiddenToolSet = new Set(hiddenTools);
  const optionalTools = cleanTools(input?.optionalTools, base.optionalTools || []).filter((tool) => !hiddenToolSet.has(tool));
  const optionalToolSet = new Set(optionalTools);
  const defaultTools = cleanTools(input?.defaultTools, defaultToolDefaults).filter((tool) => !hiddenToolSet.has(tool) && !optionalToolSet.has(tool));
  const cleanWorkspaceEntities = (values: unknown, defaults: ClusterProjectWorkspaceEntityDefinition[] = []) => {
    const source = Array.isArray(values) ? values : defaults;
    const allowedKinds = new Set(["phase", "milestone", "deliverable", "issue", "change_request", "decision", "baseline"]);
    return source.filter((item): item is ClusterProjectWorkspaceEntityDefinition => Boolean(item && typeof item === "object")).map((item: any) => {
      const id = normalizeClusterProjectTypeId(item.id || item.label);
      const statuses = uniqueStrings(item.statuses, [item.defaultStatus || "planned"], 12);
      const defaultStatus = String(item.defaultStatus || statuses[0] || "planned").trim().slice(0, 48) || "planned";
      return { id, label: String(item.label || id.replace(/_/g, " ")).trim().slice(0, 80), plural: String(item.plural || `${item.label || id}s`).trim().slice(0, 100), baseKind: (allowedKinds.has(String(item.baseKind)) ? String(item.baseKind) : "deliverable") as ClusterProjectWorkspaceEntityDefinition["baseKind"], statuses: statuses.includes(defaultStatus) ? statuses : [defaultStatus, ...statuses].slice(0, 12), defaultStatus, stage: item.stage ? normalizeClusterProjectTypeId(item.stage) : undefined, description: item.description ? String(item.description).trim().slice(0, 240) : undefined };
    }).filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index).slice(0, 16);
  };
  return {
    id: normalizeClusterProjectTypeId(input?.id || base.id || label), label, category,
    tracks: uniqueStrings(input?.tracks, base.tracks || ["studio"], 12), note: String(input?.note || base.note || "Custom project workflow.").trim().slice(0, 400), buildProfileKey: normalizeClusterProjectTypeId(input?.buildProfileKey || base.buildProfileKey || "generic"),
    boardColumns: uniqueStrings(input?.boardColumns, base.boardColumns || ["Backlog", "To Do", "In Progress", "Review", "Done"], 12), starterBoardName: String(input?.starterBoardName || base.starterBoardName || `${label} Board`).trim().slice(0, 100),
    createFields: uniqueStrings(input?.createFields, base.createFields || [], 24), requiredFields: uniqueStrings(input?.requiredFields, base.requiredFields || [], 24), buildFields: uniqueStrings(input?.buildFields, base.buildFields || [], 24), qaFields: uniqueStrings(input?.qaFields, base.qaFields || [], 24), releaseFields: uniqueStrings(input?.releaseFields, base.releaseFields || [], 24), metadataFields: uniqueStrings(input?.metadataFields, base.metadataFields || [], 24), defaultStatuses: uniqueStrings(input?.defaultStatuses, base.defaultStatuses || ["active", "review", "done"], 16), taskTemplates: uniqueStrings(input?.taskTemplates, base.taskTemplates || [], 20), timelineTemplate: String(input?.timelineTemplate || base.timelineTemplate || "Intake → Production → Review → Delivery").trim().slice(0, 240), approvalRoles: uniqueStrings(input?.approvalRoles, base.approvalRoles || ["owner", "admin", "producer", "qa lead"], 16),
    ...resolveClusterProjectToolSets(
      cleanTools(input?.defaultTools, defaultToolDefaults),
      cleanTools(input?.optionalTools, base.optionalTools || []),
      cleanTools(input?.hiddenTools, base.hiddenTools || []),
    ),
    capabilities: { ...(base.capabilities || {}), ...(input?.capabilities || {}) }, sourceControlDefaults: { ...(base.sourceControlDefaults || {}), ...(input?.sourceControlDefaults || {}) },
    terminology: { ...(base.terminology || {}), ...(input?.terminology || {}) }, productionHierarchy: uniqueStrings(input?.productionHierarchy, base.productionHierarchy || [], 12), deliveryStages: uniqueStrings(input?.deliveryStages, base.deliveryStages || [], 16), reviewStages: uniqueStrings(input?.reviewStages, base.reviewStages || [], 16), dashboardWidgets: uniqueStrings(input?.dashboardWidgets, base.dashboardWidgets || [], 16), productionTemplates: uniqueStrings(input?.productionTemplates, base.productionTemplates || categoryBase?.productionTemplates || [], 20), stageOwnership: { ...(categoryBase?.stageOwnership || {}), ...(base.stageOwnership || {}), ...(input?.stageOwnership || {}) }, deliveryGatePolicy: { requiredGateIds: uniqueStrings(input?.deliveryGatePolicy?.requiredGateIds, base.deliveryGatePolicy?.requiredGateIds || categoryBase?.deliveryGatePolicy?.requiredGateIds || [], 20), optionalGateIds: uniqueStrings(input?.deliveryGatePolicy?.optionalGateIds, base.deliveryGatePolicy?.optionalGateIds || categoryBase?.deliveryGatePolicy?.optionalGateIds || [], 20), channels: uniqueStrings(input?.deliveryGatePolicy?.channels, base.deliveryGatePolicy?.channels || categoryBase?.deliveryGatePolicy?.channels || ["internal", "release"], 8) }, workspaceEntities: cleanWorkspaceEntities(input?.workspaceEntities, base.workspaceEntities || categoryBase?.workspaceEntities || []),
    enabled: input?.enabled !== false, locked: Boolean(input?.locked),
  };
}

export function resolveClusterProjectTypes(custom?: unknown): ClusterProjectTypeDefinition[] {
  const builtIns = new Map(CLUSTER_PROJECT_TYPE_DEFINITIONS.map((item) => [item.id, sanitizeClusterProjectTypeDefinition(item, item)]));
  if (Array.isArray(custom)) {
    for (const raw of custom) {
      if (!raw || typeof raw !== "object") continue;
      const candidate = raw as Partial<ClusterProjectTypeDefinition>;
      const id = normalizeClusterProjectTypeId(candidate.id || candidate.label);
      const fallback = builtIns.get(id);
      const clean = sanitizeClusterProjectTypeDefinition(candidate, fallback);
      if (clean.enabled === false) builtIns.delete(clean.id); else builtIns.set(clean.id, clean);
    }
  }
  return Array.from(builtIns.values());
}

export function resolveClusterProjectType(type: unknown, custom?: unknown) {
  const id = normalizeClusterProjectTypeId(type);
  const definitions = resolveClusterProjectTypes(custom);
  return definitions.find((item) => item.id === id) || definitions.find((item) => item.id === "general") || definitions[0];
}


export function clusterProjectCapabilitiesForDefinition(definition: ClusterProjectTypeDefinition, productionProfile?: unknown): ClusterProjectCapabilities {
  const effective = resolveClusterProjectDefinitionForProfile(definition, productionProfile);
  const defaults = new Set(effective.defaultTools || []);
  const optional = new Set(effective.optionalTools || []);
  const hidden = new Set(effective.hiddenTools || []);
  const category = String(effective.category || "general");
  let sourceControl: ClusterProjectSourceControlMode = hidden.has("source") ? "off" : effective.capabilities?.sourceControl ?? (defaults.has("source") || category === "game" || category === "software" ? "default" : optional.has("source") ? "optional" : "off");
  const profile = resolveClusterProductionProfile(productionProfile, definition);
  if (profile.id === "unreal") sourceControl = "required";
  return {
    sourceControl,
    builds: effective.capabilities?.builds ?? (!hidden.has("builds") && defaults.has("builds")),
    qa: effective.capabilities?.qa ?? (!hidden.has("qa") && defaults.has("qa")),
    videoReview: effective.capabilities?.videoReview ?? (!hidden.has("viewer") && defaults.has("viewer")),
    library: effective.capabilities?.library ?? (!hidden.has("library") && defaults.has("library")),
    boards: effective.capabilities?.boards ?? (!hidden.has("boards") && defaults.has("boards")),
    whiteboards: effective.capabilities?.whiteboards ?? (!hidden.has("whiteboards") && defaults.has("whiteboards")),
    timeline: effective.capabilities?.timeline ?? (!hidden.has("plan") && defaults.has("plan")),
    deliveries: effective.capabilities?.deliveries ?? Boolean((effective.deliveryStages || []).length || defaults.has("builds") || defaults.has("qa")),
  };
}

export function resolveClusterProjectCapabilities(type: unknown, custom?: unknown, productionProfile?: unknown): ClusterProjectCapabilities {
  return clusterProjectCapabilitiesForDefinition(resolveClusterProjectType(type, custom), productionProfile);
}

export function clusterProjectSourceControlDefaultsForDefinition(definition: ClusterProjectTypeDefinition, productionProfile?: unknown): ClusterProjectSourceControlDefaults {
  const effective = resolveClusterProjectDefinitionForProfile(definition, productionProfile);
  const profile = resolveClusterProductionProfile(productionProfile, definition);
  const unreal = profile.id === "unreal" || effective.buildProfileKey === "unreal" || effective.tracks.includes("unreal");
  const software = String(effective.category || "") === "software";
  return {
    defaultBranch: String(effective.sourceControlDefaults?.defaultBranch || "main").trim() || "main",
    lfs: effective.sourceControlDefaults?.lfs ?? unreal,
    ignoreTemplate: effective.sourceControlDefaults?.ignoreTemplate || (unreal ? "unreal" : software ? "software" : "generic"),
  };
}

export function resolveClusterProjectSourceControlDefaults(type: unknown, custom?: unknown, productionProfile?: unknown): ClusterProjectSourceControlDefaults {
  return clusterProjectSourceControlDefaultsForDefinition(resolveClusterProjectType(type, custom), productionProfile);
}


export function resolveClusterProjectPurposeTypes(custom?: unknown): ClusterProjectTypeDefinition[] {
  return resolveClusterProjectTypes(custom);
}
