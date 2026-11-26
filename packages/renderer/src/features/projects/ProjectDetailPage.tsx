import { ClusterButton } from "../../components/ClusterButton";
import { CollaborationPanel } from "../../components/CollaborationPanel";
import { ClusterDisclosureGroup } from "../../components/ClusterDisclosureGroup";
import { clusterProjectCapabilitiesForDefinition } from "@cluster/shared";
import type * as React from "react";
import { Suspense, useState, type ComponentType } from "react";
import { ClusterStatus } from "../../components/ClusterStatus";
import { ProjectFileDropZone, ProjectOverviewWorkbench } from "./ProjectOverviewWorkbench";
import { ProjectPinnedLinks } from "./ProjectPinnedLinks";
import { ProjectWorkList } from "./ProjectWorkList";
import { useProjectFocus } from "./project-focus";
import { LazyLibraryWorkspacePage } from "../application/application-entrypoints";
import { api } from "../../core/api";
import { canUseTool } from "../../core/permissions";
import { requestSecurityPin, requestSecurityPinSetup } from "../../core/security-pin";
import {
  isVideoProject,
  projectAssignedIds,
  projectCompleteness,
  projectMemberIds,
  projectMemberRoles,
  projectHasDiscord,
  projectHasGit,
  projectSetupGaps,
} from "./projects-utils";
import type {
  BoardSummary,
  Project,
  ProjectTypePreset,
  BuildArtifactRecord,
  User,
  ReviewAsset,
  WhiteboardSummary,
  WorkLinkRecord,
  LibraryItem,
  AccessTargetKind,
} from "../application/application-models";
import { ProjectOverviewDashboard } from "./ProjectOverviewDashboard";
import { ProjectPlanningPanel, type ProjectPlanDraft } from "./ProjectPlanningPanel";
import { ProjectTeamPanel } from "./ProjectTeamPanel";
import { ProjectConnectionsPanel, type ProjectConnectionsDraft } from "./ProjectConnectionsPanel";
import { ProjectChangesPanel } from "./ProjectChangesPanel";
import { ProjectResourceHubPanel } from "./ProjectResourceHubPanel";
import { ProjectControlCenterPanel } from "./ProjectControlCenterPanel";
import { SettingsWorkspaceShell } from "../../components/SettingsWorkspaceShell";

/* Settings holds configuration only: details, integrations, access.
   Plan (the control center) is work and has its own tab; Closeout is a
   lifecycle step opened from the header menu. */
// Settings holds project details, crew, integrations and access.
const PROJECT_SETTINGS_SECTION_IDS: readonly string[] = ["plan", "people", "links", "access"];
// Parked: the planning console, intelligence, production entities, assets,
// closeout and whiteboards stay built but leave the tab bar for now. QA is
// reached from Builds rather than its own tab.
const PARKED_PROJECT_TABS: readonly string[] = ["intelligence", "control", "production", "assets", "closeout", "whiteboards"];
const SECONDARY_PROJECT_TABS: readonly string[] = ["qa"];
import { ProjectIntelligencePanel } from "./ProjectIntelligencePanel";
import { ProjectVideoWorkspace } from "./ProjectVideoWorkspace";
import { ProjectAssetWorkspace } from "./ProjectAssetWorkspace";
import { ProjectTypeProductionWorkspace } from "./ProjectTypeProductionWorkspace";
import { ProjectWorkflowHandoffPanel } from "./ProjectWorkflowHandoffPanel";
import { getProjectCapabilities } from "./project-access-policy";
import { useProjectDetailWorkspace } from "./useProjectDetailWorkspace";
import { ProjectDetailHeader, type ProjectDetailTab } from "./ProjectDetailHeader";
import { PROJECT_WORKSPACE_SECTIONS, type ProjectWorkspaceTabId } from "./project-workspace-registry";
import "./project-detail.css";
import "./project-detail-workspace.css";
import "./project-portfolio.css";
import { runtimeStyle } from "../../core/runtime-style";
import { ProjectCollaborationStrip } from "../collaboration";

export interface ProjectDetailHelpers {
  readFileAsDataUrl: (file: File) => Promise<string>;
  parseTimecode: (value: string) => number;
  secondsToTimecode: (value?: number | null) => string;
  projectTypeMeta: (projectType?: string | null) => ProjectTypePreset;
  canUseEntityAccess: (user: User | null | undefined, targetKind: AccessTargetKind, targetId: string, project?: Project | null) => boolean;
  canUseLibraryItem: (user: User | null | undefined, item: LibraryItem, project?: Project | null) => boolean;
  projectHasBuildSignals: (project: Project, artifacts?: BuildArtifactRecord[]) => boolean;
  normalizeLinkRecord: (record: WorkLinkRecord) => WorkLinkRecord;
  isBlockingRelationship: (relationship?: string | null) => boolean;
  isPast: (value?: string | null) => boolean;
  bytesToSize: (value?: number | null) => string;
  videoAssetUrl: (video: ReviewAsset) => string;
}

export interface ProjectDetailComponents {
  ProjectHealthStripAdapter: ComponentType<any>;
  RelatedRecordsPanel: ComponentType<any>;
  CustomFieldValuesPanel: ComponentType<any>;
  VersionHistoryPanel: ComponentType<any>;
  ProjectBuildsPanel: ComponentType<any>;
  ProjectQAPanel: ComponentType<any>;
  ProjectAccessPanel: ComponentType<any>;
  CloseoutPortalPanel: ComponentType<any>;
}

export interface ProjectDetailPageProps {
  project: Project | null;
  projects: Project[];
  whiteboards: WhiteboardSummary[];
  currentUser: User;
  onBack: () => void;
  onOpenBoard: (boardId: string) => void;
  onOpenWhiteboard: (whiteboardId: string) => void;
  onOpenLibrary: (folderId: string) => void;
  onOpenTimeline: () => void;
  onOpenTickets: (projectId: string) => void;
  onOpenTime: (projectId: string) => void;
  onReloadProjects: () => Promise<void>;
  onReloadWhiteboards: () => Promise<void>;
  helpers: ProjectDetailHelpers;
  components: ProjectDetailComponents;
}

export function ProjectDetailPage({ project, projects, whiteboards, currentUser, onBack, onOpenBoard, onOpenWhiteboard, onOpenLibrary, onOpenTimeline, onOpenTickets, onOpenTime, onReloadProjects, onReloadWhiteboards, helpers, components }: ProjectDetailPageProps) {
  const { parseTimecode, secondsToTimecode, projectTypeMeta, canUseEntityAccess, canUseLibraryItem, projectHasBuildSignals, normalizeLinkRecord, isBlockingRelationship, isPast, bytesToSize, videoAssetUrl } = helpers;
  const { ProjectHealthStripAdapter, RelatedRecordsPanel, CustomFieldValuesPanel, VersionHistoryPanel, ProjectBuildsPanel, ProjectQAPanel, ProjectAccessPanel, CloseoutPortalPanel } = components;
  const {
    tab,
    setTab,
    media,
    mediaStatus,
    setMediaStatus,
    dashboard,
    snapshot,
    dashboardLoading,
    controlCenter,
    controlLoading,
    intelligence,
    intelligenceLoading,
    projectUsers,
    qaPlans: workflowQaPlans,
    buildArtifacts: workflowBuildArtifacts,
    qaSessions: workflowQaSessions,
    workflowLinks,
    loadMedia,
    updateMedia,
    loadProjectSnapshot,
    loadProjectDashboard,
    loadProjectControlCenter,
    loadProjectIntelligence,
  } = useProjectDetailWorkspace(project?.id);
  const { focus: projectFocus, reload: reloadProjectFocus } = useProjectFocus(project?.id || "");
  const [projectSaveBusy, setProjectSaveBusy] = useState(false);
  const [projectSaveStatus, setProjectSaveStatus] = useState("");
  const projectWhiteboards = project ? (project.whiteboards?.length ? project.whiteboards : whiteboards.filter((whiteboard) => whiteboard.projectId === project.id)) : [];
  if (!project) {
    return (
      <section className="page">
        <div className="empty-state panel">
          <h2>No project</h2>
          <p>Pick a project first.</p>
          <ClusterButton type="button" className="" onClick={onBack} variant="secondary">
            Back
          </ClusterButton>
        </div>
      </section>
    );
  }
  async function createBoardForProject(nameOverride?: string) {
    const name = nameOverride?.trim() || `${project!.name} Board`;
    const created = await api<BoardSummary>(`/api/projects/${project!.id}/boards`, {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    await onReloadProjects();
    onOpenBoard(created.id);
  }
  async function createWhiteboardForProject(nameOverride?: string) {
    const name = nameOverride?.trim() || `${project!.name} Whiteboard`;
    const created = await api<WhiteboardSummary>("/api/whiteboards", {
      method: "POST",
      body: JSON.stringify({ name, projectId: project!.id, description: "" }),
    });
    await onReloadWhiteboards();
    onOpenWhiteboard(created.id);
  }
  async function saveProjectPlan(draft: ProjectPlanDraft) {
    if (!project || !getProjectCapabilities(currentUser, project).canEditProject) return;
    setProjectSaveBusy(true);
    setProjectSaveStatus("Saving project plan…");
    try {
      let pin: string | undefined;
      if (draft.status === "completed" && project.status !== "completed") {
        pin = currentUser?.pinConfigured
          ? await requestSecurityPin({
              title: "Complete project",
              description: "Enter your security PIN to submit project completion.",
              purpose: "submit_project_completion",
              confirmLabel: "Complete project",
            }) || undefined
          : await requestSecurityPinSetup({
              title: "Create security PIN",
              description: "Create a PIN before completing a project.",
              purpose: "setup_for_project_completion",
            }) || undefined;
        if (!pin) {
          setProjectSaveStatus("Project completion was cancelled.");
          return;
        }
      }
      await api(`/api/projects/${project.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: draft.name.trim(),
          externalName: draft.externalName.trim() || null,
          codename: draft.codename.trim() || null,
          aliases: draft.aliases.split(",").map((alias) => alias.trim()).filter(Boolean),
          description: draft.description.trim() || null,
          objective: draft.objective.trim() || null,
          clientName: draft.clientName.trim() || null,
          departmentId: draft.departmentId || null,
          startDate: draft.startDate || null,
          targetDate: draft.targetDate || null,
          priority: draft.priority,
          tags: draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
          color: draft.color || null,
          iconId: draft.iconId,
          healthNote: draft.healthNote.trim() || null,
          status: draft.status,
          pin,
          expectedRevision: project.revision,
        }),
      });
      await onReloadProjects();
      await Promise.all([loadProjectSnapshot(), loadProjectDashboard()]);
      setProjectSaveStatus("Project plan saved.");
    } catch (error) {
      setProjectSaveStatus(error instanceof Error ? error.message : "Project plan could not be saved.");
    } finally {
      setProjectSaveBusy(false);
    }
  }
  async function uploadProjectIcon(file: File) {
    if (!project || !getProjectCapabilities(currentUser, project).canEditProject) throw new Error("Project edit permission required.");
    if (!(["image/png", "image/jpeg", "image/webp"].includes(file.type)) || file.size > 5 * 1024 * 1024) throw new Error("Choose a PNG, JPG or WebP up to 5 MB.");
    // Resize locally before upload; the server still verifies image content, scope and revision.
    const bitmap = await createImageBitmap(file);
    try {
      const canvas = document.createElement("canvas"); canvas.width=256;canvas.height=256;
      const context = canvas.getContext("2d"); if (!context) throw new Error("Image processing unavailable.");
      const side = Math.min(bitmap.width, bitmap.height);
      context.drawImage(bitmap, (bitmap.width-side)/2, (bitmap.height-side)/2, side, side, 0, 0, 256, 256);
      const dataUrl = canvas.toDataURL("image/png");
      await api(`/api/projects/${encodeURIComponent(project.id)}/icon`, { method: "POST", body: JSON.stringify({ originalName: "project-icon.png", mimeType: "image/png", sizeBytes: Math.round(dataUrl.length*0.75), dataUrl, expectedRevision: project.revision }) });
      await onReloadProjects();
    } finally { bitmap.close(); }
  }
  async function runProjectLifecycleAction(action: "cancel" | "reactivate" | "complete" | "reopen", reason: string) {
    if (!project || !getProjectCapabilities(currentUser, project).canManage) return;
    setProjectSaveBusy(true);
    setProjectSaveStatus({ cancel: "Cancelling project…", reactivate: "Reactivating project…", complete: "Completing project…", reopen: "Reopening project…" }[action]);
    try {
      await api(`/api/projects/${project.id}/lifecycle`, {
        method: "POST",
        body: JSON.stringify({ action, reason: reason || null, expectedRevision: project.revision }),
      });
      await onReloadProjects();
      await Promise.all([loadProjectSnapshot(), loadProjectDashboard()]);
      setProjectSaveStatus({ cancel: "Project cancelled.", reactivate: "Project reactivated.", complete: "Project marked complete.", reopen: "Project reopened." }[action]);
    } catch (error) {
      setProjectSaveStatus(error instanceof Error ? error.message : "Project lifecycle could not be changed.");
    } finally {
      setProjectSaveBusy(false);
    }
  }

  async function saveProjectTeam(memberIds: string[], teamRoles: Record<string, string>) {
    if (!project || !getProjectCapabilities(currentUser, project).canManageTeam) return;
    setProjectSaveBusy(true);
    setProjectSaveStatus("Saving project team…");
    try {
      await api(`/api/projects/${project.id}`, {
        method: "PATCH",
        body: JSON.stringify({ memberIds, memberRoles: teamRoles, expectedRevision: project.revision }),
      });
      await onReloadProjects();
      await loadProjectSnapshot();
      setProjectSaveStatus("Project team saved.");
    } catch (error) {
      setProjectSaveStatus(error instanceof Error ? error.message : "Project team could not be saved.");
    } finally {
      setProjectSaveBusy(false);
    }
  }
  async function saveProjectConnections(draft: ProjectConnectionsDraft) {
    if (!project || !getProjectCapabilities(currentUser, project).canManageConnections) return;
    setProjectSaveBusy(true);
    setProjectSaveStatus("Saving project integrations…");
    try {
      await api(`/api/projects/${project.id}/connections`, {
        method: "PUT",
        body: JSON.stringify({
          repositoryId: draft.repositoryId || null,
          discordConnectionId: draft.discordConnectionId || null,
          expectedRevision: project.revision,
        }),
      });
      await onReloadProjects();
      setProjectSaveStatus("Project integrations saved.");
    } catch (error) {
      setProjectSaveStatus(error instanceof Error ? error.message : "Project integrations could not be saved.");
    } finally {
      setProjectSaveBusy(false);
    }
  }
  async function refreshAfterCloseout() {
    await onReloadProjects();
    await Promise.all([loadProjectSnapshot(), loadProjectDashboard(), loadProjectControlCenter()]);
  }
  const type = projectTypeMeta(project.projectType);
  const capabilities = getProjectCapabilities(currentUser, project);
  const videoEnabled = isVideoProject(project);
  const isVideoType = type.category === "video" || type.id === "video";
  const readiness = snapshot?.readiness.score ?? projectCompleteness(project);
  const assignedIds = projectAssignedIds(project);
  const setupGaps = snapshot?.readiness.gaps ?? projectSetupGaps(project);
  const visibleBoards = project.boards.filter((board) => canUseEntityAccess(currentUser, "board", board.id, project));
  const visibleWhiteboards = projectWhiteboards.filter((whiteboard) => canUseEntityAccess(currentUser, "whiteboard", whiteboard.id, project));
  const visibleFiles = media.files.filter((file) => canUseEntityAccess(currentUser, "file", file.id, project));
  const visibleVideos = media.reviewAssets.filter((video) => canUseEntityAccess(currentUser, "review_asset", video.id, project));
  const visibleDocuments = (project.libraryItems || []).filter((item) => canUseLibraryItem(currentUser, item, project));
  const reviewOpenNoteCount = visibleVideos.reduce((total: number, video: ReviewAsset) => total + (video.comments || []).filter((comment) => (comment.status || "open") !== "resolved").length, 0);
  const primaryBoard = visibleBoards[0] || null;
  const primaryWhiteboard = visibleWhiteboards[0] || null;
  const teamCrewIds = (projectFocus?.teams || []).flatMap((team) => team.memberIds);
  const assignedSet = new Set([...assignedIds, ...teamCrewIds]);
  const projectTeamMembers = projectUsers
    .filter((user) => assignedSet.has(user.id))
    .map((user) => ({
      id: user.id,
      name: user.displayName || user.username || "Project member",
      avatarUrl: user.avatarUrl,
      personalAccentColor: user.personalAccentColor,
      status: user.status,
      lastSeenAt: user.lastSeenAt,
      archived: user.archived,
      connectionVisibility: user.connectionVisibility,
    }));
  const projectQaPlanCount = workflowQaPlans.length;
  const projectBuildArtifacts = workflowBuildArtifacts;
  const projectQaSessions = workflowQaSessions;
  const projectTypeCapabilities = clusterProjectCapabilitiesForDefinition(type, project.productionProfile);
  const supportsBuilds = projectTypeCapabilities.builds;
  const supportsQa = projectTypeCapabilities.qa;
  const supportsSource = projectTypeCapabilities.sourceControl !== "off";
  const setupChecklist = [
    { label: "Brief", done: Boolean(project.description) },
    { label: "Objective", done: Boolean(project.objective) },
    { label: "Target", done: Boolean(project.targetDate) },
    { label: "Board", done: visibleBoards.length > 0 },
    { label: "Lead", done: assignedIds.length > 0 },
    { label: "Library", done: Boolean(project.libraryFolderId) },
    ...(isVideoType ? [{ label: "Review media", done: visibleVideos.length > 0 }] : []),
    ...(supportsBuilds ? [{ label: "Build track", done: projectHasBuildSignals(project, projectBuildArtifacts) }] : []),
    ...(supportsSource ? [{ label: "Source", done: projectHasGit(project) }] : []),
  ];
  const activeQaSessionCount = projectQaSessions.filter((session) => ["planned", "running"].includes(session.status)).length;
  const failedBuildCount = projectBuildArtifacts.filter((artifact) => artifact.qaStatus === "failed" || artifact.approval === "blocked").length;
  const passedBuildCount = projectBuildArtifacts.filter((artifact) => artifact.qaStatus === "passed").length;
  const projectRelationshipLinks = workflowLinks
    .map(normalizeLinkRecord)
    .filter((link) => link.projectId === project.id || link.source?.projectId === project.id || link.target?.projectId === project.id);
  const durableRelationships = controlCenter?.relationships || [];
  const projectTicketLinkCount = projectRelationshipLinks.filter((link) => String(link.source?.kind) === "ticket" || String(link.target?.kind) === "ticket").length
    + durableRelationships.filter((link) => link.sourceType === "ticket" || link.targetType === "ticket").length;
  const projectBlockerCount = projectRelationshipLinks.filter((link) => link.status === "blocked" || isBlockingRelationship(link.relationship)).length
    + durableRelationships.filter((link) => link.critical || isBlockingRelationship(link.relationship)).length;
  const projectOverdueLinkCount = projectRelationshipLinks.filter((link) => link.dueDate && isPast(link.dueDate) && link.status !== "resolved").length;
  const projectToolIds = new Set([...(type.defaultTools || []), ...(type.optionalTools || [])]);
  const hiddenToolIds = new Set(type.hiddenTools || []);
  const applyCapability = (tool: "source" | "builds" | "qa" | "viewer", enabled: boolean) => { if (enabled) { projectToolIds.add(tool); hiddenToolIds.delete(tool); } else { projectToolIds.delete(tool); hiddenToolIds.add(tool); } };
  applyCapability("source", supportsSource); applyCapability("builds", supportsBuilds); applyCapability("qa", supportsQa); applyCapability("viewer", projectTypeCapabilities.videoReview);
  const toolLabel = (id: string, fallback: string) => type.terminology?.[id] || fallback;
  const productionLabel = type.category === "game" ? "Production" : type.category === "software" ? "Delivery" : type.category === "creative" ? "Studio" : "Production";
  const tabDetails: Record<ProjectWorkspaceTabId, string> = {
    overview: "",
    intelligence: intelligence ? `${intelligence.score}%` : "",
    plan: project.targetDate ? new Date(project.targetDate).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "setup",
    control: controlCenter?.summary.attention.length ? `${controlCenter.summary.attention.length}` : controlCenter?.records.length ? `${controlCenter.records.length}` : "setup",
    tickets: projectTicketLinkCount ? `${projectTicketLinkCount}` : "",
    source: projectHasGit(project) ? (project.sourceBindings?.find((binding) => binding.isPrimary)?.repository?.defaultBranch || "linked") : "",
    builds: projectBuildArtifacts.length ? `${projectBuildArtifacts.length}` : projectHasBuildSignals(project, projectBuildArtifacts) ? "live" : "",
    qa: activeQaSessionCount ? `${activeQaSessionCount}` : projectQaPlanCount ? `${projectQaPlanCount}` : "",
    boards: visibleBoards.length ? `${visibleBoards.length}` : "",
    whiteboards: visibleWhiteboards.length ? `${visibleWhiteboards.length}` : "",
    library: project.libraryFolderId ? "linked" : "",
    assets: visibleFiles.length ? `${visibleFiles.length}` : "",
    production: type.workspaceEntities?.length ? `${type.workspaceEntities.length} types` : "",
    viewer: videoEnabled && visibleVideos.length ? `${visibleVideos.length}` : "",
    people: assignedIds.length ? `${assignedIds.length}` : "",
    links: projectHasGit(project) ? "linked" : "",
    access: "",
    closeout: project.archived ? "archived" : "",
    settings: "",
  };
  const tabLabelFallbacks: Partial<Record<ProjectWorkspaceTabId, string>> = { production: productionLabel, library: "Files", viewer: "Review" };
  const allTabs = PROJECT_WORKSPACE_SECTIONS
    .filter((item) => !PARKED_PROJECT_TABS.includes(item.id))
    .filter((item) => item.id === "settings" || !hiddenToolIds.has(item.id as any) && (!projectToolIds.size || projectToolIds.has(item.id as any) || PROJECT_SETTINGS_SECTION_IDS.includes(item.id)) && (item.id !== "assets" || canUseTool(currentUser, "library", "view")) && (item.id !== "source" || canUseTool(currentUser, "sourceControl", "view")))
    .map((item): ProjectDetailTab => ({
      id: item.id,
      label: toolLabel(item.id, tabLabelFallbacks[item.id] || item.defaultLabel),
      detail: tabDetails[item.id],
      group: item.mode,
    }));
  const settingsSections = allTabs.filter((item) => PROJECT_SETTINGS_SECTION_IDS.includes(item.id));
  const settingsLabels: Partial<Record<ProjectWorkspaceTabId, string>> = { plan: "Details", people: "Crew", links: "Integrations", access: "Access & sharing" };
  // QA stays reachable (Builds links to it) but only shows as a tab while open.
  const tabs = allTabs.filter((item) => !PROJECT_SETTINGS_SECTION_IDS.includes(item.id) && (item.id !== "settings" || settingsSections.length > 0) && (!SECONDARY_PROJECT_TABS.includes(item.id) || tab === item.id));
  const settingsSection = (settingsSections.some((item) => item.id === tab) ? tab : settingsSections[0]?.id) as ProjectWorkspaceTabId | undefined;
  const activeTab = PROJECT_SETTINGS_SECTION_IDS.includes(tab) && settingsSection ? "settings" : tabs.some((item: ProjectDetailTab) => item.id === tab) ? tab : (tabs[0]?.id || "overview");
  const view = activeTab === "settings" ? settingsSection : activeTab;
  const restoreProjectSnapshot = async (snapshot: Project) => {
                await api(`/api/projects/${project.id}`, {
                  method: "PATCH",
                  body: JSON.stringify({
                    name: snapshot.name,
                    externalName: snapshot.externalName || null,
                    codename: snapshot.codename || null,
                    aliases: snapshot.aliases || [],
                    description: snapshot.description || null,
                    objective: snapshot.objective || null,
                    clientName: snapshot.clientName || null,
                    startDate: snapshot.startDate || null,
                    targetDate: snapshot.targetDate || null,
                    priority: snapshot.priority || "medium",
                    tags: snapshot.tags || [],
                    color: snapshot.color || null,
                    healthNote: snapshot.healthNote || null,
                    status: snapshot.status,
                    projectType: snapshot.projectType,
                    archived: Boolean(snapshot.archived),
                  }),
                });
                await onReloadProjects();
                await loadProjectDashboard();
              };
  const primaryTabCandidates: ProjectWorkspaceTabId[] = isVideoType
    ? ["overview", "viewer", "tickets", "boards", "library", "settings"]
    : ["overview", "tickets", "boards", ...(supportsBuilds ? ["builds" as const] : []), ...(supportsQa && tab === "qa" ? ["qa" as const] : []), "library", ...(supportsSource ? ["source" as const] : []), "settings"];
  const primaryTabIds = primaryTabCandidates.filter((id, index) => primaryTabCandidates.indexOf(id) === index && tabs.some((item: ProjectDetailTab) => item.id === id));
  return (
    <section className="page cluster-specialist-workspace cluster-project-detail-workspace project-page-v312" style={runtimeStyle({ "--project-accent": project.color || "#60a5fa" })}>
      <ProjectDetailHeader
        project={project}
        typeLabel={type.label}
        readiness={readiness}
        teamCount={snapshot?.team.assigned ?? assignedIds.length}
        primaryBoardId={primaryBoard?.id}
        tabs={tabs}
        primaryTabIds={primaryTabIds}
        activeTab={activeTab}
        onTabChange={setTab}
        onBack={onBack}
        onOpenBoard={onOpenBoard}
        onOpenTimeline={onOpenTimeline}
        onOpenTickets={() => onOpenTickets(project.id)}
        onLifecycle={capabilities.canManage ? (action) => void runProjectLifecycleAction(action, "") : undefined}
        links={<ProjectPinnedLinks project={project} canEdit={capabilities.canEditProject} onSaved={onReloadProjects} />}
      />
      {activeTab !== "source" ? <ProjectCollaborationStrip tool="project" projectId={project.id} activity={`Project · ${tabs.find((item: ProjectDetailTab) => item.id === activeTab)?.label || activeTab}`} /> : null}


      <div className="project-workspace-v312">
        <main className="project-content-v312">
          {activeTab === "overview" && (
            <ProjectFileDropZone project={project} enabled={capabilities.canContribute && canUseTool(currentUser, "library", "edit")} onUploaded={onReloadProjects}>
            <ProjectOverviewDashboard
              project={project}
              projectType={type}
              snapshot={snapshot}
              reviewAssetCount={visibleVideos.length}
              reviewOpenNoteCount={reviewOpenNoteCount}
              dashboard={dashboard}
              controlCenter={controlCenter}
              loading={dashboardLoading}
              setupChecklist={setupChecklist}
              setupGaps={setupGaps}
              teamMembers={projectTeamMembers}
              primaryBoard={primaryBoard}
              primaryWhiteboard={primaryWhiteboard}
              onOpenBoard={onOpenBoard}
              onOpenWhiteboard={onOpenWhiteboard}
              onOpenTimeline={onOpenTimeline}
              onOpenTickets={() => setTab("tickets")}
              onOpenTime={() => onOpenTime(project.id)}
              onOpenPlan={() => setTab("plan")}
              availableSections={tabs.map((item) => item.id)}
              onOpenSection={(section) => setTab(section as typeof tab)}
              onRefresh={() => Promise.all([loadProjectSnapshot(), loadProjectDashboard(), loadProjectControlCenter()]).catch(() => undefined)}
              canManage={capabilities.canManage}
              canContribute={capabilities.canContribute}
              currentUserId={currentUser?.id}
              department={projectFocus?.department?.name || ""}
              teams={(projectFocus?.teams || []).map((team) => team.name)}
              addableUsers={capabilities.canManageTeam ? projectUsers.filter((user) => !user.archived && !projectMemberIds(project).includes(user.id)).map((user) => ({ id: user.id, name: user.displayName || user.username })) : []}
              onAddMember={capabilities.canManageTeam ? (userId) => saveProjectTeam([...projectMemberIds(project), userId], { ...projectMemberRoles(project), [userId]: "Contributor" }) : undefined}
              RelatedRecordsPanel={RelatedRecordsPanel}
              CustomFieldValuesPanel={CustomFieldValuesPanel}
              VersionHistoryPanel={VersionHistoryPanel}
              onRestore={restoreProjectSnapshot}
            >
              <ProjectOverviewWorkbench project={project} currentUserId={currentUser?.id} canEdit={capabilities.canEditProject} canContribute={capabilities.canContribute} onSaved={onReloadProjects} onOpenFiles={() => setTab("library")} onOpenLibrary={onOpenLibrary} onOpenBoard={onOpenBoard} onOpenTickets={() => setTab("tickets")} onOpenSection={(section) => setTab(section as typeof tab)} />
            </ProjectOverviewDashboard>
            <CollaborationPanel entityType="project" entityId={project.id} title="Discussion" users={projectUsers} currentUser={currentUser} compact />
            </ProjectFileDropZone>
          )}

          {activeTab === "intelligence" && <ProjectIntelligencePanel project={project} projects={projects} users={projectUsers} snapshot={intelligence} loading={intelligenceLoading} canManage={capabilities.canManage} onRefresh={loadProjectIntelligence} onOpenSection={(section) => setTab(section as typeof tab)} />}

          {activeTab === "settings" && settingsSection ? <SettingsWorkspaceShell inline
            className="project-settings"
            title="Project settings"
            navLabel="Project settings sections"
            activeId={settingsSection}
            onChange={(id) => setTab(id)}
            items={settingsSections.map((item) => ({ id: item.id, label: settingsLabels[item.id] || item.label, detail: item.detail }))}>
          {view === "plan" && (
            <>
              <ProjectPlanningPanel project={project} users={projectUsers} focus={projectFocus} onReloadFocus={reloadProjectFocus} canEdit={capabilities.canEditProject} canManage={capabilities.canManage} permissionReason={capabilities.reason} busy={projectSaveBusy} status={projectSaveStatus} onSave={saveProjectPlan} onLifecycleAction={runProjectLifecycleAction} onUploadIcon={uploadProjectIcon} />
              <ClusterDisclosureGroup className="project-secondary-details-v57 project-plan-handoff-v57"
                contentClassName="project-plan-handoff-body-v57" title="Workflow handoff"
                summary="Recurring work, dependencies, meetings, and ownership handoff">
                  <ProjectWorkflowHandoffPanel
                    project={project}
                    canContribute={capabilities.canContribute}
                    onOpenTickets={() => onOpenTickets(project.id)}
                    onOpenTimeline={onOpenTimeline}
                    onOpenTime={() => onOpenTime(project.id)}
                  />
              </ClusterDisclosureGroup>
              <ClusterDisclosureGroup title="Fields & related records">
                <CustomFieldValuesPanel entity="project" entityId={project.id} projectId={project.id} title="Project fields" />
                <RelatedRecordsPanel entity={{ kind: "project", id: project.id, label: project.name, projectId: project.id }} projectId={project.id} />
              </ClusterDisclosureGroup>
              <ClusterDisclosureGroup title="Version history">
                <VersionHistoryPanel entityType="project" entityId={project.id} projectId={project.id} label={project.name} data={project} onRestore={restoreProjectSnapshot} />
              </ClusterDisclosureGroup>
            </>
          )}

          {view === "people" && (
            <ProjectTeamPanel
              project={project}
              users={projectUsers}
              teams={projectFocus?.teams || []}
              canManage={capabilities.canManageTeam}
              busy={projectSaveBusy}
              status={projectSaveStatus}
              onSave={saveProjectTeam}
            />
          )}
          {view === "links" && (
            <ProjectConnectionsPanel project={project} canManage={capabilities.canManageConnections} permissionReason={capabilities.reason} busy={projectSaveBusy} status={projectSaveStatus} onSave={saveProjectConnections} />
          )}
          {view === "access" && <ProjectAccessPanel project={project} media={{ reviewAssets: visibleVideos, files: visibleFiles }} currentUser={currentUser} />}
          </SettingsWorkspaceShell> : null}

          {activeTab === "control" && <ProjectControlCenterPanel project={project} projects={projects} users={projectUsers} currentUser={currentUser} canManage={capabilities.canManage} permissionReason={capabilities.reason} data={controlCenter} loading={controlLoading} onReload={loadProjectControlCenter} onReloadProjectResources={async () => { await Promise.all([onReloadProjects(), onReloadWhiteboards(), loadProjectControlCenter()]); }} />}

          {activeTab === "closeout" && <CloseoutPortalPanel project={project} projects={projects} media={media} currentUser={currentUser} onArchiveProject={refreshAfterCloseout} />}


          {activeTab === "tickets" && <ProjectWorkList project={project} currentUser={currentUser} users={projectUsers} canContribute={capabilities.canContribute} onOpenBoard={onOpenBoard} />}

          {activeTab === "builds" && <ProjectBuildsPanel project={project} projects={projects} onOpenTimeline={onOpenTimeline} onOpenQa={() => setTab("qa")} currentUser={currentUser} users={projectUsers} canContribute={capabilities.canContribute} canManage={capabilities.canManage} permissionReason={capabilities.reason} />}

          {activeTab === "qa" && <ProjectQAPanel project={project} onOpenBoard={onOpenBoard} onOpenBuilds={() => setTab("builds")} currentUser={currentUser} users={projectUsers} canContribute={capabilities.canContribute} canManage={capabilities.canManage} permissionReason={capabilities.reason} />}

          {activeTab === "boards" && (
            <ProjectResourceHubPanel kind="boards" project={project} boards={visibleBoards} onCreate={capabilities.canCreateSpaces ? createBoardForProject : undefined} onOpen={onOpenBoard} />
          )}

          {activeTab === "whiteboards" && (
            <ProjectResourceHubPanel kind="whiteboards" project={project} whiteboards={visibleWhiteboards} onCreate={capabilities.canCreateSpaces ? createWhiteboardForProject : undefined} onOpen={onOpenWhiteboard} />
          )}

          {activeTab === "production" && <ProjectTypeProductionWorkspace project={project} type={type} users={projectUsers} canContribute={capabilities.canContribute} canManage={capabilities.canManage} isAdmin={Boolean(currentUser.isAdmin)} onReloadProjects={onReloadProjects} />}

          {activeTab === "viewer" && (
            <ProjectVideoWorkspace
              project={project}
              media={{ ...media, reviewAssets: visibleVideos, files: visibleFiles }}
              users={projectUsers}
              videoEnabled={videoEnabled}
              buildArtifacts={projectBuildArtifacts}
              qaSessions={projectQaSessions}
              onOpenBuilds={supportsBuilds ? () => setTab("builds") : undefined}
              onOpenQa={isVideoType ? undefined : supportsQa ? () => setTab("qa") : undefined}
              canContribute={capabilities.canContribute}
              canManage={capabilities.canManage}
              isAdmin={Boolean(currentUser.isAdmin)}
              userId={currentUser.id}
              status={mediaStatus}
              onStatusChange={setMediaStatus}
              onMediaChange={updateMedia}
              onRevalidate={() => loadMedia(true)}
              parseTimecode={parseTimecode}
              secondsToTimecode={secondsToTimecode}
              bytesToSize={bytesToSize}
              videoAssetUrl={videoAssetUrl}
            />
          )}

          {activeTab === "library" && (project.libraryFolderId && canUseTool(currentUser, "library", "view")
            ? <Suspense fallback={<ClusterStatus state="loading">Loading files…</ClusterStatus>}><LazyLibraryWorkspacePage key={project.id} projects={projects} currentUser={currentUser} initialFolderId={project.libraryFolderId} embedded /></Suspense>
            : <ProjectResourceHubPanel kind="library" project={project} onOpenLibrary={onOpenLibrary} />)}

          {activeTab === "assets" && canUseTool(currentUser, "library", "view") && (
            <ProjectAssetWorkspace project={project} currentUser={currentUser} canContribute={capabilities.canContribute && canUseTool(currentUser, "library", "edit")} canManage={capabilities.canManage && canUseTool(currentUser, "library", "edit")} bytesToSize={bytesToSize} onReloadMedia={loadMedia} />
          )}

          {activeTab === "source" && (
            <ProjectChangesPanel project={project} users={projectUsers} currentUser={currentUser} canContribute={capabilities.canContribute && canUseTool(currentUser, "sourceControl", "edit")} canManage={capabilities.canManage && canUseTool(currentUser, "sourceControl", "edit")} permissionReason={capabilities.reason} onOpenConnections={() => setTab("links")} />
          )}



        </main>
      </div>
    </section>
  );
}
