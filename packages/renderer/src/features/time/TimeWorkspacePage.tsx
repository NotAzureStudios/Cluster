import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterTextArea } from "../../components/ClusterTextArea";
import { ClusterButton, ClusterIconButton } from "../../components/ClusterButton";
import { ClusterModal } from "../../components/ClusterModal";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CLUSTER_PERSON_CHANGED_EVENT, CLUSTER_WORK_ASSIGNMENT_CHANGED_EVENT, type ClusterPersonSummary, type ClusterAssignmentChange } from "@cluster/shared";
import { api, ApiError, queryApi, setApiQueryData } from "../../core/api";
import { useVisibleTicker } from "../../core/visible-ticker";
import { ClusterSelect } from "../../components/ClusterSelect";
import { ClusterIcon } from "../../components/ClusterIcon";
import { ClusterVisualMeter, ClusterVisualRankedBars } from "../../components/ClusterVisualMetrics";

import { ClusterActionMenu } from "../../components/ClusterContextActions";
import { ToolPageHeader } from "../../components/ToolPageHeader";
import { LoadingState } from "../../components/LoadingState";
import { ClusterStatus } from "../../components/ClusterStatus";
import { requestSecurityPin, requestSecurityPinSetup } from "../../core/security-pin";
import "./time-workspace.css";
import { runtimeStyle } from "../../core/runtime-style";
import { useClusterDetailHistory } from "../../components/ClusterMasterDetail";
import { readClusterWorkProjectContext, recoverClusterDetailNavigation } from "../workflow/work-navigation";
import { LinkedWorkPanel } from "../workflow/LinkedWorkPanel";
import { WorkActionMenu } from "../workflow/WorkActionMenu";
import { subscribeClusterCohesionEvent } from "../../core/cohesion-events";
import { SchedulePlanningDialog, type PlanningAvailabilitySignal, type PlanningCalendarEvent, type PlanningConflict, type PlanningResource, type ProductionWindowDraft } from "./SchedulePlanningDialog";
import { mergeScheduleBlocks } from "./scheduler-workspace-state";
import { ProjectCollaborationStrip } from "../collaboration";

import { TimeOffDialog } from "./TimeOffDialog";
import {
  EMPTY_SUMMARY,
  addDays,
  clockLabel,
  dateTimeLabel,
  durationLabel,
  fromLocalInput,
  localDateKey,
  makeProductionWindowDraft,
  makeScheduleEditor,
  mondayStart,
  toLocalInput,
  type ScheduleBlock,
  type ScheduleEditor,
  type TimeBreak,
  type TimeEntry,
  type TimeProject,
  type TimeUser,
  type ViewMode,
  type WorkspacePayload,
} from "./time-workspace-model";

export default function TimeWorkspacePage({
  projects,
  currentUser,
}: {
  projects: TimeProject[];
  currentUser: TimeUser;
}) {
  const [view, setView] = useState<ViewMode>("week");
  const [week, setWeek] = useState(() => mondayStart(new Date()));
  const [projectId, setProjectId] = useState(() => readClusterWorkProjectContext() || "");
  const [workspace, setWorkspace] = useState<WorkspacePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [tick, setTick] = useState(Date.now());
  const [clockForm, setClockForm] = useState({
    title: "",
    projectId: "",
    category: "work",
    description: "",
    breakType: "unpaid",
  });
  const [breakDialogOpen, setBreakDialogOpen] = useState(false);
  const [breakNote, setBreakNote] = useState("");
  const [scheduleEditor, setScheduleEditor] = useState<ScheduleEditor | null>(
    null,
  );
  const [draggedBlockId, setDraggedBlockId] = useState<string | null>(null);
  const [selectedScheduleBlock, setSelectedScheduleBlock] = useState<ScheduleBlock | null>(null);
  const [planningEditor, setPlanningEditor] = useState<ProductionWindowDraft | null>(null);
  const [planningEdit, setPlanningEdit] = useState<{ blockId: string; scope: "single" | "future" } | null>(null);
  const [planningConflicts, setPlanningConflicts] = useState<PlanningConflict[]>([]);
  const [planningAvailabilitySignals, setPlanningAvailabilitySignals] = useState<PlanningAvailabilitySignal[]>([]);
  const [resourceDraft, setResourceDraft] = useState({ name: "", type: "room", location: "", quantityTotal: 1 });
  const workspaceRequestSequence = useRef(0);
  const revalidateTimerRef = useRef(0);

  const start = week.toISOString();
  const end = addDays(week, 7).toISOString();
  // Activity remains self-scoped. The manager-only Plan surface expands the same
  // Scheduler authority to the team so capacity/resource conflicts can be resolved.
  const queryUserId = workspace?.canManage && view === "plan" ? "" : currentUser.id;
  const workspacePath = useMemo(() => {
    const params = new URLSearchParams({ start, end });
    if (queryUserId) params.set("userId", queryUserId);
    if (projectId) params.set("projectId", projectId);
    return `/api/time/workspace?${params.toString()}`;
  }, [start, end, queryUserId, projectId]);

  function commitWorkspace(next: WorkspacePayload) {
    setWorkspace(next);
    setApiQueryData(workspacePath, next, { staleMs: 10_000, maxAgeMs: 2 * 60_000, tags: ["time", "scheduler", "workspace"] });
  }
  function updateWorkspace(updater: (current: WorkspacePayload) => WorkspacePayload) {
    setWorkspace((current) => {
      if (!current) return current;
      const next = updater(current);
      setApiQueryData(workspacePath, next, { staleMs: 10_000, maxAgeMs: 2 * 60_000, tags: ["time", "scheduler", "workspace"] });
      return next;
    });
  }
  function upsertTimeEntry(entry: TimeEntry, makeActive: boolean | null = null) {
    updateWorkspace((current) => {
      const entries = [...current.entries.filter((item) => item.id !== entry.id), entry].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
      const active = makeActive === true ? entry : makeActive === false && current.active?.id === entry.id ? null : current.active?.id === entry.id ? entry : current.active;
      return { ...current, entries, active };
    });
  }
  function patchActiveBreak(item: TimeBreak, running: boolean) {
    updateWorkspace((current) => {
      if (!current.active) return current;
      const breaks = [...(current.active.breaks || []).filter((entry) => entry.id !== item.id), item].sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
      const active = { ...current.active, breaks, activeBreak: running ? item : null };
      const entries = current.entries.map((entry) => entry.id === active.id ? active : entry);
      return { ...current, active, entries };
    });
  }
  function upsertScheduleBlocks(blocks: ScheduleBlock[]) {
    if (!blocks.length) return;
    updateWorkspace((current) => ({ ...current, scheduleBlocks: mergeScheduleBlocks(current.scheduleBlocks, blocks) }));
  }
  function scheduleWorkspaceRevalidation() {
    window.clearTimeout(revalidateTimerRef.current);
    revalidateTimerRef.current = window.setTimeout(() => { if (document.visibilityState === "visible") void loadWorkspace(false, true, true); }, 300);
  }

  async function loadWorkspace(showLoading = false, force = false, quiet = false) {
    const sequence = ++workspaceRequestSequence.current;
    if (!quiet && showLoading) setLoading(true);
    else if (!quiet && workspace) setRefreshing(true);
    try {
      const next = await queryApi<WorkspacePayload>(workspacePath, { staleMs: 10_000, maxAgeMs: 2 * 60_000, staleWhileRevalidate: true, force, tags: ["time", "scheduler", "workspace"] });
      if (sequence !== workspaceRequestSequence.current) return;
      commitWorkspace(next);
      if (!clockForm.projectId && projectId)
        setClockForm((value) => ({ ...value, projectId }));
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Scheduler failed to load.",
      );
    } finally {
      if (sequence === workspaceRequestSequence.current && !quiet) { setLoading(false); setRefreshing(false); }
    }
  }

  useEffect(() => {
    void loadWorkspace(true);
    return () => { workspaceRequestSequence.current += 1; window.clearTimeout(revalidateTimerRef.current); };
  }, [workspacePath]);
  useEffect(() => subscribeClusterCohesionEvent<ClusterAssignmentChange>(CLUSTER_WORK_ASSIGNMENT_CHANGED_EVENT, (change) => { if (change.resource.kind === "scheduler" && document.visibilityState === "visible") scheduleWorkspaceRevalidation(); }), [currentUser.id, workspacePath]);
  useEffect(() => subscribeClusterCohesionEvent<Partial<ClusterPersonSummary>>(CLUSTER_PERSON_CHANGED_EVENT, () => { if (document.visibilityState === "visible") scheduleWorkspaceRevalidation(); }), [currentUser.id, workspacePath]);

  const restoreScheduleBlockDetail = useCallback((id: string | null) => {
    if (!id) { setSelectedScheduleBlock(null); return; }
    const local = workspace?.scheduleBlocks.find((block) => block.id === id);
    if (local) {
      setSelectedScheduleBlock(local);
      setView("schedule");
      return;
    }
    void api<ScheduleBlock>(`/api/schedule/blocks/${encodeURIComponent(id)}`)
      .then((block) => {
        setSelectedScheduleBlock(block);
        setView("schedule");
        setWeek(mondayStart(new Date(block.startsAt)));
        setProjectId(block.projectId || "");
      })
      .catch(() => {
        setSelectedScheduleBlock(null);
        recoverClusterDetailNavigation("schedule-block", {
          title: "Schedule block unavailable",
          message: "That block may have been deleted, moved, archived with its project, or your Scheduler access may have changed. Scheduler stayed open.",
          tone: "warning",
        });
      });
  }, [workspace?.scheduleBlocks]);
  const scheduleBlockDetailHistory = useClusterDetailHistory("schedule-block", selectedScheduleBlock?.id || null, restoreScheduleBlockDetail);

  useEffect(() => { if (!workspace?.active) setTick(Date.now()); }, [workspace?.active?.id]);
  useVisibleTicker(() => setTick(Date.now()), 1_000, Boolean(workspace?.active));

  const summary = workspace?.summary || EMPTY_SUMMARY;
  const active = workspace?.active || null;
  const days = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(week, index)),
    [start],
  );
  const completedBreakMinutes =
    active?.breaks
      ?.filter((item) => Boolean(item.endedAt) && item.type !== "paid")
      .reduce(
        (sum, item) =>
          sum + (item.durationMinutes ?? item.computedDurationMinutes ?? 0),
        0,
      ) || 0;
  const runningBreakMinutes =
    active?.activeBreak && active.activeBreak.type !== "paid"
      ? Math.max(
          0,
          Math.round(
            (tick - new Date(active.activeBreak.startedAt).getTime()) / 60_000,
          ),
        )
      : 0;
  const activeMinutes = active
    ? Math.max(
        0,
        Math.round((tick - new Date(active.startedAt).getTime()) / 60_000) -
          completedBreakMinutes -
          runningBreakMinutes,
      )
    : 0;

  const entriesByDay = useMemo(() => {
    const map = new Map<string, TimeEntry[]>();
    for (const day of days) map.set(localDateKey(day), []);
    for (const entry of workspace?.entries || []) {
      const key = localDateKey(entry.startedAt);
      if (map.has(key)) map.get(key)?.push(entry);
    }
    for (const values of map.values())
      values.sort(
        (a, b) =>
          new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime(),
      );
    return map;
  }, [workspace?.entries, start]);

  const blocksByDay = useMemo(() => {
    const map = new Map<string, ScheduleBlock[]>();
    for (const day of days) map.set(localDateKey(day), []);
    for (const block of workspace?.scheduleBlocks || []) {
      const key = localDateKey(block.startsAt);
      if (map.has(key)) map.get(key)?.push(block);
    }
    return map;
  }, [workspace?.scheduleBlocks, start]);

  async function runAction(action: () => Promise<void>, revalidate = true) {
    setBusy(true);
    setStatus("");
    try {
      await action();
      if (revalidate) scheduleWorkspaceRevalidation();
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Scheduler action failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function startClock(switching = false) {
    if (!clockForm.title.trim()) {
      setStatus("Add a work description before starting the timer.");
      return;
    }
    const pin = currentUser.pinConfigured
      ? await requestSecurityPin({
          title: switching ? "Switch work item" : "Clock in",
          description: "Enter your security PIN.",
          purpose: switching ? "switch_work" : "clock_in",
          confirmLabel: switching ? "Switch work" : "Clock in",
        })
      : await requestSecurityPinSetup({
          title: "Create security PIN",
          description: "Create a PIN before using the clock.",
          purpose: switching ? "setup_for_switch_work" : "setup_for_clock_in",
        });
    if (!pin) return;
    await runAction(async () => {
      const path = switching ? "/api/time/switch" : "/api/time/start";
      const result = await api<TimeEntry | { stopped: TimeEntry | null; started: TimeEntry }>(path, {
        method: "POST",
        body: JSON.stringify({
          title: clockForm.title.trim(),
          description: clockForm.description.trim() || null,
          projectId: clockForm.projectId || null,
          category: clockForm.category,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          pin,
        }),
      });
      if (switching && "started" in result) { if (result.stopped) upsertTimeEntry(result.stopped, false); upsertTimeEntry(result.started, true); }
      else if (!("started" in result)) upsertTimeEntry(result, true);
      setStatus(
        switching ? "Timer switched to the new work item." : "Clocked in.",
      );
      setClockForm((value) => ({ ...value, title: "", description: "" }));
    });
  }

  async function stopClock() {
    const pin = currentUser.pinConfigured
      ? await requestSecurityPin({
          title: "Clock out",
          description: "Enter your security PIN.",
          purpose: "clock_out",
          confirmLabel: "Clock out",
        })
      : await requestSecurityPinSetup({
          title: "Create security PIN",
          description: "Create a PIN before using the clock.",
          purpose: "setup_for_clock_out",
        });
    if (!pin) return;
    await runAction(async () => {
      const stopped = await api<TimeEntry>("/api/time/stop", {
        method: "POST",
        body: JSON.stringify({ pin }),
      });
      upsertTimeEntry(stopped, false);
      setStatus("Clocked out and saved.");
    });
  }

  async function toggleBreak() {
    if (!active?.activeBreak) {
      setBreakDialogOpen(true);
      return;
    }
    const pin = currentUser.pinConfigured
      ? await requestSecurityPin({
          title: "End break",
          description: "Enter your security PIN.",
          purpose: "end_break",
          confirmLabel: "End break",
        })
      : await requestSecurityPinSetup({
          title: "Create security PIN",
          description: "Create a PIN before ending a break.",
          purpose: "setup_for_end_break",
        });
    if (!pin) return;
    await runAction(async () => {
      const ended = await api<TimeBreak>("/api/time/breaks/stop", {
        method: "POST",
        body: JSON.stringify({ entryId: active?.id, pin }),
      });
      patchActiveBreak(ended, false);
      setStatus("Break ended.");
    });
  }

  async function startBreak() {
    const pin = currentUser.pinConfigured
      ? await requestSecurityPin({
          title: "Start break",
          description: "Enter your security PIN.",
          purpose: "start_break",
          confirmLabel: "Start break",
        })
      : await requestSecurityPinSetup({
          title: "Create security PIN",
          description: "Create a PIN before starting a break.",
          purpose: "setup_for_start_break",
        });
    if (!pin) return;
    await runAction(async () => {
      const started = await api<TimeBreak>("/api/time/breaks/start", {
        method: "POST",
        body: JSON.stringify({
          entryId: active?.id,
          type: clockForm.breakType,
          note: breakNote.trim() || null,
          pin,
        }),
      });
      patchActiveBreak(started, true);
      setBreakDialogOpen(false);
      setBreakNote("");
      setStatus("Break started.");
    });
  }

  function requestTimeOff(day = new Date()) {
    const draft = makeScheduleEditor(day);
    setScheduleEditor(draft);
  }

  async function saveSchedule() {
    if (!scheduleEditor) return;
    await runAction(async () => {
      const result = await api<ScheduleBlock | { pendingApproval?: boolean; blocks?: ScheduleBlock[] }>("/api/schedule/blocks", {
        method: "POST",
        body: JSON.stringify({
          userId: currentUser.id,
          title: scheduleEditor.title.trim(),
          description: scheduleEditor.description.trim() || null,
          projectId: null,
          type: "time-off",
          startsAt: fromLocalInput(scheduleEditor.startsAt),
          endsAt: fromLocalInput(scheduleEditor.endsAt),
          color: scheduleEditor.color,
        }),
      });
      if ("id" in result) upsertScheduleBlocks([result]);
      else if (Array.isArray(result.blocks)) upsertScheduleBlocks(result.blocks);
      setScheduleEditor(null);
      setStatus(
        !("id" in result) && result.pendingApproval
          ? "Time-off request sent to Administration."
          : "Time-off request submitted.",
      );
    });
  }

  function openProductionPlanner(day = new Date(), event?: PlanningCalendarEvent) {
    const draft = makeProductionWindowDraft(day, currentUser.id, event?.projectId || projectId, workspace?.permissions?.calendarMirrorDefault === true);
    if (event) {
      const start = new Date(event.startsAt);
      const end = event.endsAt ? new Date(event.endsAt) : new Date(start.getTime() + 60 * 60 * 1000);
      draft.title = event.title;
      draft.projectId = event.projectId || "";
      draft.startsAt = toLocalInput(start);
      draft.endsAt = toLocalInput(end);
      draft.calendarEventId = event.id;
      draft.calendarMirror = true;
      draft.windowKind = ["shoot", "review", "release", "delivery", "maintenance"].includes(event.eventType) ? event.eventType : "standard";
      const knownLead = (workspace?.users || []).some((user) => user.id === event.ownerId) ? String(event.ownerId) : currentUser.id;
      draft.userId = knownLead;
      draft.participantIds = (event.attendeeIds || []).filter((id) => id !== knownLead && (workspace?.users || []).some((user) => user.id === id));
    }
    setPlanningEdit(null);
    setPlanningConflicts([]);
    setPlanningAvailabilitySignals([]);
    setPlanningEditor(draft);
  }

  function editProductionWindow(block: ScheduleBlock, scope: "single" | "future" = "single") {
    const draft: ProductionWindowDraft = {
      title: block.title, description: block.description || "", userId: block.userId || currentUser.id, projectId: block.projectId || "",
      startsAt: toLocalInput(block.startsAt), endsAt: toLocalInput(block.endsAt), type: block.type, windowKind: block.windowKind || "standard", status: block.status || "confirmed",
      participantIds: block.participantIds || [], resources: (block.resources || []).map((item) => ({ resourceId: item.resourceId, quantity: item.quantity })),
      calendarMirror: Boolean(block.calendarEventId || block.calendarSync), calendarEventId: block.calendarEventId || null, color: block.color || "#4f8df7",
      timezone: block.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", recurrenceFrequency: "", recurrenceOccurrences: 2, expectedRevision: block.revision || 1,
    };
    setPlanningEdit({ blockId: block.id, scope });
    setPlanningConflicts([]);
    setPlanningAvailabilitySignals([]);
    setPlanningEditor(draft);
  }

  function planningRequestBody(allowConflicts = false) {
    if (!planningEditor) return null;
    return {
      userId: planningEditor.userId,
      projectId: planningEditor.projectId || null,
      title: planningEditor.title.trim(),
      description: planningEditor.description.trim() || null,
      startsAt: fromLocalInput(planningEditor.startsAt),
      endsAt: fromLocalInput(planningEditor.endsAt),
      type: planningEditor.type,
      windowKind: planningEditor.windowKind,
      status: planningEditor.status,
      participantIds: planningEditor.participantIds,
      resources: planningEditor.resources,
      calendarMirror: planningEditor.calendarMirror,
      calendarEventId: planningEditor.calendarMirror ? (planningEditor.calendarEventId || null) : null,
      color: planningEditor.color || null,
      timezone: planningEditor.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
      ...(planningEditor.recurrenceFrequency && !planningEdit ? { recurrence: { frequency: planningEditor.recurrenceFrequency, occurrences: planningEditor.recurrenceOccurrences } } : {}),
      ...(planningEdit ? { expectedRevision: planningEditor.expectedRevision } : {}),
      allowConflicts,
    };
  }

  async function checkProductionAvailability() {
    if (!planningEditor) return;
    setBusy(true);
    setStatus("");
    try {
      const result = await api<{ conflicts: PlanningConflict[]; availabilitySignals?: PlanningAvailabilitySignal[] }>("/api/schedule/availability", {
        method: "POST",
        body: JSON.stringify({
          startsAt: fromLocalInput(planningEditor.startsAt),
          endsAt: fromLocalInput(planningEditor.endsAt),
          userIds: [planningEditor.userId, ...planningEditor.participantIds],
          resources: planningEditor.resources,
        }),
      });
      setPlanningConflicts(result.conflicts || []);
      setPlanningAvailabilitySignals(result.availabilitySignals || []);
      setStatus(result.conflicts?.some((conflict) => conflict.blockId === "calendar-virtual:incomplete") ? "Recurring Calendar availability could not be fully verified. This placement is blocked; shorten the window or review the recurrence workload." : result.conflicts?.length ? "Scheduling conflicts found." : result.availabilitySignals?.length ? `Crew and resources are available · ${result.availabilitySignals.length} preferred availability match${result.availabilitySignals.length === 1 ? "" : "es"}.` : "Crew and resources are available for this window.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Availability check failed.");
    } finally {
      setBusy(false);
    }
  }

  async function saveProductionWindow(allowConflicts = false) {
    const payload = planningRequestBody(allowConflicts);
    if (!payload || !payload.title) return;
    setBusy(true);
    setStatus("");
    try {
      const endpoint = planningEdit ? `/api/schedule/blocks/${encodeURIComponent(planningEdit.blockId)}?scope=${planningEdit.scope}` : "/api/schedule/blocks";
      const result = await api<ScheduleBlock | { blocks?: ScheduleBlock[] }>(endpoint, { method: planningEdit ? "PUT" : "POST", body: JSON.stringify(payload) });
      if ("id" in result) upsertScheduleBlocks([result]);
      else if (Array.isArray(result.blocks)) upsertScheduleBlocks(result.blocks);
      setPlanningEditor(null);
      setPlanningEdit(null);
      setPlanningConflicts([]);
      setPlanningAvailabilitySignals([]);
      setStatus(planningEdit?.scope === "future" ? "This and future recurring windows were updated." : planningEdit ? "Production window updated." : payload.calendarEventId ? "Calendar event placed on the production schedule." : "Production window planned.");
      scheduleWorkspaceRevalidation();
    } catch (error) {
      if (error instanceof ApiError && error.code === "CALENDAR_AVAILABILITY_INCOMPLETE") {
        setPlanningConflicts([{ kind: "resource", severity: "high", blockId: "calendar-virtual:incomplete",
          title: "Availability not verified", message: "Recurring Calendar reservations could not be completely inspected. The server did not save this placement.",
          startsAt: payload.startsAt, endsAt: payload.endsAt }]);
        setStatus("Scheduling could not be verified. This placement was not saved. Narrow the window or review recurrence load.");
      } else if (error instanceof ApiError && error.code === "SCHEDULER_CONFLICT") {
        const details = error.payload && typeof error.payload === "object" ? error.payload as { conflicts?: PlanningConflict[] } : null;
        setPlanningConflicts(details?.conflicts || []);
        setStatus("Scheduling conflicts found. Review them before overriding.");
      } else {
        setStatus(error instanceof Error ? error.message : "Production window could not be planned.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function reconcileScheduleCalendar(block: ScheduleBlock, action: "repair" | "unlink") {
    await runAction(async () => {
      const result = await api<{ block?: ScheduleBlock | null }>(`/api/schedule/blocks/${encodeURIComponent(block.id)}/calendar/reconcile`, { method: "POST", body: JSON.stringify({ action }) });
      if (result.block) { setSelectedScheduleBlock(result.block); upsertScheduleBlocks([result.block]); }
      setStatus(action === "unlink" ? "Calendar link removed from the production window." : "Calendar mirror reconciled.");
    });
  }

  async function createScheduleResource() {
    if (!resourceDraft.name.trim()) return;
    await runAction(async () => {
      await api("/api/schedule/resources", {
        method: "POST",
        body: JSON.stringify({ name: resourceDraft.name.trim(), type: resourceDraft.type, location: resourceDraft.location.trim() || null, quantityTotal: resourceDraft.quantityTotal, status: "active", tags: [], projectTypeIds: [] }),
      });
      setResourceDraft({ name: "", type: "room", location: "", quantityTotal: 1 });
      setStatus("Scheduler resource added.");
    });
  }

  async function setScheduleResourceStatus(resource: PlanningResource, statusValue: "active" | "maintenance") {
    await runAction(async () => {
      await api(`/api/schedule/resources/${encodeURIComponent(resource.id)}`, {
        method: "PUT",
        body: JSON.stringify({ name: resource.name, type: resource.type, description: resource.description || null, location: resource.location || null, quantityTotal: resource.quantityTotal, status: statusValue, tags: resource.tags || [], projectTypeIds: resource.projectTypeIds || [], color: resource.color || null, expectedRevision: resource.revision }),
      });
      setStatus(`${resource.name} marked ${statusValue}.`);
    });
  }

  async function moveScheduleBlock(block: ScheduleBlock, day: Date) {
    if (!workspace?.canManage) return;
    const startsAt = new Date(block.startsAt);
    const endsAt = new Date(block.endsAt);
    const duration = endsAt.getTime() - startsAt.getTime();
    const nextStart = new Date(day);
    nextStart.setHours(startsAt.getHours(), startsAt.getMinutes(), 0, 0);
    const nextEnd = new Date(nextStart.getTime() + duration);
    await runAction(async () => {
      const moved = await api<ScheduleBlock>(`/api/schedule/blocks/${block.id}`, {
        method: "PUT",
        body: JSON.stringify({
          userId: block.userId || currentUser.id,
          projectId: block.projectId || null,
          title: block.title,
          description: block.description || null,
          startsAt: nextStart.toISOString(),
          endsAt: nextEnd.toISOString(),
          type: block.type,
          windowKind: block.windowKind || "standard",
          status: block.status || "confirmed",
          participantIds: block.participantIds || [],
          resources: (block.resources || []).map((item) => ({ resourceId: item.resourceId, quantity: item.quantity })),
          calendarMirror: Boolean(block.calendarSync),
          calendarEventId: block.calendarEventId || null,
          expectedRevision: block.revision,
          color: block.color || null,
        }),
      });
      upsertScheduleBlocks([moved]);
      setStatus(`Moved ${block.title} to ${day.toLocaleDateString([], { weekday: "long" })}.`);
    });
  }

  return (
    <section className="page cluster-page-shell cluster-tool-page-v228 time-workspace-v212">
      <ToolPageHeader
        className="cluster-page-header"
        title="Scheduler"
        metrics={[
          { label: "Tracked", value: durationLabel(summary.trackedMinutes) },
          {
            label: "Scheduled",
            value: durationLabel(summary.scheduledMinutes),
          },
          {
            label: "Conflicts",
            value: String(workspace?.planning?.conflicts.length || 0),
          },
        ]}
        context={
          <ClusterButton unstyled type="button"
            className="time-week-label-v212"
            onClick={() => setWeek(mondayStart(new Date()))}
          >
            <strong>
              {week.toLocaleDateString([], { month: "short", day: "numeric" })}{" "}
              –{" "}
              {addDays(week, 6).toLocaleDateString([], {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </strong>
          </ClusterButton>
        }
        actions={
          <>
            <ClusterIconButton label="Previous week" size="compact" onClick={() => setWeek(addDays(week, -7))}><ClusterIcon name="chevron-left" /></ClusterIconButton>
            <ClusterIconButton label="Next week" size="compact" onClick={() => setWeek(addDays(week, 7))}><ClusterIcon name="chevron-right" /></ClusterIconButton>
            <ClusterActionMenu iconOnly label="More scheduler actions" items={[{ id: "refresh", label: "Refresh scheduler", icon: "refresh", disabled: loading, onSelect: () => loadWorkspace(false, true) }]} />
          </>
        }
      />
      {projectId ? <ProjectCollaborationStrip tool="scheduler" projectId={projectId} activity={`Scheduler · ${view}`} /> : null}

      <section
        className={`time-clock-dock-v212 ${active ? "is-active" : ""} ${active?.activeBreak ? "is-break" : ""}`}
      >
        <div className="time-clock-state-v212">
          <span>
            {active?.activeBreak
              ? "On break"
              : active
                ? "Clocked in"
                : "Clocked out"}
          </span>
          <strong>{active ? durationLabel(activeMinutes) : "Ready"}</strong>
          {active && <p>{active.title}{active.project?.name ? ` · ${active.project.name}` : ""}</p>}
          {active && (
            <small>
              Started {clockLabel(active.startedAt)} ·{" "}
              {durationLabel(active.breakMinutes || 0)} break
            </small>
          )}
        </div>
        <div className="time-clock-composer-v212">
          <label className="time-clock-title-v212">
            <span>{active ? "Next work item" : "Work item"}</span>
            <ClusterTextInput
              value={clockForm.title}
              onChange={(event) =>
                setClockForm({ ...clockForm, title: event.target.value })
              }
              placeholder={
                active
                  ? "Describe what you are switching to"
                  : "Describe what you are working on"
              }
            />
          </label>
          <label>
            <span>Project</span>
            <ClusterSelect
              ariaLabel="Clock project"
              value={clockForm.projectId}
              onChange={(projectId) =>
                setClockForm({ ...clockForm, projectId })
              }
              options={[
                { value: "", label: "Studio / unassigned" },
                ...projects
                  .filter((project) => !project.archived)
                  .map((project) => ({
                    value: project.id,
                    label: project.name,
                  })),
              ]}
            />
          </label>
          <label>
            <span>Category</span>
            <ClusterSelect
              ariaLabel="Clock category"
              value={clockForm.category}
              onChange={(category) => setClockForm({ ...clockForm, category })}
              options={[
                { value: "work", label: "Work" },
                { value: "meeting", label: "Meeting" },
                { value: "admin", label: "Administration" },
                { value: "research", label: "Research" },
                { value: "support", label: "Support" },
                { value: "other", label: "Other" },
              ]}
            />
          </label>
        </div>
        <div className="time-clock-actions-v212">
          {active ? (
            <>
              <ClusterButton type="button"
                className=""
                onClick={toggleBreak}
                disabled={busy}
               variant="secondary">
                {active.activeBreak ? "End break" : "Take break"}
              </ClusterButton>
              <ClusterButton type="button"
                className=""
                onClick={() => startClock(true)}
                disabled={busy || !clockForm.title.trim()}
               variant="secondary">
                Switch task
              </ClusterButton>
              <ClusterButton type="button"
                className=""
                onClick={stopClock}
                disabled={busy}
               variant="danger">
                Clock out
              </ClusterButton>
            </>
          ) : (
            <ClusterButton type="button"
              className="time-clock-primary-v212"
              onClick={() => startClock(false)}
              disabled={busy || !clockForm.title.trim()}
             variant="primary">
              Clock in
            </ClusterButton>
          )}
        </div>
      </section>

      <nav
        className="time-view-tabs-unified-v229"
        aria-label="Scheduler sections"
      >
        <div className="time-view-tab-list-v229">
          <ClusterButton unstyled type="button"
            className={view === "week" ? "active" : ""}
            onClick={() => setView("week")}
          >
            <strong>Activity</strong>
            <span>{summary.entryCount} entries</span>
          </ClusterButton>
          <ClusterButton unstyled type="button"
            className={view === "schedule" ? "active" : ""}
            onClick={() => setView("schedule")}
          >
            <strong>Schedule</strong>
            <span>{workspace?.scheduleBlocks.length || 0} blocks</span>
          </ClusterButton>
          {workspace?.canManage && <ClusterButton unstyled type="button"
            className={view === "plan" ? "active" : ""}
            onClick={() => setView("plan")}
          >
            <strong>Plan</strong>
            <span>{workspace?.planning?.resources.length || 0} resources</span>
          </ClusterButton>}
        </div>
        <div className="time-view-toolbar-v229">
          <ClusterSelect
            className="time-view-project-v229"
            ariaLabel="Project filter"
            value={projectId}
            onChange={setProjectId}
            options={[
              { value: "", label: "All projects" },
              ...projects.map((project) => ({
                value: project.id,
                label: project.name,
              })),
            ]}
          />
          {view === "schedule" && (
            <ClusterButton type="button"
              className=""
              onClick={() => requestTimeOff(week)}
             variant="primary">
              Request time off
            </ClusterButton>
          )}
          {view === "plan" && workspace?.canManage && (
            <ClusterButton type="button" className="" onClick={() => openProductionPlanner(week)} variant="primary">
              Plan production
            </ClusterButton>
          )}
        </div>
      </nav>

      {refreshing ? <ClusterStatus state="loading" compact>Refreshing scheduler</ClusterStatus> : null}
      {status && (
        <div className="time-message-v212" role="status">
          <span>{status}</span>
          <ClusterButton unstyled type="button" onClick={() => setStatus("")} aria-label="Dismiss message">
            <ClusterIcon name="close" />
          </ClusterButton>
        </div>
      )}
      {loading && <LoadingState label="Loading Scheduler" rows={6} compact className="time-loading-v212" />}

      {!loading && view === "week" && (
        <div className="time-week-layout-v212">
          <main className="time-day-ledger-v212">
            {days.map((day) => {
              const key = localDateKey(day);
              const dayEntries = entriesByDay.get(key) || [];
              const dayBlocks = blocksByDay.get(key) || [];
              const tracked = dayEntries.reduce(
                (sum, entry) => sum + entry.computedDurationMinutes,
                0,
              );
              const scheduled = dayBlocks
                .filter(
                  (block) => !["time-off", "unavailable"].includes(block.type),
                )
                .reduce((sum, block) => sum + (block.durationMinutes || 0), 0);
              const isToday = key === localDateKey(new Date());
              return (
                <section
                  className={`time-day-card-v212 ${isToday ? "is-today" : ""}`}
                  key={key}
                >
                  <header>
                    <div>
                      <span>
                        {day.toLocaleDateString([], { weekday: "long" })}
                      </span>
                      <strong>
                        {day.toLocaleDateString([], {
                          month: "short",
                          day: "numeric",
                        })}
                      </strong>
                    </div>
                    <div className="time-day-totals-v212">
                      <span>{durationLabel(tracked)} tracked</span>
                      {scheduled > 0 && (
                        <span>{durationLabel(scheduled)} planned</span>
                      )}
                    </div>
                  </header>
                  <div className="time-day-entries-v212">
                    {dayEntries.map((entry) => (
                      <article
                        className={`time-ledger-row-v212 ${entry.running ? "is-running" : ""}`}
                        key={entry.id}
                      >
                        <div className="time-ledger-time-v212">
                          <strong>{clockLabel(entry.startedAt)}</strong>
                          <span>
                            {entry.endedAt
                              ? clockLabel(entry.endedAt)
                              : "Running"}
                          </span>
                        </div>
                        <div className="time-ledger-main-v212">
                          <strong>{entry.title}</strong>
                          <span>
                            {entry.project?.name || "Studio / unassigned"} ·{" "}
                            {entry.category || "work"}
                          </span>
                          {entry.description && (
                            <small>{entry.description}</small>
                          )}
                        </div>
                        <div className="time-ledger-duration-v212">
                          <strong>
                            {durationLabel(entry.computedDurationMinutes)}
                          </strong>
                          {Boolean(entry.breakMinutes) && (
                            <span>
                              {durationLabel(entry.breakMinutes || 0)} break
                            </span>
                          )}
                        </div>
                      </article>
                    ))}
                    {!dayEntries.length && (
                      <div className="time-day-empty-v212">
                        <span>No time tracked</span>
                        <p>
                          {dayBlocks.length
                            ? `${dayBlocks.length} scheduled block${dayBlocks.length === 1 ? "" : "s"}`
                            : "No scheduled work"}
                        </p>
                      </div>
                    )}
                  </div>
                </section>
              );
            })}
          </main>

          <aside className="time-week-sidebar-v212">
            <section className="time-summary-card-v212">
              <header>
                <span className="time-kicker-v212">Week</span>
                <strong>{durationLabel(summary.trackedMinutes)}</strong>
              </header>
              <ClusterVisualMeter label="Tracked / capacity" value={summary.trackedMinutes} total={summary.capacityMinutes} formatValue={durationLabel} tone={summary.overtimeMinutes > 0 ? "warning" : "accent"} />
              <ClusterVisualMeter label="Scheduled / capacity" value={summary.scheduledMinutes} total={summary.capacityMinutes} formatValue={durationLabel} tone="neutral" compact />
              <dl>
                <div>
                  <dt>Breaks</dt>
                  <dd>{durationLabel(summary.breakMinutes)}</dd>
                </div>
                <div>
                  <dt>Remaining</dt>
                  <dd>{durationLabel(summary.remainingCapacityMinutes)}</dd>
                </div>
                {summary.overtimeMinutes > 0 && (
                  <div className="warning">
                    <dt>Overtime</dt>
                    <dd>{durationLabel(summary.overtimeMinutes)}</dd>
                  </div>
                )}
              </dl>
            </section>

            <section className="time-summary-card-v212">
              <header>
                <span className="time-kicker-v212">Exceptions</span>
                <strong>{workspace?.exceptions.length || 0}</strong>
              </header>
              <div className="time-exception-list-v212">
                {(workspace?.exceptions || [])
                  .slice(0, 8)
                  .map((exception, index) => (
                    <div
                      className={exception.severity}
                      key={`${exception.code}-${exception.entryId || index}`}
                    >
                      <span>{exception.code.replace(/_/g, " ")}</span>
                      <p>{exception.message}</p>
                    </div>
                  ))}
                {!workspace?.exceptions.length && (
                  <p className="time-clear-state-v212">No issues detected.</p>
                )}
              </div>
            </section>

            <section className="time-summary-card-v212 time-planning-card-v418">
              <header>
                <span className="time-kicker-v212">Planning health</span>
                <strong>{workspace?.planning?.conflicts.length || 0}</strong>
              </header>
              <div className="time-exception-list-v212">
                {(workspace?.planning?.conflicts || []).slice(0, 5).map((conflict) => (
                  <div className={conflict.severity === "high" ? "high" : "medium"} key={conflict.id}>
                    <span>{conflict.severity === "high" ? "Availability conflict" : "Schedule overlap"}</span>
                    <p>{conflict.message}</p>
                  </div>
                ))}
                {!workspace?.planning?.conflicts.length && <p className="time-clear-state-v212">No schedule conflicts.</p>}
              </div>
            </section>

            <section className="time-summary-card-v212 time-milestones-card-v418">
              <header>
                <span className="time-kicker-v212">Milestones</span>
                <strong>{workspace?.planning?.milestones.length || 0}</strong>
              </header>
              <div className="time-allocation-list-v212">
                {(workspace?.planning?.milestones || []).slice(0, 6).map((milestone) => (
                  <div key={milestone.projectId}>
                    <span>{milestone.projectName}</span>
                    <strong>{new Date(milestone.targetDate).toLocaleDateString([], { month: "short", day: "numeric" })}</strong>
                  </div>
                ))}
                {!workspace?.planning?.milestones.length && <p className="time-clear-state-v212">No nearby project milestones.</p>}
              </div>
            </section>

            <section className="time-summary-card-v212">
              <header>
                <span className="time-kicker-v212">Project allocation</span>
                <strong>{summary.byProject.length}</strong>
              </header>
              <ClusterVisualRankedBars label="Logged time by project" rows={summary.byProject.slice(0, 8).map((item) => ({ id: item.id, label: item.name, value: item.minutes }))} formatValue={durationLabel} />
            </section>
          </aside>
        </div>
      )}

      {!loading && view === "schedule" && (
        <>
          <section className="time-capacity-strip-v418" aria-label="Schedule capacity">
            {(workspace?.planning?.capacity || []).slice(0, workspace?.canManage ? 8 : 1).map((person) => (
              <article key={person.userId} className={person.loadPercent > 100 ? "is-over" : person.loadPercent > 85 ? "is-tight" : ""}>
                <div><strong>{person.name}</strong><span>{durationLabel(person.plannedMinutes)} planned · {durationLabel(person.unavailableMinutes)} unavailable</span></div>
                <b>{person.loadPercent}%</b>
              </article>
            ))}
          </section>
          {workspace?.canManage && <p className="time-drag-hint-v418">Drag a schedule block to another day to reschedule it. Conflicts are recalculated after every move.</p>}
          <div className="time-schedule-board-v212">
          {days.map((day) => {
            const key = localDateKey(day);
            const blocks = blocksByDay.get(key) || [];
            return (
              <section
                className={`time-schedule-day-v212 ${draggedBlockId ? "is-drop-ready" : ""}`}
                key={key}
                onDragOver={(event) => { if (workspace?.canManage) event.preventDefault(); }}
                onDrop={(event) => {
                  event.preventDefault();
                  const block = (workspace?.scheduleBlocks || []).find((item) => item.id === draggedBlockId);
                  setDraggedBlockId(null);
                  if (block) void moveScheduleBlock(block, day);
                }}
              >
                <header>
                  <div>
                    <strong>
                      {day.toLocaleDateString([], { weekday: "short" })}
                    </strong>
                    <span>
                      {day.toLocaleDateString([], {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  </div>
                  <ClusterButton unstyled type="button"
                    className="time-icon-button-v212"
                    onClick={() => workspace?.canManage ? openProductionPlanner(day) : requestTimeOff(day)}
                    aria-label={`${workspace?.canManage ? "Plan production" : "Request time off"} for ${day.toLocaleDateString()}`}
                  >
                    <ClusterIcon name="plus" />
                  </ClusterButton>
                </header>
                <div>
                  {blocks.map((block) => (
                    <ClusterButton unstyled
                      type="button"
                      className={`time-schedule-block-v212 type-${block.type} window-${block.windowKind || "standard"} status-${block.status || "confirmed"} ${workspace?.canManage ? "is-draggable" : ""}`}
                      key={block.id}
                      style={runtimeStyle({ borderLeftColor: block.color || undefined })}
                      draggable={Boolean(workspace?.canManage)}
                      onDragStart={() => setDraggedBlockId(block.id)}
                      onDragEnd={() => setDraggedBlockId(null)}
                      onClick={() => scheduleBlockDetailHistory.openDetail(block.id)}
                      title={workspace?.canManage ? "Open details; drag to another day to reschedule" : "Open schedule details"}
                    >
                      <span>
                        {clockLabel(block.startsAt)} –{" "}
                        {clockLabel(block.endsAt)}
                      </span>
                      <strong>{block.title}</strong>
                      <span className="time-schedule-block-meta-v493">
                        {block.project?.name || block.type.replace("-", " ")} · {(block.windowKind || "standard").replace(/-/g, " ")}{block.participantIds?.length ? ` · ${block.participantIds.length + 1} crew` : ""}{block.resources?.length ? ` · ${block.resources.length} resource${block.resources.length === 1 ? "" : "s"}` : ""}{block.calendarEvent ? " · calendar" : ""}
                      </span>
                    </ClusterButton>
                  ))}
                  {!blocks.length && (
                    <ClusterButton unstyled type="button"
                      className="time-schedule-empty-v212"
                      onClick={() => workspace?.canManage ? openProductionPlanner(day) : requestTimeOff(day)}
                    >
                      {workspace?.canManage ? "Plan production" : "Request time off"}
                    </ClusterButton>
                  )}
                </div>
              </section>
            );
          })}
          </div>
        </>
      )}
      {!loading && view === "plan" && workspace?.canManage && (
        <div className="time-planning-workspace-v496">
          <section className="time-planning-overview-v496">
            <header><div><span className="time-kicker-v212">Crew capacity</span><h2>Production load</h2></div><span>{workspace.planning?.capacity.length || 0} people</span></header>
            <div className="time-planning-capacity-grid-v496">
              {(workspace.planning?.capacity || []).map((person) => <article key={person.userId} className={person.loadPercent > 100 ? "is-over" : person.loadPercent > 85 ? "is-tight" : ""}>
                <div><strong>{person.name}</strong><span>{durationLabel(person.plannedMinutes)} planned · {durationLabel(person.capacityMinutes)} capacity</span></div>
                <b>{person.loadPercent}%</b>
              </article>)}
            </div>
          </section>

          <div className="time-planning-dashboard-v496">
            <section className="time-planning-panel-v496">
              <header><div><span className="time-kicker-v212">Conflicts</span><h3>Needs attention</h3></div><strong>{workspace.planning?.conflicts.length || 0}</strong></header>
              <div className="time-planning-alert-list-v496">
                {(workspace.planning?.conflicts || []).slice(0, 12).map((conflict) => <article key={conflict.id} className={conflict.severity}>
                  <strong>{conflict.kind === "resource" ? "Resource capacity" : "Crew overlap"}</strong><span>{conflict.message}</span>
                </article>)}
                {!workspace.planning?.conflicts.length && <p className="time-clear-state-v212">No crew or resource conflicts in this range.</p>}
              </div>
            </section>

            <section className="time-planning-panel-v496">
              <header><div><span className="time-kicker-v212">Project windows</span><h3>Calendar placement</h3></div><strong>{(workspace.planning?.calendarEvents || []).filter((event) => !event.scheduled).length}</strong></header>
              <div className="time-planning-event-list-v496">
                {(workspace.planning?.calendarEvents || []).filter((event) => !event.scheduled).slice(0, 12).map((event) => <article key={event.id}>
                  <div><strong>{event.title}</strong><span>{dateTimeLabel(event.startsAt)}{event.projectId ? ` · project event` : ""}</span></div>
                  <ClusterButton type="button" className="" onClick={() => openProductionPlanner(new Date(event.startsAt), event)} variant="quiet" size="compact">Place</ClusterButton>
                </article>)}
                {!(workspace.planning?.calendarEvents || []).some((event) => !event.scheduled) && <p className="time-clear-state-v212">No unplaced Calendar events this week.</p>}
              </div>
            </section>

            <section className="time-planning-panel-v496 time-planning-resources-v496">
              <header><div><span className="time-kicker-v212">Resources</span><h3>Rooms, equipment & facilities</h3></div><strong>{workspace.planning?.resources.length || 0}</strong></header>
              {workspace.permissions?.resourcePlanningEnabled !== false ? <>
                <div className="time-resource-create-v496">
                  <ClusterTextInput aria-label="Resource name" placeholder="Resource name" value={resourceDraft.name} onChange={(event) => setResourceDraft({ ...resourceDraft, name: event.target.value })} />
                  <ClusterSelect ariaLabel="Resource type" value={resourceDraft.type} onChange={(type) => setResourceDraft({ ...resourceDraft, type })} options={[{ value: "room", label: "Room" }, { value: "equipment", label: "Equipment" }, { value: "stage", label: "Stage" }, { value: "vehicle", label: "Vehicle" }, { value: "facility", label: "Facility" }, { value: "other", label: "Other" }]} />
                  <ClusterTextInput aria-label="Resource location" placeholder="Location" value={resourceDraft.location} onChange={(event) => setResourceDraft({ ...resourceDraft, location: event.target.value })} />
                  <ClusterTextInput aria-label="Resource quantity" type="number" min={1} max={1000} value={resourceDraft.quantityTotal} onChange={(event) => setResourceDraft({ ...resourceDraft, quantityTotal: Math.max(1, Math.min(1000, Number(event.target.value || 1))) })} />
                  <ClusterButton type="button" className="" disabled={busy || !resourceDraft.name.trim()} onClick={() => void createScheduleResource()} variant="secondary">Add resource</ClusterButton>
                </div>
                <div className="time-resource-grid-v496">
                  {(workspace.planning?.resources || []).map((resource) => {
                    const reserved = (workspace.scheduleBlocks || []).filter((block) => block.status !== "cancelled").reduce((sum, block) => sum + (block.resources || []).filter((item) => item.resourceId === resource.id).reduce((itemSum, item) => itemSum + item.quantity, 0), 0);
                    return <article key={resource.id} className={resource.status !== "active" ? "is-maintenance" : ""}>
                      <div><strong>{resource.name}</strong><span>{resource.type}{resource.location ? ` · ${resource.location}` : ""}</span><small>{reserved} reservation unit{reserved === 1 ? "" : "s"} in range · capacity {resource.quantityTotal}</small></div>
                      <div className="button-row"><span className="soft-pill">{resource.status}</span><ClusterButton type="button" className="" disabled={busy} onClick={() => void setScheduleResourceStatus(resource, resource.status === "active" ? "maintenance" : "active")} variant="quiet" size="compact">{resource.status === "active" ? "Maintenance" : "Activate"}</ClusterButton></div>
                    </article>;
                  })}
                  {!workspace.planning?.resources.length && <p className="time-clear-state-v212">Add the first room, kit, stage, vehicle, or shared facility.</p>}
                </div>
              </> : <p className="time-clear-state-v212">Resource planning is disabled in Admin → Scheduler.</p>}
            </section>

            <section className="time-planning-panel-v496">
              <header><div><span className="time-kicker-v212">Milestones</span><h3>Nearby project dates</h3></div><strong>{workspace.planning?.milestones.length || 0}</strong></header>
              <div className="time-planning-event-list-v496">
                {(workspace.planning?.milestones || []).map((milestone) => <article key={milestone.projectId}><div><strong>{milestone.projectName}</strong><span>{new Date(milestone.targetDate).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} · {milestone.status}</span></div><ClusterButton type="button" className="" onClick={() => { const date = new Date(milestone.targetDate); const draft = makeProductionWindowDraft(date, currentUser.id, milestone.projectId, workspace?.permissions?.calendarMirrorDefault === true); setProjectId(milestone.projectId); setPlanningConflicts([]); setPlanningEditor(draft); }} variant="quiet" size="compact">Plan</ClusterButton></article>)}
                {!workspace.planning?.milestones.length && <p className="time-clear-state-v212">No nearby project milestones.</p>}
              </div>
            </section>
          </div>
        </div>
      )}

      <ClusterModal open={Boolean(selectedScheduleBlock)} onClose={scheduleBlockDetailHistory.closeDetail} backdropClassName="time-schedule-detail-backdrop-v491" className="modal panel time-schedule-detail-v491" ariaLabel="Schedule block details">
        {selectedScheduleBlock && <>
            <div className="modal-header"><div><p className="eyebrow">Scheduler</p><h2>{selectedScheduleBlock.title}</h2></div><div className="button-row"><WorkActionMenu context={{ source: { kind: "scheduler", id: selectedScheduleBlock.id, projectId: selectedScheduleBlock.projectId || selectedScheduleBlock.project?.id || null, label: selectedScheduleBlock.title }, navigation: { screen: "scheduler", projectId: selectedScheduleBlock.projectId || selectedScheduleBlock.project?.id || null, inspectScope: "schedule-block", inspectId: selectedScheduleBlock.id }, projectId: selectedScheduleBlock.projectId || selectedScheduleBlock.project?.id || null, assigneeId: selectedScheduleBlock.userId || selectedScheduleBlock.user?.id || null, startsAt: selectedScheduleBlock.startsAt, endsAt: selectedScheduleBlock.endsAt }} label={`${selectedScheduleBlock.title} work actions`} exclude={["schedule"]} /><ClusterButton type="button" className="" onClick={scheduleBlockDetailHistory.closeDetail} variant="quiet" size="compact">Close</ClusterButton></div></div>
            <dl className="time-schedule-detail-grid-v491">
              <div><dt>Starts</dt><dd>{dateTimeLabel(selectedScheduleBlock.startsAt)}</dd></div>
              <div><dt>Ends</dt><dd>{dateTimeLabel(selectedScheduleBlock.endsAt)}</dd></div>
              <div><dt>Type</dt><dd>{selectedScheduleBlock.type.replace(/-/g, " ")}</dd></div>
              <div><dt>Duration</dt><dd>{durationLabel(selectedScheduleBlock.durationMinutes || Math.max(0, Math.round((new Date(selectedScheduleBlock.endsAt).getTime() - new Date(selectedScheduleBlock.startsAt).getTime()) / 60000)))}</dd></div>
              <div><dt>Project</dt><dd>{selectedScheduleBlock.project?.name || "Studio"}</dd></div>
              <div><dt>Owner</dt><dd>{selectedScheduleBlock.user?.displayName || selectedScheduleBlock.user?.username || "Unassigned"}</dd></div>
              <div><dt>Window</dt><dd>{(selectedScheduleBlock.windowKind || "standard").replace(/-/g, " ")}</dd></div>
              <div><dt>Status</dt><dd>{selectedScheduleBlock.status || "confirmed"}</dd></div>
              <div><dt>Crew</dt><dd>{(selectedScheduleBlock.participantIds || []).map((id) => { const person = (workspace?.users || []).find((user) => user.id === id); return person?.displayName || person?.username || "Unknown"; }).join(", ") || "Lead only"}</dd></div>
              <div><dt>Resources</dt><dd>{(selectedScheduleBlock.resources || []).map((item) => `${item.resource?.name || "Resource"}${item.quantity > 1 ? ` ×${item.quantity}` : ""}`).join(", ") || "None"}</dd></div>
              <div><dt>Calendar</dt><dd>{selectedScheduleBlock.calendarEvent ? `${selectedScheduleBlock.calendarSync ? "Mirrored" : "Linked"} · ${selectedScheduleBlock.calendarEvent.title}` : selectedScheduleBlock.calendarSync ? "Mirror needs recovery" : "Not linked"}</dd></div>
              <div><dt>Timezone</dt><dd>{selectedScheduleBlock.timezone || "UTC"}</dd></div>
              <div><dt>Recurrence</dt><dd>{selectedScheduleBlock.recurrenceGroupId ? `${selectedScheduleBlock.recurrenceFrequency || "Recurring"} · occurrence ${Number(selectedScheduleBlock.recurrenceIndex || 0) + 1}` : "None"}</dd></div>
              <div><dt>Revision</dt><dd>{selectedScheduleBlock.revision || 1}</dd></div>
            </dl>
            {workspace?.canManage ? <div className="button-row"><ClusterButton type="button" className="" onClick={() => { editProductionWindow(selectedScheduleBlock, "single"); scheduleBlockDetailHistory.closeDetail(); }} variant="secondary">Edit occurrence</ClusterButton>{selectedScheduleBlock.recurrenceGroupId ? <ClusterButton type="button" className="" onClick={() => { editProductionWindow(selectedScheduleBlock, "future"); scheduleBlockDetailHistory.closeDetail(); }} variant="secondary">Edit this + future</ClusterButton> : null}{selectedScheduleBlock.calendarSync ? <ClusterButton type="button" className="" disabled={busy} onClick={() => void reconcileScheduleCalendar(selectedScheduleBlock, "repair")} variant="secondary">Repair Calendar mirror</ClusterButton> : null}{selectedScheduleBlock.calendarEventId || selectedScheduleBlock.calendarSync ? <ClusterButton type="button" className="" disabled={busy} onClick={() => void reconcileScheduleCalendar(selectedScheduleBlock, "unlink")} variant="secondary">Unlink Calendar</ClusterButton> : null}</div> : null}
            {selectedScheduleBlock.description ? <p className="time-schedule-detail-notes-v491">{selectedScheduleBlock.description}</p> : null}
            {selectedScheduleBlock.projectId || selectedScheduleBlock.project?.id ? <LinkedWorkPanel projectId={selectedScheduleBlock.projectId || selectedScheduleBlock.project!.id} kind="scheduler" entityId={selectedScheduleBlock.id} compact /> : null}
        </>}
      </ClusterModal>
      {scheduleEditor && (
        <TimeOffDialog
          value={scheduleEditor}
          busy={busy}
          onChange={setScheduleEditor}
          onClose={() => setScheduleEditor(null)}
          onSave={saveSchedule}
        />
      )}
      {planningEditor && <SchedulePlanningDialog
        value={planningEditor}
        users={workspace?.users || [currentUser]}
        projects={projects}
        resources={workspace?.planning?.resources || []}
        conflicts={planningConflicts}
        availabilitySignals={planningAvailabilitySignals}
        busy={busy}
        onChange={(value) => { setPlanningEditor(value); setPlanningConflicts([]); setPlanningAvailabilitySignals([]); }}
        onClose={() => { setPlanningEditor(null); setPlanningEdit(null); setPlanningConflicts([]); setPlanningAvailabilitySignals([]); }}
        onCheck={() => void checkProductionAvailability()}
        onSave={(allowConflicts) => void saveProductionWindow(Boolean(allowConflicts))}
        editingScope={planningEdit?.scope || null}
      />}
      <ClusterModal open={breakDialogOpen} onClose={() => setBreakDialogOpen(false)} backdropClassName="time-break-backdrop-v270" className="modal panel time-break-dialog-v270" ariaLabel="Start break">
            <div className="modal-header">
              <div>
                <p className="eyebrow">Scheduler</p>
                <h2>Take a break</h2>
              </div>
              <ClusterIconButton label="Close break dialog" type="button" onClick={() => setBreakDialogOpen(false)}><ClusterIcon name="close" /></ClusterIconButton>
            </div>
            <label className="field">
              <span>Break type</span>
              <ClusterSelect
                ariaLabel="Break type"
                value={clockForm.breakType}
                onChange={(breakType) => setClockForm({ ...clockForm, breakType })}
                options={[
                  { value: "unpaid", label: "Unpaid break" },
                  { value: "meal", label: "Meal break" },
                  { value: "paid", label: "Paid break" },
                  { value: "personal", label: "Personal break" },
                ]}
              />
            </label>
            <label className="field">
              <span>Note <small>Optional</small></span>
              <ClusterTextArea value={breakNote} onChange={(event) => setBreakNote(event.target.value)} maxLength={500} placeholder="Add context for this break" />
            </label>
            <div className="modal-actions">
              <ClusterButton type="button" className="" onClick={() => setBreakDialogOpen(false)} variant="secondary">Cancel</ClusterButton>
              <ClusterButton type="button" className="" onClick={() => void startBreak()} disabled={busy} variant="primary">{busy ? "Starting…" : "Continue to PIN"}</ClusterButton>
            </div>
      </ClusterModal>
    </section>
  );
}
