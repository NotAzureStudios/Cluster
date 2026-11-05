import { CLUSTER_CREATE_MODE_IDS, CLUSTER_PRODUCTION_PROFILE_DEFINITIONS, enabledClusterProductionProfiles, type StudioAudience } from "@cluster/shared";
import type { ClusterWorkNavigationTarget } from "../workflow/work-navigation-types";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import "./shared-create-drawer.css";
import { api, apiErrorPresentation, queryApi } from "../../core/api";
import { clearOfflineDraft, readOfflineDraft, saveOfflineDraft } from "../../core/offline-storage";
import { findLikelyDuplicates, type DuplicateCandidate, type SmartWorkspaceContext } from "../../core/smart-interface";
import { localId, unique } from "../../core/storage";
import { addDays, toDateTimeLocalInput, toLocalDateInput } from "../../core/date-time";
import { formatRelativeTime, levelLabel } from "../../core/format";
import { uploadNativeProjectFile } from "../../core/desktop";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterInput, ClusterNativeSelect } from "../../components/ClusterNativeControls";
import { ClusterSelect } from "../../components/ClusterSelect";
import { ClusterTextArea } from "../../components/ClusterTextArea";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ColorField } from "../../components/ColorField";
import { ClusterIcon } from "../../components/ClusterIcon";
import { ClusterModal } from "../../components/ClusterModal";
import { CreateErrorPanel } from "./CreateErrorPanel";
import { confirmCluster } from "../../components/cluster-dialog-service";
import { SharedCreateModePicker } from "./SharedCreateModePicker";
import { SharedCreateProjectAdvancedOptions } from "./SharedCreateProjectAdvancedOptions";
import { SharedCreateOptionalDisclosure } from "./SharedCreateOptionalDisclosure";
import { useSmartCreateMemory } from "./use-smart-create-memory";
import { createClusterCreateIntentControl } from "./create-intent-control";
import { CREATE_MODE_CATALOG, CREATE_MODE_GROUPS, CREATE_MODE_GUIDANCE, CREATE_PRIMARY_MODE_IDS, CREATE_SPECIALIZED_MODE_IDS, createModeMatches } from "./create-mode-catalog";
import { createReadinessIssues } from "./create-readiness";
import { canOfferCreateMode as canOfferMode } from "./create-mode-access";
import { BUILD_PLATFORM_PROFILES, defaultPlatformMeta } from "../projects/ProjectBuildsPanel";
import type { ProjectBuildSourceOptions } from "../projects/ProjectBuildComposer";
import { PROJECT_STATUS_OPTIONS } from "../projects/projects-utils";
import { displayUserName, profileWorkloadLabel, profileWorkloadTone } from "../people/people-utils";
import { PeopleMultiPicker, PeoplePicker } from "../people/PeoplePicker";
import { StudioAudiencePicker } from "../studio-systems/StudioAudiencePicker";
import { emitSharedCreateCompleted, readSharedCreateHandoff } from "./shared-create-handoff";
import { openClusterWorkNavigation } from "../workflow/work-navigation";
import type {
  BoardSummary, BuildArtifactRecord, Card, CommandSearchPayload, Priority, Project, ProjectKind, ProjectStatus, QuickCreateMode, Settings,
  SharedCreateHandoff, SmartCreateDraftSnapshot, MeetingRecord, TeamAssignment, TicketCard, TimelineEntry, User, UserActivitySummary, WhiteboardSummary, ProjectTypePreset,
} from "../application/application-models";

export interface SharedCreateDrawerDependencies {
  PRIORITY_CREATE_OPTIONS: Array<{ value: Priority; label: string }>;
  boardOptions: (projects: Project[]) => Array<BoardSummary & { projectId: string; projectName: string }>;
  fromDateTimeLocalInput: (value: string) => string;
  projectBuildProfile: (project: Project) => (typeof BUILD_PLATFORM_PROFILES)[number];
  projectTypeBadge: (project: Project) => string;
  projectTypeMeta: (type?: string | null, presets?: ProjectTypePreset[] | null) => ProjectTypePreset;
  projectTypePresetsFromSettings: (settings?: Settings | null) => ProjectTypePreset[];
  quickCreateModeFromSetting: (value?: Settings["userQuickCreateTarget"]) => QuickCreateMode;
}

type ProjectProvisionOperation = { id: string; status: string; progress: number; progressMessage?: string | null; lastError?: string | null; result?: { projectId?: string; provisioningKey?: string; source?: { state?: string; repositoryId?: string | null; bindingId?: string | null; hostingMode?: string | null; defaultBranch?: string; lfs?: boolean; ignoreTemplate?: string; capability?: string; required?: boolean; reason?: string | null }; steps?: Array<{ id: string; state: string }> } | null };
type PacketPurpose = "knowledge" | "training" | "onboarding" | "policy" | "procedure" | "handoff";
type PacketCompletionMode = "none" | "read" | "acknowledge" | "form";
type PacketCompletionFormOption = { id: string; key: string; title: string; purpose: string; version: number };

export interface SharedCreateDrawerFeatureProps {
  open: boolean;
  onClose: () => void;
  projects: Project[];
  settings?: Settings;
  currentUser: User;
  context?: SmartWorkspaceContext | null;
  onReloadProjects: () => Promise<void>;
  onReloadWhiteboards: () => Promise<void>;
  onOpenProject: (projectId: string) => void;
  onOpenBoard: (boardId: string) => void;
  onOpenWhiteboard: (whiteboardId: string) => void;
  onOpenTime: () => void;
  dependencies: SharedCreateDrawerDependencies;
}

export function SharedCreateDrawerFeature(props: SharedCreateDrawerFeatureProps) {
  const { dependencies, ...drawerProps } = props;
  const { PRIORITY_CREATE_OPTIONS, boardOptions, fromDateTimeLocalInput, projectBuildProfile, projectTypeBadge, projectTypeMeta, projectTypePresetsFromSettings, quickCreateModeFromSetting } = dependencies;
  const { open, onClose, projects, settings, currentUser, context, onReloadProjects, onReloadWhiteboards, onOpenProject, onOpenBoard, onOpenWhiteboard, onOpenTime } = drawerProps;
  const boards = useMemo(() => boardOptions(projects), [projects]);
  const createMemory = useSmartCreateMemory(currentUser.id);
  const [mode, setMode] = useState<QuickCreateMode>("project");
  const [activeHandoff, setActiveHandoff] = useState<SharedCreateHandoff | null>(null);
  const acceptedHandoffRef = useRef<SharedCreateHandoff | null>(null);
  const handoffRequestRef = useRef(0);
  const [handoffRevision, setHandoffRevision] = useState(0);
  const [showModePicker, setShowModePicker] = useState(true);
  const [showSpecializedModes, setShowSpecializedModes] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const [createTypeQuery, setCreateTypeQuery] = useState("");
  const [activeCreateMode, setActiveCreateMode] = useState<QuickCreateMode>("project");
  const [recentCreateModes, setRecentCreateModes] = useState<QuickCreateMode[]>(() => {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(`cluster.recent-create-modes:${currentUser.id}`) || "[]");
      return Array.isArray(parsed) ? parsed.filter((value): value is QuickCreateMode => typeof value === "string" && CLUSTER_CREATE_MODE_IDS.includes(value as QuickCreateMode)).slice(0, 3) : [];
    } catch { return []; }
  });
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [projectId, setProjectId] = useState(projects[0]?.id || "");
  const [boardId, setBoardId] = useState(boards[0]?.id || "");
  const [ticketTargetBoardId, setTicketTargetBoardId] = useState("");
  const [ticketTargetListId, setTicketTargetListId] = useState("");
  const [date, setDate] = useState(() => toLocalDateInput());
  const [busy, setBusy] = useState(false);
  const createIntentRef = useRef(createClusterCreateIntentControl());
  // A drawer is remounted per authenticated identity. Abort old requests on
  // unmount so a delayed create cannot continue under a different account.
  const createSessionController = useRef(new AbortController());
  useEffect(() => () => { createSessionController.current.abort(); }, []);
  const initializedCreateRef = useRef(false);
  const [status, setStatus] = useState("Ready.");
  const [createError, setCreateError] = useState<ReturnType<typeof apiErrorPresentation> | null>(null);
  const [projectType, setProjectType] = useState<ProjectKind>((settings?.defaultProjectTypeId || "general") as ProjectKind);
  const [productionProfile, setProductionProfile] = useState("generic");
  const [projectExternalName, setProjectExternalName] = useState("");
  const [projectCodename, setProjectCodename] = useState("");
  const [projectAliases, setProjectAliases] = useState("");
  const [workspacePresetKey, setWorkspacePresetKey] = useState("standard");
  const [projectProvisioningKey, setProjectProvisioningKey] = useState(() => crypto.randomUUID());
  // A failed async provisioning operation may have already saved the project.
  // Resume that exact operation instead of creating another project/folder.
  const [projectProvisionRetryId, setProjectProvisionRetryId] = useState<string | null>(null);
  const [projectTypeTemplate, setProjectTypeTemplate] = useState("");
  const [projectStatus, setProjectStatus] = useState<ProjectStatus>(settings?.defaultProjectStatus || "active");
  const [projectExternal, setProjectExternal] = useState((settings?.defaultProjectSource || "internal") === "external");
  const [externalOwnerId, setExternalOwnerId] = useState("");
  const [projectLeadId, setProjectLeadId] = useState("");
  const [projectObjective, setProjectObjective] = useState("");
  const [projectClientName, setProjectClientName] = useState("");
  const [projectStartDate, setProjectStartDate] = useState(() => toLocalDateInput());
  const [projectTargetDate, setProjectTargetDate] = useState("");
  const [projectPriority, setProjectPriority] = useState<Priority>("medium");
  const [projectTags, setProjectTags] = useState("");
  const [projectColor, setProjectColor] = useState("#60a5fa");
  const [createUsers, setCreateUsers] = useState<User[]>([]);
  const [createUserActivity, setCreateUserActivity] = useState<UserActivitySummary[]>([]);
  const [duplicateMatches, setDuplicateMatches] = useState<Array<ReturnType<typeof findLikelyDuplicates>[number]>>([]);
  const [duplicateOverride, setDuplicateOverride] = useState(false);
  const [recoveredDraft, setRecoveredDraft] = useState<{ value: SmartCreateDraftSnapshot; updatedAt: number } | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [createStarterBoard, setCreateStarterBoard] = useState(settings?.defaultCreateStarterBoard ?? true);
  const [createStarterWhiteboard, setCreateStarterWhiteboard] = useState(settings?.defaultCreateStarterWhiteboard ?? true);
  const [createStarterLibrary, setCreateStarterLibrary] = useState(settings?.defaultCreateStarterLibrary ?? true);
  const [cardPriority, setCardPriority] = useState<Priority>("medium");
  const [timelineType, setTimelineType] = useState("milestone");
  const [buildLane, setBuildLane] = useState("internal");
  const [buildVersion, setBuildVersion] = useState("");
  const [buildPlatform, setBuildPlatform] = useState("Windows");
  const [buildRepositoryId, setBuildRepositoryId] = useState("");
  const [buildBranch, setBuildBranch] = useState("");
  const [buildRevision, setBuildRevision] = useState("");
  const [buildReviewId, setBuildReviewId] = useState("");
  const [buildSourceOptions, setBuildSourceOptions] = useState<ProjectBuildSourceOptions | null>(null);
  const [buildSourceLoading, setBuildSourceLoading] = useState(false);
  const [buildArtifactUrl, setBuildArtifactUrl] = useState("");
  const [buildMeta, setBuildMeta] = useState<Record<string, string>>({});
  const [assigneeId, setAssigneeId] = useState("");
  const [attendeeIds, setAttendeeIds] = useState<string[]>([]);
  const [dueDate, setDueDate] = useState("");
  const [labelsText, setLabelsText] = useState("");
  const [ticketType, setTicketType] = useState("Task");
  const [bugEnvironment, setBugEnvironment] = useState("");
  const [bugSteps, setBugSteps] = useState("");
  const [bugExpected, setBugExpected] = useState("");
  const [bugActual, setBugActual] = useState("");
  const [timelineEndDate, setTimelineEndDate] = useState("");
  const [timelineStartTime, setTimelineStartTime] = useState("09:00");
  const [timelineEndTime, setTimelineEndTime] = useState("10:00");
  const [timelineColor, setTimelineColor] = useState("#4f8df7");
  const [meetingEndDate, setMeetingEndDate] = useState(() => addDays(new Date(), 14).toISOString().slice(0, 10));
  const [meetingCapacity, setMeetingCapacity] = useState("40");
  const [whiteboardTemplate, setWhiteboardTemplate] = useState("blank");
  const [whiteboardWidth, setWhiteboardWidth] = useState(String(settings?.whiteboardDefaultWidth || 1800));
  const [whiteboardHeight, setWhiteboardHeight] = useState(String(settings?.whiteboardDefaultHeight || 950));
  const [calendarType, setCalendarType] = useState("meeting");
  const [calendarStatus, setCalendarStatus] = useState("scheduled");
  const [calendarStartsAt, setCalendarStartsAt] = useState(() => toDateTimeLocalInput(new Date().toISOString()));
  const [calendarEndsAt, setCalendarEndsAt] = useState(() => toDateTimeLocalInput(new Date(Date.now() + 60 * 60 * 1000).toISOString()));
  const [calendarLocation, setCalendarLocation] = useState("");
  const [calendarAllDay, setCalendarAllDay] = useState(false);
  const [calendarReminder, setCalendarReminder] = useState("15");
  const [timeBlockType, setTimeBlockType] = useState("work");
  const [timeStartsAt, setTimeStartsAt] = useState(() => toDateTimeLocalInput(new Date().toISOString()));
  const [timeEndsAt, setTimeEndsAt] = useState(() => toDateTimeLocalInput(new Date(Date.now() + 60 * 60 * 1000).toISOString()));
  const [timeColor, setTimeColor] = useState("#4f8df7");
  const [packetPurpose, setPacketPurpose] = useState<PacketPurpose>("knowledge");
  const [packetVersionLabel, setPacketVersionLabel] = useState("1.0");
  const [packetAudience, setPacketAudience] = useState<StudioAudience>({ mode: "all", targets: [] });
  const [packetCompletionMode, setPacketCompletionMode] = useState<PacketCompletionMode>("none");
  const [packetCompletionFormId, setPacketCompletionFormId] = useState("");
  const [packetRequired, setPacketRequired] = useState(false);
  const [packetDueDays, setPacketDueDays] = useState("");
  const [packetRecertifyDays, setPacketRecertifyDays] = useState("");
  const [packetRecordCompletion, setPacketRecordCompletion] = useState(false);
  const [packetCompletionForms, setPacketCompletionForms] = useState<PacketCompletionFormOption[]>([]);
  const draftKey = `cluster-shared-create:${currentUser.id}`;
  const draftSnapshot: SmartCreateDraftSnapshot = {
    mode,
    title,
    details,
    projectId,
    boardId,
    date,
    assigneeId,
    dueDate,
    labelsText,
    cardPriority,
    ticketType,
    bugEnvironment,
    bugSteps,
    bugExpected,
    bugActual,
    timelineType,
    timelineEndDate,
    timelineStartTime,
    timelineEndTime,
    buildVersion,
    buildLane,
    buildPlatform,
    buildRepositoryId,
    buildBranch,
    buildRevision,
    buildReviewId,
    buildArtifactUrl,
    meetingEndDate,
    meetingCapacity,
    whiteboardTemplate,
    whiteboardWidth,
    whiteboardHeight,
    calendarType,
    calendarStatus,
    calendarStartsAt,
    calendarEndsAt,
    calendarLocation,
    calendarAllDay,
    calendarReminder,
    timeBlockType,
    timeStartsAt,
    timeEndsAt,
    projectType,
    productionProfile,
    projectExternalName,
    projectCodename,
    projectAliases,
    workspacePresetKey,
    projectTypeTemplate,
    projectStatus,
    projectExternal,
    externalOwnerId,
    projectLeadId,
    projectObjective,
    projectClientName,
    projectStartDate,
    projectTargetDate,
    projectPriority,
    projectTags,
    projectColor,
    createStarterBoard,
    createStarterWhiteboard,
    createStarterLibrary,
    buildMeta,
    timelineColor,
    timeColor,
    packetPurpose,
    packetVersionLabel,
    packetAudience,
    packetCompletionMode,
    packetCompletionFormId,
    packetRequired,
    packetDueDays,
    packetRecertifyDays,
    packetRecordCompletion,
  };
  const serializedDraftSnapshot = JSON.stringify(draftSnapshot);
  const draftMeaningful = Boolean(title.trim() || details.trim() || labelsText.trim() || bugEnvironment.trim() || bugSteps.trim() || bugExpected.trim() || bugActual.trim() || buildVersion.trim() || buildRevision.trim() || buildArtifactUrl.trim() || calendarLocation.trim() || projectObjective.trim() || projectClientName.trim() || projectTags.trim() || (mode === "packet" && (packetVersionLabel.trim() !== "1.0" || packetAudience.mode !== "all" || packetCompletionMode !== "none" || packetRequired || packetDueDays.trim() || packetRecertifyDays.trim() || packetRecordCompletion)));
  useEffect(() => {
    if (!projectId && projects[0]) setProjectId(projects[0].id);
    if (!boardId && boards[0]) setBoardId(boards[0].id);
  }, [projects, boards, projectId, boardId]);
  useEffect(() => {
    if (!open) { initializedCreateRef.current = false; return; }
    if (initializedCreateRef.current) return;
    initializedCreateRef.current = true;
    createIntentRef.current.reset();
    const handoff = acceptedHandoffRef.current || readSharedCreateHandoff();
    acceptedHandoffRef.current = null;
    setActiveHandoff(handoff);
    const nextMode = handoff?.mode || quickCreateModeFromSetting(settings?.userQuickCreateTarget);
    setShowModePicker(!handoff?.mode || !canOfferCreateMode(nextMode));
    setShowSpecializedModes(false);
    setShowAdvanced(false);
    setShowValidation(false);
    const memory = createMemory.read(nextMode);
    const contextProjectId = context?.projectId && projects.some((project) => project.id === context.projectId) ? context.projectId : "";
    const memoryProjectId = memory?.projectId && projects.some((project) => project.id === memory.projectId) ? memory.projectId : "";
    const preferredProjectId = handoff?.projectId || contextProjectId || memoryProjectId || projects[0]?.id || "";
    const handoffBoardCandidate = handoff?.boardId ? boards.find((board) => board.id === handoff.boardId) : null;
    const contextBoardCandidate = context?.boardId ? boards.find((board) => board.id === context.boardId) : null;
    const memoryBoardCandidate = memory?.boardId ? boards.find((board) => board.id === memory.boardId) : null;
    const handoffBoard = handoffBoardCandidate && (!preferredProjectId || handoffBoardCandidate.projectId === preferredProjectId) ? handoffBoardCandidate : null;
    const contextBoard = contextBoardCandidate && (!preferredProjectId || contextBoardCandidate.projectId === preferredProjectId) ? contextBoardCandidate : null;
    const memoryBoard = memoryBoardCandidate && (!preferredProjectId || memoryBoardCandidate.projectId === preferredProjectId) ? memoryBoardCandidate : null;
    const projectBoard = boards.find((board) => board.projectId === preferredProjectId);
    const preferredBoard = handoffBoard || contextBoard || memoryBoard || projectBoard || boards[0];
    const rememberedPriority = handoff?.priority || (["low", "medium", "high", "urgent"].includes(String(memory?.priority || "")) ? (memory?.priority as Priority) : "medium");
    setMode(nextMode);
    setTitle(handoff?.title || "");
    setDetails(handoff?.details || "");
    setProjectId(preferredProjectId);
    setBoardId(preferredBoard?.id || "");
    setDate(handoff?.date || toLocalDateInput());
    setProjectType((settings?.defaultProjectTypeId || "general") as ProjectKind);
    setProductionProfile("generic");
    setProjectTypeTemplate("");
    setProjectStatus(settings?.defaultProjectStatus || "active");
    setProjectExternal((settings?.defaultProjectSource || "internal") === "external");
    setExternalOwnerId("");
    setProjectLeadId(currentUser.id);
    setProjectObjective("");
    setProjectClientName("");
    setProjectStartDate(toLocalDateInput());
    setProjectTargetDate("");
    setProjectPriority("medium");
    setProjectTags("");
    setProjectColor("#60a5fa");
    setCreateStarterBoard(settings?.defaultCreateStarterBoard ?? true);
    setCreateStarterWhiteboard(settings?.defaultCreateStarterWhiteboard ?? true);
    setCreateStarterLibrary(settings?.defaultCreateStarterLibrary ?? true);
    setAssigneeId(handoff?.assigneeId || memory?.assigneeId || (context?.screen === "mywork" ? currentUser.id : ""));
    setAttendeeIds(handoff?.attendeeIds || []);
    setCardPriority(rememberedPriority);
    setDueDate(handoff?.dueDate || "");
    setLabelsText(handoff?.labels?.join(", ") || memory?.labelsText || "");
    setTicketType("Task");
    setBugEnvironment("");
    setBugSteps("");
    setBugExpected("");
    setBugActual("");
    setTimelineEndDate(handoff?.date || "");
    setTimelineStartTime("09:00");
    setTimelineEndTime("10:00");
    setTimelineColor("#4f8df7");
    setMeetingEndDate(
      toLocalDateInput(addDays(new Date(`${handoff?.date || toLocalDateInput()}T00:00:00`), 14)),
    );
    setMeetingCapacity("40");
    setWhiteboardTemplate("blank");
    setWhiteboardWidth(String(settings?.whiteboardDefaultWidth || 1800));
    setWhiteboardHeight(String(settings?.whiteboardDefaultHeight || 950));
    const now = handoff?.startsAt ? new Date(handoff.startsAt) : handoff?.date ? new Date(`${handoff.date}T09:00:00`) : new Date();
    const later = handoff?.endsAt ? new Date(handoff.endsAt) : new Date(now.getTime() + 60 * 60 * 1000);
    setCalendarType(handoff?.calendarType || "meeting");
    setCalendarStatus(handoff?.calendarStatus || "scheduled");
    setCalendarStartsAt(toDateTimeLocalInput(now.toISOString()));
    setCalendarEndsAt(toDateTimeLocalInput(later.toISOString()));
    setCalendarLocation("");
    setCalendarAllDay(false);
    setCalendarReminder("15");
    setTimeBlockType(handoff?.timeBlockType || "work");
    setTimeStartsAt(toDateTimeLocalInput(now.toISOString()));
    setTimeEndsAt(toDateTimeLocalInput(later.toISOString()));
    setTimeColor("#4f8df7");
    setPacketPurpose("knowledge");
    setPacketVersionLabel("1.0");
    setPacketAudience({ mode: "all", targets: [] });
    setPacketCompletionMode("none");
    setPacketCompletionFormId("");
    setPacketRequired(false);
    setPacketDueDays("");
    setPacketRecertifyDays("");
    setPacketRecordCompletion(false);
    setDuplicateMatches([]);
    setDuplicateOverride(false);
    const defaultMessage = handoff
      ? ""
      : contextBoard
        ? `Using ${contextBoard.name} from your current workspace.`
        : contextProjectId
          ? `Using ${projects.find((project) => project.id === contextProjectId)?.name || "your current project"}.`
          : memory
            ? `Using your recent ${nextMode} destination.`
            : "Studio defaults applied.";
    setStatus(handoff ? defaultMessage : "");
    setRecoveredDraft(null);
    setDraftReady(false);
    let cancelled = false;
    void readOfflineDraft<SmartCreateDraftSnapshot>(draftKey)
      .then((record) => {
        if (cancelled || createSessionController.current.signal.aborted) return;
        const value = record?.value;
        const meaningful = Boolean(value && (value.title?.trim() || value.details?.trim() || value.labelsText?.trim() || value.bugSteps?.trim() || value.buildVersion?.trim() || value.calendarLocation?.trim() || value.projectObjective?.trim() || value.projectClientName?.trim() || value.projectTags?.trim()));
        if (meaningful && !handoff?.title && !handoff?.details && record) setRecoveredDraft({ value: record.value, updatedAt: record.updatedAt });
      })
      .catch(() => { /* Unavailable local drafts are not evidence of a failed Create. */ })
      .finally(() => { if (!cancelled && !createSessionController.current.signal.aborted) setDraftReady(true); });
    return () => { cancelled = true; };
  }, [open, currentUser.id, context?.screen, context?.projectId, context?.boardId, settings?.defaultProjectTypeId, settings?.defaultProjectStatus, settings?.defaultProjectSource, settings?.defaultCreateStarterBoard, settings?.defaultCreateStarterWhiteboard, settings?.defaultCreateStarterLibrary, createMemory.hydrated, handoffRevision]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const signal = createSessionController.current.signal;
    Promise.all([
      api<User[]>("/api/users", { signal }),
      api<UserActivitySummary[]>("/api/users/activity", { signal }),
      api<TeamAssignment[]>("/api/team/assignments", { signal }).catch(() => []),
    ])
      .then(([items, activityItems, assignments]) => {
        if (cancelled || signal.aborted) return;
        const assignmentByUserId = new Map(assignments.map((item) => [item.user.id, item]));
        setCreateUsers(items.filter((user) => !user.archived));
        setCreateUserActivity(activityItems.filter((user) => !user.archived).map((user) => ({
          ...user,
          counts: {
            activityEvents: user.counts?.activityEvents || 0,
            comments: user.counts?.comments || 0,
            assignedCards: assignmentByUserId.get(user.id)?.cards.length ?? user.counts?.assignedCards ?? 0,
          },
        })));
      })
      .catch(() => {
        if (!cancelled && !signal.aborted) { setCreateUsers([]); setCreateUserActivity([]); }
      });
    return () => { cancelled = true; };
  }, [open, currentUser.id]);
  useEffect(() => {
    if (!open || !draftReady || settings?.userAutoSaveDrafts === false || busy || createIntentRef.current.committed) return;
    if (!draftMeaningful && recoveredDraft) return;
    const timer = window.setTimeout(() => {
      // A create can commit while the debounce timer is pending. Never save
      // the successful form again as a recoverable draft.
      if (createIntentRef.current.inFlight || createIntentRef.current.committed) return;
      const change = draftMeaningful
        ? saveOfflineDraft(draftKey, draftSnapshot, { ttlMs: 30 * 24 * 60 * 60 * 1000 })
        : clearOfflineDraft(draftKey);
      void change.catch(() => {
        if (!createSessionController.current.signal.aborted && !createIntentRef.current.committed) {
          setStatus("Automatic draft storage failed. Keep the form open or copy your changes before leaving.");
        }
      });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [open, draftReady, draftKey, serializedDraftSnapshot, settings?.userAutoSaveDrafts, recoveredDraft?.updatedAt, draftMeaningful, busy]);
  // Creation is an edit action. Showing a tool the user can only view (or
  // that Studio has disabled) leads to a predictable 403 after a full form.
  // These checks shape the UI only; the server remains authoritative.
  function canOfferCreateMode(candidate: QuickCreateMode) {
    return canOfferMode(currentUser, settings, candidate);
  }
  const modes = CREATE_MODE_CATALOG;
  const availableModes = modes.filter((item) => canOfferCreateMode(item.id));
  const modeGroups = CREATE_MODE_GROUPS;
  const normalizedCreateQuery = createTypeQuery.trim().toLowerCase();
  const recentModes = recentCreateModes.map((modeId) => availableModes.find((item) => item.id === modeId)).filter(Boolean) as typeof modes;
  const exposedCreateModes = new Set<QuickCreateMode>(normalizedCreateQuery || showSpecializedModes ? modes.map((item) => item.id) : [...CREATE_PRIMARY_MODE_IDS, ...recentCreateModes]);
  const filteredModeGroups = modeGroups
    .map((group) => ({ ...group, modes: group.modes.filter((modeId) => {
      const item = availableModes.find((candidate) => candidate.id === modeId);
      return exposedCreateModes.has(modeId) && Boolean(item && createModeMatches(item, group.label, normalizedCreateQuery));
    }) }))
    .filter((group) => group.modes.length > 0);
  const visibleCreateModeIds = filteredModeGroups.flatMap((group) => group.modes);
  const visibleCreateModeKey = visibleCreateModeIds.join("|");
  useEffect(() => {
    if (!showModePicker || visibleCreateModeIds.length === 0) return;
    setActiveCreateMode((current) => visibleCreateModeIds.includes(current)
      ? current
      : (recentModes.find((item) => visibleCreateModeIds.includes(item.id))?.id || visibleCreateModeIds[0]));
  }, [showModePicker, visibleCreateModeKey, recentCreateModes.join("|")]);
  function moveCreatePickerSelection(direction: 1 | -1) {
    if (visibleCreateModeIds.length === 0) return;
    setActiveCreateMode((current) => {
      const index = visibleCreateModeIds.indexOf(current);
      const nextIndex = index < 0
        ? (direction > 0 ? 0 : visibleCreateModeIds.length - 1)
        : (index + direction + visibleCreateModeIds.length) % visibleCreateModeIds.length;
      return visibleCreateModeIds[nextIndex];
    });
  }
  function handleCreatePickerKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      event.preventDefault();
      moveCreatePickerSelection(1);
      return;
    }
    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      event.preventDefault();
      moveCreatePickerSelection(-1);
      return;
    }
    if (event.key === "Enter" && event.target instanceof HTMLInputElement && visibleCreateModeIds.includes(activeCreateMode)) {
      event.preventDefault();
      changeCreateMode(activeCreateMode);
    }
  }
  const projectBoards = projectId ? boards.filter((board) => board.projectId === projectId) : boards;
  const selectedBoard = projectBoards.find((board) => board.id === boardId) || projectBoards[0] || boards[0];
  const firstList = selectedBoard?.lists?.[0];
  const selectedProject = projects.find((project) => project.id === projectId) || projects[0];
  const projectTypePresets = useMemo(() => projectTypePresetsFromSettings(settings), [settings?.projectTypePresets]);
  const selectedProjectType = projectTypeMeta(projectType, projectTypePresets);
  const productionProfiles = useMemo(() => enabledClusterProductionProfiles(settings?.studioEnabledProductionProfileIds, selectedProjectType), [settings?.studioEnabledProductionProfileIds, selectedProjectType.id, selectedProjectType.category]);
  const selectedProductionProfile = productionProfiles.find((profile) => profile.id === productionProfile) || productionProfiles[0] || CLUSTER_PRODUCTION_PROFILE_DEFINITIONS[0];
  const selectedProjectTypeTemplates = selectedProjectType.productionTemplates || [];
  useEffect(() => {
    if (!selectedProjectTypeTemplates.length) { if (projectTypeTemplate) setProjectTypeTemplate(""); return; }
    if (!selectedProjectTypeTemplates.includes(projectTypeTemplate)) setProjectTypeTemplate(selectedProjectTypeTemplates[0]);
  }, [selectedProjectType.id, selectedProjectTypeTemplates.join("|"), projectTypeTemplate]);
  const studioDefaultBuildProfile = BUILD_PLATFORM_PROFILES.find((profile) => profile.key === settings?.defaultBuildProfileKey);
  useEffect(() => {
    if (!projectTypePresets.some((preset) => preset.id === projectType)) setProjectType((projectTypePresets[0]?.id || "general") as ProjectKind);
  }, [projectTypePresets, projectType]);
  useEffect(() => {
    if (!productionProfiles.some((profile) => profile.id === productionProfile)) setProductionProfile(productionProfiles[0]?.id || "generic");
  }, [productionProfiles, productionProfile]);
  const genericBuildProfile = BUILD_PLATFORM_PROFILES.find((profile) => profile.key === "generic") || BUILD_PLATFORM_PROFILES[0];
  const selectedBuildProfile = selectedProject ? projectBuildProfile(selectedProject) : studioDefaultBuildProfile || genericBuildProfile;
  const activeBuildMeta = {
    ...defaultPlatformMeta(selectedBuildProfile),
    ...buildMeta,
  };
  const selectedMode = modes.find((item) => item.id === mode);
  const activeGuidance = CREATE_MODE_GUIDANCE[mode];
  useEffect(() => {
    if (mode !== "build") return;
    setBuildLane(selectedBuildProfile.lanes[0]?.id || "internal");
    setBuildPlatform(selectedBuildProfile.defaultPlatform);
    setBuildMeta(defaultPlatformMeta(selectedBuildProfile));
  }, [mode, selectedBuildProfile.key, selectedProject?.id]);
  useEffect(() => {
    if (mode !== "build" || !selectedProject?.id) { setBuildSourceOptions(null); setBuildSourceLoading(false); return; }
    let cancelled = false;
    setBuildSourceLoading(true);
    void queryApi<ProjectBuildSourceOptions>(`/api/projects/${encodeURIComponent(selectedProject.id)}/delivery/source-options`, { staleMs: 15_000, maxAgeMs: 5 * 60_000, tags: ["project-delivery", "source-control", selectedProject.id] }).then((options) => {
      if (cancelled) return;
      setBuildSourceOptions(options);
      const repository = options.repositories.find((item) => item.repositoryId === buildRepositoryId) || options.repositories.find((item) => item.isPrimary) || options.repositories[0] || null;
      const branch = repository?.branches.find((item) => item.name === buildBranch) || repository?.branches.find((item) => item.name === repository.defaultBranch) || repository?.branches.find((item) => item.isDefault) || repository?.branches[0] || null;
      const revision = repository?.commits.find((item) => item.revision === buildRevision)?.revision || repository?.commits.find((item) => item.revision === branch?.headRevision)?.revision || branch?.headRevision || repository?.commits.find((item) => !item.branchNames?.length || item.branchNames.includes(branch?.name || ""))?.revision || "";
      setBuildRepositoryId(repository?.repositoryId || "");
      setBuildBranch(branch?.name || repository?.defaultBranch || "");
      setBuildRevision(revision);
      if (buildReviewId && !repository?.reviews.some((review) => review.id === buildReviewId)) setBuildReviewId("");
    }).catch((caught) => {
      if (!cancelled) { setBuildSourceOptions(null); setStatus(apiErrorPresentation(caught).message || "Source Control options could not be loaded."); }
    }).finally(() => { if (!cancelled) setBuildSourceLoading(false); });
    return () => { cancelled = true; };
  }, [mode, selectedProject?.id]);
  useEffect(() => {
    if (!open || mode !== "packet") return;
    let cancelled = false;
    void queryApi<{ forms: PacketCompletionFormOption[] }>("/api/packets/completion-forms", { staleMs: 30_000, maxAgeMs: 5 * 60_000, tags: ["packets", "studio-systems", "forms"] })
      .then((result) => { if (!cancelled) setPacketCompletionForms(result.forms || []); })
      .catch(() => { if (!cancelled) setPacketCompletionForms([]); });
    return () => { cancelled = true; };
  }, [open, mode]);
  useEffect(() => {
    setDuplicateOverride(false);
    if (!open || title.trim().length < 3 || !["project", "card", "ticket", "bug"].includes(mode)) {
      setDuplicateMatches([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (mode === "project") {
        const candidates: DuplicateCandidate[] = projects.map((project) => ({
          id: project.id,
          title: project.name,
          kind: "project",
          subtitle: projectTypeBadge(project),
          projectId: project.id,
        }));
        setDuplicateMatches(findLikelyDuplicates(title, candidates));
        return;
      }
      api<CommandSearchPayload>(`/api/command/search?q=${encodeURIComponent(title.trim())}`)
        .then((result) => {
          if (cancelled) return;
          const candidates: DuplicateCandidate[] = result.cards.map((card) => ({
            id: card.id,
            title: card.title,
            kind: mode === "card" ? "card" : "ticket",
            subtitle: `${card.projectName} · ${card.boardName} · ${card.listTitle}`,
            projectId: card.projectId,
            boardId: card.boardId,
          }));
          setDuplicateMatches(findLikelyDuplicates(title, candidates));
        })
        .catch(() => !cancelled && setDuplicateMatches([]));
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, mode, title, projectId, boardId, projects]);
  const readinessIssues = createReadinessIssues({
    mode,
    title,
    hasProject: Boolean(selectedProject),
    hasBoardList: Boolean(selectedBoard && firstList),
    projectLeadId,
    externalOwnerRequired: mode === "project" && projectExternal && settings?.studioExternalProjectOwnerRequired !== false,
    externalOwnerId,
    buildVersion,
    date,
    timelineStartTime,
    timelineEndDate,
    timelineEndTime,
    calendarStartsAt,
    calendarEndsAt,
    calendarAllDay,
    timeStartsAt,
    timeEndsAt,
    meetingEndDate,
    whiteboardWidth,
    whiteboardHeight,
    packetAudienceMode: packetAudience.mode,
    packetAudienceTargetCount: packetAudience.targets.length,
    packetCompletionMode,
    packetCompletionFormId,
  });
  const createPeople = createUserActivity.length ? createUserActivity : createUsers;
  const selectedAssigneeActivity = assigneeId ? createUserActivity.find((user) => user.id === assigneeId) : null;
  const selectedAssigneeTone = selectedAssigneeActivity ? profileWorkloadTone(selectedAssigneeActivity.counts?.assignedCards || 0, selectedAssigneeActivity.capacityHours) : "neutral";
  const selectedAssigneeLoad = selectedAssigneeActivity ? `${profileWorkloadLabel(selectedAssigneeActivity.counts?.assignedCards || 0, selectedAssigneeActivity.capacityHours)} · ${selectedAssigneeActivity.counts?.assignedCards || 0} assigned card${selectedAssigneeActivity.counts?.assignedCards === 1 ? "" : "s"}${selectedAssigneeActivity.capacityHours != null ? ` · ${selectedAssigneeActivity.capacityHours}h capacity` : ""}` : "";
  if (!open) return null;
  function patchBuildMeta(key: string, value: string) {
    setBuildMeta((current) => ({ ...current, [key]: value }));
  }
  function changeCreateProject(nextProjectId: string) {
    setProjectId(nextProjectId);
    setTicketTargetBoardId("");
    setTicketTargetListId("");
    if (!nextProjectId) return;
    const currentBoard = boards.find((board) => board.id === boardId);
    if (currentBoard?.projectId === nextProjectId) return;
    const nextBoard = boards.find((board) => board.projectId === nextProjectId);
    setBoardId(nextBoard?.id || "");
  }
  function changeCreateBoard(nextBoardId: string) {
    setBoardId(nextBoardId);
    const nextBoard = boards.find((board) => board.id === nextBoardId);
    if (nextBoard?.projectId) setProjectId(nextBoard.projectId);
  }
  function changeCreateMode(nextMode: QuickCreateMode) {
    if (!canOfferCreateMode(nextMode)) { setStatus("This item type is not available for your current access or Studio configuration."); return; }
    createIntentRef.current.reset();
    setShowModePicker(false);
    setShowAdvanced(false);
    setShowValidation(false);
    setCreateTypeQuery("");
    setRecentCreateModes((current) => {
      const next = [nextMode, ...current.filter((item) => item !== nextMode)].slice(0, 3);
      try { window.localStorage.setItem(`cluster.recent-create-modes:${currentUser.id}`, JSON.stringify(next)); } catch {}
      return next;
    });
    const memory = createMemory.read(nextMode);
    setMode(nextMode);
    setDuplicateMatches([]);
    setDuplicateOverride(false);
    const rememberedBoard = memory?.boardId ? boards.find((board) => board.id === memory.boardId) : null;
    const rememberedProjectId = memory?.projectId && projects.some((project) => project.id === memory.projectId)
      ? memory.projectId
      : rememberedBoard?.projectId || "";
    if (rememberedProjectId) setProjectId(rememberedProjectId);
    if (rememberedBoard && (!rememberedProjectId || rememberedBoard.projectId === rememberedProjectId)) setBoardId(rememberedBoard.id);
    else if (rememberedProjectId) setBoardId(boards.find((board) => board.projectId === rememberedProjectId)?.id || "");
    if (memory?.assigneeId) setAssigneeId(memory.assigneeId);
    if (["low", "medium", "high", "urgent"].includes(String(memory?.priority || ""))) setCardPriority(memory?.priority as Priority);
    if (memory?.labelsText != null) setLabelsText(memory.labelsText);
    setStatus("");
  }
  function restoreCreateDraft() {
    if (!recoveredDraft) return;
    createIntentRef.current.reset();
    setShowModePicker(false);
    const value = recoveredDraft.value;
    setMode(value.mode);
    setTitle(value.title || "");
    setDetails(value.details || "");
    setProjectId(value.projectId || projectId);
    setBoardId(value.boardId || boardId);
    setDate(value.date || date);
    setAssigneeId(value.assigneeId || "");
    setDueDate(value.dueDate || "");
    setLabelsText(value.labelsText || "");
    setCardPriority(value.cardPriority || "medium");
    setTicketType(value.ticketType || "Task");
    setBugEnvironment(value.bugEnvironment || "");
    setBugSteps(value.bugSteps || "");
    setBugExpected(value.bugExpected || "");
    setBugActual(value.bugActual || "");
    setTimelineType(value.timelineType || "milestone");
    setTimelineEndDate(value.timelineEndDate || "");
    setTimelineStartTime(value.timelineStartTime || "09:00");
    setTimelineEndTime(value.timelineEndTime || "10:00");
    setBuildVersion(value.buildVersion || "");
    setBuildLane(value.buildLane || buildLane);
    setBuildPlatform(value.buildPlatform || buildPlatform);
    setBuildRepositoryId(value.buildRepositoryId || "");
    setBuildBranch(value.buildBranch || "");
    setBuildRevision(value.buildRevision || "");
    setBuildReviewId(value.buildReviewId || "");
    setBuildArtifactUrl(value.buildArtifactUrl || "");
    setMeetingEndDate(value.meetingEndDate || meetingEndDate);
    setMeetingCapacity(value.meetingCapacity || meetingCapacity);
    setWhiteboardTemplate(value.whiteboardTemplate || "blank");
    setWhiteboardWidth(value.whiteboardWidth || whiteboardWidth);
    setWhiteboardHeight(value.whiteboardHeight || whiteboardHeight);
    setCalendarType(value.calendarType || "meeting");
    setCalendarStatus(value.calendarStatus || "scheduled");
    setCalendarStartsAt(value.calendarStartsAt || calendarStartsAt);
    setCalendarEndsAt(value.calendarEndsAt || calendarEndsAt);
    setCalendarLocation(value.calendarLocation || "");
    setCalendarAllDay(Boolean(value.calendarAllDay));
    setCalendarReminder(value.calendarReminder || "15");
    setTimeBlockType(value.timeBlockType || "work");
    setTimeStartsAt(value.timeStartsAt || timeStartsAt);
    setTimeEndsAt(value.timeEndsAt || timeEndsAt);
    setProjectType(value.projectType || projectType);
    setProductionProfile(value.productionProfile || productionProfile);
    setProjectExternalName(value.projectExternalName || "");
    setProjectCodename(value.projectCodename || "");
    setProjectAliases(value.projectAliases || "");
    setWorkspacePresetKey(value.workspacePresetKey || workspacePresetKey);
    setProjectTypeTemplate(value.projectTypeTemplate || "");
    setProjectStatus(value.projectStatus || projectStatus);
    setProjectExternal(value.projectExternal ?? projectExternal);
    setExternalOwnerId(value.externalOwnerId || "");
    setProjectLeadId(value.projectLeadId || projectLeadId || currentUser.id);
    setProjectObjective(value.projectObjective || "");
    setProjectClientName(value.projectClientName || "");
    setProjectStartDate(value.projectStartDate || projectStartDate);
    setProjectTargetDate(value.projectTargetDate || "");
    setProjectPriority(value.projectPriority || projectPriority);
    setProjectTags(value.projectTags || "");
    setProjectColor(value.projectColor || projectColor);
    setCreateStarterBoard(value.createStarterBoard ?? createStarterBoard);
    setCreateStarterWhiteboard(value.createStarterWhiteboard ?? createStarterWhiteboard);
    setCreateStarterLibrary(value.createStarterLibrary ?? createStarterLibrary);
    setBuildMeta(value.buildMeta || buildMeta);
    setTimelineColor(value.timelineColor || timelineColor);
    setTimeColor(value.timeColor || timeColor);
    setPacketPurpose(value.packetPurpose || "knowledge");
    setPacketVersionLabel(value.packetVersionLabel || "1.0");
    setPacketAudience(value.packetAudience || { mode: "all", targets: [] });
    setPacketCompletionMode(value.packetCompletionMode || "none");
    setPacketCompletionFormId(value.packetCompletionFormId || "");
    setPacketRequired(Boolean(value.packetRequired));
    setPacketDueDays(value.packetDueDays || "");
    setPacketRecertifyDays(value.packetRecertifyDays || "");
    setPacketRecordCompletion(Boolean(value.packetRecordCompletion));
    setShowValidation(false);
    setRecoveredDraft(null);
    setStatus(`Draft restored from ${formatRelativeTime(new Date(recoveredDraft.updatedAt).toISOString())}.`);
  }
  // A direct Create command can arrive while this drawer is already mounted.
  // Consume its pending handoff immediately; otherwise it would be replayed
  // unexpectedly the next time Create opens. Never discard unsaved work or
  // replace a committed/in-flight operation without an explicit safe outcome.
  useEffect(() => {
    if (!open) return;
    const onCreateHandoff = () => {
      const incoming = readSharedCreateHandoff();
      if (!incoming) return;
      const ticket = ++handoffRequestRef.current;
      const isCurrent = () => ticket === handoffRequestRef.current && !createSessionController.current.signal.aborted;
      if (busy || createIntentRef.current.inFlight) {
        setStatus("Finish the current Create operation before opening another item type.");
        return;
      }
      if (!canOfferCreateMode(incoming.mode)) {
        setStatus("That Create type is unavailable for your current permissions or Studio configuration.");
        return;
      }
      void (async () => {
        if (createIntentRef.current.committed) {
          try { await clearOfflineDraft(draftKey); }
          catch { if (isCurrent()) setStatus("Created item is safe, but its old draft could not be cleared. Close Create before starting another item."); return; }
        } else if (draftMeaningful) {
          if (settings?.userAutoSaveDrafts === false) {
            const discard = await confirmCluster({
              title: "Switch Create type?",
              message: "This form contains unsaved changes. Switching will discard them.",
              confirmLabel: "Discard and switch",
              cancelLabel: "Keep editing",
              tone: "danger",
            });
            if (!isCurrent() || !discard) return;
            try { await clearOfflineDraft(draftKey); }
            catch { if (isCurrent()) setStatus("Could not clear the old draft. Keep editing or retry."); return; }
          } else {
            try { await saveOfflineDraft(draftKey, draftSnapshot, { ttlMs: 30 * 24 * 60 * 60 * 1000 }); }
            catch { if (isCurrent()) setStatus("Could not preserve the current draft. Keep editing or retry."); return; }
          }
        }
        if (!isCurrent() || !canOfferCreateMode(incoming.mode)) {
          if (isCurrent()) setStatus("That Create type is unavailable for your current permissions or Studio configuration.");
          return;
        }
        acceptedHandoffRef.current = incoming;
        initializedCreateRef.current = false;
        setHandoffRevision((value) => value + 1);
      })();
    };
    window.addEventListener("cluster:open-shared-create", onCreateHandoff);
    return () => window.removeEventListener("cluster:open-shared-create", onCreateHandoff);
  }, [open, busy, draftMeaningful, serializedDraftSnapshot, settings?.userAutoSaveDrafts, draftKey, currentUser.id]);

  async function discardCreateDraft() {
    try {
      await clearOfflineDraft(draftKey);
      if (createSessionController.current.signal.aborted) return;
      setRecoveredDraft(null);
      setStatus("Saved draft discarded.");
    } catch {
      if (!createSessionController.current.signal.aborted) setStatus("Could not discard the stored draft. Try again before creating a new item.");
    }
  }
  async function requestClose() {
    if (busy) {
      setStatus("Creation is still running. Keep this window open until Cluster finishes or reports an error.");
      return false;
    }
    if (createIntentRef.current.committed) {
      // A successful mutation is not an unsaved form. Never persist it again,
      // even when an optional post-create reload or draft cleanup failed.
      try { await clearOfflineDraft(draftKey); } catch {
        setStatus("Item already created. Local draft cleanup is unavailable; do not re-create it from a recovered draft.");
      }
      onClose();
      return true;
    }
    if (!draftMeaningful) {
      onClose();
      return true;
    }
    if (settings?.userAutoSaveDrafts === false) {
      const discard = await confirmCluster({
        title: "Discard create draft?",
        message: "This create form has unsaved changes and draft autosave is disabled. Closing now will discard them.",
        confirmLabel: "Discard draft",
        cancelLabel: "Keep editing",
        tone: "danger",
      });
      if (!discard) return false;
      await clearOfflineDraft(draftKey);
      onClose();
      return true;
    }
    try {
      await saveOfflineDraft(draftKey, draftSnapshot, { ttlMs: 30 * 24 * 60 * 60 * 1000 });
      onClose();
      return true;
    } catch {
      const discard = await confirmCluster({
        title: "Draft could not be saved",
        message: "Cluster could not persist the latest create draft locally. Close anyway and discard these changes?",
        confirmLabel: "Close and discard",
        cancelLabel: "Keep editing",
        tone: "danger",
      });
      if (!discard) {
        setStatus("Draft save failed. Your changes are still open in this form.");
        return false;
      }
      onClose();
      return true;
    }
  }
  async function openDuplicate(match: ReturnType<typeof findLikelyDuplicates>[number]) {
    if (!await requestClose()) return;
    if (match.kind === "project" && match.projectId) onOpenProject(match.projectId);
    else if (match.boardId) onOpenBoard(match.boardId);
  }
  async function repairProjectStorage() {
    setBusy(true);
    setStatus("Repairing storage...");
    try {
      await api("/api/admin/storage/verify", { method: "POST", body: JSON.stringify({ source: "project-create" }) });
      setCreateError(null);
      setStatus("Storage repaired. Project creation is ready to retry.");
    } catch (error) {
      const detail = apiErrorPresentation(error);
      setCreateError(detail);
      setStatus(`${detail.title} · ${detail.code}`);
    } finally {
      setBusy(false);
    }
  }

  function createdNavigationTarget(entity: { kind: Parameters<typeof emitSharedCreateCompleted>[0]["entity"]["kind"]; id: string; projectId?: string | null }): ClusterWorkNavigationTarget | null {
    const targetProjectId = entity.projectId || selectedProject?.id || projectId || null;
    if (entity.kind === "project") return { screen: "project", projectId: entity.id };
    if (entity.kind === "card") return { screen: "board", projectId: targetProjectId, boardId: selectedBoard?.id || boardId || null, inspectScope: "card", inspectId: entity.id };
    if (entity.kind === "ticket") return { screen: "tickets", projectId: targetProjectId, inspectScope: "ticket", inspectId: entity.id };
    if (entity.kind === "whiteboard") return { screen: "whiteboard", projectId: targetProjectId, whiteboardId: entity.id };
    if (entity.kind === "build") return { screen: "project", projectId: targetProjectId, projectTab: "builds", inspectScope: "build-artifact", inspectId: entity.id };
    if (entity.kind === "meeting") return { screen: "project", projectId: targetProjectId, projectTab: "plan" };
    // Create & Open means opening the newly created record, not dropping the
    // user onto a generic tool index and making them search for it again.
    if (entity.kind === "calendar") return { screen: "calendar", projectId: targetProjectId, inspectScope: "calendar-event", inspectId: entity.id };
    if (entity.kind === "scheduler") return { screen: "scheduler", projectId: targetProjectId, inspectScope: "schedule-block", inspectId: entity.id };
    if (entity.kind === "timeline") return { screen: "timeline", projectId: targetProjectId, inspectScope: "timeline-item", inspectId: entity.id };
    if (entity.kind === "packet") return { screen: "packets", packetId: entity.id };
    return null;
  }

  /** Mutating creates use durable server receipts in addition to the immediate click lock. */
  function createMutation<T>(path: string, options: NonNullable<Parameters<typeof api>[1]>): Promise<T> {
    if (createSessionController.current.signal.aborted) return Promise.reject(new Error("Create session has changed."));
    const method = String(options.method || "POST").toUpperCase();
    const body = typeof options.body === "string" ? options.body : JSON.stringify(options.body ?? null);
    const headers = new Headers(options.headers || {});
    headers.set("X-Cluster-Idempotency-Key", createIntentRef.current.requestKey(method, path, body));
    return api<T>(path, { ...options, headers, signal: createSessionController.current.signal });
  }

  async function finalizeCreatedEntity(entity: { kind: Parameters<typeof emitSharedCreateCompleted>[0]["entity"]["kind"]; id: string; projectId?: string | null; label?: string | null }, disposition: "open" | "another") {
    // The primary create succeeded. An optional workflow link/upload failure must
    // never turn the already-created object into a second Create on retry.
    createIntentRef.current.commit();
    if (createSessionController.current.signal.aborted) return "";
    const source = activeHandoff?.source;
    const relationship = activeHandoff?.relationship;
    let linkWarning = "";
    if (source && relationship) {
      const linkProjectId = source.projectId || entity.projectId || selectedProject?.id || projectId || "";
      if (linkProjectId) {
        try {
          await api(`/api/projects/${encodeURIComponent(linkProjectId)}/workflow-links`, {
            method: "POST",
            body: JSON.stringify({
              source: { ...source, projectId: source.projectId || linkProjectId },
              target: { ...entity, projectId: entity.projectId || linkProjectId },
              relationship,
            }),
            signal: createSessionController.current.signal,
          });
        } catch {
          linkWarning = " Created successfully, but the related-work link could not be saved.";
        }
      }
    }
    const nativeFiles = activeHandoff?.nativeFiles?.slice(0, 8) || [];
    if (nativeFiles.length) {
      const evidenceProjectId = entity.projectId || selectedProject?.id || projectId || "";
      const evidenceKind = ["card", "ticket", "build", "whiteboard"].includes(entity.kind) ? entity.kind as "card" | "ticket" | "build" | "whiteboard" : null;
      if (!evidenceProjectId || !evidenceKind) {
        linkWarning += " Native capture upload requires a project-backed Card, Ticket, Build, or Whiteboard.";
      } else {
        let queued = 0;
        for (const file of nativeFiles) {
          // Native transfers are not abortable mid-flight. Do not submit any
          // additional captures after the initiating login/drawer disappears.
          if (createSessionController.current.signal.aborted) break;
          try {
            await uploadNativeProjectFile(file.handle, {
              projectId: evidenceProjectId,
              title: file.name.replace(/\.[^.]+$/, "") || "Desktop capture",
              originalName: file.name,
              mimeType: file.mimeType || "image/png",
              category: "evidence",
              assetRole: "reference",
              status: "review",
              tags: ["shared-work", "desktop-capture"],
              evidenceForKind: evidenceKind,
              evidenceForId: entity.id,
              evidenceForLabel: entity.label || title.trim(),
              evidenceRelationship: "evidence_for",
            });
            if (createSessionController.current.signal.aborted) break;
            queued += 1;
          } catch {
            if (createSessionController.current.signal.aborted) break;
            linkWarning += ` ${file.name} could not be queued as evidence.`;
          }
        }
        if (queued) linkWarning += ` ${queued} Desktop capture${queued === 1 ? "" : "s"} queued for verified upload and automatic evidence linking.`;
      }
    }
    if (createSessionController.current.signal.aborted) return linkWarning;
    emitSharedCreateCompleted({ mode, entity, source, relationship });
    const shouldOpenCreated = disposition === "open" && activeHandoff?.openOnComplete !== false;
    if (shouldOpenCreated) {
      const navigation = createdNavigationTarget(entity);
      if (navigation) window.setTimeout(() => { if (!createSessionController.current.signal.aborted) openClusterWorkNavigation(navigation); }, 0);
    }
    return linkWarning;
  }

  async function submitSharedCreate(disposition: "open" | "another" = "open") {
    if (!canOfferCreateMode(mode)) { setStatus("Creation is unavailable: this tool is disabled or your current access does not allow edits."); return; }
    if (readinessIssues.length > 0) {
      setShowValidation(true);
      setStatus(readinessIssues[0]);
      return;
    }
    if (duplicateMatches[0]?.score >= 0.86 && !duplicateOverride) {
      setStatus("A near-identical item already exists. Open it, or confirm that this should be created anyway.");
      return;
    }
    if (!createIntentRef.current.begin()) {
      if (createIntentRef.current.committed) setStatus("This item was already created. Close the drawer or choose Create another.");
      return;
    }
    setShowValidation(false);
    setBusy(true);
    setCreateError(null);
    setStatus("Creating...");
    try {
      let completionWarning = "";
      if (mode === "project") {
        const memberIds = unique([projectLeadId, projectExternal ? externalOwnerId : ""].filter(Boolean));
        const roleLabels = Object.fromEntries(memberIds.map((id, index) => [id, index === 0 ? "Project Lead" : "Partner Owner"]));
        const provisioningRequest = {
          name: title.trim(), externalName: projectExternalName.trim() || null, codename: projectCodename.trim() || null, aliases: projectAliases.split(",").map((alias) => alias.trim()).filter(Boolean), description: details || null, objective: projectObjective.trim() || null, clientName: projectClientName.trim() || null,
          startDate: projectStartDate || null, targetDate: projectTargetDate || null, priority: projectPriority,
          tags: projectTags.split(",").map((tag) => tag.trim()).filter(Boolean), color: projectColor, healthNote: null,
          projectType: selectedProjectType.id, productionProfile: selectedProductionProfile.id, blueprintKey: projectTypeTemplate || null, workspacePresetKey, projectTypeTemplate: projectTypeTemplate || null,
          status: projectStatus, external: projectExternal, memberIds, leadId: projectLeadId, roleLabels, provisioningKey: projectProvisioningKey, sourceControl: "auto" as const,
          createDefaultBoard: createStarterBoard, boardName: settings?.defaultProjectBoardNameMode === "project" ? `${title.trim()} Board` : selectedProjectType.starterBoardName || `${selectedProjectType.label} Board`,
          createWhiteboard: createStarterWhiteboard, whiteboardName: `${title.trim()} Whiteboard`, whiteboardDescription: details || selectedProjectType.note || null,
          createLibraryFolder: createStarterLibrary, libraryFolderName: `${title.trim()} Library`, libraryFolderDescription: details || selectedProjectType.note || null,
        };
        const verifiedPreview = await api<{ ok: boolean; preview: { steps: Array<{ id: string; label: string; action: string }>; sourceControl: { requested: "auto" | "enabled" | "disabled"; capability: "off" | "optional" | "default" | "required"; required: boolean; shouldProvision: boolean; defaults: { defaultBranch: string; lfs: boolean; ignoreTemplate: "generic" | "unreal" | "software" }; selectedRepositoryId: string | null } } }>("/api/projects/provision/preview", { method: "POST", body: JSON.stringify(provisioningRequest), signal: createSessionController.current.signal });
        const sourcePreview = verifiedPreview.preview.sourceControl;
        const sourceSummary = sourcePreview.selectedRepositoryId
          ? `bind existing repository · ${sourcePreview.defaults.defaultBranch}`
          : sourcePreview.shouldProvision
            ? `Cluster repo · ${sourcePreview.defaults.defaultBranch} · ${sourcePreview.defaults.ignoreTemplate}${sourcePreview.defaults.lfs ? " · LFS" : ""}`
            : `off by default · ${sourcePreview.capability}`;
        setStatus(`Plan verified · ${verifiedPreview.preview.steps.filter((step) => step.action !== "skip").length} active steps · Source Control: ${sourceSummary}.`);
        const started = projectProvisionRetryId
          ? await api<{ ok: boolean; operation: ProjectProvisionOperation }>(`/api/projects/provision/${encodeURIComponent(projectProvisionRetryId)}/retry`, { method: "POST", signal: createSessionController.current.signal })
          : await createMutation<{ ok: boolean; operation: ProjectProvisionOperation }>("/api/projects/provision", { method: "POST", body: JSON.stringify(provisioningRequest) });
        let operation = started.operation;
        for (let poll = 0; poll < 360 && !["succeeded", "failed", "dead-letter", "cancelled"].includes(operation.status); poll += 1) {
          setStatus(`${operation.progressMessage || "Provisioning project workspace"} · ${Math.round(operation.progress || 0)}%`);
          const pollDelay = poll < 4 ? 650 : poll < 20 ? 1_000 : 1_500;
          await new Promise((resolve) => window.setTimeout(resolve, pollDelay));
          if (createSessionController.current.signal.aborted) throw new Error("Create session has changed.");
          const snapshot = await api<{ ok: boolean; operation: ProjectProvisionOperation }>(`/api/projects/provision/${operation.id}`, { signal: createSessionController.current.signal });
          operation = snapshot.operation;
        }
        if (operation.status !== "succeeded" || !operation.result?.projectId) {
          if (["failed", "dead-letter", "cancelled"].includes(operation.status)) setProjectProvisionRetryId(operation.id);
          throw new Error(operation.lastError || `Project provisioning ended in ${operation.status}.`);
        }
        setProjectProvisionRetryId(null);
        createIntentRef.current.commit();
        // A successful server create must still open its exact record if the
        // optional list refresh fails. Admission rechecks Project access.
        let projectReloadWarning = "";
        try { await onReloadProjects(); } catch {
          projectReloadWarning = " Project created; the Project list could not refresh yet.";
        }
        if (createSessionController.current.signal.aborted) return;
        const createdProjectId = operation.result.projectId;
        completionWarning = (await finalizeCreatedEntity({ kind: "project", id: createdProjectId, projectId: createdProjectId, label: title.trim() }, disposition)) + projectReloadWarning;
        setProjectProvisioningKey(crypto.randomUUID());
        const sourceResult = operation.result?.source;
        const sourceCompletion = sourceResult?.repositoryId
          ? ` Source Control ready · ${sourceResult.defaultBranch || "main"}${sourceResult.lfs ? " · LFS" : ""}.`
          : sourceResult?.state === "skipped"
            ? " Source Control not provisioned for this project type."
            : "";
        setStatus(`${selectedProjectType.label} · ${selectedProductionProfile.label} project provisioned.${sourceCompletion}${completionWarning}`);
      }
      if (mode === "card") {
        if (!firstList || !selectedBoard) throw new Error("Pick a board with at least one list first.");
        const labels = unique(
          labelsText
            .split(",")
            .map((label) => label.trim())
            .filter(Boolean),
        );
        const createdCard = await createMutation<Card>("/api/cards", {
          method: "POST",
          body: JSON.stringify({
            listId: firstList.id,
            title: title.trim(),
            description: details || undefined,
            priority: cardPriority,
            dueDate: dueDate || null,
            labels,
            assigneeId: assigneeId || null,
          }),
        });
        completionWarning = await finalizeCreatedEntity({ kind: "card", id: createdCard.id, projectId: selectedBoard.projectId, label: createdCard.title }, disposition);
        setStatus(`Board card created.${completionWarning}`);
      }
      if (mode === "ticket" || mode === "bug") {
        const ticketBoard = boards.find((candidate) => candidate.id === ticketTargetBoardId && candidate.projectId === selectedProject?.id);
        const ticketList = ticketBoard?.lists?.find((candidate) => candidate.id === ticketTargetListId && !candidate.isDone);
        if (!ticketBoard || !ticketList) throw new Error("Choose an active Board and List for this Project Ticket. Cluster will not automatically populate a Board.");
        const labels = unique([
          mode === "bug" ? "bug" : "ticket",
          mode === "bug"
            ? "qa"
            : ticketType
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-|-$/g, ""),
          ...labelsText
            .split(",")
            .map((label) => label.trim())
            .filter(Boolean),
        ]);
        const description =
          mode === "bug"
            ? [
                `Type: Bug`,
                bugEnvironment && `Environment: ${bugEnvironment}`,
                bugSteps &&
                  `Reproduction steps:
${bugSteps}`,
                bugExpected &&
                  `Expected:
${bugExpected}`,
                bugActual &&
                  `Actual:
${bugActual}`,
                details,
              ]
                .filter(Boolean)
                .join("\n\n")
            : [`Type: ${ticketType}`, details].filter(Boolean).join("\n\n");
        const createdTicket = await createMutation<TicketCard>("/api/tickets", {
          method: "POST",
          body: JSON.stringify({
            projectId: selectedProject?.id || null,
            boardId: ticketBoard.id,
            listId: ticketList.id,
            title: title.trim(),
            description,
            priority: cardPriority,
            dueDate: dueDate || null,
            labels,
            assigneeId: assigneeId || null,
          }),
        });
        completionWarning = await finalizeCreatedEntity({ kind: "ticket", id: createdTicket.id, projectId: selectedProject?.id || null, label: createdTicket.title }, disposition);
        setStatus(`${mode === "bug" ? "Bug ticket created." : "Ticket created."}${completionWarning}`);
      }
      if (mode === "whiteboard") {
        const board = await createMutation<WhiteboardSummary>("/api/whiteboards", {
          method: "POST",
          body: JSON.stringify({
            name: title.trim(),
            description: [details, whiteboardTemplate !== "blank" ? `Template: ${whiteboardTemplate}` : ""].filter(Boolean).join("\n\n") || null,
            projectId: selectedProject?.id || null,
            canvasWidth: Math.max(640, Math.min(8000, Number(whiteboardWidth) || 1800)),
            canvasHeight: Math.max(480, Math.min(8000, Number(whiteboardHeight) || 950)),
          }),
        });
        completionWarning = await finalizeCreatedEntity({ kind: "whiteboard", id: board.id, projectId: selectedProject?.id || null, label: board.name }, disposition);
        try { await onReloadWhiteboards(); } catch {
          completionWarning += " Whiteboard created; the list could not refresh yet.";
        }
        setStatus(`Whiteboard created.${completionWarning}`);
      }
      if (mode === "packet") {
        if (packetAudience.mode !== "all" && !packetAudience.targets.length) throw new Error("Choose a packet audience target or use Whole studio.");
        if (packetCompletionMode === "form" && !packetCompletionFormId) throw new Error("Choose a reusable completion form.");
        const createdPacket = await createMutation<{ id: string; title: string }>("/api/packets", {
          method: "POST",
          body: JSON.stringify({
            title: title.trim(),
            description: details.trim(),
            kind: packetPurpose,
            versionLabel: packetVersionLabel.trim() || "1.0",
            audience: packetAudience,
            completionMode: packetCompletionMode,
            completionFormId: packetCompletionMode === "form" ? packetCompletionFormId || null : null,
            required: packetRequired,
            dueDays: packetDueDays.trim() ? Number(packetDueDays) : null,
            recertifyDays: packetRecertifyDays.trim() ? Number(packetRecertifyDays) : null,
            recordCompletion: packetRecordCompletion,
          }),
        });
        completionWarning = await finalizeCreatedEntity({ kind: "packet", id: createdPacket.id, label: createdPacket.title }, disposition);
        setStatus(`Packet created.${completionWarning}`);
      }
      if (mode === "timeline") {
        const startsAtDate = new Date(`${date}T${timelineStartTime || "09:00"}:00`);
        const endsAtDate = new Date(`${timelineEndDate || date}T${timelineEndTime || timelineStartTime || "10:00"}:00`);
        if (Number.isNaN(startsAtDate.getTime()) || Number.isNaN(endsAtDate.getTime())) throw new Error("Choose valid start and end dates and times.");
        if (endsAtDate.getTime() < startsAtDate.getTime()) throw new Error("The timeline end must be after the start.");
        const createdTimeline = await createMutation<TimelineEntry>("/api/timeline/items", {
          method: "POST",
          body: JSON.stringify({
            projectId: selectedProject?.id || null,
            title: title.trim(),
            description: details || null,
            startsAt: startsAtDate.toISOString(),
            endsAt: endsAtDate.toISOString(),
            type: timelineType,
            color: timelineColor,
          }),
        });
        completionWarning = await finalizeCreatedEntity({ kind: "timeline", id: createdTimeline.id, projectId: selectedProject?.id || null, label: createdTimeline.title }, disposition);
        setStatus(`Timeline item created.${completionWarning}`);
      }
      if (mode === "calendar") {
        const startsAt = fromDateTimeLocalInput(calendarStartsAt);
        const endsAt = calendarAllDay ? null : fromDateTimeLocalInput(calendarEndsAt);
        const createdCalendar = await createMutation<{ id: string; title: string; projectId?: string | null }>("/api/calendar/events", {
          method: "POST",
          body: JSON.stringify({
            projectId: selectedProject?.id || null,
            title: title.trim(),
            description: details || null,
            location: calendarLocation.trim() || null,
            startsAt,
            endsAt,
            allDay: calendarAllDay,
            color: timelineColor,
            eventType: calendarType,
            status: calendarStatus,
            ownerId: assigneeId || null,
            attendeeIds,
            reminderMinutes: calendarReminder ? Number(calendarReminder) : null,
          }),
        });
        completionWarning = await finalizeCreatedEntity({ kind: "calendar", id: createdCalendar.id, projectId: createdCalendar.projectId || selectedProject?.id || null, label: createdCalendar.title }, disposition);
        setStatus(`Calendar event created.${completionWarning}`);
      }
      if (mode === "scheduler") {
        const createdSchedule = await createMutation<{ id?: string; title?: string; projectId?: string | null; pendingApproval?: boolean }>("/api/schedule/blocks", {
          method: "POST",
          body: JSON.stringify({
            userId: assigneeId || currentUser.id,
            projectId: selectedProject?.id || null,
            boardId: activeHandoff?.source?.kind === "board" ? activeHandoff.source.id : activeHandoff?.boardId || null,
            cardId: activeHandoff?.source && ["card", "ticket"].includes(activeHandoff.source.kind) ? activeHandoff.source.id : null,
            title: title.trim(),
            description: details || null,
            startsAt: fromDateTimeLocalInput(timeStartsAt),
            endsAt: fromDateTimeLocalInput(timeEndsAt),
            type: timeBlockType,
            color: timeColor,
          }),
        });
        createIntentRef.current.commit();
        if (createdSchedule.id) completionWarning = await finalizeCreatedEntity({ kind: "scheduler", id: createdSchedule.id, projectId: createdSchedule.projectId || selectedProject?.id || null, label: createdSchedule.title || title.trim() }, disposition);
        setStatus(`${createdSchedule.pendingApproval ? "Time-off request created." : "Schedule block created."}${completionWarning}`);
      }
      if (mode === "build") {
        if (!selectedProject) throw new Error("Select a project before creating a build artifact.");
        if (!buildRepositoryId || !buildBranch || !buildRevision) throw new Error("Select a synchronized repository, branch, and revision before creating a build.");
        const nextId = localId("build");
        const payload = {
          title: title.trim(),
          version: buildVersion.trim() || "unversioned",
          lane: buildLane,
          platform: buildPlatform || selectedBuildProfile.defaultPlatform,
          sourceRepositoryId: buildRepositoryId,
          sourceBranch: buildBranch,
          sourceRevision: buildRevision,
          sourceReviewId: buildReviewId || null,
          artifactUrl: buildArtifactUrl.trim(),
          changelog: details,
          channel: buildLane === "release" ? "release" : "internal",
          buildNumber: "",
          createdBy: displayUserName(currentUser),
          ownerId: assigneeId || null,
          reviewerIds: [],
          fileSize: "",
          checksum: "",
          signed: false,
          pinned: false,
          promotedAt: null,
          testedPlatforms: [],
          expiresAt: null,
          platformKey: selectedBuildProfile.key,
          metadata: activeBuildMeta,
        };
        const createdBuild = await createMutation<BuildArtifactRecord>(`/api/projects/${encodeURIComponent(selectedProject.id)}/delivery/build/${encodeURIComponent(nextId)}`, {
          method: "PUT",
          body: JSON.stringify({ payload }),
        });
        completionWarning = await finalizeCreatedEntity({ kind: "build", id: createdBuild.id, projectId: selectedProject.id, label: createdBuild.title || createdBuild.version }, disposition);
        setStatus(`${selectedBuildProfile.artifactLabel} created for ${selectedProject.name}.${completionWarning}`);
      }
      if (mode === "meeting") {
        if (!selectedProject) throw new Error("Select a project before creating a meeting.");
        const meeting: MeetingRecord = {
          id: localId("meeting"),
          projectId: selectedProject?.id || "",
          name: title.trim(),
          goal: details,
          start: date,
          end:
            meetingEndDate ||
            toLocalDateInput(addDays(new Date(`${date}T00:00:00`), 14)),
          capacity: meetingCapacity || "40",
          status: "planned",
          createdAt: new Date().toISOString(),
        };
        await createMutation(`/api/projects/${encodeURIComponent(selectedProject.id)}/workflows/meeting/${encodeURIComponent(meeting.id)}`, {
          method: "PUT",
          body: JSON.stringify({ payload: meeting }),
        });
        completionWarning = await finalizeCreatedEntity({ kind: "meeting", id: meeting.id, projectId: selectedProject.id, label: meeting.name }, disposition);
        setStatus(`Meeting created.${completionWarning}`);
      }
      // Local conveniences run *after* the authoritative create. A browser
      // storage error must not be presented as a failed server mutation.
      let localPreferenceWarning = "";
      try {
        createMemory.save(mode, { mode, projectId: selectedProject?.id || projectId || null, boardId: selectedBoard?.id || boardId || null, assigneeId: assigneeId || null, priority: cardPriority, labelsText, usedAt: new Date().toISOString() });
      } catch {
        localPreferenceWarning = " Recently-used defaults could not be saved.";
      }
      try {
        await clearOfflineDraft(draftKey);
      } catch {
        // Do not reset the intent for Create Another or silently dismiss a
        // form whose old snapshot can still resurface on the next mount.
        setStatus("Item created, but its local draft could not be cleared. Close the drawer to retry cleanup; do not submit again.");
        return;
      }
      if (localPreferenceWarning) setStatus((previous) => `${previous}${localPreferenceWarning}`);
      setRecoveredDraft(null);
      setDuplicateMatches([]);
      setDuplicateOverride(false);
      setShowValidation(false);
      setTitle("");
      setDetails("");
      setExternalOwnerId("");
      setProjectLeadId(currentUser.id);
      setBuildVersion("");
      setBuildRevision("");
      setBuildReviewId("");
      setBuildArtifactUrl("");
      setAssigneeId("");
      setAttendeeIds([]);
      setDueDate("");
      setLabelsText("");
      setBugEnvironment("");
      setBugSteps("");
      setBugExpected("");
      setBugActual("");
      setCalendarLocation("");
      if (disposition === "another") {
        // Create another is a new deliberate intent; it must receive new
        // idempotency keys and a new provisioning key.
        createIntentRef.current.finish();
        createIntentRef.current.reset();
        setProjectProvisioningKey(crypto.randomUUID());
        setStatus("Created. Ready for another item.");
      } else {
        window.setTimeout(() => { if (!createSessionController.current.signal.aborted) onClose(); }, 650);
      }
    } catch (err) {
      const detail = apiErrorPresentation(err);
      if (detail.code === "IDEMPOTENCY_ALREADY_COMMITTED") {
        // The server proves the Create committed, but does not replay an ID or
        // private payload. Never resubmit or synthesize an object for navigation.
        createIntentRef.current.commit();
        setCreateError({ ...detail, title: "Create already applied", action: "Refresh the destination workspace to locate the created record. Do not resubmit." });
        setStatus("The server confirms this Create already completed. No duplicate was submitted. Refresh the destination workspace to locate it.");
        if (mode === "project") void onReloadProjects().catch(() => undefined);
        else if (mode === "whiteboard") void onReloadWhiteboards().catch(() => undefined);
      } else {
        setCreateError(detail);
        const savedProjectNeedsSource = mode === "project" && err instanceof Error && /project .+ was saved|project and its library were preserved/i.test(err.message);
        setStatus(createIntentRef.current.committed
          ? `Item created, but a follow-up action failed: ${detail.title}. Do not submit it again.`
          : savedProjectNeedsSource
            ? "Project saved. Git setup failed, but your project and Library are preserved. Choose Retry project setup after checking the Server Git runtime. Do not create a second project."
            : `${detail.title} · ${detail.code}`);
      }
    } finally {
      createIntentRef.current.finish();
      setBusy(false);
    }
  }
  return (
    <ClusterModal
      open={open}
      onClose={() => { void requestClose(); }}
      closeOnEscape={!busy}
      backdropClassName="shared-create-backdrop-v254"
      includeDefaultBackdropClass={false}
      className={`shared-create-workspace-v254 panel ${showModePicker ? "picker-mode-v455" : "form-mode-v455"}`}
      labelledBy="shared-create-title-v370"
      portal={false}
      dialogProps={{
        tabIndex: -1,
        onKeyDown: (event) => {
          if (!showModePicker && !busy && event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void submitSharedCreate("open"); }
        },
      }}
    >
        {showModePicker ? (
          <SharedCreateModePicker
            query={createTypeQuery}
            normalizedQuery={normalizedCreateQuery}
            visibleModeIds={visibleCreateModeIds}
            modes={availableModes}
            filteredGroups={filteredModeGroups}
            recentModes={recentModes}
            activeMode={activeCreateMode}
            showSpecializedModes={showSpecializedModes}
            specializedModeCount={CREATE_SPECIALIZED_MODE_IDS.filter((id) => availableModes.some((item) => item.id === id)).length}
            onToggleSpecializedModes={() => setShowSpecializedModes((value) => !value)}
            onQueryChange={setCreateTypeQuery}
            onClearQuery={() => setCreateTypeQuery("")}
            onActivateMode={setActiveCreateMode}
            onChooseMode={changeCreateMode}
            onCreateAnnouncement={currentUser.isAdmin ? () => { onClose(); openClusterWorkNavigation({ screen: "studioSettings", inspectScope: "studio-announcement-new", inspectId: "new" }); } : undefined}
            onClose={() => void requestClose()}
            onKeyDown={handleCreatePickerKeyDown}
          />
        ) : <main className="shared-create-main-v254">
          <header className="shared-create-header-v254">
            <ClusterButton type="button" variant="quiet" size="compact" className="shared-create-back-v455" onClick={() => setShowModePicker(true)} disabled={busy} aria-label="Choose a different item type">
              <ClusterIcon name="chevron-left" /><span>Create</span>
            </ClusterButton>
            <div className="shared-create-title-v448">
              <span className="shared-create-title-icon-v448" data-create-mode={mode}><ClusterIcon name={mode === "project" ? "project" : selectedMode?.icon || "plus"} treatment="duotone" /></span>
              <span className="shared-create-title-copy-v448"><h2 id="shared-create-title-v370">{selectedMode?.label || "Item"}</h2></span>
            </div>
            <ClusterButton type="button" variant="quiet" size="compact" className="shared-create-close-v448" onClick={() => void requestClose()} disabled={busy} aria-label="Close item creator">
              <ClusterIcon name="close" />
            </ClusterButton>
          </header>
          <div className="shared-create-scroll-v254">
            <div className="create-context-strip-v161">
              <span>
                <b>{selectedMode?.label || "Item"}</b>
                <em>{mode === "project" ? `${selectedProjectType.label} · ${levelLabel(projectStatus)}` : selectedProject ? `${selectedProject.name} · ${projectTypeBadge(selectedProject)}` : "No project selected"}</em>
              </span>
              {mode === "build" && (
                <span>
                  <b>{selectedBuildProfile.label}</b>
                  <em>
                    {selectedBuildProfile.artifactLabel} · {selectedBuildProfile.versionLabel}
                  </em>
                </span>
              )}
              {mode === "card" && (
                <span>
                  <b>{selectedBoard?.name || "No board"}</b>
                  <em>{firstList?.title || "No list available"}</em>
                </span>
              )}
              {(mode === "bug" || mode === "ticket") && (
                <span>
                  <b>{assigneeId ? displayUserName(createUsers.find((user) => user.id === assigneeId)) : "Unassigned"}</b>
                  <em>{mode === "bug" ? "QA bug workflow" : `${ticketType} ticket`}</em>
                </span>
              )}
            </div>
            {activeHandoff?.source && (
              <section className="smart-create-context-v276 smart-create-context-compact-v521">
                <span><strong>From:</strong> {activeHandoff.source.label || activeHandoff.source.kind}{activeHandoff.relationship ? ` · ${activeHandoff.relationship.replace(/_/g, " ")}` : ""}</span>
              </section>
            )}
            {recoveredDraft && (
              <section className="smart-create-recovery-v276">
                <div>
                  <strong>Unsaved draft found</strong>
                  <span>{recoveredDraft.value.title || recoveredDraft.value.details || "Previous create form"} · {formatRelativeTime(new Date(recoveredDraft.updatedAt).toISOString())}</span>
                </div>
                <div className="smart-create-draft-actions-v276">
                  <ClusterButton type="button" variant="primary" onClick={restoreCreateDraft}>Restore</ClusterButton>
                  <ClusterButton type="button" variant="secondary" onClick={discardCreateDraft}>Discard</ClusterButton>
                </div>
              </section>
            )}
            {duplicateMatches.length > 0 && (
              <section className="smart-create-warning-v276" aria-live="polite">
                <div>
                  <strong>{duplicateMatches[0].score >= 0.86 ? "Likely duplicate" : "Similar work already exists"}</strong>
                  <span>Review the existing item before creating another copy.</span>
                  <div className="smart-create-warning-list-v276">
                    {duplicateMatches.map((match) => (
                      <ClusterButton type="button" key={`${match.kind}-${match.id}`} variant="quiet" size="compact" className="" onClick={() => void openDuplicate(match)}>
                        <span>{match.title}<small>{match.subtitle || levelLabel(match.kind)}</small></span>
                        <b>{Math.round(match.score * 100)}%</b>
                      </ClusterButton>
                    ))}
                  </div>
                </div>
                {duplicateMatches[0].score >= 0.86 && !duplicateOverride ? (
                  <ClusterButton type="button" variant="secondary" onClick={() => { setDuplicateOverride(true); setStatus("Duplicate warning acknowledged. Creation is now allowed."); }}>Create anyway</ClusterButton>
                ) : (
                  <span className="soft-pill">Review only</span>
                )}
              </section>
            )}
            {selectedAssigneeActivity && ["card", "ticket", "bug", "calendar"].includes(mode) && (
              <div className={`smart-create-workload-v276 ${selectedAssigneeTone}`}>
                <span><strong>{displayUserName(selectedAssigneeActivity as User)}</strong> · {selectedAssigneeLoad}</span>
                {selectedAssigneeTone === "danger" || selectedAssigneeTone === "warn" ? <span className="soft-pill">Check capacity</span> : <span className="soft-pill">Available</span>}
              </div>
            )}
            {showValidation && readinessIssues.length > 0 && (
              <section className="shared-create-readiness-v479" role="alert" aria-live="polite">
                <ClusterIcon name="warning" />
                <div><strong>Finish {readinessIssues.length === 1 ? "this field" : "these fields"}</strong><ul>{readinessIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul></div>
              </section>
            )}
            {createError && <CreateErrorPanel detail={createError} canRepair={Boolean(currentUser.isAdmin)} busy={busy} onRepair={() => void repairProjectStorage()} onIssueFocus={(path) => {
              const leaf = path.split(/[.[\]]/).filter(Boolean).pop()?.replace(/Id$/i, "") || path;
              const labelNeedle = leaf.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[-_]/g, " ").trim().toLowerCase();
              const aliases: Record<string, string[]> = { title: ["title", "name"], project: ["project"], board: ["board"], list: ["list", "column"], assignee: ["assignee", "owner"], dueDate: ["due date", "date"], details: ["details", "description"] };
              const terms = aliases[leaf] || [labelNeedle];
              const fields = Array.from(document.querySelectorAll<HTMLElement>(".create-form-v161 .field"));
              const field = fields.find((entry) => { const text = entry.querySelector("label")?.textContent?.trim().toLowerCase() || ""; return terms.some((term) => text.includes(term.toLowerCase())); });
              const control = field?.querySelector<HTMLElement>("input, textarea, select, button, [tabindex]");
              field?.scrollIntoView({ behavior: "smooth", block: "center" });
              control?.focus();
            }} />}
            <div className={`create-form-v161 create-form-${mode}-v228`}>
              <div className="field full">
                <label>{mode === "bug" ? "Bug title" : mode === "ticket" ? "Ticket title" : mode === "timeline" ? "Timeline title" : mode === "calendar" ? "Event title" : mode === "scheduler" ? "Schedule block title" : mode === "meeting" ? "Meeting name" : mode === "build" ? selectedBuildProfile.artifactLabel : mode === "packet" ? "Packet name" : "Title"}</label>
                <ClusterTextInput value={title} onChange={(event) => setTitle(event.target.value)} placeholder={mode === "project" ? "New project" : mode === "build" ? `${selectedBuildProfile.artifactLabel} ${buildVersion || "0.1.0"}` : "Name it"} />
              </div>
              <SharedCreateOptionalDisclosure open={showAdvanced} guidance={activeGuidance} onToggle={() => setShowAdvanced((value) => !value)} />

              {mode === "project" && (
                <>
                  <div className="field">
                    <label>Project type</label>
                    <ClusterSelect
                      value={projectType}
                      onChange={setProjectType}
                      ariaLabel="Project type"
                      options={projectTypePresets.map((option) => ({
                        value: option.id,
                        label: option.label,
                      }))}
                    />
                  </div>
                  {productionProfiles.length > 1 && <div className="field">
                    <label>Technology profile</label>
                    <ClusterSelect value={selectedProductionProfile.id} onChange={setProductionProfile} ariaLabel="Technology profile" options={productionProfiles.map((profile) => ({ value: profile.id, label: profile.label }))} />
                    <small>Optional technology specialization enabled by Studio Settings. Project Type controls the workflow.</small>
                  </div>}
                  <div className="field">
                    <label>Project lead</label>
                    <ClusterSelect
                      value={projectLeadId}
                      onChange={setProjectLeadId}
                      ariaLabel="Project lead"
                      options={[
                        { value: "", label: "Select project lead" },
                        ...createUsers
                          .filter((user) => !user.archived)
                          .map((user) => ({
                            value: user.id,
                            label: displayUserName(user),
                            meta: user.department || user.title || undefined,
                          })),
                      ]}
                    />
                    
                  </div>
                  {showAdvanced && <SharedCreateProjectAdvancedOptions
                    projectExternalName={projectExternalName}
                    setProjectExternalName={setProjectExternalName}
                    projectCodename={projectCodename}
                    setProjectCodename={setProjectCodename}
                    projectAliases={projectAliases}
                    setProjectAliases={setProjectAliases}
                    workspacePresetKey={workspacePresetKey}
                    setWorkspacePresetKey={setWorkspacePresetKey}
                    projectTypeTemplate={projectTypeTemplate}
                    setProjectTypeTemplate={setProjectTypeTemplate}
                    projectTypeTemplates={selectedProjectTypeTemplates}
                    projectStatus={projectStatus}
                    setProjectStatus={setProjectStatus}
                    projectStatusOptions={PROJECT_STATUS_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                    projectPriority={projectPriority}
                    setProjectPriority={setProjectPriority}
                    priorityOptions={Array.from(PRIORITY_CREATE_OPTIONS, (option) => ({ value: option.value, label: option.label }))}
                    projectStartDate={projectStartDate}
                    setProjectStartDate={setProjectStartDate}
                    projectTargetDate={projectTargetDate}
                    setProjectTargetDate={setProjectTargetDate}
                    projectObjective={projectObjective}
                    setProjectObjective={setProjectObjective}
                    projectClientName={projectClientName}
                    setProjectClientName={setProjectClientName}
                    projectTags={projectTags}
                    setProjectTags={setProjectTags}
                    projectColor={projectColor}
                    setProjectColor={setProjectColor}
                    selectedProjectType={selectedProjectType}
                    createStarterBoard={createStarterBoard}
                    setCreateStarterBoard={setCreateStarterBoard}
                    createStarterWhiteboard={createStarterWhiteboard}
                    setCreateStarterWhiteboard={setCreateStarterWhiteboard}
                    createStarterLibrary={createStarterLibrary}
                    setCreateStarterLibrary={setCreateStarterLibrary}
                    projectExternal={projectExternal}
                    setProjectExternal={setProjectExternal}
                    settings={settings}
                    externalOwnerId={externalOwnerId}
                    setExternalOwnerId={setExternalOwnerId}
                    createUsers={createUsers}
                  />}
                </>
              )}

              {mode !== "project" && (
                <div className="field">
                  <label>Assigned project</label>
                  <ClusterSelect
                    value={projectId}
                    onChange={changeCreateProject}
                    ariaLabel="Assigned project"
                    options={[
                      { value: "", label: "No project" },
                      ...projects.map((project) => ({
                        value: project.id,
                        label: project.name,
                        meta: projectTypeBadge(project),
                      })),
                    ]}
                  />
                </div>
              )}
              {mode === "card" && (
                <>
                  <div className="field">
                    <label>Board</label>
                    <ClusterSelect
                      value={boardId}
                      onChange={changeCreateBoard}
                      ariaLabel="Board"
                      options={projectBoards.map((board) => ({
                        value: board.id,
                        label: board.name,
                        meta: board.projectName,
                      }))}
                    />
                  </div>
                  <div className="field">
                    <label>Priority</label>
                    <ClusterSelect
                      value={cardPriority}
                      onChange={(value) => setCardPriority(value as Priority)}
                      ariaLabel="Priority"
                      options={PRIORITY_CREATE_OPTIONS.map((option) => ({
                        value: option.value,
                        label: option.label,
                      }))}
                    />
                  </div>
                  <div className="field">
                    <label>Ticket destination Board</label>
                    <ClusterNativeSelect value={ticketTargetBoardId} onChange={(event) => { setTicketTargetBoardId(event.target.value); setTicketTargetListId(""); }}>
                      <option value="">Choose Board...</option>
                      {boards.filter((board) => board.projectId === selectedProject?.id).map((board) => <option key={board.id} value={board.id}>{board.name}</option>)}
                    </ClusterNativeSelect>
                  </div>
                  <div className="field">
                    <label>Ticket destination List</label>
                    <ClusterNativeSelect value={ticketTargetListId} disabled={!ticketTargetBoardId} onChange={(event) => setTicketTargetListId(event.target.value)}>
                      <option value="">Choose active List...</option>
                      {boards.find((board) => board.id === ticketTargetBoardId)?.lists?.filter((list) => !list.isDone).map((list) => <option key={list.id} value={list.id}>{list.title}</option>)}
                    </ClusterNativeSelect>
                  </div>
                  {showAdvanced && <>
                  <PeoplePicker value={assigneeId} onChange={setAssigneeId} people={createPeople} label="Assignee" ariaLabel="Card assignee" />
                  <div className="field">
                    <label>Due date</label>
                    <ClusterTextInput type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
                  </div>
                  <div className="field full">
                    <label>Labels</label>
                    <ClusterTextInput value={labelsText} onChange={(event) => setLabelsText(event.target.value)} placeholder="design, blocked, client-review" />
                    <small>Comma-separated board labels.</small>
                  </div>
                  </>}
                </>
              )}
              {(mode === "ticket" || mode === "bug") && (
                <>
                  {mode === "ticket" && (
                    <div className="field">
                      <label>Ticket type</label>
                      <ClusterSelect value={ticketType} onChange={setTicketType} ariaLabel="Ticket type" options={["Task", "Feature", "Improvement", "Support", "Incident", "Security", "Access Request", "Infrastructure", "Build Issue", "Documentation", "Client Feedback", "Discussion"].map((value) => ({ value, label: value }))} />
                    </div>
                  )}
                  <div className="field">
                    <label>{mode === "bug" ? "Severity" : "Priority"}</label>
                    <ClusterSelect
                      value={cardPriority}
                      onChange={(value) => setCardPriority(value as Priority)}
                      ariaLabel="Ticket priority"
                      options={PRIORITY_CREATE_OPTIONS.map((option) => ({
                        value: option.value,
                        label: option.label,
                      }))}
                    />
                  </div>
                  {showAdvanced && <>
                  <PeoplePicker value={assigneeId} onChange={setAssigneeId} people={createPeople} label="Assignee" ariaLabel="Ticket assignee" />
                  <div className="field">
                    <label>Due date</label>
                    <ClusterTextInput type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
                  </div>
                  <div className="field full">
                    <label>Labels</label>
                    <ClusterTextInput value={labelsText} onChange={(event) => setLabelsText(event.target.value)} placeholder="pipeline, client, blocker" />
                  </div>
                  </>}
                  {mode === "bug" && (
                    <>
                      <div className="field full">
                        <label>Environment / affected build</label>
                        <ClusterTextInput value={bugEnvironment} onChange={(event) => setBugEnvironment(event.target.value)} placeholder="Platform, build, branch, device, map, or environment" />
                      </div>
                      <div className="field full">
                        <label>Reproduction steps</label>
                        <ClusterTextArea
                          value={bugSteps}
                          onChange={(event) => setBugSteps(event.target.value)}
                          placeholder="1. Open…
2. Perform…
3. Observe…"
                        />
                      </div>
                      <div className="field">
                        <label>Expected behavior</label>
                        <ClusterTextArea value={bugExpected} onChange={(event) => setBugExpected(event.target.value)} />
                      </div>
                      <div className="field">
                        <label>Actual behavior</label>
                        <ClusterTextArea value={bugActual} onChange={(event) => setBugActual(event.target.value)} />
                      </div>
                    </>
                  )}
                </>
              )}
              {mode === "packet" && (
                <>
                  <div className="field full">
                    <label>Description</label>
                    <ClusterTextArea value={details} onChange={(event) => setDetails(event.target.value)} placeholder="What this packet is for." />
                  </div>
                  <div className="field">
                    <label>Purpose</label>
                    <ClusterNativeSelect value={packetPurpose} onChange={(event) => setPacketPurpose(event.target.value as PacketPurpose)}>
                      <option value="knowledge">Knowledge</option><option value="training">Training</option><option value="onboarding">Onboarding</option><option value="policy">Policy</option><option value="procedure">Procedure</option><option value="handoff">Handoff</option>
                    </ClusterNativeSelect>
                  </div>
                  <div className="field">
                    <label>Version</label>
                    <ClusterInput value={packetVersionLabel} onChange={(event) => setPacketVersionLabel(event.target.value)} placeholder="1.0" />
                  </div>
                  <div className="field">
                    <label>Completion</label>
                    <ClusterNativeSelect value={packetCompletionMode} onChange={(event) => { const next = event.target.value as PacketCompletionMode; setPacketCompletionMode(next); if (next !== "form") setPacketCompletionFormId(""); }}>
                      <option value="none">None</option><option value="read">Read</option><option value="acknowledge">Acknowledge</option><option value="form">Reusable form</option>
                    </ClusterNativeSelect>
                  </div>
                  {packetCompletionMode === "form" && <div className="field">
                    <label>Completion form</label>
                    <ClusterNativeSelect value={packetCompletionFormId} onChange={(event) => setPacketCompletionFormId(event.target.value)}>
                      <option value="">Choose form…</option>{packetCompletionForms.map((form) => <option key={form.id} value={form.id}>{form.title} · v{form.version}</option>)}
                    </ClusterNativeSelect>
                  </div>}
                  <div className="field">
                    <label>Due after</label>
                    <ClusterInput type="number" min="1" max="3650" value={packetDueDays} onChange={(event) => setPacketDueDays(event.target.value)} placeholder="Optional days" />
                  </div>
                  <div className="field">
                    <label>Recertify after</label>
                    <ClusterInput type="number" min="1" max="3650" value={packetRecertifyDays} onChange={(event) => setPacketRecertifyDays(event.target.value)} placeholder="Optional days" />
                  </div>
                  <div className="field full shared-create-packet-audience-v521">
                    <label>Audience</label>
                    <StudioAudiencePicker value={packetAudience} onChange={setPacketAudience} compact />
                  </div>
                  <label className="field shared-create-check-v521"><ClusterInput type="checkbox" checked={packetRequired} onChange={(event) => setPacketRequired(event.target.checked)} /><span>Required packet</span></label>
                  <label className="field shared-create-check-v521"><ClusterInput type="checkbox" checked={packetRecordCompletion} onChange={(event) => setPacketRecordCompletion(event.target.checked)} /><span>Personnel Record evidence</span></label>
                </>
              )}

              {mode === "timeline" && (
                <>
                  <div className="field">
                    <label>Type</label>
                    <ClusterSelect
                      value={timelineType}
                      onChange={setTimelineType}
                      ariaLabel="Timeline type"
                      options={[
                        { value: "milestone", label: "Milestone" },
                        { value: "deadline", label: "Deadline" },
                        { value: "release", label: "Release" },
                        { value: "playtest", label: "Playtest" },
                        { value: "meeting", label: "Meeting" },
                        { value: "note", label: "Note" },
                      ]}
                    />
                  </div>
                  <div className="field">
                    <label>Start date</label>
                    <ClusterTextInput type="date" value={date} onChange={(event) => setDate(event.target.value)} />
                  </div>
                  {showAdvanced && <>
                  <div className="field">
                    <label>Start time</label>
                    <ClusterTextInput type="scheduler" value={timelineStartTime} onChange={(event) => setTimelineStartTime(event.target.value)} />
                  </div>
                  <div className="field">
                    <label>End date</label>
                    <ClusterTextInput type="date" value={timelineEndDate || date} min={date} onChange={(event) => setTimelineEndDate(event.target.value)} />
                  </div>
                  <div className="field">
                    <label>End time</label>
                    <ClusterTextInput type="scheduler" value={timelineEndTime} onChange={(event) => setTimelineEndTime(event.target.value)} />
                  </div>
                  <ColorField value={timelineColor} onChange={setTimelineColor} label="Timeline color" />
                  </>}
                </>
              )}
              {mode === "calendar" && (
                <>
                  <div className="field">
                    <label>Event type</label>
                    <ClusterSelect
                      value={calendarType}
                      onChange={setCalendarType}
                      ariaLabel="Calendar event type"
                      options={[
                        { value: "meeting", label: "Meeting" },
                        { value: "review", label: "Review" },
                        { value: "deadline", label: "Deadline" },
                        { value: "release", label: "Release" },
                        { value: "focus", label: "Focus block" },
                        { value: "time-off", label: "Time off" },
                      ]}
                    />
                  </div>
                  <div className="field">
                    <label>Status</label>
                    <ClusterSelect
                      value={calendarStatus}
                      onChange={setCalendarStatus}
                      ariaLabel="Calendar event status"
                      options={[
                        { value: "scheduled", label: "Scheduled" },
                        { value: "tentative", label: "Tentative" },
                        { value: "confirmed", label: "Confirmed" },
                        { value: "cancelled", label: "Cancelled" },
                      ]}
                    />
                  </div>
                  <div className="field">
                    <label>Starts</label>
                    <ClusterTextInput type="datetime-local" value={calendarStartsAt} onChange={(event) => setCalendarStartsAt(event.target.value)} />
                  </div>
                  {!calendarAllDay && (
                    <div className="field">
                      <label>Ends</label>
                      <ClusterTextInput type="datetime-local" min={calendarStartsAt} value={calendarEndsAt} onChange={(event) => setCalendarEndsAt(event.target.value)} />
                    </div>
                  )}
                  {showAdvanced && <>
                  <PeoplePicker value={assigneeId} onChange={setAssigneeId} people={createPeople} label="Owner" emptyLabel="Current user" ariaLabel="Calendar owner" />
                  <PeopleMultiPicker values={attendeeIds} onChange={setAttendeeIds} people={createPeople} label="Attendees" emptyLabel="Add attendee" />
                  <div className="field">
                    <label>Reminder</label>
                    <ClusterSelect
                      value={calendarReminder}
                      onChange={setCalendarReminder}
                      ariaLabel="Calendar reminder"
                      options={[
                        { value: "", label: "No reminder" },
                        { value: "5", label: "5 minutes before" },
                        { value: "15", label: "15 minutes before" },
                        { value: "30", label: "30 minutes before" },
                        { value: "60", label: "1 hour before" },
                        { value: "1440", label: "1 day before" },
                      ]}
                    />
                  </div>
                  <div className="field full">
                    <label>Location or meeting link</label>
                    <ClusterTextInput value={calendarLocation} onChange={(event) => setCalendarLocation(event.target.value)} placeholder="Studio, Discord channel, room, or URL" />
                  </div>
                  <label className="tool-check">
                    <ClusterInput type="checkbox" checked={calendarAllDay} onChange={(event) => setCalendarAllDay(event.target.checked)} /> All-day event
                  </label>
                  <ColorField value={timelineColor} onChange={setTimelineColor} label="Event color" />
                  </>}
                </>
              )}
              {mode === "scheduler" && (
                <>
                  <div className="field">
                    <label>Block type</label>
                    <ClusterSelect
                      value={timeBlockType}
                      onChange={setTimeBlockType}
                      ariaLabel="Schedule block type"
                      options={[
                        { value: "work", label: "Work" },
                        { value: "focus", label: "Focus" },
                        { value: "meeting", label: "Meeting" },
                        { value: "availability", label: "Availability" },
                        { value: "time-off", label: "Time off" },
                        { value: "unavailable", label: "Unavailable" },
                      ]}
                    />
                  </div>
                  <div className="field">
                    <label>Starts</label>
                    <ClusterTextInput type="datetime-local" value={timeStartsAt} onChange={(event) => setTimeStartsAt(event.target.value)} />
                  </div>
                  <div className="field">
                    <label>Ends</label>
                    <ClusterTextInput type="datetime-local" min={timeStartsAt} value={timeEndsAt} onChange={(event) => setTimeEndsAt(event.target.value)} />
                  </div>
                  {showAdvanced ? <>
                    <PeoplePicker value={assigneeId} onChange={setAssigneeId} people={createPeople} label="Scheduled person" emptyLabel="Current user" ariaLabel="Scheduled person" />
                    <ColorField value={timeColor} onChange={setTimeColor} label="Block color" />
                  </> : null}
                </>
              )}
              {mode === "meeting" && (
                <>
                  <div className="field">
                    <label>Start date</label>
                    <ClusterTextInput type="date" value={date} onChange={(event) => setDate(event.target.value)} />
                  </div>
                  <div className="field">
                    <label>End date</label>
                    <ClusterTextInput type="date" value={meetingEndDate} min={date} onChange={(event) => setMeetingEndDate(event.target.value)} />
                  </div>
                  {showAdvanced ? <div className="field">
                    <label>Capacity</label>
                    <ClusterTextInput type="number" min="1" max="10000" value={meetingCapacity} onChange={(event) => setMeetingCapacity(event.target.value)} />
                  </div> : null}
                </>
              )}
              {mode === "whiteboard" && (
                <>
                  <div className="field">
                    <label>Template intent</label>
                    <ClusterSelect
                      value={whiteboardTemplate}
                      onChange={setWhiteboardTemplate}
                      ariaLabel="Whiteboard template"
                      options={[
                        { value: "blank", label: "Blank canvas" },
                        { value: "brainstorm", label: "Brainstorm" },
                        { value: "flow", label: "Process flow" },
                        { value: "review", label: "Review board" },
                        { value: "retrospective", label: "Retrospective" },
                        { value: "architecture", label: "Architecture map" },
                      ]}
                    />
                  </div>
                  <div className="field">
                    <label>Canvas width</label>
                    <ClusterTextInput type="number" min="640" max="8000" value={whiteboardWidth} onChange={(event) => setWhiteboardWidth(event.target.value)} />
                  </div>
                  <div className="field">
                    <label>Canvas height</label>
                    <ClusterTextInput type="number" min="480" max="8000" value={whiteboardHeight} onChange={(event) => setWhiteboardHeight(event.target.value)} />
                  </div>
                </>
              )}

              {mode === "build" && (
                <>
                  <div className="field">
                    <label>Lane</label>
                    <ClusterSelect
                      value={buildLane}
                      onChange={setBuildLane}
                      ariaLabel="Build lane"
                      options={selectedBuildProfile.lanes.map((lane) => ({
                        value: lane.id,
                        label: lane.label,
                        meta: lane.hint,
                      }))}
                    />
                  </div>
                  <div className="field">
                    <label>{selectedBuildProfile.versionLabel}</label>
                    <ClusterTextInput value={buildVersion} onChange={(event) => setBuildVersion(event.target.value)} placeholder="0.1.0, v12, private version" />
                  </div>
                  <div className="field">
                    <label>Platform / target</label>
                    <ClusterSelect value={buildPlatform} onChange={setBuildPlatform} ariaLabel="Build platform" options={selectedBuildProfile.platforms.map((platform) => ({ value: platform, label: platform }))} />
                  </div>
                  <div className="field span-2"><p className="muted tight">Build provenance comes from synchronized Source Control and becomes immutable when the build is created.</p></div>
                  <div className="field">
                    <label>Repository</label>
                    <ClusterSelect value={buildRepositoryId} disabled={buildSourceLoading || !buildSourceOptions?.repositories.length} onChange={(repositoryId) => {
                      const repository = buildSourceOptions?.repositories.find((item) => item.repositoryId === repositoryId);
                      const branch = repository?.branches.find((item) => item.name === repository.defaultBranch) || repository?.branches.find((item) => item.isDefault) || repository?.branches[0];
                      const revision = repository?.commits.find((item) => item.revision === branch?.headRevision)?.revision || branch?.headRevision || repository?.commits[0]?.revision || "";
                      setBuildRepositoryId(repositoryId); setBuildBranch(branch?.name || repository?.defaultBranch || ""); setBuildRevision(revision); setBuildReviewId("");
                    }} ariaLabel="Build repository" options={[{ value: "", label: buildSourceLoading ? "Loading repositories…" : "Select repository" }, ...(buildSourceOptions?.repositories || []).map((item) => ({ value: item.repositoryId, label: `${item.name}${item.isPrimary ? " · Primary" : ""}` }))]} />
                  </div>
                  <div className="field">
                    <label>Branch</label>
                    <ClusterSelect value={buildBranch} disabled={!buildRepositoryId} onChange={(branchName) => {
                      const repository = buildSourceOptions?.repositories.find((item) => item.repositoryId === buildRepositoryId);
                      const branch = repository?.branches.find((item) => item.name === branchName);
                      const revision = repository?.commits.find((item) => item.revision === branch?.headRevision)?.revision || branch?.headRevision || repository?.commits.find((item) => item.branchNames?.includes(branchName))?.revision || "";
                      setBuildBranch(branchName); setBuildRevision(revision); setBuildReviewId("");
                    }} ariaLabel="Build branch" options={[{ value: "", label: "Select branch" }, ...((buildSourceOptions?.repositories.find((item) => item.repositoryId === buildRepositoryId)?.branches) || []).map((branch) => ({ value: branch.name, label: `${branch.name}${branch.isDefault ? " · Default" : ""}` }))]} />
                  </div>
                  <div className="field span-2">
                    <label>Review</label>
                    <ClusterSelect value={buildReviewId} disabled={!buildRepositoryId} onChange={(reviewId) => {
                      const repository = buildSourceOptions?.repositories.find((item) => item.repositoryId === buildRepositoryId);
                      const review = repository?.reviews.find((item) => item.id === reviewId);
                      setBuildReviewId(reviewId);
                      if (review) { setBuildBranch(review.mergedRevision ? review.targetBranch : review.sourceBranch); setBuildRevision(review.mergedRevision || review.sourceRevision); }
                    }} ariaLabel="Build review" options={[{ value: "", label: "No review · exact revision" }, ...((buildSourceOptions?.repositories.find((item) => item.repositoryId === buildRepositoryId)?.reviews) || []).map((review) => ({ value: review.id, label: `${review.title} · ${review.sourceBranch} → ${review.targetBranch} · ${review.status}` }))]} />
                  </div>
                  <div className="field span-2">
                    <label>Revision</label>
                    <ClusterSelect value={buildRevision} disabled={!buildRepositoryId} onChange={(revision) => { setBuildRevision(revision); setBuildReviewId(""); }} ariaLabel="Build revision" options={[{ value: "", label: "Select synchronized revision" }, ...((buildSourceOptions?.repositories.find((item) => item.repositoryId === buildRepositoryId)?.commits.filter((commit) => !commit.branchNames?.length || commit.branchNames.includes(buildBranch))) || []).map((commit) => ({ value: commit.revision, label: `${commit.shortRevision} · ${commit.message.split("\n")[0].slice(0, 100)}` }))]} />
                  </div>
                  {showAdvanced && <>
                  <div className="field">
                    <label>Artifact / publish URL</label>
                    <ClusterTextInput value={buildArtifactUrl} onChange={(event) => setBuildArtifactUrl(event.target.value)} placeholder="Package link, folder, release draft, portal URL" />
                  </div>
                  <div className="build-profile-note-v161 full">
                    <strong>{selectedBuildProfile.label}</strong>
                    <span>{selectedBuildProfile.summary}</span>
                  </div>
                  {selectedBuildProfile.fields.map((field) => (
                    <div key={field.id} className={`field ${field.span === 2 ? "span-2" : ""}`}>
                      <label>{field.label}</label>
                      <ClusterTextInput value={activeBuildMeta[field.id] || ""} onChange={(event) => patchBuildMeta(field.id, event.target.value)} placeholder={field.placeholder} />
                    </div>
                  ))}
                  </>}
                </>
              )}

              {mode !== "packet" && (showAdvanced || mode === "bug" || mode === "meeting") ? <div className="field full">
                <label>{mode === "meeting" ? "Meeting agenda / outcome" : mode === "build" ? "Build notes / changelog" : mode === "bug" ? "Additional evidence / notes" : mode === "ticket" ? "Ticket details and acceptance criteria" : mode === "timeline" ? "Timeline notes" : mode === "whiteboard" ? "Whiteboard purpose" : mode === "project" ? "Project brief" : "Card description"}</label>
                <ClusterTextArea value={details} onChange={(event) => setDetails(event.target.value)} placeholder={mode === "bug" ? "Logs, screenshots, frequency, workaround, or related ticket." : mode === "ticket" ? "Context, requested outcome, acceptance criteria, links, and dependencies." : mode === "project" ? "Goals, scope, deliverables, stakeholders, and constraints." : "Add the context required for this item."} />
              </div> : null}
            </div>
          </div>
          <footer className="shared-create-footer-v254">
            <div className="shared-create-status-v254" role="status" aria-live="polite" aria-atomic="true">
              {status}
            </div>
            <div className="button-row">
              <ClusterButton type="button" variant="secondary" onClick={() => void requestClose()} disabled={busy}>
                {createIntentRef.current.committed ? "Close" : "Cancel"}
              </ClusterButton>
              <ClusterButton type="button" variant="secondary" onClick={() => void submitSharedCreate("another")} disabled={busy || createIntentRef.current.committed} title="Create this item and stay in the drawer">Create another</ClusterButton>
              <ClusterButton type="button" variant="primary" onClick={() => void submitSharedCreate("open")} disabled={createIntentRef.current.committed} busy={busy} busyLabel="Creating…" title={createIntentRef.current.committed ? "This Create already committed; close to review the item" : "Create · Ctrl/Cmd+Enter"}>
                {createIntentRef.current.committed ? "Already created" : mode === "project" && projectProvisionRetryId ? "Retry project setup" : duplicateOverride ? "Create anyway & open" : `Create & open ${selectedMode?.label || "item"}`}
              </ClusterButton>
            </div>
          </footer>
        </main>}
    </ClusterModal>
  );

}
