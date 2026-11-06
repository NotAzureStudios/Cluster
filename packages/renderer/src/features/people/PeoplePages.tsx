import { ClusterVisualComposition, ClusterVisualMeter, ClusterVisualRankedBars } from "../../components/ClusterVisualMetrics";
import { ClusterNativeSelect, ClusterInput } from "../../components/ClusterNativeControls";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import "./people.css";
import { api, queryApi } from "../../core/api";
import { reconcileAfterCommit } from "../../core/post-commit-reconciliation";
import { formatDueDate, formatRelativeTime, levelLabel } from "../../core/format";
import { getToolLevel, TOOL_PERMISSION_OPTIONS } from "../../core/permissions";
import { DataViewAggregationStrip, DataViewDerivedFieldBuilder, DataViewFacetBar, DataViewGroupControl, DataViewProjection, DataViewProjectionComposer, DataViewSelectionBar, DataViewSelectionSetBar, selectedDataSummary, useDataViewDrilldownHistory } from "../../components/DataView";
import { ClusterTableToolbar } from "../../components/ClusterTableToolbar";
import { ClusterDataView } from "../../components/ClusterDataView";
import { ClusterDisclosureGroup } from "../../components/ClusterDisclosureGroup";
import { ClusterButton, ClusterLinkButton } from "../../components/ClusterButton";
import { ClusterEmptyState } from "../../components/ClusterEmptyState";
import { ClusterActionMenu } from "../../components/ClusterContextActions";
import { resolveClusterResourceActions } from "../../core/resource-action-registry";
import { ClusterMetricStrip } from "../../components/ClusterMetricStrip";
import { PEOPLE_DATA_FIELDS, clusterDataDerivedSemanticFields, clusterDataSelectionSetFilterGroup, createClusterDataViewLayout, evaluateClusterDataDerivedFields, mergeClusterDataFilterGroups, planClusterDataDerivedFields, type ClusterDataDerivedField, type ClusterDataExportDelivery, type ClusterDataExportFormat, type ClusterDataGroup, type ClusterDataProjection, type ClusterDataQuery, type ClusterDataSelection, type ClusterDataSelectionSet, type ClusterDataSort, type ClusterDataViewLayout, type ClusterSavedDataView, type ClusterSemanticField } from "@cluster/shared";
import { ClusterDataTable, type ClusterDataTableColumn } from "../../components/ClusterDataTable";
import { requestClusterDataExport } from "../../core/data-export-client";
import { DataExportOperationFeedback } from "../../components/DataExportOperationFeedback";
import { DataExportBuilder } from "../../components/DataExportBuilder";
import { ClusterSegmentedControl } from "../../components/ClusterSegmentedControl";
import { ToolPageHeader } from "../../components/ToolPageHeader";
import { ClusterMasterDetail, readClusterDetailSelection, useClusterDetailHistory } from "../../components/ClusterMasterDetail";
import { InspectorLoadingState, LoadingState } from "../../components/LoadingState";
import { PresenceAvatar } from "../../components/PresenceAvatar";
import { PersonSummary } from "../../components/PersonSummary";
import { DepartmentIdentityMark, type DepartmentIdentity } from "../../components/DepartmentIdentityMark";
import { useProgressiveList } from "../../components/useProgressiveList";
import { useClusterCursorData, type ClusterCursorPage } from "../../components/useClusterCursorData";
import { clusterDataQueryParameter } from "../../components/data-view-query";
import { CLUSTER_PERSON_CHANGED_EVENT, type ClusterPersonSummary } from "@cluster/shared";
import { subscribeClusterCohesionEvent } from "../../core/cohesion-events";
import { useResourceChangeRefresh } from "../../core/use-resource-change-refresh";
import { openClusterWorkNavigation } from "../workflow/work-navigation";
import type { ActivityEvent, Project, TeamAssignment, User, UserActivitySummary } from "../application/application-models";
import {
  canViewSensitiveProfile,
  displayUserName,
  presenceLabel,
  presenceState,
  profileAvailabilityLabel,
  profileCapacityLabel,
  profileCompletionScore,
  profileLocalTime,
  profileWorkloadLabel,
  userInitial,
} from "./people-utils";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterCopyButton } from "../../components/ClusterCopyButton";
import { copyClusterText } from "../../core/clipboard";
import { promptCluster } from "../../components/cluster-dialog-service";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import { PersonnelRecordsPanel } from "./PersonnelRecordsPanel";
import { WorkforceAvailabilityExceptions, type WorkforceAvailabilityException } from "./WorkforceAvailabilityExceptions";
import { CompanyGraphPanel } from "./CompanyGraphPanel";
import { PersonEffectiveAccessPanel } from "./PersonEffectiveAccessPanel";
import { PeopleUserEditor } from "./PeopleUserEditor";
import { AccountCredentialHandoff } from "./AccountCredentialHandoff";
import { canChooseStudioRole, type StudioAssignableRoleChoice } from "./people-role-choice";

const DEFAULT_PEOPLE_PROJECTIONS: ClusterDataProjection[] = [
  { id: "people_department", kind: "grouped", dimensions: ["department"], measures: [{ id: "count", kind: "count", label: "People" }], limit: 20, drilldown: { mode: "filter", presentation: "table" } },
  { id: "people_department_status", kind: "matrix", dimensions: ["department", "status"], measures: [{ id: "count", kind: "count", label: "People" }], limit: 80 },
];

function safeProfileUrl(value?: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function ProfileContactActions({ user }: { user: User }) {
  const website = safeProfileUrl(user.profileWebsite);
  const discord = user.profileDiscordUsername || user.discordUsername || "";
  const hasAny = Boolean(user.email || user.phoneNumber || discord || website);
  if (!hasAny) return <span className="muted">No shared contact methods.</span>;
  return <div className="people-contact-actions-v473">
    {user.email && <ClusterLinkButton className="" href={`mailto:${user.email}`} variant="secondary">Email</ClusterLinkButton>}
    {user.phoneNumber && <ClusterLinkButton className="" href={`tel:${user.phoneNumber}`} variant="secondary">Call</ClusterLinkButton>}
    {discord && <ClusterCopyButton text={discord} copiedLabel="Discord copied" failedLabel="Discord username could not be copied">Copy Discord</ClusterCopyButton>}
    {website && <ClusterLinkButton className="" href={website} target="_blank" rel="noreferrer" variant="secondary">Website</ClusterLinkButton>}
  </div>;
}

type PeopleTeam = {
  id: string; name: string; description?: string | null; department?: string | null; leadUserId?: string | null; lead?: User | null; color?: string | null; archived?: boolean; revision?: number; permissionBundleIds?: string[];
  members: Array<{ userId: string; user?: User | null; roleLabel?: string | null; allocationPercent: number; primaryMembership: boolean }>;
};
type PeopleContextPerson = User & { teamAllocationPercent?: number; allocatedCapacityHours?: number | null; allocationState?: "unallocated" | "underallocated" | "balanced" | "overallocated"; projectHistory?: Array<{ id: string; name: string; projectType?: string | null; status?: string | null; active: boolean; lastContributionAt?: string; contributions: number }> };
type PeopleContext = { generatedAt: string; directory?: { limit: number; loaded: number; truncated: boolean; historyEvidenceRows: number }; teams: PeopleTeam[]; people: PeopleContextPerson[]; profileFieldDefinitions: Array<{ id: string; label: string; type: string; required?: boolean; visibility?: string; options?: string[] }>; expertise: Array<{ name: string; total: number; advanced: number; experts: number }>; capacity: { configuredPeople: number; totalHours: number; minimumHours: number; workingHoursConfigured: number; overallocatedPeople?: number; underallocatedPeople?: number; totalAllocatedHours?: number } };
type PeopleProfilePayload = UserActivitySummary & { recentActivity?: ActivityEvent[]; manager?: Pick<User, "id" | "username" | "displayName" | "preferredName" | "avatarUrl"> | null; directReports?: Array<Pick<User, "id" | "username" | "displayName" | "preferredName" | "avatarUrl" | "title">>; profileFieldDefinitions?: PeopleContext["profileFieldDefinitions"] };
type ProfileCalendarEvent = { id: string; title: string; startsAt: string; endsAt?: string | null; allDay?: boolean; eventType?: string | null; status?: string | null; visibility?: "studio" | "project" | "participants" | "private"; projectId?: string | null; project?: { id: string; name: string } | null; notes?: string | null; attachmentIds?: string[]; ownerId?: string | null; attendeeIds?: string[] };
type WorkforcePerson = Omit<User, "skills"> & {
  employment?: { id: string; departmentId?: string | null; department?: { id: string; name: string; color?: string | null; iconId?: string | null } | null; jobRoleId?: string | null; jobRole?: { id: string; name: string } | null; managerUserId?: string | null; manager?: Pick<User, "id" | "username" | "displayName" | "avatarUrl"> | null; employmentType?: string | null; workLocation?: string | null; startDate?: string | null; endDate?: string | null; capacityHours?: number | null; minimumHours?: number | null; active: boolean; revision: number } | null;
  workingPattern?: { timezone?: string | null; hours?: Record<string, Array<{ start: string; end: string }> | string | null>; revision: number } | null;
  skills?: Array<{ id: string; name: string; level: "learning" | "working" | "advanced" | "expert"; years?: number | null; primary?: boolean }>;
  availability?: string; availabilityMessage?: string | null; declaredStatus?: string | null; presenceDisclosure?: "connection" | "work_state" | "application" | "project" | "detailed" | string; connectionState?: "online" | "idle" | "offline" | "unknown" | string; connectionVisibility?: "visible" | "invisible" | string; clockState?: "clocked_in" | "clocked_out" | "break" | "unknown" | string;
  teams?: Array<{ id: string; name: string; roleId?: string | null; role?: string | null; allocationPercent: number; primary: boolean }>;
  projectMemberships?: Array<{ id: string; projectId: string; projectName: string; roleKey?: string | null; roleLabel?: string | null; allocationPercent: number; accessLevel: string; isLead: boolean; status: string }>;
  availabilityExceptions?: WorkforceAvailabilityException[];
};
type WorkforceContext = {
  generatedAt: string; workspaceId?: string;
  departments: Array<{ id: string; name: string; description?: string | null; parentId?: string | null; leadUserId?: string | null; color?: string | null; iconId?: string | null; members: number; teams: number; revision: number }>;
  jobRoles: Array<{ id: string; name: string; description?: string | null; departmentId?: string | null; departmentName?: string | null; defaultCapacityHours?: number | null; defaultMinimumHours?: number | null; members: number; revision: number }>;
  skills: Array<{ id: string; name: string; description?: string | null; people: number }>;
  teams: Array<{ id: string; name: string; description?: string | null; departmentId?: string | null; department?: { id: string; name: string } | null; leadUserId?: string | null; roles: Array<{ id: string; name: string; description?: string | null }>; members: Array<{ userId: string; roleId?: string | null; role?: string | null; allocationPercent: number; primary: boolean }>; revision: number }>;
  people: WorkforcePerson[];
  capacity: { configuredPeople: number; totalHours: number; clockedIn: number; available: number };
};

function workingHoursSummary(hours?: User["workingHours"]) {
  if (!hours) return "Not configured";
  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].filter((day) => Array.isArray(hours[day]) && (hours[day] as unknown[]).length);
  if (!days.length) return "Not configured";
  const first = hours[days[0]] as Array<{ start: string; end: string }>;
  const same = days.every((day) => { const value = hours[day] as Array<{ start: string; end: string }>; return value?.[0]?.start === first?.[0]?.start && value?.[0]?.end === first?.[0]?.end; });
  return `${days.length} days${same && first?.[0] ? ` · ${first[0].start}–${first[0].end}` : " configured"}`;
}

export function ProfilesPage({ currentUser, projects, onOpenProject, onEditProfile, adminMode = false }: { currentUser: User; projects: Project[]; onOpenProject: (projectId: string) => void; onEditProfile?: () => void; adminMode?: boolean }) {
  const [assignments, setAssignments] = useState<TeamAssignment[]>([]);
  const [selectedUserId, setSelectedUserId] = useState(currentUser.id);
  const [selectedPeopleIds, setSelectedPeopleIds] = useState<Set<string>>(() => new Set());
  const [profile, setProfile] = useState<PeopleProfilePayload | null>(null);
  const [peopleContext, setPeopleContext] = useState<PeopleContext | null>(null);
  const [workforceContext, setWorkforceContext] = useState<WorkforceContext | null>(null);
  const [workforceMode, setWorkforceMode] = useState<"directory" | "organization" | "teams" | "capacity" | "availability">("directory");
  const [availabilityBusy, setAvailabilityBusy] = useState(false);
  const [teamNameDraft, setTeamNameDraft] = useState("");
  const [query, setQuery] = useState("");
  const deferredDirectoryQuery = useDeferredValue(query);
  const [departmentFilter, setDepartmentFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  type ProfileView = "overview" | "work" | "calendar" | "activity" | "records" | "access" | "full" | "edit";
  const [profileView, setProfileViewState] = useState<ProfileView>("overview");
  const [editorDirty, setEditorDirty] = useState(false);
  const { confirmDiscard: confirmEditorDiscard } = useUnsavedChangesGuard({
    dirty: profileView === "edit" && editorDirty,
    title: "Discard user changes?",
    message: "Your user editor contains unsaved changes. Leave without saving?",
  });
  function setProfileView(next: ProfileView) {
    if (profileView === "edit" && editorDirty && next !== "edit") {
      void confirmEditorDiscard().then((confirmed) => {
        if (confirmed) { setEditorDirty(false); setProfileViewState(next); }
      });
    } else setProfileViewState(next);
  }
  const [profileExpanded, setProfileExpanded] = useState(false);
  const [profileCalendar, setProfileCalendar] = useState<ProfileCalendarEvent[]>([]);
  const [profileCalendarLoading, setProfileCalendarLoading] = useState(false);
  const [directoryMode, setDirectoryMode] = useState<"list" | "table">("list");
  const [directorySorts, setDirectorySorts] = useState<ClusterDataSort[]>([{ fieldId: "person", direction: "asc" }]);
  const [directoryGroups, setDirectoryGroups] = useState<ClusterDataGroup[]>([]);
  const [peopleProjections, setPeopleProjections] = useState<ClusterDataProjection[]>(() => DEFAULT_PEOPLE_PROJECTIONS);
  const [peopleDerivedFields, setPeopleDerivedFields] = useState<ClusterDataDerivedField[]>([]);
  const peoplePortableDerivedPlan = useMemo(() => planClusterDataDerivedFields(peopleDerivedFields, PEOPLE_DATA_FIELDS), [peopleDerivedFields]);
  const peopleAnalyticalFields = useMemo<ClusterSemanticField[]>(() => [...PEOPLE_DATA_FIELDS, ...clusterDataDerivedSemanticFields(peoplePortableDerivedPlan.fields)], [peoplePortableDerivedPlan.fields]);
  const peopleExportFields = peopleAnalyticalFields;
  const [peopleAnalyticalSelection, setPeopleAnalyticalSelection] = useState<ClusterDataSelection | null>(null);
  const [peopleAnalyticalSelectionSet, setPeopleAnalyticalSelectionSet] = useState<ClusterDataSelectionSet>({ logic: "or", selections: [] });
  const [directoryTableLayout, setDirectoryTableLayout] = useState<ClusterDataViewLayout | null>(null);
  const [peopleExporting, setPeopleExporting] = useState(false);
  const [peopleExportJobId, setPeopleExportJobId] = useState("");
  const [peopleExportStatus, setPeopleExportStatus] = useState("");
  const peopleDrilldown = useDataViewDrilldownHistory(
    { departmentFilter, statusFilter, selection: peopleAnalyticalSelection, selectionSet: peopleAnalyticalSelectionSet, directoryMode },
    (snapshot) => { setDepartmentFilter(snapshot.departmentFilter); setStatusFilter(snapshot.statusFilter); setPeopleAnalyticalSelection(snapshot.selection); setPeopleAnalyticalSelectionSet(snapshot.selectionSet); setDirectoryMode(snapshot.directoryMode); },
  );
  const [loadStatus, setLoadStatus] = useState("Loading people...");
  const [securityActionUserId, setSecurityActionUserId] = useState("");
  const effectiveAdminMode = Boolean(adminMode && currentUser.isAdmin);
  const [accountFilter, setAccountFilter] = useState<"all" | "attention" | "restricted" | "archived">("all");
  const [createAccountOpen, setCreateAccountOpen] = useState(false);
  const [createAccountBusy, setCreateAccountBusy] = useState(false);
  type CreateRoleCatalog = {
    actorRole: string;
    workspaceId: string;
    roles: StudioAssignableRoleChoice[];
  };
  const [createRoleCatalog, setCreateRoleCatalog] = useState<CreateRoleCatalog | null>(null);
  const [createRoleError, setCreateRoleError] = useState("");
  const [createRoleLoading, setCreateRoleLoading] = useState(false);
  useEffect(() => {
    if (!effectiveAdminMode || !createAccountOpen) {
      setCreateRoleCatalog(null);
      setCreateRoleError("");
      return;
    }
    let cancelled = false;
    setCreateRoleLoading(true);
    setCreateRoleError("");
    void queryApi<CreateRoleCatalog>("/api/admin/users/assignable-roles", {
      force: true, staleMs: 0, persist: false, tags: ["roles", "users", "people"],
    }).then((result) => {
      if (cancelled) return;
      setCreateRoleCatalog(result);
      const canAssign = (id: string) => result.roles.some((role) =>
        role.id === id && canChooseStudioRole(role, result.actorRole));
      setCreateAccountDraft((draft) => canAssign(draft.role) ? draft : { ...draft, role: "member" });
    }).catch((cause: unknown) => {
      if (!cancelled) {
        setCreateRoleCatalog(null);
        setCreateRoleError(cause instanceof Error ? cause.message : "Could not load workspace roles.");
      }
    }).finally(() => { if (!cancelled) setCreateRoleLoading(false); });
    return () => { cancelled = true; };
  }, [effectiveAdminMode, createAccountOpen, currentUser.id]);
  const accountCreateGateRef = useRef(false);
  const [adminActionBusy, setAdminActionBusy] = useState("");
  const accountScopeRef = useRef(currentUser.id);
  const [issuedCredential, setIssuedCredential] = useState<{ username: string; temporaryPassword: string } | null>(null);
  const [createAccountDraft, setCreateAccountDraft] = useState({ username: "", displayName: "", email: "", accountType: "employee", accessExpiresAt: "", role: "member" });
  const [directoryRefresh, setDirectoryRefresh] = useState(0);
  useEffect(() => {
    if (effectiveAdminMode) return;
    setCreateAccountOpen(false);
    setIssuedCredential(null);
    setAccountFilter("all");
  }, [effectiveAdminMode]);
  const profileRequestSequenceRef = useRef(0);
  const peopleLoadSequenceRef = useRef(0);
  const calendarRequestSequenceRef = useRef(0);
  const activeProfileIdRef = useRef(currentUser.id);
  // ProfilesPage can remain mounted across session changes. Invalidate all prior
  // account-scoped responses rather than displaying private state from the old user.
  useEffect(() => {
    accountScopeRef.current = currentUser.id;
    ++profileRequestSequenceRef.current;
    ++peopleLoadSequenceRef.current;
    ++calendarRequestSequenceRef.current;
    activeProfileIdRef.current = currentUser.id;
    setSelectedUserId(currentUser.id);
    setProfile(null);
    setProfileCalendar([]);
    setProfileCalendarLoading(false);
    setAssignments([]);
    setPeopleContext(null);
    setWorkforceContext(null);
    setIssuedCredential(null);
  }, [currentUser.id]);
  const peopleServerGroups = useMemo<ClusterDataGroup[]>(() => directoryGroups.every((group) => group.fieldId === "department") ? directoryGroups.map((group) => ({ fieldId: "department", direction: group.direction })) : [], [directoryGroups]);
  const peopleServerDataQuery = useMemo<ClusterDataQuery>(() => ({
    search: deferredDirectoryQuery.trim() || undefined,
    filters: mergeClusterDataFilterGroups(departmentFilter !== "all" ? { logic: "and", conditions: [{ fieldId: "department", operator: "equals", value: departmentFilter }] } : null, clusterDataSelectionSetFilterGroup(peopleAnalyticalSelectionSet)),
    facets: ["department"],
    aggregations: [
      { id: "count", kind: "count", label: "People" },
      { id: "capacity", kind: "sum", fieldId: "capacityHours", label: "Total capacity" },
      { id: "average_capacity", kind: "average", fieldId: "capacityHours", label: "Average capacity" },
    ],
    projections: peopleProjections,
    groups: peopleServerGroups,
    derivedFields: peoplePortableDerivedPlan.fields,
  }), [deferredDirectoryQuery, departmentFilter, peopleProjections, peopleServerGroups, peoplePortableDerivedPlan.fields, peopleAnalyticalSelectionSet]);
  const peopleServerQueryKey = useMemo(() => JSON.stringify(peopleServerDataQuery), [peopleServerDataQuery]);
  const peopleDirectory = useClusterCursorData<UserActivitySummary>({
    resetKey: `${currentUser.id}:${effectiveAdminMode ? "admin" : "directory"}:${directoryRefresh}:${peopleServerQueryKey}`,
    rowKey: (person) => person.id,
    loadPage: async (cursor): Promise<ClusterCursorPage<UserActivitySummary>> => queryApi<ClusterCursorPage<UserActivitySummary>>(`/api/users?summary=true&paged=true&limit=80${effectiveAdminMode ? "&includeArchived=true" : ""}&dataQuery=${clusterDataQueryParameter(peopleServerDataQuery)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { staleMs: 5_000, maxAgeMs: 2 * 60_000, force: Boolean(cursor), tags: ["users", "people", "directory"] }),
  });
  const contextPeopleById = useMemo(() => new Map((peopleContext?.people || []).map((person) => [person.id, person])), [peopleContext]);
  const workforcePeopleById = useMemo(() => new Map((workforceContext?.people || []).map((person) => [person.id, {
    ...person,
    department: person.employment?.department?.name || person.department || null,
    title: person.employment?.jobRole?.name || person.title || null,
    managerUserId: person.employment?.managerUserId || person.managerUserId || null,
    managerName: person.employment?.manager?.displayName || person.managerName || null,
    employmentType: person.employment?.employmentType || person.employmentType || null,
    workLocation: person.employment?.workLocation || person.workLocation || null,
    startDate: person.employment?.startDate || person.startDate || null,
    capacityHours: person.employment?.capacityHours ?? null,
    minimumHours: person.employment?.minimumHours ?? null,
    timezone: person.workingPattern?.timezone || person.timezone || null,
    workingHours: person.workingPattern?.hours || person.workingHours || {},
    status: person.availability || person.status || "available",
    statusMessage: person.availabilityMessage ?? person.statusMessage ?? null,
    expertise: (person.skills || []).map((skill) => ({ name: skill.name, level: skill.level, years: skill.years ?? null })),
    skills: (person.skills || []).map((skill) => skill.name),
    studioTeams: (person.teams || []).map((team) => ({ id: team.id, name: team.name, roleLabel: team.role || null, allocationPercent: team.allocationPercent, primaryMembership: team.primary })),
  } as PeopleContextPerson])), [workforceContext]);
  const users = useMemo(() => peopleDirectory.rows.filter((person) => effectiveAdminMode || !person.archived).map((person) => ({ ...person, ...(contextPeopleById.get(person.id) || {}), ...(workforcePeopleById.get(person.id) || {}) })), [peopleDirectory.rows, contextPeopleById, workforcePeopleById, effectiveAdminMode]);
  useEffect(() => {
    if (peopleDirectory.error) setLoadStatus(peopleDirectory.error.message || "People directory load failed");
    else if (!peopleDirectory.loading) setLoadStatus(`Loaded ${users.length} people${peopleDirectory.hasMore ? " so far" : ""}.`);
  }, [peopleDirectory.error, peopleDirectory.loading, peopleDirectory.hasMore, users.length]);
  async function loadProfile(userId: string, force = false) {
    const sequence = ++profileRequestSequenceRef.current;
    const result = await api<PeopleProfilePayload>(`/api/users/${encodeURIComponent(userId)}/profile`);
    if (sequence !== profileRequestSequenceRef.current || activeProfileIdRef.current !== userId) return null;
    setProfile(result);
    return result;
  }
  async function loadProfileCalendar(userId: string, force = false) {
    const sequence = ++calendarRequestSequenceRef.current;
    setProfileCalendar([]);
    setProfileCalendarLoading(true);
    try {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date(start.getTime() + 90 * 24 * 60 * 60 * 1000);
      const result = await api<ProfileCalendarEvent[]>(`/api/calendar/events?personId=${encodeURIComponent(userId)}&start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`);
      if (sequence === calendarRequestSequenceRef.current && activeProfileIdRef.current === userId) setProfileCalendar(result);
    } catch (error) {
      // A request superseded by another profile or closed inspector may not
      // surface its old failure on the newly selected person's Calendar.
      if (sequence === calendarRequestSequenceRef.current && activeProfileIdRef.current === userId) throw error;
    } finally {
      if (sequence === calendarRequestSequenceRef.current) setProfileCalendarLoading(false);
    }
  }
  useEffect(() => {
    if (profileView !== "calendar" || !profile?.id) {
      ++calendarRequestSequenceRef.current;
      setProfileCalendarLoading(false);
      return;
    }
    void loadProfileCalendar(profile.id).catch((error) => { if (activeProfileIdRef.current === profile.id) setLoadStatus(error instanceof Error ? error.message : "Profile Calendar load failed"); });
    return () => { ++calendarRequestSequenceRef.current; };
  }, [profileView, profile?.id]);

  useResourceChangeRefresh(async () => {
    if (profileView === "calendar" && profile?.id) await loadProfileCalendar(profile.id, true);
  }, { kinds: ["calendar", "meeting"], debounceMs: 220 });

  async function loadProfiles(targetUserId = activeProfileIdRef.current, force = false, activateTarget = false) {
    const sequence = ++peopleLoadSequenceRef.current;
    if (activateTarget) {
      const nextId = targetUserId || currentUser.id;
      activeProfileIdRef.current = nextId;
      ++calendarRequestSequenceRef.current;
      setProfileCalendar([]);
      setSelectedUserId(nextId);
      setProfile(null);
      // Load the authorized profile immediately; a slow 1000-person context must
      // never gate the person header or a deep link into their full profile.
      await loadProfile(nextId, force).catch((error) => {
        if (activeProfileIdRef.current === nextId) setLoadStatus(error instanceof Error ? error.message : "Profile load failed");
      });
      if (sequence !== peopleLoadSequenceRef.current) return;
    }
    const [assignmentResult, contextResult, workforceResult] = await Promise.all([
      queryApi<TeamAssignment[]>("/api/team/assignments", { force, staleMs: 10_000, maxAgeMs: 2 * 60_000, tags: ["work", "people"] }),
      queryApi<PeopleContext>(`/api/team/context?limit=1000&historyUserId=${encodeURIComponent(targetUserId || currentUser.id)}`, { force, staleMs: 20_000, maxAgeMs: 3 * 60_000, tags: ["users", "people", "teams"] }),
      queryApi<WorkforceContext>("/api/workforce/context", { force, staleMs: 10_000, maxAgeMs: 2 * 60_000, tags: ["users", "people", "workforce"] }),
    ]);
    if (sequence !== peopleLoadSequenceRef.current) return;
    setAssignments(assignmentResult);
    setPeopleContext(contextResult);
    setWorkforceContext(workforceResult);
    if (!activateTarget && activeProfileIdRef.current === targetUserId && targetUserId) {
      await loadProfile(targetUserId, force);
    }
  }
  useEffect(() => {
    const initialTarget = readClusterDetailSelection("person") || currentUser.id;
    activeProfileIdRef.current = initialTarget;
    loadProfiles(initialTarget, false, true).catch((err) => setLoadStatus(err instanceof Error ? err.message : "People load failed"));
  }, [currentUser.id]);
  useEffect(() => subscribeClusterCohesionEvent<Partial<ClusterPersonSummary>>(CLUSTER_PERSON_CHANGED_EVENT, () => {
    setDirectoryRefresh((current) => current + 1);
    void loadProfiles(activeProfileIdRef.current, true).catch((error) => setLoadStatus(error instanceof Error ? error.message : "People refresh failed"));
  }), [currentUser.id]);
  useResourceChangeRefresh(async () => {
    setDirectoryRefresh((current) => current + 1);
    await loadProfiles(activeProfileIdRef.current, true);
  }, { kinds: ["user", "team", "department", "job_role", "form_submission", "onboarding_assignment"], debounceMs: 220 });
  async function resetAuthenticatorsForProfile() {
    if (!profile || !currentUser.isAdmin || profile.id === currentUser.id || securityActionUserId) return;
    const confirmation = await promptCluster({
      title: "Reset account authenticators?",
      message: `This revokes every authenticator and active session for ${displayUserName(profile)}. They must sign in with their password and enroll a compliant authenticator again.`,
      label: "Required confirmation",
      expectedValue: "RESET AUTHENTICATORS",
      confirmLabel: "Reset authenticators",
      tone: "danger",
    }) || "";
    if (confirmation !== "RESET AUTHENTICATORS") { setLoadStatus("Authenticator reset cancelled."); return; }
    setSecurityActionUserId(profile.id);
    setLoadStatus(`Resetting authenticators for ${displayUserName(profile)}…`);
    try {
      await api<{ ok: boolean; sessionsRevoked: boolean; requiresReenrollment: boolean }>(`/api/admin/users/${profile.id}/authenticators/reset`, { method: "POST", headers: { "X-Cluster-Confirmation": confirmation } });
      await loadProfile(profile.id, true);
      setLoadStatus(`Authenticators reset for ${displayUserName(profile)}. Existing sessions were revoked and reenrollment is required.`);
    } catch (error) {
      setLoadStatus(error instanceof Error ? error.message : "Authenticator reset failed.");
    } finally {
      setSecurityActionUserId("");
    }
  }

  async function createPersonAccount() {
    if (!effectiveAdminMode || accountCreateGateRef.current) return;
    const username = createAccountDraft.username.trim();
    if (username.length < 3) { setLoadStatus("Username must contain at least 3 characters."); return; }
    const assignable = createRoleCatalog?.roles.find((role) => role.id === createAccountDraft.role);
    if (!canChooseStudioRole(assignable, createRoleCatalog?.actorRole)) {
      setLoadStatus("Choose an enabled workspace role you are authorized to assign before creating this account.");
      return;
    }
    accountCreateGateRef.current = true;
    const scope = currentUser.id;
    setCreateAccountBusy(true);
    setLoadStatus("Creating account…");
    try {
      const created = await api<PeopleProfilePayload & { temporaryPassword: string }>("/api/users", {
        method: "POST",
        body: JSON.stringify({
          username,
          displayName: createAccountDraft.displayName.trim() || null,
          email: createAccountDraft.email.trim() || null,
          accountType: createAccountDraft.accountType,
          accessExpiresAt: createAccountDraft.accessExpiresAt ? new Date(`${createAccountDraft.accessExpiresAt}T23:59:59`).toISOString() : null,
          role: createAccountDraft.role,
        }),
      });
      if (accountScopeRef.current !== scope) return; // Never show another session's credential.
      setIssuedCredential({ username: created.username, temporaryPassword: created.temporaryPassword });
      setCreateAccountDraft({ username: "", displayName: "", email: "", accountType: "employee", accessExpiresAt: "", role: "member" });
      setDirectoryRefresh((current) => current + 1);
      setLoadStatus(`Account created for ${displayUserName(created)}. Copy the temporary password before leaving this view.`);
      // Creation already committed. A failed follow-up read must never invite a retry
      // of the POST or falsely claim that the account was not created.
      const refreshWarning = await reconcileAfterCommit(() => loadProfiles(created.id, true, true));
      if (refreshWarning) setLoadStatus(`Account created for ${displayUserName(created)}, but the directory refresh failed. The temporary password above remains valid; refresh People manually. ${refreshWarning}`);
    } catch (error) {
      if (accountScopeRef.current === scope) setLoadStatus(error instanceof Error ? error.message : "Account creation failed.");
    } finally { accountCreateGateRef.current = false; if (accountScopeRef.current === scope) setCreateAccountBusy(false); }
  }
  async function issuePasswordResetForProfile() {
    if (!effectiveAdminMode || !profile || adminActionBusy) return;
    const scope = currentUser.id;
    setAdminActionBusy("password-reset");
    try {
      const result = await api<{ ok: boolean; username: string; temporaryPassword: string }>(`/api/admin/users/${profile.id}/password-reset`, { method: "POST" });
      if (accountScopeRef.current !== scope) return; // Response contains a one-time password.
      setIssuedCredential({ username: result.username, temporaryPassword: result.temporaryPassword });
      setLoadStatus(`Password reset issued for ${displayUserName(profile)}. Existing sessions were revoked. Copy the temporary password above.`);
      const refreshWarning = await reconcileAfterCommit(async () => { await loadProfile(profile.id, true); setDirectoryRefresh((current) => current + 1); });
      if (refreshWarning) setLoadStatus(`Password reset succeeded, but profile refresh failed. The temporary password above remains valid. ${refreshWarning}`);
    } catch (error) { if (accountScopeRef.current === scope) setLoadStatus(error instanceof Error ? error.message : "Password reset failed."); }
    finally { if (accountScopeRef.current === scope) setAdminActionBusy(""); }
  }
  async function setProfileAccountState(state: "ACTIVE" | "SUSPENDED" | "DISABLED") {
    if (!effectiveAdminMode || !profile || adminActionBusy) return;
    setAdminActionBusy(`state:${state}`);
    try {
      await api(`/api/admin/users/${profile.id}/account-state`, { method: "PATCH", body: JSON.stringify({ state }) });
      await loadProfile(profile.id, true);
      setDirectoryRefresh((current) => current + 1);
      setLoadStatus(`${displayUserName(profile)} account set to ${state.toLowerCase()}.`);
    } catch (error) { setLoadStatus(error instanceof Error ? error.message : "Account state update failed."); }
    finally { setAdminActionBusy(""); }
  }
  async function setProfileToolPermission(toolKey: string, level: string) {
    if (!effectiveAdminMode || !profile || adminActionBusy) return;
    setAdminActionBusy(`tool:${toolKey}`);
    try {
      const next = { ...(profile.toolPermissions || {}) } as Record<string, string>;
      if (level === "inherit") delete next[toolKey]; else next[toolKey] = level;
      await api(`/api/users/${profile.id}`, { method: "PATCH", body: JSON.stringify({ toolPermissions: next }) });
      await loadProfile(profile.id, true);
      setDirectoryRefresh((current) => current + 1);
      setLoadStatus("Tool access updated.");
    } catch (error) { setLoadStatus(error instanceof Error ? error.message : "Tool access update failed."); }
    finally { setAdminActionBusy(""); }
  }

  async function patchProfileAdministration(patch: Record<string, unknown>, status: string) {
    if (!effectiveAdminMode || !profile || adminActionBusy) return;
    setAdminActionBusy("profile-admin");
    try {
      await api(`/api/users/${profile.id}`, { method: "PATCH", body: JSON.stringify(patch) });
      await loadProfile(profile.id, true);
      setDirectoryRefresh((current) => current + 1);
      setLoadStatus(status);
    } catch (error) { setLoadStatus(error instanceof Error ? error.message : "Account administration update failed."); }
    finally { setAdminActionBusy(""); }
  }

  async function copyProfileLink(person: User) { const url = new URL(window.location.href); url.hash = "#people"; url.searchParams.set("inspect", `person:${person.id}`); const copied = await copyClusterText(url.toString()); setLoadStatus(copied ? "Profile link copied." : "Profile link could not be copied on this device."); }
  async function copyProfileMention(person: User) { const copied = await copyClusterText(`@${person.username}`); setLoadStatus(copied ? `Mention copied for ${displayUserName(person)}.` : "Mention could not be copied on this device."); }

  async function selectProfile(userId: string) {
    if (profileView === "edit" && editorDirty && userId !== activeProfileIdRef.current) {
      if (!(await confirmEditorDiscard())) return;
      setEditorDirty(false);
    }
    ++peopleLoadSequenceRef.current; // Cancel older directory loads selecting a stale target.
    const sequence = ++profileRequestSequenceRef.current;
    activeProfileIdRef.current = userId;
    ++calendarRequestSequenceRef.current;
    setProfileCalendar([]);
    setProfileCalendarLoading(false);
    setProfile(null);
    setSelectedUserId(userId);
    setProfileViewState("overview");
    setLoadStatus("Loading profile...");
    try {
      // Render the profile as soon as its authorized payload arrives. The legacy
      // 1000-person context query should never block opening a single person.
      const profileResult = await api<PeopleProfilePayload>(`/api/users/${encodeURIComponent(userId)}/profile`);
      if (sequence !== profileRequestSequenceRef.current || activeProfileIdRef.current !== userId) return;
      setProfile(profileResult);
      setLoadStatus("Profile loaded.");
      void queryApi<PeopleContext>(`/api/team/context?limit=1000&historyUserId=${encodeURIComponent(userId)}`, {
        staleMs: 60_000, maxAgeMs: 3 * 60_000, tags: ["people", "teams", "profiles"],
      }).then((contextResult) => {
        if (sequence === profileRequestSequenceRef.current && activeProfileIdRef.current === userId) setPeopleContext(contextResult);
      }).catch(() => { /* Profile remains usable when optional context is unavailable. */ });
    } catch (err) {
      if (sequence !== profileRequestSequenceRef.current || activeProfileIdRef.current !== userId) return;
      setProfile(null);
      setLoadStatus(err instanceof Error ? err.message : "Profile load failed");
    }
  }
  const restorePersonDetail = useCallback((id: string | null) => {
    if (id) void selectProfile(id);
    else { ++profileRequestSequenceRef.current; ++peopleLoadSequenceRef.current; ++calendarRequestSequenceRef.current; activeProfileIdRef.current = ""; setSelectedUserId(""); setProfile(null); setProfileCalendar([]); setProfileCalendarLoading(false); setProfileExpanded(false); }
  }, []);
  const personDetailHistory = useClusterDetailHistory("person", selectedUserId || null, restorePersonDetail);
  const openFullProfile = (userId: string) => {
    setProfileExpanded(true);
    personDetailHistory.openDetail(userId);
  };
  const departmentById = useMemo(() => new Map((workforceContext?.departments || []).map((department) => [department.id, department])), [workforceContext?.departments]);
  const departmentByName = useMemo(() => new Map((workforceContext?.departments || []).map((department) => [department.name.trim().toLocaleLowerCase(), department])), [workforceContext?.departments]);
  function departmentForPerson(person: { department?: string | null; employment?: { departmentId?: string | null } | null }): DepartmentIdentity | null {
    const id = person.employment?.departmentId;
    const name = person.department?.trim().toLocaleLowerCase();
    return (id ? departmentById.get(id) : null) || (name ? departmentByName.get(name) : null) || null;
  }
  const departments = Array.from(new Set(users.map((person) => person.department).filter((value): value is string => Boolean(value)))).sort();
  const filteredUsers = users.filter((person) => {
    if (departmentFilter !== "all" && person.department !== departmentFilter) return false;
    if (statusFilter !== "all" && (person.status || "available") !== statusFilter && presenceState(person) !== statusFilter) return false;
    if (effectiveAdminMode) {
      const state = String(person.accountState || "ACTIVE").toUpperCase();
      if (accountFilter === "attention" && !["PASSWORD_CHANGE_REQUIRED", "PASSWORD_RESET_REQUIRED", "MFA_ENROLLMENT_REQUIRED"].includes(state)) return false;
      if (accountFilter === "restricted" && !["SUSPENDED", "DISABLED", "LOCKED"].includes(state)) return false;
      if (accountFilter === "archived" && !person.archived) return false;
      if (accountFilter !== "archived" && person.archived) return false;
    }
    return true;
  });
  const peopleProgress = useProgressiveList(filteredUsers, {
    initial: 80,
    step: 80,
    resetKey: `${query}|${departmentFilter}|${statusFilter}|${accountFilter}|${effectiveAdminMode}`,
  });
  const activeProfiles = users.filter((person) => ["active", "recent", "focus"].includes(presenceState(person))).length;
  const assignmentByUserId = useMemo(() => new Map(assignments.map((item) => [item.user.id, item])), [assignments]);
  const assignedCards = assignments.reduce((total, item) => total + item.cards.length, 0);
  const teamCapacity = users.reduce((total, person) => total + (person.capacityHours || 0), 0);
  const profileAssignment = profile ? assignmentByUserId.get(profile.id) || null : null;
  const profileProjects = profileAssignment?.projects || [];
  const profileCards = profileAssignment?.cards || [];
  const profileShowcaseProjects = profile ? (profile.profilePinnedProjectIds || []).map((id) => projects.find((project) => project.id === id)).filter((project): project is Project => Boolean(project)) : [];
  const profileRecentContributions = profile?.recentActivity?.filter((event) => ["project", "card", "board", "build", "qa", "timeline"].includes(String(event.entityType || "").toLowerCase())).slice(0, 10) || [];
  const now = Date.now();
  const workloadSummary = useMemo(() => users.map((person) => {
    const assignment = assignmentByUserId.get(person.id);
    const cards = assignment?.cards || [];
    const overdue = cards.filter((card) => card.dueDate && new Date(card.dueDate).getTime() < now).length;
    const highPriority = cards.filter((card) => card.priority === "high" || card.priority === "urgent").length;
    return { person, cards: cards.length, projects: assignment?.projects.length || 0, overdue, highPriority, completion: profileCompletionScore(person) };
  }), [users, assignmentByUserId]);
  const workloadByUserId = useMemo(() => new Map(workloadSummary.map((item) => [item.person.id, item])), [workloadSummary]);
  async function exportPeople(format: ClusterDataExportFormat, fieldIds: string[], scope: "view" | "selection", delivery: ClusterDataExportDelivery) {
    setPeopleExporting(true);
    setPeopleExportStatus(delivery === "library" || format === "xlsx" ? "Queueing People export..." : "Exporting People data...");
    try {
      if (scope === "view" && statusFilter !== "all") throw new Error("Current-view export cannot include the local live-presence filter. Clear Presence, or export selected people instead.");
      const result = await requestClusterDataExport({
        resourceKind: "user", format, scope, delivery, fieldIds,
        query: scope === "view" ? peopleServerDataQuery : {},
        selectedIds: scope === "selection" ? [...selectedPeopleIds] : undefined,
        fileName: `people-${new Date().toISOString().slice(0, 10)}`,
      });
      if (result.mode === "background") { setPeopleExportJobId(result.jobId); setPeopleExportStatus("People export queued. The completed file will be saved to Library."); }
      else setPeopleExportStatus(`${result.rowCount} person${result.rowCount === 1 ? "" : "s"} exported${result.truncated ? " (bounded immediate export)" : ""}.`);
    } catch (error) { setPeopleExportStatus(error instanceof Error ? error.message : "People export failed."); }
    finally { setPeopleExporting(false); }
  }

  const peopleServerAnalytics = peopleDirectory.dataView?.analytics || null;
  const peopleAnalyticsExact = statusFilter === "all";
  const selectedPeopleSummary = useMemo(() => selectedDataSummary(peopleProgress.visibleItems, selectedPeopleIds, {
    capacity: (rows) => rows.reduce((sum, person) => sum + (person.capacityHours || 0), 0),
    work: (rows) => rows.reduce((sum, person) => sum + (workloadByUserId.get(person.id)?.cards || 0), 0),
  }), [peopleProgress.visibleItems, selectedPeopleIds, workloadByUserId]);
  const peopleSummaryRows = useMemo(() => [
    ...(selectedPeopleSummary.count ? [{ key: "people-selected", label: "Selected people", scope: selectedPeopleSummary.scope, values: { person: `${selectedPeopleSummary.count} selected`, capacity: `${selectedPeopleSummary.values.capacity || 0}h capacity`, work: `${selectedPeopleSummary.values.work || 0} cards` } }] : []),
    ...(peopleAnalyticsExact && peopleServerAnalytics ? [{ key: "people-dataset", label: "Filtered directory", scope: "dataset" as const, values: { person: `${peopleServerAnalytics.total} people`, capacity: `${Math.round(peopleServerAnalytics.aggregations.capacity || 0)}h capacity` } }] : []),
    { key: "people-visible", label: "Loaded people", scope: "visible" as const, values: { person: `${peopleProgress.visibleItems.length} loaded`, capacity: `${peopleProgress.visibleItems.reduce((sum, person) => sum + (person.capacityHours || 0), 0)}h capacity`, work: `${peopleProgress.visibleItems.reduce((sum, person) => sum + (workloadByUserId.get(person.id)?.cards || 0), 0)} cards` } },
  ], [peopleProgress.visibleItems, selectedPeopleSummary, workloadByUserId, peopleAnalyticsExact, peopleServerAnalytics]);
  const peopleGroupMetrics = useMemo(() => [
    { id: "capacity", label: "Capacity", columnId: "capacity", aggregationId: "capacity", value: (rows: readonly UserActivitySummary[]) => `${rows.reduce((sum, person) => sum + (person.capacityHours || 0), 0)}h`, formatExact: (value: number | null) => `${Math.round(value || 0)}h` },
    { id: "average_capacity", label: "Avg", columnId: "capacity", aggregationId: "average_capacity", value: (rows: readonly UserActivitySummary[]) => rows.length ? `${Math.round(rows.reduce((sum, person) => sum + (person.capacityHours || 0), 0) / rows.length)}h` : "—", formatExact: (value: number | null) => value == null ? "—" : `${Math.round(value)}h` },
  ], []);
  const peopleTableColumns = useMemo<ClusterDataTableColumn<UserActivitySummary>[]>(() => {
    const valueMap = (person: UserActivitySummary) => ({ id: person.id, displayName: displayUserName(person), username: person.username || "", title: person.title || "", department: person.department || "", teamName: person.teamName || "", status: person.status || "offline", capacityHours: person.capacityHours ?? null, minimumHours: person.minimumHours ?? null, updatedAt: person.updatedAt || null });
    const base: ClusterDataTableColumn<UserActivitySummary>[] = [
      { id: "person", header: "Person", hideable: false, pinnable: true, defaultWidth: 260, sortValue: (person) => displayUserName(person), cell: (person) => <ClusterButton unstyled type="button" onClick={() => openFullProfile(person.id)}><PersonSummary person={person} compact profileAction={false} avatarProfilePeek={false} departmentIdentity={departmentForPerson(person)} /></ClusterButton> },
      { id: "role", header: "Role", defaultWidth: 190, sortValue: (person) => person.title || "", groupValue: (person) => person.title || "Member", cell: (person) => person.title || "Member" },
      { id: "department", header: "Department", defaultWidth: 180, sortValue: (person) => person.department || "", groupValue: (person) => person.department || person.teamName || "Unassigned", cell: (person) => { const department = departmentForPerson(person); return department ? <DepartmentIdentityMark department={department} label size={19} /> : person.department || person.teamName || "Unassigned"; } },
      { id: "presence", header: "Presence", defaultWidth: 130, sortValue: (person) => presenceState(person), groupValue: (person) => presenceState(person), cell: (person) => presenceLabel(person) },
      { id: "capacity", header: "Capacity", defaultWidth: 150, sortValue: (person) => person.capacityHours || 0, cell: (person) => profileCapacityLabel(person.capacityHours) },
      { id: "work", header: "Current work", defaultWidth: 170, sortValue: (person) => workloadByUserId.get(person.id)?.cards || 0, cell: (person) => { const work = workloadByUserId.get(person.id); return work ? `${work.cards} cards · ${work.projects} projects` : "No assignments"; } },
      { id: "profile", header: "Profile", defaultWidth: 120, sortValue: (person) => profileCompletionScore(person), cell: (person) => `${profileCompletionScore(person)}%` },
    ];
    return base.concat(peopleDerivedFields.map((derived) => ({
      id: derived.id, header: derived.label, defaultWidth: 150,
      sortValue: (person) => evaluateClusterDataDerivedFields(peopleDerivedFields, valueMap(person), PEOPLE_DATA_FIELDS).values[derived.id] as string | number | boolean | null,
      cell: (person) => { const value = evaluateClusterDataDerivedFields(peopleDerivedFields, valueMap(person), PEOPLE_DATA_FIELDS).values[derived.id]; return typeof value === "number" ? value.toLocaleString(undefined, { maximumFractionDigits: derived.display?.precision ?? 2 }) : String(value ?? "—"); },
    })));
  }, [workloadByUserId, personDetailHistory, peopleDerivedFields, departmentById, departmentByName]);
  const peopleDataFields = useMemo<ClusterSemanticField[]>(() => [
    { id: "person", label: "Person", type: "person", sortable: true, resourceKind: "user" },
    { id: "role", label: "Role", type: "text", sortable: true, groupable: true },
    { id: "department", label: "Department", type: "enum", sortable: true, filterable: true, groupable: true, facet: true },
    { id: "presence", label: "Presence", type: "status", sortable: true, filterable: true, groupable: true, facet: true },
    { id: "capacity", label: "Capacity", type: "number", sortable: true, aggregatable: true, display: { format: "number", unit: "h/week" } },
    { id: "work", label: "Current work", type: "number", sortable: true, aggregatable: true },
    { id: "profile", label: "Profile completeness", type: "number", sortable: true, aggregatable: true, display: { format: "percent" } },
  ], []);
  const defaultPeopleTableLayout = useMemo(() => createClusterDataViewLayout(peopleTableColumns.map((column) => column.id), peopleTableColumns.filter((column) => !column.hiddenByDefault).map((column) => column.id)), [peopleTableColumns]);
  const effectivePeopleTableLayout = directoryTableLayout || defaultPeopleTableLayout;
  const profileAccess = profile ? TOOL_PERMISSION_OPTIONS.map((tool) => ({ ...tool, level: getToolLevel(profile as User, tool.key) })).filter((tool) => tool.level !== "none") : [];
  const profileWork = profile ? workloadSummary.find((item) => item.person.id === profile.id) : null;
  const directReports = profile ? users.filter((person) => person.managerUserId === profile.id || (person.managerName && [profile.displayName, profile.preferredName, profile.username].filter(Boolean).some((name) => person.managerName === name))) : [];
  const profileContext = profile ? peopleContext?.people.find((person) => person.id === profile.id) || null : null;
  const profileTeams = profileContext?.studioTeams || profile?.studioTeams || [];
  const profileHistory = profileContext?.projectHistory || [];
  const profileHistoryProgress = useProgressiveList(profileHistory, {
    initial: 20,
    step: 20,
    resetKey: profile?.id || "",
  });
  const profileAllocation = profileContext?.teamAllocationPercent ?? 0;
  const profileAllocationState = profileContext?.allocationState || "unallocated";
  const canOpenScheduler = getToolLevel(currentUser, "scheduler") !== "none";
  const canManageTeams = getToolLevel(currentUser, "people") === "manage";
  const [teamBundles, setTeamBundles] = useState<Array<{ id: string; label: string; enabled: boolean; revision: number }>>([]);
  const [savingTeamBundleId, setSavingTeamBundleId] = useState("");
  const [teamCreateBusy, setTeamCreateBusy] = useState(false);
  const [busyTeamIds, setBusyTeamIds] = useState<Set<string>>(() => new Set());
  const teamCreateGateRef = useRef(false);
  const teamMutationGateRef = useRef<Set<string>>(new Set());
  const teamBundleSaveGate = useRef(false);
  function beginTeamMutation(teamId: string) {
    if (teamMutationGateRef.current.has(teamId)) return false;
    teamMutationGateRef.current.add(teamId);
    setBusyTeamIds(new Set(teamMutationGateRef.current));
    return true;
  }
  function finishTeamMutation(teamId: string) {
    teamMutationGateRef.current.delete(teamId);
    setBusyTeamIds(new Set(teamMutationGateRef.current));
  }
  useEffect(() => {
    if (!currentUser.isAdmin) { setTeamBundles([]); return; }
    let live = true;
    void api<Array<{ id: string; label: string; enabled: boolean; revision: number }>>("/api/team/permission-bundles")
      .then((items) => { if (live) setTeamBundles(items); })
      .catch(() => { if (live) setTeamBundles([]); });
    return () => { live = false; };
  }, [currentUser.isAdmin]);
  async function refreshPeopleAfterCommit(successMessage: string) {
    setDirectoryRefresh((current) => current + 1);
    setLoadStatus(successMessage);
    // Mutation was committed already; users must not repeat a team write
    // because a subsequent directory read happens to fail.
    const warning = await reconcileAfterCommit(() => loadProfiles(activeProfileIdRef.current, true));
    if (warning) setLoadStatus(`${successMessage} People refresh failed; refresh manually. ${warning}`);
  }
  async function toggleTeamBundle(team: PeopleTeam, bundleId: string) {
    if (!currentUser.isAdmin || teamBundleSaveGate.current || !beginTeamMutation(team.id)) return;
    const ids = new Set(team.permissionBundleIds || []);
    if (ids.has(bundleId)) ids.delete(bundleId); else ids.add(bundleId);
    teamBundleSaveGate.current = true;
    setSavingTeamBundleId(team.id);
    try {
      await api(`/api/team/teams/${encodeURIComponent(team.id)}`, { method: "PATCH", body: JSON.stringify({ expectedRevision: team.revision, permissionBundleIds: [...ids] }) });
      await refreshPeopleAfterCommit(`Updated ${team.name} permission bundles.`);
    } catch (error) {
      setLoadStatus(error instanceof Error ? error.message : "Team permission bundles could not be updated.");
    } finally { teamBundleSaveGate.current = false; setSavingTeamBundleId(""); finishTeamMutation(team.id); }
  }
  async function createTeam() {
    const name = teamNameDraft.trim(); if (!name || teamCreateGateRef.current) return;
    const scope = currentUser.id;
    teamCreateGateRef.current = true;
    setTeamCreateBusy(true);
    setLoadStatus("Creating team...");
    try {
      await api("/api/team/teams", { method: "POST", body: JSON.stringify({ name }) });
      if (accountScopeRef.current !== scope) return;
      setTeamNameDraft("");
      await refreshPeopleAfterCommit("Team created.");
    } catch (error) { if (accountScopeRef.current === scope) setLoadStatus(error instanceof Error ? error.message : "Team creation failed"); }
    finally { teamCreateGateRef.current = false; if (accountScopeRef.current === scope) setTeamCreateBusy(false); }
  }
  async function toggleTeamMember(team: PeopleTeam, userId: string) {
    if (!beginTeamMutation(team.id)) return;
    const exists = team.members.some((member) => member.userId === userId);
    const person = peopleContext?.people.find((item) => item.id === userId);
    const members = exists ? team.members.filter((member) => member.userId !== userId) : [...team.members, { userId, roleLabel: null, allocationPercent: 100, primaryMembership: !(person?.studioTeams || []).some((membership) => membership.primaryMembership) }];
    try { await api(`/api/team/teams/${team.id}/members`, { method: "PUT", body: JSON.stringify({ expectedRevision: team.revision, members: members.map((member) => ({ userId: member.userId, roleLabel: member.roleLabel || null, allocationPercent: member.allocationPercent, primaryMembership: member.primaryMembership })) }) }); await refreshPeopleAfterCommit(`${exists ? "Removed from" : "Added to"} ${team.name}.`); } catch (error) { setLoadStatus(error instanceof Error ? error.message : "Team membership update failed"); }
    finally { finishTeamMutation(team.id); }
  }
  async function patchTeamMember(team: PeopleTeam, userId: string, updates: Partial<PeopleTeam["members"][number]>) {
    if (!beginTeamMutation(team.id)) return;
    const members = team.members.map((member) => member.userId === userId ? { ...member, ...updates } : member);
    try { await api(`/api/team/teams/${team.id}/members`, { method: "PUT", body: JSON.stringify({ expectedRevision: team.revision, members: members.map((member) => ({ userId: member.userId, roleLabel: member.roleLabel || null, allocationPercent: member.allocationPercent, primaryMembership: member.primaryMembership })) }) }); await refreshPeopleAfterCommit(`${team.name} membership updated.`); } catch (error) { setLoadStatus(error instanceof Error ? error.message : "Team membership update failed"); }
    finally { finishTeamMutation(team.id); }
  }
  async function archiveTeam(team: PeopleTeam) { if (!beginTeamMutation(team.id)) return; try { await api(`/api/team/teams/${team.id}`, { method: "PATCH", body: JSON.stringify({ archived: true, expectedRevision: team.revision }) }); await refreshPeopleAfterCommit(`${team.name} archived.`); } catch (error) { setLoadStatus(error instanceof Error ? error.message : "Team archive failed"); } finally { finishTeamMutation(team.id); } }
  const peopleDataView = useMemo(() => ({
    presentation: directoryMode,
    density: "comfortable" as const,
    query: {
      search: query,
      sorts: directorySorts,
      groups: directoryGroups,
      projections: peopleProjections,
      derivedFields: peopleDerivedFields,
      filters: departmentFilter !== "all" || statusFilter !== "all" ? {
        logic: "and" as const,
        conditions: [
          ...(departmentFilter !== "all" ? [{ fieldId: "department", operator: "equals" as const, value: departmentFilter }] : []),
          ...(statusFilter !== "all" ? [{ fieldId: "presence", operator: "equals" as const, value: statusFilter }] : []),
        ],
      } : null,
    },
    layout: effectivePeopleTableLayout,
  }), [directoryMode, query, directorySorts, directoryGroups, peopleProjections, peopleDerivedFields, departmentFilter, statusFilter, effectivePeopleTableLayout]);
  function applySavedPeopleDataView(view: ClusterSavedDataView) {
    setQuery(view.query.search || "");
    const conditions = view.query.filters?.conditions || [];
    const valueFor = (fieldId: string) => { const condition = conditions.find((item) => item.fieldId === fieldId && item.operator === "equals"); return typeof condition?.value === "string" ? condition.value : ""; };
    const nextDepartment = valueFor("department");
    const nextPresence = valueFor("presence");
    setDepartmentFilter(nextDepartment || "all");
    setStatusFilter(["active", "available", "focus", "away", "offline"].includes(nextPresence) ? nextPresence : "all");
    setDirectorySorts(view.query.sorts?.length ? view.query.sorts : [{ fieldId: "person", direction: "asc" }]);
    setDirectoryGroups((view.query.groups || []).filter((group) => peopleDataFields.some((field) => field.id === group.fieldId && field.groupable)).slice(0, 3));
    setPeopleProjections(view.query.projections?.length ? view.query.projections : DEFAULT_PEOPLE_PROJECTIONS);
    setPeopleDerivedFields(view.query.derivedFields || []);
    setPeopleAnalyticalSelection(null);
    setPeopleAnalyticalSelectionSet({ logic: "or", selections: [] });
    if (view.presentation === "list" || view.presentation === "table") setDirectoryMode(view.presentation);
    setDirectoryTableLayout(view.layout);
  }
  function applyPeopleAnalyticalSelection(selection: ClusterDataSelection | null) {
    if (selection) peopleDrilldown.capture();
    setPeopleAnalyticalSelectionSet({ logic: "or", selections: [] });
    setPeopleAnalyticalSelection(selection);
    if (!selection) return;
    const department = selection.conditions.find((condition) => condition.fieldId === "department" && condition.operator === "equals");
    if (typeof department?.value === "string") setDepartmentFilter(department.value);
  }
  async function updateMyAvailability(next: { availability?: string; connectionVisibility?: string; message?: string | null; declaredStatus?: string | null; presenceDisclosure?: "connection" | "work_state" | "application" | "project" | "detailed" }) {
    if (availabilityBusy) return;
    setAvailabilityBusy(true);
    try {
      await api("/api/me/presence", { method: "PATCH", body: JSON.stringify(next) });
      window.dispatchEvent(new CustomEvent("cluster:presence-policy-changed"));
      const refreshed = await queryApi<WorkforceContext>("/api/workforce/context", { force: true, staleMs: 0, tags: ["users", "people", "workforce"] });
      setWorkforceContext(refreshed);
      setDirectoryRefresh((current) => current + 1);
      setLoadStatus("Availability updated.");
    } catch (error) {
      setLoadStatus(error instanceof Error ? error.message : "Availability update failed.");
    } finally { setAvailabilityBusy(false); }
  }
  const myWorkforce = workforceContext?.people.find((person) => person.id === currentUser.id) || null;
  const workforceAllocatedHours = (workforceContext?.people || []).reduce((sum, person) => {
    const capacity = Number(person.employment?.capacityHours ?? 0);
    const allocation = (person.projectMemberships || []).reduce((total, membership) => total + Number(membership.allocationPercent || 0), 0);
    return sum + capacity * Math.min(200, allocation) / 100;
  }, 0);
  const workforceOverallocated = (workforceContext?.people || []).filter((person) => (person.projectMemberships || []).reduce((total, membership) => total + Number(membership.allocationPercent || 0), 0) > 100).length;
  const canSeeSensitiveProfile = Boolean(profile && canViewSensitiveProfile(currentUser, profile));
  const sensitiveProfileMessage = profile?.id === currentUser.id ? "Your private contact record." : "Private contact data is limited to administrators.";
  return (
    <section className={`page cluster-page-shell people-page-v244${profileExpanded && profile ? " people-profile-expanded-rc46" : ""}`}>
      <ToolPageHeader
        className="cluster-page-header"
        title="People"
        actions={<>
          <ClusterActionMenu iconOnly label="More people actions" items={[{ id: "refresh", label: "Refresh people", icon: "refresh", onSelect: () => loadProfiles() }]} />
          {effectiveAdminMode && <ClusterButton variant="secondary" onClick={() => setCreateAccountOpen((open) => !open)}>{createAccountOpen ? "Close account form" : "Create account"}</ClusterButton>}
          <ClusterButton variant="primary" onClick={() => { openFullProfile(currentUser.id); }}>My profile</ClusterButton>
        </>}
      />

      <div className="people-workforce-modebar-v504">
        <ClusterSegmentedControl value={workforceMode} onChange={setWorkforceMode} label="People workspace" options={[
          { value: "directory", label: "Directory" },
          { value: "organization", label: "Organization" },
          { value: "teams", label: "Teams" },
          { value: "capacity", label: "Capacity" },
          { value: "availability", label: "Availability" },
        ]} />
        <span>{effectiveAdminMode ? `Admin mode · ${users.length} accounts` : workforceContext ? `${users.length} people` : "Loading…"}</span>
      </div>

      {effectiveAdminMode && createAccountOpen && <section className="people-admin-create-v536 panel" aria-label="Create Cluster account">
        <header><div><strong>Create account</strong><span>Provision identity and workspace access. Cluster issues a one-time temporary password; the new member signs in and chooses their own permanent password.</span></div></header>
        <div className="people-admin-create-grid-v536">
          <label className="field"><span>Username</span><ClusterTextInput autoFocus value={createAccountDraft.username} onChange={(event) => setCreateAccountDraft((draft) => ({ ...draft, username: event.target.value }))} placeholder="username" /></label>
          <label className="field"><span>Display name</span><ClusterTextInput value={createAccountDraft.displayName} onChange={(event) => setCreateAccountDraft((draft) => ({ ...draft, displayName: event.target.value }))} placeholder="Display name" /></label>
          <label className="field"><span>Email</span><ClusterTextInput value={createAccountDraft.email} onChange={(event) => setCreateAccountDraft((draft) => ({ ...draft, email: event.target.value }))} placeholder="name@example.com" /></label>
          <label className="field"><span>Access expires</span><ClusterInput type="date" value={createAccountDraft.accessExpiresAt} onChange={(event) => setCreateAccountDraft((draft) => ({ ...draft, accessExpiresAt: event.target.value }))} /><small>Required for contractor, client and guest accounts.</small></label>
          <label className="field"><span>Account type</span><ClusterNativeSelect value={createAccountDraft.accountType} onChange={(event) => setCreateAccountDraft((draft) => ({ ...draft, accountType: event.target.value }))}><option value="employee">Employee</option><option value="contractor">Contractor</option><option value="client">Client</option><option value="guest">Guest</option></ClusterNativeSelect></label>
          <label className="field"><span>Workspace role</span><ClusterNativeSelect value={createAccountDraft.role} disabled={createRoleLoading || !createRoleCatalog || createAccountBusy} onChange={(event) => setCreateAccountDraft((draft) => ({ ...draft, role: event.target.value }))}>
            {!createRoleCatalog?.roles.some((role) => role.id === createAccountDraft.role) && <option value={createAccountDraft.role} disabled>{createAccountDraft.role} (unavailable)</option>}
            {(createRoleCatalog?.roles || []).map((role) => <option key={role.id} value={role.id} disabled={!canChooseStudioRole(role, createRoleCatalog?.actorRole)}>
              {role.label}{role.enabled ? "" : " (disabled)"} · {role.members} members
            </option>)}
          </ClusterNativeSelect>
          <small>Only roles you can assign appear as enabled options. Owner and administrator roles require an owner.</small>
          {createRoleLoading && <small role="status">Loading workspace roles…</small>}
          {createRoleError && <small role="alert">{createRoleError}</small>}
          </label>
          <div className="button-row compact"><ClusterButton variant="primary" disabled={createAccountBusy || createRoleLoading || !createRoleCatalog || Boolean(createRoleError)} onClick={() => void createPersonAccount()}>{createAccountBusy ? "Creating…" : "Create account"}</ClusterButton></div>
        </div>
      </section>}

      {effectiveAdminMode && issuedCredential && <AccountCredentialHandoff username={issuedCredential.username} temporaryPassword={issuedCredential.temporaryPassword} onDismiss={() => setIssuedCredential(null)} />}

      {workforceMode !== "directory" && <section className="people-workforce-workspace-v504 panel" aria-label={`${workforceMode} workforce workspace`}>
        {!workforceContext ? <LoadingState label="Loading workforce" rows={6} compact /> : <>
          {workforceMode === "organization" && <>
            <header><div><h2>Organization</h2></div><strong>{workforceContext.departments.length} departments · {workforceContext.jobRoles.length} roles</strong></header>
<CompanyGraphPanel departments={workforceContext.departments} teams={workforceContext.teams} people={workforceContext.people} workspaceId={workforceContext.workspaceId || ""} canEdit={Boolean(currentUser.isAdmin)} onChanged={async () => { const refreshed = await queryApi<WorkforceContext>("/api/workforce/context", { force: true, staleMs: 0, tags: ["users", "people", "workforce"] }); setWorkforceContext(refreshed); }} onOpenPerson={openFullProfile} />
          </>}
          {workforceMode === "teams" && <>
            <header><div><h2>Teams</h2></div><strong>{workforceContext.teams.length} teams</strong></header>
            <div className="people-workforce-card-grid-v504">{workforceContext.teams.map((team) => <article key={team.id}><div><strong>{team.name}</strong><span>{team.department?.name || "Cross-studio"}{team.description ? ` · ${team.description}` : ""}</span></div><small>{team.members.length} members · {team.members.reduce((sum, member) => sum + member.allocationPercent, 0)}% team allocation</small><div className="chip-row">{team.roles.slice(0, 8).map((role) => <span className="tag-chip" key={role.id}>{role.name}</span>)}</div></article>)}{!workforceContext.teams.length && <ClusterEmptyState compact kind="empty" icon="users" title="No teams yet" description="Teams can span departments without becoming another department field." />}</div>
          </>}
          {workforceMode === "capacity" && <>
            <header><div><h2>Capacity</h2></div><strong>{Math.round(workforceAllocatedHours * 10) / 10}h allocated</strong></header>
            <div className="people-capacity-visuals-v34" aria-label="Workforce capacity overview">
              <ClusterVisualComposition label="Capacity configured" total={workforceContext.people.length} parts={[
                { label: "Configured", value: Math.min(workforceContext.people.length, workforceContext.capacity.configuredPeople), tone: "good" },
                { label: "Not configured", value: Math.max(0, workforceContext.people.length - workforceContext.capacity.configuredPeople), tone: "neutral" },
              ]} />
              <ClusterVisualMeter label="Hours allocated" value={workforceAllocatedHours} total={workforceContext.capacity.totalHours} tone={workforceAllocatedHours > workforceContext.capacity.totalHours ? "warning" : "accent"} />
              <span className={workforceOverallocated ? "warning" : "muted"}>{workforceOverallocated} overallocated</span>
            </div>
            <div className="people-workforce-table-v504">{workforceContext.people.map((person) => { const capacity = Number(person.employment?.capacityHours ?? 0); const allocation = (person.projectMemberships || []).reduce((sum, membership) => sum + Number(membership.allocationPercent || 0), 0); return <article key={person.id}><div><strong>{displayUserName(person)}</strong><span>{person.employment?.jobRole?.name || "No role"} · {person.employment?.department?.name || "No department"}</span></div><span>{capacity ? `${capacity}h capacity` : "Capacity unset"}</span><div className="people-capacity-person-v34"><ClusterVisualMeter label="Allocated" value={allocation} total={100} tone={allocation > 100 ? "danger" : "accent"} compact /></div></article>; })}</div>
          </>}
          {workforceMode === "availability" && <>
            <header><div><h2>Availability</h2></div><strong>{workforceContext.capacity.available} available · {workforceContext.capacity.clockedIn} clocked in</strong></header>
            {myWorkforce && <div className="people-my-availability-v504"><div><strong>My availability</strong><span>Set availability and visibility without changing time records.</span></div><ClusterSegmentedControl className="people-availability-segmented-v528" value={String(myWorkforce.availability || "available")} onChange={(value) => void updateMyAvailability({ availability: value })} label="My availability" options={[{ value: "available", label: "Available" }, { value: "busy", label: "Busy" }, { value: "focus", label: "Focus" }, { value: "do_not_disturb", label: "Do Not Disturb" }, { value: "away", label: "Away" }]} /><div className="project-form-grid-v312"><label><span>Custom status</span><ClusterTextInput key={`declared-${myWorkforce.declaredStatus || ""}`} defaultValue={myWorkforce.declaredStatus || ""} maxLength={120} placeholder="Optional status" onBlur={(event) => void updateMyAvailability({ declaredStatus: event.target.value.trim() || null })} disabled={availabilityBusy} /></label><label><span>Status message</span><ClusterTextInput key={`message-${myWorkforce.availabilityMessage || ""}`} defaultValue={myWorkforce.availabilityMessage || ""} maxLength={160} placeholder="What teammates should know" onBlur={(event) => void updateMyAvailability({ message: event.target.value.trim() || null })} disabled={availabilityBusy} /></label><label><span>Presence detail</span><ClusterNativeSelect value={String(myWorkforce.presenceDisclosure || "work_state")} onChange={(event) => void updateMyAvailability({ presenceDisclosure: event.target.value as "connection" | "work_state" | "application" | "project" | "detailed" })} disabled={availabilityBusy}><option value="connection">Connection only</option><option value="work_state">Work state</option><option value="application">Application</option><option value="project">Project</option><option value="detailed">Detailed work context</option></ClusterNativeSelect></label></div><div className="button-row compact"><ClusterButton variant="secondary" size="compact" disabled={availabilityBusy} onClick={() => void updateMyAvailability({ connectionVisibility: myWorkforce.connectionVisibility === "invisible" ? "visible" : "invisible" })}>{myWorkforce.connectionVisibility === "invisible" ? "Become visible" : "Go invisible"}</ClusterButton><span className="muted">{myWorkforce.connectionVisibility === "invisible" ? "Invisible hides presence from ordinary viewers; time records stay unchanged." : "Availability does not change time records."}</span></div></div>}
            <div className="people-capacity-visuals-v34"><ClusterVisualComposition label="Availability" total={workforceContext.people.length} parts={[
              { label: "Available", value: Math.min(workforceContext.people.length, workforceContext.capacity.available), tone: "good" },
              { label: "Other / unknown", value: Math.max(0, workforceContext.people.length - workforceContext.capacity.available), tone: "neutral" },
            ]} /></div>
            <WorkforceAvailabilityExceptions currentUser={currentUser} people={workforceContext.people} canManageAll={Boolean(currentUser.isAdmin || ["edit", "manage"].includes(getToolLevel(currentUser, "people")))} onStatus={setLoadStatus} onChanged={async () => { const refreshed = await queryApi<WorkforceContext>("/api/workforce/context", { force: true, staleMs: 0, tags: ["users", "people", "workforce"] }); setWorkforceContext(refreshed); }} />
            <div className="people-workforce-table-v504">{workforceContext.people.map((person) => { const windows = (person.availabilityExceptions || []).filter((item) => item.status !== "cancelled" && new Date(item.endsAt).getTime() >= Date.now()); const active = windows.find((item) => new Date(item.startsAt).getTime() <= Date.now() && new Date(item.endsAt).getTime() >= Date.now()); return <article key={person.id}><div><strong>{displayUserName(person)}</strong><span>{person.availabilityMessage || person.employment?.jobRole?.name || "No status message"}{active ? ` · ${active.kind === "time_off" ? "time off" : active.kind}` : windows.length ? ` · ${windows.length} upcoming window${windows.length === 1 ? "" : "s"}` : ""}</span></div><span>{person.availability || "available"} · {person.clockState || "clocked_out"}</span><strong>{person.connectionState || "unknown"}{person.connectionVisibility === "invisible" ? " · invisible" : ""}</strong></article>; })}</div>
          </>}
        </>}
      </section>}

      <div hidden={workforceMode !== "directory"} className="people-directory-workspace-v504">
      <ClusterMetricStrip
        className="people-metrics-v244"
        label="People summary and shortcuts"
        items={[
          { label: "People", value: users.length, detail: `${filteredUsers.length} shown`, onSelect: () => { setStatusFilter("all"); setDepartmentFilter("all"); } },
          { label: "Available", value: activeProfiles, detail: "active or focus", tone: activeProfiles ? "good" : "neutral", selected: statusFilter === "active", onSelect: () => setStatusFilter("active") },
          { label: "Assigned", value: assignedCards, detail: "cards", onSelect: () => setProfileView("work") },
          { label: "Capacity", value: `${teamCapacity}h`, detail: "configured", onSelect: () => setProfileView("work") },
        ]}
      />


      <ClusterDisclosureGroup className="people-data-tools-v524" title="Data tools" summary="Saved views, analytics, layout" contentClassName="people-data-tools-body-v524">
        <>
          {peopleContext && <ClusterDisclosureGroup className="people-context-disclosure-v30d" title="Team & expertise context" summary="Allocation, working hours, teams, and searchable expertise" headerTrailing={<span className="people-context-count-v547">{peopleContext.teams.length} teams · {peopleContext.capacity.overallocatedPeople || 0} overallocated</span>}><section className="people-context-v495" aria-label="Team and expertise context">
        <div className="cluster-visual-summary-grid people-context-charts-v40">
          <ClusterVisualComposition label="Working hours configured · loaded people" total={peopleContext.people.length} parts={[
            { label: "Configured", value: Math.min(peopleContext.people.length, peopleContext.capacity.workingHoursConfigured), tone: "good" },
            { label: "Not set", value: Math.max(0, peopleContext.people.length - peopleContext.capacity.workingHoursConfigured), tone: "neutral" },
          ]} />
          <ClusterVisualMeter label="Allocated working hours" value={peopleContext.capacity.totalAllocatedHours ?? null} total={peopleContext.capacity.totalHours} tone={(peopleContext.capacity.totalAllocatedHours || 0) > peopleContext.capacity.totalHours ? "warning" : "accent"} formatValue={(hours: number) => `${Math.round(hours * 10) / 10}h`} />
          {peopleContext.teams.length > 0 && <ClusterVisualRankedBars label="Largest teams · memberships" rows={peopleContext.teams.slice().sort((a: PeopleTeam, b: PeopleTeam) => b.members.length - a.members.length).slice(0, 5).map((team) => ({ id: team.id, label: team.name, value: team.members.length }))} />}
        </div>
        <div className="people-team-strip-v495">{peopleContext.teams.slice(0, 8).map((team) => { const selectedId = selectedUserId || currentUser.id; const selectedMember = team.members.find((member) => member.userId === selectedId); const allocation = team.members.reduce((sum, member) => sum + Number(member.allocationPercent || 0), 0); return <article key={team.id}><div><strong>{team.name}</strong><span>{team.department || "Cross-studio"} · {team.members.length} members</span></div><small>{team.lead ? `Lead: ${displayUserName(team.lead)}` : "No lead assigned"} · {allocation}% allocation</small>{canManageTeams && selectedMember && <div className="people-team-member-controls-v495"><label><span>Selected allocation</span><ClusterNativeSelect aria-label={`${team.name} selected person allocation`} value={selectedMember.allocationPercent} disabled={busyTeamIds.has(team.id)} onChange={(event) => void patchTeamMember(team, selectedId, { allocationPercent: Number(event.target.value) })}>{[25,50,75,100,125,150,175,200].map((value) => <option key={value} value={value}>{value}%</option>)}</ClusterNativeSelect></label><label className="tool-check compact"><ClusterInput type="checkbox" checked={selectedMember.primaryMembership} disabled={busyTeamIds.has(team.id)} onChange={(event) => void patchTeamMember(team, selectedId, { primaryMembership: event.target.checked })} /> Primary team</label></div>}{currentUser.isAdmin && teamBundles.length > 0 && <ClusterDisclosureGroup className="people-team-bundles-v507" title={`Permission bundles (${team.permissionBundleIds?.length || 0})`}><p className="muted tight">Team bundles layer after department and before Studio role and user overrides.</p>{teamBundles.map((bundle) => <label key={bundle.id} className="tool-check compact"><ClusterInput type="checkbox" checked={(team.permissionBundleIds || []).includes(bundle.id)} disabled={busyTeamIds.has(team.id) || Boolean(savingTeamBundleId) || (!bundle.enabled && !(team.permissionBundleIds || []).includes(bundle.id))} onChange={() => void toggleTeamBundle(team, bundle.id)} />{bundle.label}{!bundle.enabled ? " (disabled)" : ""}</label>)}</ClusterDisclosureGroup>}{canManageTeams && <div className="button-row compact"><ClusterButton type="button" className="" onClick={() => toggleTeamMember(team, selectedId)} disabled={busyTeamIds.has(team.id)} variant="quiet" size="compact">{selectedMember ? "Remove selected" : "Add selected"}</ClusterButton><ClusterButton type="button" className="" onClick={() => archiveTeam(team)} disabled={busyTeamIds.has(team.id)} variant="quiet" size="compact">Archive</ClusterButton></div>}</article>; })}{!peopleContext.teams.length && <span className="muted">No structured Studio teams yet.</span>}</div>
            {peopleContext.directory?.truncated && <div className="people-directory-boundary-v495" role="status">Showing the first {peopleContext.directory.loaded} directory records. Search remains bounded for predictable Studio performance.</div>}
        <div className="people-expertise-coverage-v495">{peopleContext.expertise.slice(0, 12).map((item) => <ClusterButton unstyled type="button" key={item.name} onClick={() => setQuery(item.name)}><strong>{item.name}</strong><span>{item.total} people · {item.experts} expert</span></ClusterButton>)}</div>
        {canManageTeams && <div className="people-team-create-v495"><ClusterTextInput value={teamNameDraft} onChange={(event) => setTeamNameDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void createTeam(); } }} disabled={teamCreateBusy} placeholder="New Studio team" /><ClusterButton type="button" className="" onClick={() => void createTeam()} disabled={teamCreateBusy || !teamNameDraft.trim()} busy={teamCreateBusy} busyLabel="Creating…" variant="secondary">Create team</ClusterButton></div>}
      </section></ClusterDisclosureGroup>}

      <ClusterTableToolbar
        className="people-toolbar-v244 panel"
        query={query}
        onQueryChange={setQuery}
        placeholder="Name, role, team, skill, location"
        countLabel={`${filteredUsers.length} shown`}
        filters={
          <>
            <label className="field">
              <span>Department</span>
              <ClusterNativeSelect value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)}>
                <option value="all">All departments</option>
                {departments.map((department) => <option value={department} key={department}>{department}</option>)}
              </ClusterNativeSelect>
            </label>
            <label className="field">
              <span>Status</span>
              <ClusterNativeSelect value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="available">Available</option>
                <option value="focus">Focus</option>
                <option value="away">Away</option>
                <option value="offline">Offline</option>
              </ClusterNativeSelect>
            </label>
            {effectiveAdminMode && <label className="field">
              <span>Account</span>
              <ClusterNativeSelect value={accountFilter} onChange={(event) => setAccountFilter(event.target.value as typeof accountFilter)}>
                <option value="all">Active directory</option>
                <option value="attention">Setup / recovery</option>
                <option value="restricted">Suspended / disabled</option>
                <option value="archived">Archived</option>
              </ClusterNativeSelect>
            </label>}
          </>
        }
        actions={<DataExportBuilder fields={peopleExportFields} selectionCount={selectedPeopleIds.size} busy={peopleExporting} onExport={({ format, fieldIds, scope, delivery }) => exportPeople(format, fieldIds, scope, delivery)} />}
      />
          <ClusterDataView scope="people.directory" label="People directory" resourceKind="user" current={peopleDataView} onApply={applySavedPeopleDataView} allowStudio={currentUser.isAdmin} summary="Save search, department, presence, sorting, grouping, analytical projections and drilldowns, presentation, and the exact directory table layout together." />
          {peopleAnalyticsExact && peopleServerAnalytics ? <>
            <DataViewAggregationStrip aggregations={peopleServerDataQuery.aggregations || []} values={peopleServerAnalytics.aggregations} fields={PEOPLE_DATA_FIELDS} label="Filtered directory totals" />
            <DataViewFacetBar facets={peopleServerAnalytics.facets} fields={PEOPLE_DATA_FIELDS} selectedValues={{ department: departmentFilter !== "all" ? [departmentFilter] : [] }} onToggle={(fieldId, value) => { if (fieldId === "department") { const next = String(value); setDepartmentFilter(departmentFilter === next ? "all" : next); } }} />
            {peopleServerAnalytics.projections?.length ? <div className="cluster-data-projections-v504">{peopleServerAnalytics.projections.map((projection) => <DataViewProjection key={projection.id} result={projection} fields={peopleAnalyticalFields} label={`People ${projection.kind} projection`} selection={peopleAnalyticalSelection} selectionSet={peopleAnalyticalSelectionSet} onSelectionChange={applyPeopleAnalyticalSelection} onSelectionSetChange={(next) => { if (!peopleAnalyticalSelectionSet.selections.length && next.selections.length) peopleDrilldown.capture(); setPeopleAnalyticalSelection(null); setPeopleAnalyticalSelectionSet(next); }} onDrilldown={(_selection, drilldown) => { if (drilldown?.presentation === "table") setDirectoryMode("table"); }} />)}</div> : null}
          </> : null}
          <DataViewProjectionComposer fields={peopleAnalyticalFields} projections={peopleProjections} onChange={setPeopleProjections} label="People analytical projections" />
          <DataViewSelectionBar selection={peopleAnalyticalSelection} fields={PEOPLE_DATA_FIELDS} historyDepth={peopleDrilldown.depth} onBack={peopleDrilldown.back} onExit={peopleDrilldown.exit} onClear={() => setPeopleAnalyticalSelection(null)} label="People analytical selection" />
          <DataViewSelectionSetBar selectionSet={peopleAnalyticalSelectionSet} fields={PEOPLE_DATA_FIELDS} onChange={(next) => { setPeopleAnalyticalSelection(null); setPeopleAnalyticalSelectionSet(next); }} label="People cross-highlight selections" />
          {directoryMode === "table" ? <DataViewDerivedFieldBuilder fields={PEOPLE_DATA_FIELDS} derivedFields={peopleDerivedFields} onChange={(next) => { setPeopleDerivedFields(next); setDirectoryTableLayout(null); }} label="People formula columns" /> : null}
          {peopleExportStatus ? <p className="muted" aria-live="polite">{peopleExportStatus}</p> : null}
            </>
      </ClusterDisclosureGroup>
      <DataExportOperationFeedback jobId={peopleExportJobId} onDismiss={() => setPeopleExportJobId("")} />

      <ClusterMasterDetail className="people-layout-v244" label="People directory and profile inspector" masterLabel="People directory" detailLabel="Person profile" detailOpen={Boolean(profile)} onCloseDetail={() => { setProfileExpanded(false); personDetailHistory.closeDetail(); }} detailSize="wide" persistKey="people" resizable={!profileExpanded} master={<aside className="panel people-directory-v244" aria-label="People directory">
          <div className="people-directory-head-v244">
            <div><strong>Directory</strong><span>{filteredUsers.length}</span></div>
            <ClusterSegmentedControl value={directoryMode} onChange={setDirectoryMode} label="People directory layout" options={[{ value: "list", label: "List" }, { value: "table", label: "Table" }]} />
          </div>
          {directoryMode === "table" ? (
            !users.length && loadStatus.startsWith("Loading") ? <LoadingState label="Loading people" rows={7} compact /> : <>
            <DataViewGroupControl fields={peopleDataFields} groups={directoryGroups} onChange={setDirectoryGroups} label="Group people" />
            <ClusterDataTable
              rows={peopleProgress.visibleItems}
              columns={peopleTableColumns}
              rowKey={(person) => person.id}
              rowLabel={(person) => displayUserName(person)}
              label="People directory table"
              sorts={directorySorts}
              onSortsChange={setDirectorySorts}
              selectedKeys={selectedPeopleIds}
              onSelectionChange={(keys) => setSelectedPeopleIds(new Set(keys))}
              onRowActivate={(person) => openFullProfile(person.id)}
              configurableColumns
              persistKey="people-directory"
              controlledLayout={directoryTableLayout || undefined}
              onLayoutChange={setDirectoryTableLayout}
              groups={directoryGroups}
              groupMetrics={peopleGroupMetrics}
              groupSubtotalMode="row"
              groupSummaries={peopleAnalyticsExact && directoryGroups.length === peopleServerGroups.length ? peopleServerAnalytics?.groupedSummaries : undefined}
              summaryRows={peopleSummaryRows}
              virtualization={{ rowHeight: 56, maxHeight: 720, minimumRows: 120, overscan: 10 }}
              incremental={!peopleProgress.hasMore ? { hasMore: peopleDirectory.hasMore, loading: peopleDirectory.loading, prefetchRows: 20, loadLabel: "Load 80 more people", onLoadMore: peopleDirectory.loadMore } : undefined}
              empty={!users.length ? <ClusterEmptyState compact kind="empty" icon="users" title="No people are available" description="No directory records are available to this account yet." /> : <ClusterEmptyState compact kind="filtered" title="No people match this view" description="Clear the search or relax the department and status filters." />}
            /></>
          ) : <div className="people-list-v244">
            {!users.length && loadStatus.startsWith("Loading") ? <LoadingState label="Loading people" rows={7} compact /> : peopleProgress.visibleItems.map((person) => (
              <ClusterButton unstyled type="button" className={selectedUserId === person.id ? "active" : ""} key={person.id} onClick={() => openFullProfile(person.id)}>
                <PersonSummary person={person} compact profileAction={false} showCapacity departmentIdentity={departmentForPerson(person)} />
              </ClusterButton>
            ))}
            {!users.length && !loadStatus.startsWith("Loading") ? <ClusterEmptyState compact kind="empty" icon="users" title="No people are available" description="No directory records are available to this account yet." /> : null}
            {users.length > 0 && !filteredUsers.length ? <ClusterEmptyState compact kind="filtered" title="No people match this view" description="Clear the search or relax the department and status filters." /> : null}
          </div>}
          {peopleProgress.hasMore ? <div className="people-directory-load-more-v495"><ClusterButton variant="quiet" size="compact" onClick={peopleProgress.showMore}>Show {Math.min(80, peopleProgress.remaining)} more · {peopleProgress.remaining} loaded locally</ClusterButton></div> : peopleDirectory.hasMore ? <div className="people-directory-load-more-v495"><ClusterButton variant="quiet" size="compact" disabled={peopleDirectory.loading} onClick={peopleDirectory.loadMore}>{peopleDirectory.loading ? "Loading more…" : "Load 80 more people from server"}</ClusterButton></div> : null}
        </aside>}

        detail={<main className="panel people-detail-v244">
          {profile ? (
            <>
              {profileExpanded && <div className="people-profile-back-rc46"><ClusterButton variant="quiet" size="compact" onClick={() => setProfileExpanded(false)}>← Back to directory</ClusterButton><span>Person profile</span></div>}
              <header className="people-detail-header-v244">
                <PersonSummary person={profile} profileAction={false} showCapacity departmentIdentity={departmentForPerson(profile)} className="people-detail-person-summary-v493" />
                <div className="people-detail-presence-v244">
                  <strong>{profileAvailabilityLabel(profile)}</strong>
                  <span>{profileLocalTime(profile.timezone)}{profile.lastSeenAt ? ` · Last seen ${formatRelativeTime(profile.lastSeenAt)}` : ""}</span>
                  {profile.statusMessage ? <small>{profile.statusMessage}</small> : null}
                </div>
                <div className="button-row compact people-person-actions-v495">
                  {effectiveAdminMode && !profile.archived && <ClusterButton size="compact" variant="secondary" onClick={() => setProfileView("edit")}>Edit user</ClusterButton>}
                  <ClusterButton size="compact" variant="secondary" onClick={() => setProfileExpanded((current) => !current)} aria-label={profileExpanded ? "Return to People directory" : "Open full-page profile"}>{profileExpanded ? "Directory" : "Full page"}</ClusterButton>
                  <ClusterActionMenu label={`${displayUserName(profile)} actions`} triggerLabel="Actions" items={resolveClusterResourceActions({ kind: "user", id: profile.id }, [
                    { id: "copy-profile-link", resourceKinds: ["user"] as const, allowed: () => true, label: "Copy profile link", icon: "link", onSelect: () => copyProfileLink(profile) },
                    { id: "mention-person", resourceKinds: ["user"] as const, allowed: () => true, label: "Copy mention", icon: "comment", onSelect: () => copyProfileMention(profile) },
                    { id: "view-activity", resourceKinds: ["user"] as const, allowed: () => true, label: "View activity", icon: "activity", onSelect: () => setProfileView("activity") },
                    ...(canOpenScheduler ? [{ id: "open-scheduler", resourceKinds: ["user"] as const, allowed: () => true, label: "Open scheduler", icon: "clock" as const, onSelect: () => { openClusterWorkNavigation({ screen: "scheduler" }); } }] : []),
                    ...((currentUser.isAdmin || getToolLevel(currentUser, "people") === "edit") ? [{ id: "view-records", resourceKinds: ["user"] as const, allowed: () => true, label: "View records", icon: "library" as const, onSelect: () => setProfileView("records") }] : []),
                    ...(profile.id === currentUser.id && onEditProfile ? [{ id: "edit-profile", resourceKinds: ["user"] as const, allowed: () => true, label: "Edit my profile", icon: "settings" as const, separatorBefore: true, onSelect: onEditProfile }] : []),
                    ...(effectiveAdminMode && !profile.archived ? [{ id: "edit-user", resourceKinds: ["user"] as const, allowed: () => true, label: "Edit user", icon: "settings" as const, separatorBefore: true, onSelect: () => setProfileView("edit") }] : []),
                    ...(currentUser.isAdmin && profile.id !== currentUser.id ? [{ id: "manage-access", resourceKinds: ["user"] as const, allowed: () => true, label: effectiveAdminMode ? "Manage access" : "View access", icon: "lock" as const, separatorBefore: true, onSelect: () => setProfileView("access") }] : []),
                  ])} />
                </div>
              </header>

              <nav className="people-detail-tabs-v244" aria-label="Profile views">
                <ClusterButton unstyled type="button" className={profileView === "overview" ? "active" : ""} onClick={() => setProfileView("overview")}>
                  Overview
                </ClusterButton>
                <ClusterButton unstyled type="button" className={profileView === "work" ? "active" : ""} onClick={() => setProfileView("work")}>
                  Work
                </ClusterButton>
                <ClusterButton unstyled type="button" className={profileView === "calendar" ? "active" : ""} onClick={() => setProfileView("calendar")}>
                  Calendar
                </ClusterButton>
                <ClusterButton unstyled type="button" className={profileView === "activity" ? "active" : ""} onClick={() => setProfileView("activity")}>
                  Activity
                </ClusterButton>
                {(currentUser.isAdmin || getToolLevel(currentUser, "people") === "edit") && <ClusterButton unstyled type="button" className={profileView === "records" ? "active" : ""} onClick={() => setProfileView("records")}>
                  Records
                </ClusterButton>}
                <ClusterButton unstyled type="button" className={profileView === "access" ? "active" : ""} onClick={() => setProfileView("access")}>
                  Access
                </ClusterButton>
                <ClusterButton unstyled type="button" className={profileView === "full" ? "active" : ""} onClick={() => setProfileView("full")}>
                  Full profile
                </ClusterButton>
              </nav>

              <div className="people-detail-scroll-v244">
                {profileExpanded && profileView === "overview" && <section className="people-profile-social-intro-rc46" aria-label="About this person">
                  {profile.profileBio ? <p>{profile.profileBio}</p> : <span className="muted">{profile.title || "Studio member"}{profile.department ? ` · ${profile.department}` : ""}</span>}
                  <div className="people-profile-social-stats-rc46"><span><strong>{profileProjects.length}</strong> Projects</span><span><strong>{profileTeams.length}</strong> Teams</span>{profile.recentActivity?.length ? <ClusterButton variant="quiet" size="compact" onClick={() => setProfileView("activity")}>Recent activity</ClusterButton> : null}</div>
                </section>}
                {profileView === "overview" && (
                  <>
                    <div className="people-profile-grid-v244">
                      {profile.email ? <div>
                        <span>Work email</span>
                        <strong>{profile.email}</strong>
                      </div> : null}
                      {(profileTeams.length || profile.teamName) ? <div>
                        <span>Team</span>
                        <strong>{profileTeams.length ? profileTeams.map((team) => team.name).join(", ") : profile.teamName}</strong>
                      </div> : null}
                      {(profile.manager || profile.managerName) ? <div>
                        <span>Manager</span>
                        <strong>{profile.manager ? displayUserName(profile.manager as User) : profile.managerName}</strong>
                      </div> : null}
                      {(profile.hideLocation || profile.workLocation || profile.timezone) ? <div>
                        <span>Location</span>
                        <strong>{profile.hideLocation ? "Hidden" : profile.workLocation || profile.timezone}</strong>
                      </div> : null}
                      {profile.timezone ? <div>
                        <span>Timezone</span>
                        <strong>{profile.timezone}</strong>
                      </div> : null}
                      {profile.timezone ? <div>
                        <span>Local time</span>
                        <strong>{profileLocalTime(profile.timezone)}</strong>
                      </div> : null}
                      {profile.capacityHours != null ? <div>
                        <span>Capacity</span>
                        <strong>{profile.capacityHours}h/week</strong>
                      </div> : null}
                      <div>
                        <span>Team allocation</span>
                        <strong>{profileAllocation ? `${profileAllocation}% · ${profileAllocationState}` : "Unallocated"}</strong>
                      </div>
                    </div>
                    {(profile.profileBio || profile.email || profile.phoneNumber || profile.profileDiscordUsername || profile.discordUsername || profile.profileWebsite) && (
                      <section className="people-section-v244 people-profile-contact-v473">
                        <header className="people-section-heading-v417"><div><h3>About & contact</h3><span>{profile.profilePreferredContact ? `Prefers ${profile.profilePreferredContact}` : "Shared by this person"}</span></div></header>
                        {profile.profileBio && <p className="people-profile-bio-v473">{profile.profileBio}</p>}
                        <ProfileContactActions user={profile as User} />
                      </section>
                    )}
                    {(profile.expertise?.length || profile.workingHours) && <section className="people-section-v244 people-capability-context-v495"><header className="people-section-heading-v417"><div><h3>Expertise & availability</h3><span>{workingHoursSummary(profile.workingHours)}</span></div></header><div className="people-expertise-tags-v495">{(profile.expertise || []).map((item) => <span className="tag-chip" key={item.name}><strong>{item.name}</strong><small>{item.level}{item.years != null ? ` · ${item.years}y` : ""}</small></span>)}</div></section>}
                    {profileShowcaseProjects.length > 0 && <section className="people-section-v244"><header className="people-section-heading-v417"><div><h3>Showcase</h3><span>Pinned by this person</span></div><strong>{profileShowcaseProjects.length}</strong></header><div className="profile-showcase-grid-v473">{profileShowcaseProjects.map((project) => <ClusterButton unstyled type="button" key={project.id} onClick={() => onOpenProject(project.id)}><strong>{project.name}</strong><span>{project.projectType || project.status || "Project"}</span></ClusterButton>)}</div></section>}
                    {profileExpanded && <section className="people-section-v244 people-profile-feed-rc46" aria-label="Recent work activity">
                      <header className="people-section-heading-v417"><h3>Activity</h3><ClusterButton size="compact" variant="quiet" onClick={() => setProfileView("activity")}>View all</ClusterButton></header>
                      {profile.recentActivity?.length ? <ol>{profile.recentActivity.slice(0, 5).map((event) => <li key={event.id}><span className="people-profile-feed-dot-rc46" aria-hidden="true" /><div><strong>{event.title}</strong>{event.message && <p>{event.message}</p>}<time dateTime={event.createdAt}>{formatRelativeTime(event.createdAt)}</time></div></li>)}</ol> : <p className="muted">No recent work activity visible.</p>}
                    </section>}
                    <section className="people-section-v244">
                      <h3>Skills</h3>
                      <div className="chip-row">
                        {profile.skills?.length ? (
                          profile.skills.map((skill) => (
                            <span className="tag-chip" key={skill}>
                              {skill}
                            </span>
                          ))
                        ) : (
                          <span className="muted">No skills listed.</span>
                        )}
                      </div>
                    </section>
                    {profile.profileFieldDefinitions?.length ? <section className="people-section-v244"><h3>Studio profile fields</h3><div className="people-profile-grid-v244">{profile.profileFieldDefinitions.map((field) => { const value = profile.customProfileFields?.[field.id]; return <div key={field.id}><span>{field.label}</span><strong>{Array.isArray(value) ? value.join(", ") : value == null || value === "" ? "Unset" : String(value)}</strong></div>; })}</div></section> : null}
                                        {canSeeSensitiveProfile && (
                      <section className="people-private-v244 open">
                        <header><div><h3>Private account record</h3><span>{sensitiveProfileMessage}</span></div></header>
                        <div className="people-profile-grid-v244">
                          {!profile.hideLegalName && <div><span>Legal name</span><strong>{profile.legalName || "Unset"}</strong></div>}
                          <div><span>Account email</span><strong>{profile.email || "Unset"}</strong></div>
                          <div><span>Account phone</span><strong>{profile.phoneNumber || "Unset"}</strong></div>
                          <div><span>Start date</span><strong>{profile.startDate ? new Date(profile.startDate).toLocaleDateString() : "Unset"}</strong></div>
                        </div>
                      </section>
                    )}
                    <section className="people-section-v244">
                      <h3>Team context</h3>
                      <div className="people-profile-grid-v244">
                        <div><span>Profile completeness</span><strong>{profileCompletionScore(profile)}%</strong></div>
                        <div><span>Direct reports</span><strong>{directReports.length}</strong></div>
                        <div><span>Project involvement</span><strong>{profileProjects.length}</strong></div>
                        <div><span>Current workload</span><strong>{profileWork ? profileWorkloadLabel(profileWork.cards, profile.capacityHours) : "No assignments"}</strong></div>
                      </div>
                      {directReports.length > 0 && <div className="chip-row people-report-chips-v417">{directReports.map((person) => <ClusterButton unstyled type="button" className="tag-chip" key={person.id} onClick={() => openFullProfile(person.id)}>{displayUserName(person)}</ClusterButton>)}</div>}
                    </section>
                  </>
                )}

                {profileView === "work" && (
                  <>
                    <div className="people-work-metrics-v244">
                      <div>
                        <span>Projects</span>
                        <strong>{profileProjects.length}</strong>
                      </div>
                      <div>
                        <span>Assigned cards</span>
                        <strong>{profileCards.length}</strong>
                      </div>
                      <div>
                        <span>Capacity</span>
                        <strong>{profile.capacityHours != null ? `${profile.capacityHours}h` : "Unset"}</strong>
                      </div>
                      <div>
                        <span>Workload</span>
                        <strong>{profileWorkloadLabel(profileCards.length, profile.capacityHours)}</strong>
                      </div>
                      <div>
                        <span>Overdue</span>
                        <strong>{profileWork?.overdue || 0}</strong>
                      </div>
                      <div>
                        <span>High priority</span>
                        <strong>{profileWork?.highPriority || 0}</strong>
                      </div>
                    </div>
                    <div className="people-work-columns-v244">
                      <section>
                        <h3>Projects</h3>
                        <div className="mini-list">
                          {profileProjects.length ? (
                            profileProjects.map((project) => (
                              <ClusterButton unstyled type="button" key={project.id} className="mini-list-row clickable" onClick={() => onOpenProject(project.id)}>
                                <strong>{project.name}</strong>
                                <span>Open project</span>
                              </ClusterButton>
                            ))
                          ) : (
                            <p className="muted">No project assignments.</p>
                          )}
                        </div>
                      </section>
                      <section>
                        <h3>Assigned cards</h3>
                        <div className="mini-list">
                          {profileCards.length ? (
                            profileCards.slice(0, 16).map((card) => (
                              <div className="mini-list-row" key={card.id}>
                                <strong>{card.title}</strong>
                                <span>
                                  {card.projectName} · {card.boardName}
                                  {card.dueDate ? ` · due ${formatDueDate(card.dueDate)}` : ""}
                                </span>
                              </div>
                            ))
                          ) : (
                            <p className="muted">No assigned cards.</p>
                          )}
                        </div>
                      </section>
                    </div>
                    <section className="people-section-v244 profile-contributions-v473">
                      <header className="people-section-heading-v417"><div><h3>Recent contributions</h3><span>Project and production activity</span></div><strong>{profileRecentContributions.length}</strong></header>
                      <div className="mini-list">
                        {profileRecentContributions.map((event) => <div className="mini-list-row" key={event.id}><strong>{event.title}</strong><span>{event.message || event.type} · {formatRelativeTime(event.createdAt)}</span></div>)}
                        {!profileRecentContributions.length && <p className="muted">No recent project contributions are available.</p>}
                      </div>
                    </section>
                  </>
                )}

                {profileView === "work" && profileHistory.length > 0 && <section className="people-section-v244 people-project-history-v495"><header className="people-section-heading-v417"><div><h3>Project history</h3><span>Recent contribution context</span></div><strong>{profileHistoryProgress.visibleCount}/{profileHistory.length}</strong></header><div className="mini-list">{profileHistoryProgress.visibleItems.map((project) => <ClusterButton unstyled type="button" className="mini-list-row" key={project.id} onClick={() => onOpenProject(project.id)}><strong>{project.name}</strong><span>{project.active ? "Active" : "Previous"} · {project.projectType || project.status || "Project"}{project.contributions ? ` · ${project.contributions} recent contributions` : ""}</span></ClusterButton>)}</div>{profileHistoryProgress.hasMore ? <ClusterButton variant="quiet" size="compact" onClick={profileHistoryProgress.showMore}>Show {Math.min(20, profileHistoryProgress.remaining)} more projects · {profileHistoryProgress.remaining} remaining</ClusterButton> : null}</section>}

                {profileView === "calendar" && (
                  <section className="people-section-v244">
                    <header className="people-section-heading-v417"><div><h3>Calendar</h3><span>Authorized events involving {displayUserName(profile)}</span></div><ClusterButton variant="quiet" size="compact" onClick={() => openClusterWorkNavigation({ screen: "calendar" })}>Open Calendar</ClusterButton></header>
                    {profileCalendarLoading ? <InspectorLoadingState label="Loading profile Calendar" compact /> : <div className="mini-list">
                      {profileCalendar.map((event) => <div className="mini-list-row" key={event.id}><strong>{event.title}</strong><span>{new Date(event.startsAt).toLocaleDateString([], { month: "short", day: "numeric" })}{event.allDay ? " · All day" : ` · ${new Date(event.startsAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`} · {levelLabel(event.eventType || "event")} · {levelLabel(event.visibility || "studio")}{event.project?.name ? ` · ${event.project.name}` : ""}{event.notes ? " · Notes" : ""}{event.attachmentIds?.length ? ` · ${event.attachmentIds.length} attachment${event.attachmentIds.length === 1 ? "" : "s"}` : ""}</span></div>)}
                      {!profileCalendar.length && <p className="muted">No upcoming Calendar objects are visible for this profile.</p>}
                    </div>}
                  </section>
                )}

                {profileView === "activity" && (
                  <section className="people-section-v244">
                    <h3>Recent activity</h3>
                    <div className="mini-list">
                      {profile.recentActivity?.slice(0, 30).map((event) => (
                        <div className="mini-list-row" key={event.id}>
                          <strong>{event.title}</strong>
                          <span>
                            {event.message || event.type} · {new Date(event.createdAt).toLocaleString()}
                          </span>
                        </div>
                      ))}
                      {!profile.recentActivity?.length && <p className="muted">No recent activity.</p>}
                    </div>
                  </section>
                )}

                {profileView === "records" && (currentUser.isAdmin || getToolLevel(currentUser, "people") === "edit") && (
                  <PersonnelRecordsPanel subjectUserId={profile.id} canManage compact />
                )}

                {profileView === "access" && (
                  <div className="people-access-v417">
                    <section className="people-section-v244">
                      <header className="people-section-heading-v417"><div><h3>Workspace access</h3><span>{profile.workspaceRole || (profile.isAdmin ? "admin" : "member")}</span></div><strong>{profileAccess.length} tools</strong></header>
                      <div className="profile-access-grid-v250">
                        {profileAccess.map((tool) => <div key={tool.key}><span>{tool.label}</span><strong>{levelLabel(tool.level)}</strong></div>)}
                        {!profileAccess.length && <p className="muted">No explicit tool access.</p>}
                      </div>
                    </section>
                    <section className="people-section-v244">
                      <h3>Account posture</h3>
                      <div className="people-profile-grid-v244">
                        <div><span>Account state</span><strong>{profile.accountState || "Active"}</strong></div>
                        <div><span>Account type</span><strong>{profile.accountType || "employee"}</strong></div>
                        <div><span>Password</span><strong>{profile.passwordConfigured === false ? "Setup required" : "Configured"}</strong></div>
                        <div><span>PIN</span><strong>{profile.pinConfigured ? "Configured" : "Not configured"}</strong></div>
                        <div><span>Access expires</span><strong>{profile.accessExpiresAt ? new Date(profile.accessExpiresAt).toLocaleDateString() : "No expiry"}</strong></div>
                        <div><span>Last activity</span><strong>{profile.lastActivityAt ? formatRelativeTime(profile.lastActivityAt) : "No activity"}</strong></div>
                      </div>
                    </section>
                    {(profile.id === currentUser.id || effectiveAdminMode) && <PersonEffectiveAccessPanel personId={profile.id} selfId={currentUser.id} />}
                    {effectiveAdminMode && <section className="people-section-v244 people-account-admin-v536">
                      <header className="people-section-heading-v417"><div><h3>Account administration</h3><span>Lifecycle and recovery actions for this person</span></div><strong>{profile.archived ? "Archived" : String(profile.accountState || "ACTIVE").replaceAll("_", " ")}</strong></header>
                      <div className="people-admin-account-fields-v536">
                        <label><span>Account type</span><ClusterNativeSelect value={profile.accountType || "employee"} disabled={Boolean(adminActionBusy)} onChange={(event) => void patchProfileAdministration({ accountType: event.target.value }, "Account type updated.")}><option value="employee">Employee</option><option value="contractor">Contractor</option><option value="client">Client</option><option value="guest">Guest</option></ClusterNativeSelect></label>
                        <div><span>Access expires</span><strong>{profile.accessExpiresAt ? new Date(profile.accessExpiresAt).toLocaleDateString() : "No expiry"}</strong><small>Extensions require another admin’s approval in Studio Settings → Studio Systems → Access renewals.</small></div>
                      </div>
                      <div className="people-admin-action-groups-v536">
                        <div><span>Lifecycle</span><div className="button-row compact"><ClusterButton variant="secondary" size="compact" disabled={Boolean(adminActionBusy)} onClick={() => void setProfileAccountState("ACTIVE")}>Activate</ClusterButton><ClusterButton variant="secondary" size="compact" disabled={Boolean(adminActionBusy) || profile.id === currentUser.id} onClick={() => void setProfileAccountState("SUSPENDED")}>Suspend</ClusterButton><ClusterButton variant="danger" size="compact" disabled={Boolean(adminActionBusy) || profile.id === currentUser.id} onClick={() => void setProfileAccountState("DISABLED")}>Disable</ClusterButton><span className="muted">{profile.archived ? "Return via Studio Settings → Offboarding" : "Archive via governed Offboarding"}</span></div></div>
                        <div><span>Credential recovery</span><div className="button-row compact"><ClusterButton variant="secondary" size="compact" disabled={Boolean(adminActionBusy) || profile.id === currentUser.id} onClick={() => void issuePasswordResetForProfile()}>{adminActionBusy === "password-reset" ? "Issuing…" : "Issue temporary password"}</ClusterButton><ClusterButton type="button" variant="danger" size="compact" disabled={Boolean(securityActionUserId) || profile.id === currentUser.id} onClick={() => void resetAuthenticatorsForProfile()}>{securityActionUserId === profile.id ? "Resetting…" : "Reset authenticators"}</ClusterButton></div></div>
                      </div>
                    </section>}
                    {effectiveAdminMode && <section className="people-section-v244 people-tool-access-editor-v536">
                      <header className="people-section-heading-v417"><div><h3>Tool access</h3><span>Explicit overrides. Inherit follows the workspace role and account type defaults.</span></div></header>
                      <div className="people-tool-access-grid-v536">{TOOL_PERMISSION_OPTIONS.map((tool) => <label key={tool.key}><span>{tool.label}</span><ClusterNativeSelect value={String(profile.toolPermissions?.[tool.key] || "inherit")} disabled={Boolean(adminActionBusy)} onChange={(event) => void setProfileToolPermission(tool.key, event.target.value)}><option value="inherit">Inherit · {levelLabel(getToolLevel(profile, tool.key))}</option><option value="none">None</option><option value="view">View</option><option value="edit">Edit</option><option value="manage">Manage</option></ClusterNativeSelect></label>)}</div>
                    </section>}
                    {effectiveAdminMode && <section className="people-section-v244 people-project-access-editor-v536">
                      <header className="people-section-heading-v417"><div><h3>Project access</h3><span>Time-limited individual grants are requested and approved in Studio Settings → Studio Systems → Scoped grants. This profile does not directly elevate Project access.</span></div></header>
                      {Object.entries(profile.projectPermissions || {}).length > 0 && <p className="muted">Legacy Project overrides remain visible to Access Explorer until explicitly reconciled during TD7 cleanup.</p>}
                    </section>}
                  </div>
                )}

                {profileView === "edit" && effectiveAdminMode && !profile.archived && <PeopleUserEditor
                  key={profile.id}
                  person={profile}
                  actorId={currentUser.id}
                  departmentNames={workforceContext?.departments.map((department) => department.name) || []}
                  managerOptions={(workforceContext?.people || [])
                    .filter((candidate) => candidate.id !== profile.id && !candidate.archived && candidate.employment?.active !== false)
                    .map((candidate) => ({
                      id: candidate.id,
                      label: candidate.preferredName || candidate.displayName || candidate.username,
                    }))}
                  onRoleChange={async (role, expectedProfileRevision) => {
                    await api(`/api/users/${encodeURIComponent(profile.id)}`, {
                      method: "PATCH", body: JSON.stringify({ role, expectedProfileRevision }),
                    });
                    setDirectoryRefresh((current) => current + 1);
                    await loadProfile(profile.id, true);
                    setLoadStatus(`Updated workspace role for ${displayUserName(profile)}.`);
                  }}
                  onDirtyChange={setEditorDirty}
                  onCancel={() => { setEditorDirty(false); setProfileViewState("overview"); }}
                  onOpenAccess={() => setProfileView("access")}
                  onSave={async (changes) => {
                    await api(`/api/users/${encodeURIComponent(profile.id)}`, { method: "PATCH", body: JSON.stringify(changes) });
                    setDirectoryRefresh((current) => current + 1);
                    const refreshed = await loadProfile(profile.id, true);
                    if (!refreshed) throw new Error("User details were saved, but the profile could not be refreshed. Reopen this person before continuing.");
                    setLoadStatus(`User details saved for ${displayUserName(refreshed)}.`);
                    // Keep the editor open so a pending role choice can be applied
                    // after the new authoritative profile revision is received.
                    return refreshed;
                  }}
                />}

                {profileView === "full" && (
                  <div className="people-full-profile-v250">
                    <section className="people-section-v244">
                      <h3>Identity</h3>
                      <div className="people-profile-grid-v244">
                        <div>
                          <span>Username</span>
                          <strong>{profile.username}</strong>
                        </div>
                        <div>
                          <span>Preferred name</span>
                          <strong>{profile.preferredName || profile.displayName || "Unset"}</strong>
                        </div>
                        <div>
                          <span>Pronouns</span>
                          <strong>{profile.pronouns || "Unset"}</strong>
                        </div>
                        <div>
                          <span>Workspace role</span>
                          <strong>{profile.workspaceRole || "member"}</strong>
                        </div>
                        <div>
                          <span>Employment</span>
                          <strong>{profile.employmentType || "Unset"}</strong>
                        </div>
                        <div>
                          <span>Employee number</span>
                          <strong>{profile.employeeNumber || "Unset"}</strong>
                        </div>
                      </div>
                    </section>
                    <section className="people-section-v244">
                      <h3>Presence</h3>
                      <div className="people-profile-grid-v244">
                        <div>
                          <span>Status</span>
                          <strong>{presenceLabel(profile)}</strong>
                        </div>
                        <div>
                          <span>Custom status</span>
                          <strong>{profile.statusMessage || "Unset"}</strong>
                        </div>
                        <div>
                          <span>Last seen</span>
                          <strong>{profile.lastSeenAt ? formatRelativeTime(profile.lastSeenAt) : "Never"}</strong>
                        </div>
                        <div>
                          <span>Timezone</span>
                          <strong>{profile.timezone || "Unset"}</strong>
                        </div>
                        <div>
                          <span>Local time</span>
                          <strong>{profileLocalTime(profile.timezone)}</strong>
                        </div>
                        {!profile.hideLocation && (
                          <div>
                            <span>Location</span>
                            <strong>{profile.workLocation || "Unset"}</strong>
                          </div>
                        )}
                        <div>
                          <span>Capacity</span>
                          <strong>{profile.capacityHours != null ? `${profile.capacityHours}h/week` : "Unset"}</strong>
                        </div>
                      </div>
                    </section>
                    <section className="people-section-v244">
                      <h3>Organization</h3>
                      <div className="people-profile-grid-v244">
                        <div>
                          <span>Title</span>
                          <strong>{profile.title || "Unset"}</strong>
                        </div>
                        <div>
                          <span>Department</span>
                          <strong>{departmentForPerson(profile) ? <DepartmentIdentityMark department={departmentForPerson(profile)!} label size={22} /> : profile.department || "Unset"}</strong>
                        </div>
                        <div>
                          <span>Team</span>
                          <strong>{profileTeams.length ? profileTeams.map((team) => team.name).join(", ") : profile.teamName || "Unset"}</strong>
                        </div>
                        <div>
                          <span>Manager</span>
                          <strong>{profile.manager ? displayUserName(profile.manager as User) : profile.managerName || "Unset"}</strong>
                        </div>
                        <div>
                          <span>Start date</span>
                          <strong>{profile.startDate ? new Date(profile.startDate).toLocaleDateString() : "Unset"}</strong>
                        </div>
                        <div>
                          <span>Projects</span>
                          <strong>{profileProjects.length}</strong>
                        </div>
                      </div>
                    </section>
                    {(profile.profileBio || profile.email || profile.phoneNumber || profile.profileDiscordUsername || profile.discordUsername || profile.profileWebsite) && (
                      <section className="people-section-v244 people-profile-contact-v473">
                        <h3>About & contact</h3>
                        {profile.profileBio && <p className="people-profile-bio-v473">{profile.profileBio}</p>}
                        <ProfileContactActions user={profile as User} />
                      </section>
                    )}
                    {canSeeSensitiveProfile && (
                      <section className="people-section-v244">
                        <h3>Private account contact</h3>
                        <div className="people-profile-grid-v244">
                          <div>
                            <span>Email</span>
                            <strong>{profile.email || "Unset"}</strong>
                          </div>
                          <div>
                            <span>Phone</span>
                            <strong>{profile.phoneNumber || "Unset"}</strong>
                          </div>
                          {!profile.hideLegalName && (
                            <div>
                              <span>Legal name</span>
                              <strong>{profile.legalName || "Unset"}</strong>
                            </div>
                          )}
                        </div>
                      </section>
                    )}
                    <section className="people-section-v244">
                      <h3>Skills and notes</h3>
                      <div className="chip-row">
                        {profile.skills?.length ? (
                          profile.skills.map((skill) => (
                            <span className="tag-chip" key={skill}>
                              {skill}
                            </span>
                          ))
                        ) : (
                          <span className="muted">No skills listed.</span>
                        )}
                      </div>
                      {profile.notes && <p className="people-profile-note-v250">{profile.notes}</p>}
                    </section>
                  </div>
                )}
              </div>
            </>
          ) : selectedUserId && loadStatus.startsWith("Loading profile") ? (
            <InspectorLoadingState label="Loading person profile" compact />
          ) : (
            <ClusterEmptyState compact kind="empty" icon="user" title="Select a person" description="Choose someone from the directory to inspect profile, workload, activity, and access details." />
          )}
          <div className="people-load-status-v244">{loadStatus}</div>
        </main>}
      />
      </div>
    </section>
  );
}

