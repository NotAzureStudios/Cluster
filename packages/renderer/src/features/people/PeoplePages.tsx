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
import { ClusterButton, ClusterIconButton } from "../../components/ClusterButton";
import { ClusterSelect } from "../../components/ClusterSelect";
import { ClusterEmptyState } from "../../components/ClusterEmptyState";
import { ClusterActionMenu } from "../../components/ClusterContextActions";
import { resolveClusterResourceActions } from "../../core/resource-action-registry";
import { ClusterIcon } from "../../components/ClusterIcon";
import { PEOPLE_DATA_FIELDS, clusterDataDerivedSemanticFields, clusterDataSelectionSetFilterGroup, createClusterDataViewLayout, evaluateClusterDataDerivedFields, mergeClusterDataFilterGroups, planClusterDataDerivedFields, type ClusterDataDerivedField, type ClusterDataExportDelivery, type ClusterDataExportFormat, type ClusterDataGroup, type ClusterDataProjection, type ClusterDataQuery, type ClusterDataSelection, type ClusterDataSelectionSet, type ClusterDataSort, type ClusterDataViewLayout, type ClusterSavedDataView, type ClusterSemanticField } from "@cluster/shared";
import { ClusterDataTable, type ClusterDataTableColumn } from "../../components/ClusterDataTable";
import { requestClusterDataExport } from "../../core/data-export-client";
import { DataExportOperationFeedback } from "../../components/DataExportOperationFeedback";
import { DataExportBuilder } from "../../components/DataExportBuilder";
import { ClusterSegmentedControl } from "../../components/ClusterSegmentedControl";
import { ToolPageHeader } from "../../components/ToolPageHeader";
import { ClusterMasterDetail, readClusterDetailSelection, useClusterDetailHistory } from "../../components/ClusterMasterDetail";
import { InspectorLoadingState, LoadingState } from "../../components/LoadingState";
import { PersonSummary } from "../../components/PersonSummary";
import { ProfileHero } from "./ProfileHero";
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
  profileCapacityLabel,
  profileCompletionScore,
  profileLocalTime,
  profileWorkloadLabel,
  userInitial,
} from "./people-utils";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterCopyButton } from "../../components/ClusterCopyButton";
import { copyClusterText } from "../../core/clipboard";
import { confirmCluster, promptCluster } from "../../components/cluster-dialog-service";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import { PersonnelRecordsPanel } from "./PersonnelRecordsPanel";
import { WorkforceAvailabilityExceptions, type WorkforceAvailabilityException } from "./WorkforceAvailabilityExceptions";
import { CompanyGraphPanel } from "./CompanyGraphPanel";
import { PersonEffectiveAccessPanel } from "./PersonEffectiveAccessPanel";
import { PeopleUserEditor } from "./PeopleUserEditor";
import { AccountCredentialHandoff } from "./AccountCredentialHandoff";
import { AccountInvitationHandoff } from "./AccountInvitationHandoff";

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

function ProfileContactList({ user }: { user: User }) {
  const website = safeProfileUrl(user.profileWebsite);
  const discord = user.profileDiscordUsername || user.discordUsername || "";
  return <ul className="pp-contact">
    {user.email && <li><ClusterIcon name="mail" /><a href={`mailto:${user.email}`}>{user.email}</a></li>}
    {user.phoneNumber && <li><ClusterIcon name="phone" /><a href={`tel:${user.phoneNumber}`}>{user.phoneNumber}</a></li>}
    {discord && <li><ClusterIcon name="comment" /><span>{discord}</span><ClusterCopyButton text={discord} variant="quiet" size="compact" copiedLabel="Copied">Copy</ClusterCopyButton></li>}
    {website && <li><ClusterIcon name="globe" /><a href={website} target="_blank" rel="noreferrer">{new URL(website).host}</a></li>}
  </ul>;
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
  if (!hours) return null;
  const days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].filter((day) => Array.isArray(hours[day]) && (hours[day] as unknown[]).length);
  if (!days.length) return null;
  const first = hours[days[0]] as Array<{ start: string; end: string }>;
  const same = days.every((day) => { const value = hours[day] as Array<{ start: string; end: string }>; return value?.[0]?.start === first?.[0]?.start && value?.[0]?.end === first?.[0]?.end; });
  return `${days.length} days${same && first?.[0] ? ` · ${first[0].start}–${first[0].end}` : " configured"}`;
}

export function ProfilesPage({ currentUser, projects, onOpenProject, onEditProfile, adminMode = false, onCreateAccount, onBack }: { onBack?: () => void; onCreateAccount?: () => void; currentUser: User; projects: Project[]; onOpenProject: (projectId: string) => void; onEditProfile?: () => void; adminMode?: boolean }) {
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
  type ProfileView = "overview" | "work" | "calendar" | "activity" | "records" | "access" | "edit";
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
  const [profileExpanded, setProfileExpanded] = useState(Boolean(adminMode));
  const [showDataTools, setShowDataTools] = useState(false);
  async function changeWorkforceMode(next: typeof workforceMode) {
    if (next === workforceMode) return;
    if (profileView === "edit" && editorDirty) {
      if (!(await confirmEditorDiscard())) return;
      setEditorDirty(false);
      setProfileViewState("overview");
    }
    setWorkforceMode(next);
  }
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
  const [adminActionBusy, setAdminActionBusy] = useState("");
  const [adminActionFeedback, setAdminActionFeedback] = useState<{ message: string; error: boolean } | null>(null);
  const accountStateActionGateRef = useRef(false);
  const accountScopeRef = useRef(currentUser.id);
  const [issuedCredential, setIssuedCredential] = useState<{ username: string; temporaryPassword: string } | null>(null);
  const [issuedActivationLink, setIssuedActivationLink] = useState<{ username: string; activationLink: string; expiresAt: string } | null>(null);
  const [directoryRefresh, setDirectoryRefresh] = useState(0);
  useEffect(() => {
    if (effectiveAdminMode) return;
    setIssuedCredential(null);
    setIssuedActivationLink(null);
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
    setIssuedActivationLink(null);
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
    enabled: workforceMode === "directory",
    resetKey: `${currentUser.id}:${effectiveAdminMode ? "admin" : "directory"}:${directoryRefresh}:${peopleServerQueryKey}`,
    rowKey: (person) => person.id,
    loadPage: async (cursor): Promise<ClusterCursorPage<UserActivitySummary>> => queryApi<ClusterCursorPage<UserActivitySummary>>(`/api/users?summary=true&paged=true&limit=80&dataQuery=${clusterDataQueryParameter(peopleServerDataQuery)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { staleMs: 5_000, maxAgeMs: 2 * 60_000, force: Boolean(cursor), tags: ["users", "people", "directory"] }),
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

  async function loadProfiles(targetUserId = activeProfileIdRef.current, force = false, activateTarget = false, contextOnly = false) {
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
    if (!activateTarget && !contextOnly && activeProfileIdRef.current === targetUserId && targetUserId) {
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

  async function issueActivationInvitationForProfile() {
    if (!effectiveAdminMode || !profile || adminActionBusy ||
      profile.id === currentUser.id || profile.archived ||
      profile.accountState !== "PASSWORD_CHANGE_REQUIRED") return;
    const targetId = profile.id;
    const scope = currentUser.id;
    const name = displayUserName(profile);
    setAdminActionBusy("activation-invitation");
    try {
      const confirmed = await confirmCluster({
        title: "Replace temporary password with an invitation?",
        message: `Create a one-time activation link for ${name}? Their existing temporary password will stop working immediately. The link must be shared privately and expires after 24 hours. No sign-in session will be issued from the link.`,
        confirmLabel: "Issue activation link",
        tone: "danger",
      });
      if (!confirmed || accountScopeRef.current !== scope || activeProfileIdRef.current !== targetId) return;
      const result = await api<{ ok: boolean; username: string; activationLink: string; expiresAt: string }>(
        `/api/admin/users/${encodeURIComponent(targetId)}/account-invitations`, { method: "POST" });
      if (accountScopeRef.current !== scope || activeProfileIdRef.current !== targetId) return;
      setIssuedCredential(null);
      setIssuedActivationLink({ username: result.username, activationLink: result.activationLink, expiresAt: result.expiresAt });
      setAdminActionFeedback({ error: false, message: "Activation link issued. The old temporary password is revoked. Complete the one-time private handoff." });
      setLoadStatus("Activation link issued. Copy and share it securely before leaving this view.");
    } catch (error) {
      if (accountScopeRef.current === scope) {
        const message = error instanceof Error ? error.message : "Could not issue an activation link.";
        setAdminActionFeedback({ message, error: true });
        setLoadStatus(message);
      }
    } finally {
      if (accountScopeRef.current === scope) setAdminActionBusy("");
    }
  }

  async function issuePasswordResetForProfile() {
    if (!effectiveAdminMode || !profile || adminActionBusy || profile.id === currentUser.id) return;
    const scope = currentUser.id;
    const targetId = profile.id;
    const name = displayUserName(profile);
    setAdminActionBusy("password-reset");
    try {
      const confirmed = await confirmCluster({
        title: "Issue temporary password?",
        message: `Reset ${name}'s password and revoke existing sessions? A new one-time password will be shown once; it must be shared privately.`,
        confirmLabel: "Reset password",
        tone: "danger",
      });
      if (!confirmed || accountScopeRef.current !== scope || activeProfileIdRef.current !== targetId) return;
      const result = await api<{ ok: boolean; username: string; temporaryPassword: string }>(`/api/admin/users/${encodeURIComponent(targetId)}/password-reset`, { method: "POST" });
      if (accountScopeRef.current !== scope) return; // Never show another session's credential.
      setIssuedCredential({ username: result.username, temporaryPassword: result.temporaryPassword });
      setLoadStatus(`Password reset issued for ${name}. Existing sessions were revoked. Copy the temporary password from the handoff dialog.`);
      setAdminActionFeedback({ message: "Temporary password issued; sessions revoked. Complete the private credential handoff.", error: false });
      const refreshWarning = await reconcileAfterCommit(async () => { await loadProfile(targetId, true); setDirectoryRefresh((current) => current + 1); });
      if (refreshWarning) setLoadStatus(`Password reset succeeded, but profile refresh failed. The temporary password remains valid. ${refreshWarning}`);
    } catch (error) {
      if (accountScopeRef.current === scope) {
        const message = error instanceof Error ? error.message : "Password reset failed.";
        setLoadStatus(message);
        setAdminActionFeedback({ message, error: true });
      }
    } finally { if (accountScopeRef.current === scope) setAdminActionBusy(""); }
  }
  async function setProfileAccountState(state: "ACTIVE" | "SUSPENDED" | "DISABLED") {
    if (!effectiveAdminMode || !profile || adminActionBusy || accountStateActionGateRef.current) return;
    const userId = profile.id;
    const name = displayUserName(profile);
    const currentState = String(profile.accountState || "ACTIVE").toUpperCase();
    if (state === currentState || (state !== "ACTIVE" && userId === currentUser.id)) return;
    if (state === "ACTIVE" && !["SUSPENDED", "DISABLED"].includes(currentState)) {
      setLoadStatus("Activate is for suspended or disabled accounts. Finish password setup or recovery through the account's existing workflow.");
      return;
    }
    accountStateActionGateRef.current = true;
    setAdminActionBusy(`state:${state}`);
    try {
      const confirmed = await confirmCluster({
        title: state === "ACTIVE" ? "Reactivate account?" : state === "SUSPENDED" ? "Suspend account?" : "Disable account?",
        message: state === "ACTIVE"
          ? `Restore sign-in eligibility for ${name}? Expired and archived accounts still require governed recovery. Temporary-password setup is not skipped.`
          : `Change ${name} to ${state.toLowerCase()}? Active sessions will be revoked${state === "DISABLED" ? ", and registered devices and authenticators will be revoked" : ""}.`,
        confirmLabel: state === "ACTIVE" ? "Reactivate" : state === "SUSPENDED" ? "Suspend account" : "Disable account",
        tone: state === "ACTIVE" ? "default" : "danger",
      });
      if (!confirmed || activeProfileIdRef.current !== userId) return;
      await api(`/api/admin/users/${encodeURIComponent(userId)}/account-state`, { method: "PATCH", body: JSON.stringify({ state }) });
      await loadProfile(userId, true);
      setDirectoryRefresh((current) => current + 1);
      setLoadStatus(`${name} account state updated. Sign-in requirements and policy checks remain enforced by the server.`);
      setAdminActionFeedback({ message: `Account ${state.toLowerCase()}. Sign-in policies remain enforced.`, error: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Account state update failed.";
      setLoadStatus(message);
      setAdminActionFeedback({ message, error: true });
    } finally {
      accountStateActionGateRef.current = false;
      setAdminActionBusy("");
    }
  }
  async function setProfileToolPermission(toolKey: string, level: string) {
    if (!effectiveAdminMode || !profile || adminActionBusy) return;
    const targetId = profile.id;
    const previousOverrides = (profile.toolPermissions || {}) as Record<string, string>;
    const previousLevel = String(previousOverrides[toolKey] || "inherit");
    if (level === previousLevel) return;
    const toolLabel = TOOL_PERMISSION_OPTIONS.find((tool) => tool.key === toolKey)?.label || toolKey;
    setAdminActionBusy(`tool:${toolKey}`);
    try {
      const confirmed = await confirmCluster({
        title: "Change tool access?",
        message: `Change ${displayUserName(profile)}'s ${toolLabel} override from ${previousLevel} to ${level}? This affects effective access and will be enforced by the server.`,
        confirmLabel: "Apply access change",
        tone: "danger",
      });
      if (!confirmed || activeProfileIdRef.current !== targetId) return;
      const next = { ...(profile.toolPermissions || {}) } as Record<string, string>;
      if (level === "inherit") delete next[toolKey]; else next[toolKey] = level;
      await api(`/api/users/${encodeURIComponent(targetId)}`, { method: "PATCH", body: JSON.stringify({ toolPermissions: next }) });
      await loadProfile(targetId, true);
      setDirectoryRefresh((current) => current + 1);
      setLoadStatus(`${toolLabel} access updated.`);
      setAdminActionFeedback({ message: `${toolLabel} access updated to ${level}.`, error: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Tool access update failed.";
      setLoadStatus(message);
      setAdminActionFeedback({ message, error: true });
    } finally { setAdminActionBusy(""); }
  }

  async function patchProfileAdministration(patch: Record<string, unknown>, status: string) {
    if (!effectiveAdminMode || !profile || adminActionBusy) return;
    setAdminActionBusy("profile-admin");
    try {
      await api(`/api/users/${profile.id}`, { method: "PATCH", body: JSON.stringify(patch) });
      await loadProfile(profile.id, true);
      setDirectoryRefresh((current) => current + 1);
      setLoadStatus(status);
      setAdminActionFeedback({ message: status, error: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Account administration update failed.";
      setLoadStatus(message);
      setAdminActionFeedback({ message, error: true });
    }
    finally { setAdminActionBusy(""); }
  }
  async function changeProfileAccountType(nextType: string) {
    if (!effectiveAdminMode || !profile || adminActionBusy || nextType === (profile.accountType || "employee")) return;
    if (["contractor", "client", "guest"].includes(nextType) &&
      (!profile.accessExpiresAt || new Date(profile.accessExpiresAt) <= new Date())) {
      setAdminActionFeedback({ error: true, message: "External account types require a future access expiry. The current renewal flow cannot assign an initial expiry to a permanent account." });
      return;
    }
    const personId = profile.id;
    const accepted = await confirmCluster({
      title: "Change account type?",
      message: `Change ${displayUserName(profile)} to ${nextType}? Account identity type and role permissions are separate. Existing access grants are not automatically changed.`,
      confirmLabel: "Change account type",
    });
    if (!accepted || activeProfileIdRef.current !== personId) return;
    await patchProfileAdministration({ accountType: nextType }, "Account type updated.");
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
    setAdminActionFeedback(null);
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
  const inspectProfile = (userId: string) => {
    setProfileExpanded(false);
    personDetailHistory.openDetail(userId);
  };
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

    return true;
  });
  const peopleProgress = useProgressiveList(filteredUsers, {
    initial: 80,
    step: 80,
    resetKey: `${query}|${departmentFilter}|${statusFilter}|${effectiveAdminMode}`,
  });
  const assignmentByUserId = useMemo(() => new Map(assignments.map((item) => [item.user.id, item])), [assignments]);
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
      {!(profileExpanded && profile) && <ToolPageHeader
        className="cluster-page-header"
        title="People"
        description={workforceContext ? `${users.length} people` : undefined}
        actions={<>
          <ClusterSegmentedControl className="people-mode-v6" value={workforceMode} onChange={(value) => { void changeWorkforceMode(value as typeof workforceMode); }} label="People workspace" options={[
            { value: "directory", label: "Directory" },
            { value: "organization", label: "Org" },
            { value: "teams", label: "Teams" },
            { value: "capacity", label: "Capacity" },
            { value: "availability", label: "Availability" },
          ]} />
          <ClusterActionMenu iconOnly label="More people actions" items={[
            { id: "refresh", label: "Refresh", icon: "refresh", onSelect: () => { setDirectoryRefresh((current) => current + 1); void loadProfiles(); } },
            { id: "data-tools", label: showDataTools ? "Hide data tools" : "Data tools", icon: "grid", onSelect: () => { setWorkforceMode("directory"); setShowDataTools((current) => !current); } },
          ]} />
          {onCreateAccount ? <ClusterButton variant="secondary" onClick={onCreateAccount}><ClusterIcon name="plus" /> Add</ClusterButton> : null}
          <ClusterButton variant="primary" onClick={() => { setWorkforceMode("directory"); openFullProfile(currentUser.id); }}>My profile</ClusterButton>
        </>}
      />}

      {effectiveAdminMode && issuedCredential && <AccountCredentialHandoff username={issuedCredential.username} temporaryPassword={issuedCredential.temporaryPassword} onDismiss={() => setIssuedCredential(null)} />}
      {effectiveAdminMode && issuedActivationLink && <AccountInvitationHandoff username={issuedActivationLink.username} activationLink={issuedActivationLink.activationLink} expiresAt={issuedActivationLink.expiresAt} onDismiss={() => setIssuedActivationLink(null)} />}


      {workforceMode !== "directory" && <section className="people-workforce-workspace-v504 panel" aria-label={`${workforceMode} workforce workspace`}>
        {!workforceContext ? <LoadingState label="Loading workforce" rows={6} compact /> : <>
          {workforceMode === "organization" && <>
            <header><h2 className="sr-only">Organization</h2><strong>{workforceContext.departments.length} departments · {workforceContext.jobRoles.length} roles</strong></header>
<CompanyGraphPanel departments={workforceContext.departments} teams={workforceContext.teams} people={workforceContext.people} workspaceId={workforceContext.workspaceId || ""} canEdit={Boolean(currentUser.isAdmin)} onChanged={async () => { const refreshed = await queryApi<WorkforceContext>("/api/workforce/context", { force: true, staleMs: 0, tags: ["users", "people", "workforce"] }); setWorkforceContext(refreshed); }} onOpenPerson={openFullProfile} />
          </>}
          {workforceMode === "teams" && <>
            <header><h2 className="sr-only">Teams</h2><strong>{workforceContext.teams.length} teams</strong></header>
            <div className="people-workforce-card-grid-v504">{workforceContext.teams.map((team) => <article key={team.id}><div><strong>{team.name}</strong><span>{team.department?.name || "Cross-studio"}{team.description ? ` · ${team.description}` : ""}</span></div><small>{team.members.length} members · {team.members.reduce((sum, member) => sum + member.allocationPercent, 0)}% team allocation</small><div className="chip-row">{team.roles.slice(0, 8).map((role) => <span className="tag-chip" key={role.id}>{role.name}</span>)}</div></article>)}{!workforceContext.teams.length && <ClusterEmptyState compact kind="empty" icon="users" title="No teams yet" description="Teams can span departments without becoming another department field." />}</div>
          </>}
          {workforceMode === "capacity" && <>
            <header><h2 className="sr-only">Capacity</h2><strong>{Math.round(workforceAllocatedHours * 10) / 10}h allocated</strong></header>
            <div className="people-capacity-visuals-v34" aria-label="Workforce capacity overview">
              <ClusterVisualComposition label="Capacity configured" total={workforceContext.people.length} parts={[
                { label: "Configured", value: Math.min(workforceContext.people.length, workforceContext.capacity.configuredPeople), tone: "good" },
                { label: "Not configured", value: Math.max(0, workforceContext.people.length - workforceContext.capacity.configuredPeople), tone: "neutral" },
              ]} />
              <ClusterVisualMeter label="Hours allocated" value={workforceAllocatedHours} total={workforceContext.capacity.totalHours} tone={workforceAllocatedHours > workforceContext.capacity.totalHours ? "warning" : "accent"} />
              <span className={workforceOverallocated ? "warning" : "muted"}>{workforceOverallocated} overallocated</span>
            </div>
            <div className="people-workforce-table-v504">{workforceContext.people.map((person) => { const capacity = Number(person.employment?.capacityHours ?? 0); const allocation = (person.projectMemberships || []).reduce((sum, membership) => sum + Number(membership.allocationPercent || 0), 0); return <article key={person.id}><div><strong>{displayUserName(person)}</strong><span>{person.employment?.jobRole?.name || "No role"} · {person.employment?.department?.name || "No department"}</span></div>{capacity ? <span>{capacity}h capacity</span> : null}<div className="people-capacity-person-v34"><ClusterVisualMeter label="Allocated" value={allocation} total={100} tone={allocation > 100 ? "danger" : "accent"} compact /></div></article>; })}</div>
          </>}
          {workforceMode === "availability" && <>
            <header><h2 className="sr-only">Availability</h2><strong>{workforceContext.capacity.available} available · {workforceContext.capacity.clockedIn} clocked in</strong></header>
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
      <ClusterTableToolbar
        className="people-toolbar-v244"
        query={query}
        onQueryChange={setQuery}
        placeholder="Name, role, team, skill, location"
        countLabel={`${filteredUsers.length} shown`}
        filters={
          <>
            <ClusterNativeSelect aria-label="Department" value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)}>
              <option value="all">All departments</option>
              {departments.map((department) => <option value={department} key={department}>{department}</option>)}
            </ClusterNativeSelect>
            <ClusterNativeSelect aria-label="Status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">Any status</option>
              <option value="active">Active</option>
              <option value="available">Available</option>
              <option value="focus">Focus</option>
              <option value="away">Away</option>
              <option value="offline">Offline</option>
            </ClusterNativeSelect>
          </>
        }
        actions={<><ClusterSegmentedControl value={directoryMode} onChange={setDirectoryMode} label="People directory layout" options={[{ value: "list", label: "List" }, { value: "table", label: "Table" }]} /><DataExportBuilder fields={peopleExportFields} selectionCount={selectedPeopleIds.size} busy={peopleExporting} onExport={({ format, fieldIds, scope, delivery }) => exportPeople(format, fieldIds, scope, delivery)} /></>}
      />
      {showDataTools && <ClusterDisclosureGroup className="people-data-tools-v524" title="Data tools" defaultOpen contentClassName="people-data-tools-body-v524">
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
      </ClusterDisclosureGroup>}
      <DataExportOperationFeedback jobId={peopleExportJobId} onDismiss={() => setPeopleExportJobId("")} />

      <ClusterMasterDetail className="people-layout-v244" label="People directory and profile inspector" masterLabel="People directory" detailLabel="Person profile" detailOpen={Boolean(profile)} onCloseDetail={() => { setProfileExpanded(false); personDetailHistory.closeDetail(); }} detailSize="wide" persistKey="people" resizable={!profileExpanded} master={<aside className="panel people-directory-v244" aria-label="People directory">
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
              onRowActivate={(person) => inspectProfile(person.id)}
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
              <ClusterButton unstyled type="button" className={selectedUserId === person.id ? "active" : ""} key={person.id} onClick={() => inspectProfile(person.id)} onDoubleClick={() => openFullProfile(person.id)}>
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
              <ProfileHero
                person={profile as any}
                isSelf={profile.id === currentUser.id}
                onSaved={() => void selectProfile(profile.id)}
                leading={profileExpanded && <ClusterIconButton size="compact" className="pp-back" label={adminMode && onBack ? "Back to users" : "Back to directory"} onClick={() => { if (adminMode && onBack) onBack(); else setProfileExpanded(false); }}><ClusterIcon name="chevron-left" /></ClusterIconButton>}
                subtitle={profile.title || (!departmentForPerson(profile) ? profile.department : null) || undefined}
                departmentIdentity={departmentForPerson(profile)}
                stats={[
                  { label: "Projects", value: profileProjects.length, onClick: () => setProfileView("work") },
                  { label: "Teams", value: profileTeams.length },
                  { label: "Cards", value: profileCards.length, onClick: () => setProfileView("work") },
                  ...(directReports.length ? [{ label: "Reports", value: directReports.length }] : []),
                ]}
                actions={<>
                  {effectiveAdminMode && !profile.archived && <ClusterButton size="compact" variant={profileView === "edit" ? "primary" : "secondary"} onClick={() => setProfileView("edit")}>Edit</ClusterButton>}
                  {!(adminMode && onBack) && <ClusterIconButton size="compact" label={profileExpanded ? "Show in directory" : "Open full page"} onClick={() => setProfileExpanded((current) => !current)}><ClusterIcon name={profileExpanded ? "minimize" : "fullscreen"} /></ClusterIconButton>}
                  <ClusterActionMenu iconOnly label={`${displayUserName(profile)} actions`} items={resolveClusterResourceActions({ kind: "user", id: profile.id }, [
                    { id: "copy-profile-link", resourceKinds: ["user"] as const, allowed: () => true, label: "Copy profile link", icon: "link", onSelect: () => copyProfileLink(profile) },
                    { id: "mention-person", resourceKinds: ["user"] as const, allowed: () => true, label: "Copy mention", icon: "comment", onSelect: () => copyProfileMention(profile) },
                    ...(canOpenScheduler ? [{ id: "open-scheduler", resourceKinds: ["user"] as const, allowed: () => true, label: "Open scheduler", icon: "clock" as const, onSelect: () => { openClusterWorkNavigation({ screen: "scheduler" }); } }] : []),
                    ...(effectiveAdminMode && profile.id !== currentUser.id && !profile.archived ? [{ id: "reset-password", resourceKinds: ["user"] as const, allowed: () => true, label: "Reset password", icon: "lock" as const, separatorBefore: true, onSelect: () => { setProfileView("access"); void issuePasswordResetForProfile(); } }] : []),
                    ...(currentUser.isAdmin && profile.id !== currentUser.id ? [{ id: "manage-access", resourceKinds: ["user"] as const, allowed: () => true, label: effectiveAdminMode ? "Manage access" : "View access", icon: "lock" as const, separatorBefore: true, onSelect: () => setProfileView("access") }] : []),
                  ])} />
                </>}
              />

              <nav className="pp-tabs" aria-label="Profile views">
                {([
                  ["overview", "Overview"],
                  ["work", "Work"],
                  ["calendar", "Calendar"],
                  ["activity", "Activity"],
                  ...((currentUser.isAdmin || getToolLevel(currentUser, "people") === "edit") ? [["records", "Records"]] : []),
                  ["access", "Access"],
                ] as Array<[ProfileView, string]>).map(([id, label]) => <ClusterButton unstyled type="button" key={id} className={profileView === id ? "active" : ""} aria-current={profileView === id ? "page" : undefined} onClick={() => setProfileView(id)}>{label}</ClusterButton>)}
              </nav>

              <div className="people-detail-scroll-v244">
                {profileView === "overview" && (() => {
                  const department = departmentForPerson(profile);
                  const facts: Array<[string, React.ReactNode]> = [];
                  const push = (label: string, value: React.ReactNode) => { if (value !== null && value !== undefined && value !== "" && value !== false) facts.push([label, value]); };
                  push("Role", profile.title);
                  push("Department", department ? <DepartmentIdentityMark department={department} label size={16} /> : profile.department);
                  push("Team", profileTeams.length ? profileTeams.map((team) => team.name).join(", ") : profile.teamName);
                  push("Manager", profile.manager ? displayUserName(profile.manager as User) : profile.managerName);
                  push("Local time", profile.timezone ? <span title={profile.timezone}>{profileLocalTime(profile.timezone)}</span> : null);
                  push("Location", profile.hideLocation ? null : profile.workLocation);
                  push("Hours", profile.workingHours && Object.keys(profile.workingHours).length ? workingHoursSummary(profile.workingHours) : null);
                  push("Capacity", profile.capacityHours != null ? `${profile.capacityHours}h / week` : null);
                  push("Allocation", profileAllocation ? `${profileAllocation}% · ${profileAllocationState}` : null);
                  push("Pronouns", profile.pronouns);
                  push("Username", `@${profile.username}`);
                  push("Access", profile.workspaceRole || (profile.isAdmin ? "admin" : null));
                  push("Employment", profile.employmentType);
                  push("Started", profile.startDate ? new Date(profile.startDate).toLocaleDateString() : null);
                  push("Last seen", profile.lastSeenAt ? formatRelativeTime(profile.lastSeenAt) : null);
                  for (const field of profile.profileFieldDefinitions || []) { const value = profile.customProfileFields?.[field.id]; push(field.label, Array.isArray(value) ? value.join(", ") : value == null ? null : String(value)); }
                  const expertise = profile.expertise?.length ? profile.expertise : (profile.skills || []).map((name) => ({ name, level: "", years: null as number | null }));
                  const hasContact = Boolean(profile.email || profile.phoneNumber || profile.profileDiscordUsername || profile.discordUsername || profile.profileWebsite);
                  return <div className="pp-overview">
                    <div className="pp-main">
                      {facts.length ? <dl className="pp-facts">{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl> : null}
                      {expertise.length ? <section className="pp-section"><h3>Skills</h3><div className="pp-chips">{expertise.map((item) => <span key={item.name}>{item.name}{item.level ? <small>{item.level}{item.years != null ? ` · ${item.years}y` : ""}</small> : null}</span>)}</div></section> : null}
                      {profileShowcaseProjects.length > 0 && <section className="pp-section"><h3>Showcase</h3><div className="profile-showcase-grid-v473">{profileShowcaseProjects.map((project) => <ClusterButton unstyled type="button" key={project.id} onClick={() => onOpenProject(project.id)}><strong>{project.name}</strong><span>{project.projectType || project.status || "Project"}</span></ClusterButton>)}</div></section>}
                      {directReports.length > 0 && <section className="pp-section"><h3>Reports</h3><div className="pp-chips">{directReports.map((person) => <ClusterButton unstyled type="button" key={person.id} onClick={() => inspectProfile(person.id)}>{displayUserName(person)}</ClusterButton>)}</div></section>}
                      <section className="pp-section people-profile-feed-rc46" aria-label="Recent work activity">
                        <h3>Activity{profile.recentActivity?.length ? <ClusterButton size="compact" variant="quiet" onClick={() => setProfileView("activity")}>All</ClusterButton> : null}</h3>
                        {profile.recentActivity?.length ? <ol>{profile.recentActivity.slice(0, 5).map((event) => <li key={event.id}><span className="people-profile-feed-dot-rc46" aria-hidden="true" /><div><strong>{event.title}</strong>{event.message && <p>{event.message}</p>}<time dateTime={event.createdAt}>{formatRelativeTime(event.createdAt)}</time></div></li>)}</ol> : <p className="muted">Nothing recent.</p>}
                      </section>
                    </div>
                    {(hasContact || canSeeSensitiveProfile) && <aside className="pp-aside">
                      {hasContact && <section className="pp-card"><h3>Contact</h3><ProfileContactList user={profile as User} /></section>}
                      {canSeeSensitiveProfile && (!profile.hideLegalName && profile.legalName || profile.employeeNumber || profile.notes) ? <section className="pp-card" aria-label={sensitiveProfileMessage}>
                        <h3><ClusterIcon name="lock" /> Private</h3>
                        <dl className="pp-rows">
                          {!profile.hideLegalName && profile.legalName ? <div><dt>Legal name</dt><dd>{profile.legalName}</dd></div> : null}
                          {profile.employeeNumber ? <div><dt>Employee #</dt><dd>{profile.employeeNumber}</dd></div> : null}
                        </dl>
                        {profile.notes ? <p className="pp-note">{profile.notes}</p> : null}
                      </section> : null}
                    </aside>}
                  </div>;
                })()}

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
                      {profile.capacityHours != null ? <><div>
                        <span>Capacity</span>
                        <strong>{profile.capacityHours}h</strong>
                      </div>
                      <div>
                        <span>Workload</span>
                        <strong>{profileWorkloadLabel(profileCards.length, profile.capacityHours)}</strong>
                      </div></> : null}
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

                {profileView === "access" && (() => {
                  const state = String(profile.accountState || "ACTIVE").toUpperCase();
                  const self = profile.id === currentUser.id;
                  const busy = Boolean(adminActionBusy);
                  return <div className="pp-access">
                    <section className="pp-card">
                      <header><h3>Account</h3><span className={`pp-state ${profile.archived ? "archived" : state.toLowerCase()}`}>{profile.archived ? "Archived" : levelLabel(state.replaceAll("_", " ").toLowerCase())}</span></header>
                      <dl className="pp-rows">
                        <div><dt>Role</dt><dd>{levelLabel(profile.workspaceRole || (profile.isAdmin ? "admin" : "member"))}</dd></div>
                        <div><dt>Type</dt><dd>{effectiveAdminMode ? <ClusterSelect ariaLabel="Account type" value={profile.accountType || "employee"} disabled={busy} onChange={(value) => void changeProfileAccountType(value)} options={[{ value: "employee", label: "Employee" }, { value: "contractor", label: "Contractor" }, { value: "client", label: "Client" }, { value: "guest", label: "Guest" }]} /> : levelLabel(profile.accountType || "employee")}</dd></div>
                        <div><dt>Password</dt><dd>{profile.passwordConfigured === false ? "Setup required" : "Set"}</dd></div>
                        <div><dt>PIN</dt><dd>{profile.pinConfigured ? "Set" : "Not set"}</dd></div>
                        <div><dt>Access expires</dt><dd title={profile.accountType && profile.accountType !== "employee" ? "Clients, contractors and guests need an expiry. Extensions are approved in Studio Settings → Access renewals." : undefined}>{profile.accessExpiresAt ? new Date(profile.accessExpiresAt).toLocaleDateString() : "Never"}</dd></div>
                        {profile.lastActivityAt ? <div><dt>Last active</dt><dd>{formatRelativeTime(profile.lastActivityAt)}</dd></div> : null}
                      </dl>
                      {effectiveAdminMode && !self && <div className="pp-admin-actions">
                        {["SUSPENDED", "DISABLED"].includes(state) ? <ClusterButton size="compact" variant="secondary" disabled={busy} onClick={() => void setProfileAccountState("ACTIVE")}>Reactivate</ClusterButton> : null}
                        {state !== "SUSPENDED" ? <ClusterButton size="compact" variant="secondary" disabled={busy} onClick={() => void setProfileAccountState("SUSPENDED")}>Suspend</ClusterButton> : null}
                        {state !== "DISABLED" ? <ClusterButton size="compact" variant="secondary" disabled={busy} onClick={() => void setProfileAccountState("DISABLED")}>Disable</ClusterButton> : null}
                        <span className="pp-admin-divider" aria-hidden="true" />
                        <ClusterButton size="compact" variant="secondary" disabled={busy} onClick={() => void issuePasswordResetForProfile()}>{adminActionBusy === "password-reset" ? "Resetting…" : "Reset password"}</ClusterButton>
                        {state === "PASSWORD_CHANGE_REQUIRED" && !profile.archived ? <ClusterButton size="compact" variant="secondary" disabled={busy} onClick={() => void issueActivationInvitationForProfile()}>{adminActionBusy === "activation-invitation" ? "Issuing…" : "Activation link"}</ClusterButton> : null}
                        <ClusterButton size="compact" variant="danger" disabled={Boolean(securityActionUserId)} onClick={() => void resetAuthenticatorsForProfile()}>{securityActionUserId === profile.id ? "Resetting…" : "Reset authenticators"}</ClusterButton>
                      </div>}
                      {adminActionFeedback && <p role={adminActionFeedback.error ? "alert" : "status"} className={adminActionFeedback.error ? "pp-feedback error" : "pp-feedback"}>{adminActionFeedback.message}</p>}
                    </section>
                    <section className="pp-card">
                      <header><h3>Tool access</h3>{effectiveAdminMode ? <span>Default follows the role and account type</span> : null}</header>
                      <div className="pp-tools">{(effectiveAdminMode ? TOOL_PERMISSION_OPTIONS : profileAccess).map((tool) => <div key={tool.key}>
                        <span>{tool.label}</span>
                        {effectiveAdminMode
                          ? <ClusterSelect ariaLabel={`${tool.label} access`} value={String(profile.toolPermissions?.[tool.key] || "inherit")} disabled={busy} onChange={(value) => void setProfileToolPermission(tool.key, value)} options={[{ value: "inherit", label: `Default · ${levelLabel(getToolLevel(profile, tool.key))}` }, { value: "none", label: "None" }, { value: "view", label: "View" }, { value: "edit", label: "Edit" }, { value: "manage", label: "Manage" }]} />
                          : <strong>{levelLabel(getToolLevel(profile, tool.key))}</strong>}
                      </div>)}</div>
                      {!effectiveAdminMode && !profileAccess.length ? <p className="muted">No tool access.</p> : null}
                    </section>
                    {(self || effectiveAdminMode) && <PersonEffectiveAccessPanel personId={profile.id} selfId={currentUser.id} />}
                  </div>;
                })()}

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

              </div>
            </>
          ) : selectedUserId && loadStatus.startsWith("Loading profile") ? (
            <InspectorLoadingState label="Loading person profile" compact />
          ) : (
            <ClusterEmptyState compact kind="empty" icon="user" title="Select a person" />
          )}
          <div className="people-load-status-v244" role="status" data-error={/fail|error|could not|unavailable/i.test(loadStatus) || undefined}>{loadStatus}</div>
        </main>}
      />
      </div>
    </section>
  );
}

