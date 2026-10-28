import { ClusterNativeSelect } from "../../components/ClusterNativeControls";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterTextArea } from "../../components/ClusterTextArea";
import type * as React from "react";
import type { ClusterResourceAddress } from "@cluster/shared";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import "./timeline-workspace.css";
import { ClusterModal } from "../../components/ClusterModal";
import { confirmCluster } from "../../components/cluster-dialog-service";
import { api, mutateApi, queryApi, peekApiQuery, setApiQueryData } from "../../core/api";
import { addDays, compactDateTime, toDateTimeLocalInput } from "../../core/date-time";
import { ClusterIcon } from "../../components/ClusterIcon";
import { ClusterVisualBars } from "../../components/ClusterVisualMetrics";
import { ClusterButton, ClusterLinkButton } from "../../components/ClusterButton";
import { ClusterEmptyState } from "../../components/ClusterEmptyState";
import { ClusterSelect } from "../../components/ClusterSelect";
import { ClusterSegmentedControl } from "../../components/ClusterSegmentedControl";
import { CollaborationPanel } from "../../components/CollaborationPanel";
import { ColorField } from "../../components/ColorField";
import { ToolPageHeader } from "../../components/ToolPageHeader";
import { TimelineLoadingState } from "../../components/LoadingState";
import { RequestErrorState } from "../../components/RequestState";
import type { Project, TimelineEntry, TimelineItem, TimelinePayload, User } from "../application/application-models";
import { runtimeStyle } from "../../core/runtime-style";
import { openSharedCreate } from "../create/shared-create-handoff";
import { useClusterDetailHistory } from "../../components/ClusterMasterDetail";
import { readClusterWorkProjectContext, recoverClusterDetailNavigation } from "../workflow/work-navigation";
import { LinkedWorkPanel } from "../workflow/LinkedWorkPanel";
import { clusterResourceNavigation } from "../workflow/resource-navigation";
import { WorkActionMenu } from "../workflow/WorkActionMenu";
import { ProjectCollaborationStrip } from "../collaboration";
import { removeTimelineItem, upsertTimelineItem } from "./timeline-workspace-state";

export interface TimelineWorkspacePageProps { projects: Project[]; currentUser: User }

function timelineEntryResource(entry: TimelineEntry): ClusterResourceAddress | null {
  const projectId = entry.projectId || entry.project?.id || null;
  if (entry.source === "card") return { kind: "card", id: entry.id, projectId };
  if (entry.source === "calendar") return { kind: "calendar", id: entry.id, projectId };
  if (entry.source === "schedule") return { kind: "scheduler", id: entry.id, projectId };
  if (entry.source === "manual") return { kind: "timeline", id: entry.id, projectId };
  return null;
}

function timelineQueryPath(start: string, end: string, projectId: string, typeFilter: string) {
  const params = new URLSearchParams({
    start: new Date(`${start}T00:00:00`).toISOString(),
    end: new Date(`${end}T23:59:59`).toISOString(),
  });
  if (projectId !== "all") params.set("projectId", projectId);
  if (typeFilter !== "all") params.set("type", typeFilter);
  return `/api/timeline?${params.toString()}`;
}

function fromDateTimeLocalInput(value: string) {
  return new Date(value).toISOString();
}

export function TimelineWorkspacePage({ projects, currentUser }: TimelineWorkspacePageProps) {
  const now = new Date();
  const [start, setStart] = useState(new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10));
  const [end, setEnd] = useState(new Date(now.getFullYear(), now.getMonth() + 4, 0).toISOString().slice(0, 10));
  const [projectId, setProjectId] = useState(() => readClusterWorkProjectContext() || "all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [laneMode, setLaneMode] = useState<"auto" | "source" | "type">("source");
  const [timelineView, setTimelineView] = useState<"map" | "board" | "list">("map");
  // Restore the current range immediately when returning from another tool.
  // Network reconciliation can happen afterward without an empty-map flash.
  const [payload, setPayload] = useState<TimelinePayload | null>(() =>
    peekApiQuery<TimelinePayload>(timelineQueryPath(start, end, projectId, typeFilter)));
  const activeTimelineQueryRef = useRef(timelineQueryPath(start, end, projectId, typeFilter));
  const [editing, setEditing] = useState<TimelineItem | null>(null);
  const [selectedTimelineEntryId, setSelectedTimelineEntryId] = useState<string | null>(null);
  const [inspectedTimelineItem, setInspectedTimelineItem] = useState<TimelineItem | null>(null);
  const [timelineComposerOpen, setTimelineComposerOpen] = useState(false);
  const [status, setStatus] = useState("Loading timeline…");
  const [loading, setLoading] = useState(() =>
    peekApiQuery<TimelinePayload>(timelineQueryPath(start, end, projectId, typeFilter)) === null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [users, setUsers] = useState<User[]>([currentUser]);
  const timelineRequestSequence = useRef(0);
  const timelineDetailRequestSequence = useRef(0);
  const revalidateTimerRef = useRef<number | null>(null);
  const [form, setForm] = useState({
    title: "",
    description: "",
    startsAt: toDateTimeLocalInput(new Date().toISOString()),
    endsAt: "",
    projectId: "",
    type: "milestone",
    color: "#3b82f6",
    externalUrl: "",
  });
  useEffect(() => {
    if (!selectedTimelineEntryId && !timelineComposerOpen) return;
    document.body.classList.add("timeline-detail-fullscreen-open-v254");
    return () => document.body.classList.remove("timeline-detail-fullscreen-open-v254");
  }, [selectedTimelineEntryId, timelineComposerOpen]);
  useEffect(() => {
    // Timeline browsing never needs a 1,000-person directory. Load it only
    // when an item is inspected and the collaboration panel can use it.
    if (!selectedTimelineEntryId) return;
    let cancelled = false;
    queryApi<User[]>("/api/users?summary=true&limit=1000", { staleMs: 5 * 60_000, maxAgeMs: 30 * 60_000, tags: ["users", "people"] })
      .then((items) => { if (!cancelled) setUsers(items.filter((user) => !user.archived)); })
      .catch(() => { if (!cancelled) setUsers([currentUser]); });
    return () => { cancelled = true; };
  }, [currentUser.id, selectedTimelineEntryId]);
  const restoreTimelineDetail = useCallback((id: string | null) => {
    if (!id) { timelineDetailRequestSequence.current += 1; setSelectedTimelineEntryId(null); setInspectedTimelineItem(null); return; }
    setSelectedTimelineEntryId(id);
    if (payload?.entries.some((entry) => entry.id === id) || inspectedTimelineItem?.id === id) return;
    const sequence = ++timelineDetailRequestSequence.current;
    void queryApi<TimelineItem>(`/api/timeline/items/${encodeURIComponent(id)}`, { staleMs: 15_000, maxAgeMs: 5 * 60_000, tags: ["timeline", `timeline-item:${id}`] })
      .then((item) => {
        if (sequence !== timelineDetailRequestSequence.current) return;
        setInspectedTimelineItem(item);
        const date = new Date(item.startsAt);
        const rangeStart = new Date(date);
        rangeStart.setDate(rangeStart.getDate() - 14);
        const rangeEnd = new Date(date);
        rangeEnd.setDate(rangeEnd.getDate() + 45);
        setStart(rangeStart.toISOString().slice(0, 10));
        setEnd(rangeEnd.toISOString().slice(0, 10));
        setProjectId(item.projectId || "all");
      })
      .catch(() => {
        if (sequence !== timelineDetailRequestSequence.current) return;
        setSelectedTimelineEntryId(null);
        setInspectedTimelineItem(null);
        recoverClusterDetailNavigation("timeline-item", {
          title: "Timeline item unavailable",
          message: "That item may have been deleted, moved, archived with its project, or your access may have changed. Timeline stayed open.",
          tone: "warning",
        });
      });
  }, [payload?.entries, inspectedTimelineItem?.id]);
  const timelineDetailHistory = useClusterDetailHistory("timeline-item", selectedTimelineEntryId, restoreTimelineDetail);
  function timelineItemMatchesCurrentView(item: TimelineItem) {
    const startsAt = new Date(item.startsAt).getTime();
    const rangeStart = new Date(`${start}T00:00:00`).getTime();
    const rangeEnd = new Date(`${end}T23:59:59`).getTime();
    return startsAt >= rangeStart && startsAt <= rangeEnd
      && (projectId === "all" || item.projectId === projectId)
      && (typeFilter === "all" || item.type === typeFilter);
  }
  function commitTimelineItem(item: TimelineItem) {
    commitTimelinePayload((current) => timelineItemMatchesCurrentView(item) ? upsertTimelineItem(current, item) : removeTimelineItem(current, item.id));
  }
  function commitTimelinePayload(update: (current: TimelinePayload) => TimelinePayload) {
    setPayload((current) => {
      if (!current) return current;
      const next = update(current);
      setApiQueryData(timelineQueryPath(start, end, projectId, typeFilter), next, { staleMs: 60_000, maxAgeMs: 10 * 60_000, tags: ["timeline"] });
      return next;
    });
  }
  async function loadTimeline(force = false) {
    const sequence = ++timelineRequestSequence.current;
    const path = timelineQueryPath(start, end, projectId, typeFilter);
    if (activeTimelineQueryRef.current !== path) {
      activeTimelineQueryRef.current = path;
      const snapshot = peekApiQuery<TimelinePayload>(path);
      setPayload(snapshot); // never display a different range while it loads
      setLoading(!snapshot);
    } else if (!peekApiQuery<TimelinePayload>(path) && !payload) setLoading(true);
    setLoadError(null);
    try {
      const result = await queryApi<TimelinePayload>(path, { force, staleMs: 60_000, maxAgeMs: 5 * 60_000, tags: ["timeline"] });
      if (sequence !== timelineRequestSequence.current) return;
      setPayload(result);
      setStatus(`Updated ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
    } catch (error) {
      if (sequence !== timelineRequestSequence.current) return;
      setLoadError(error);
      setStatus("Timeline refresh failed");
    } finally {
      if (sequence === timelineRequestSequence.current) setLoading(false);
    }
  }
  function scheduleTimelineRevalidation() {
    if (revalidateTimerRef.current) window.clearTimeout(revalidateTimerRef.current);
    revalidateTimerRef.current = window.setTimeout(() => {
      revalidateTimerRef.current = null;
      if (document.visibilityState === "visible" && navigator.onLine) void loadTimeline(true);
    }, 1_200);
  }
  useEffect(() => {
    void loadTimeline();
    return () => { timelineRequestSequence.current += 1; if (revalidateTimerRef.current) window.clearTimeout(revalidateTimerRef.current); };
  }, [start, end, projectId, typeFilter]);
  useEffect(() => {
    const refreshFromDelta = (event: Event) => {
      const changes = (event as CustomEvent<{ changes?: Array<{ entityType?: string }> }>).detail?.changes || [];
      if (changes.some((change) => change.entityType === "timeline_item")) scheduleTimelineRevalidation();
    };
    window.addEventListener("cluster-delta-applied", refreshFromDelta);
    return () => window.removeEventListener("cluster-delta-applied", refreshFromDelta);
  }, [start, end, projectId, typeFilter]);
  function editItem(item: TimelineItem) {
    setEditing(item);
    setTimelineComposerOpen(true);
    setForm({
      title: item.title,
      description: item.description || "",
      startsAt: toDateTimeLocalInput(item.startsAt),
      endsAt: toDateTimeLocalInput(item.endsAt),
      projectId: item.projectId || "",
      type: item.type || "milestone",
      color: item.color || "#3b82f6",
      externalUrl: item.externalUrl || "",
    });
    document.querySelector(".timeline-form-card")?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function resetForm() {
    setEditing(null);
    setTimelineComposerOpen(false);
    setForm({
      title: "",
      description: "",
      startsAt: toDateTimeLocalInput(new Date().toISOString()),
      endsAt: "",
      projectId: "",
      type: "milestone",
      color: "#3b82f6",
      externalUrl: "",
    });
  }
  function openTimelineComposer(type = "milestone", defaults: { title?: string; details?: string } = {}) {
    openSharedCreate("timeline", {
      projectId: projectId === "all" ? undefined : projectId,
      date: new Date().toISOString().slice(0, 10),
      title: defaults.title,
      details: defaults.details || (type === "milestone" ? undefined : `Type: ${timelineTypeLabel(type)}`),
    });
  }

  async function saveItem() {
    if (!form.title.trim()) {
      setStatus("Timeline item needs a title.");
      return;
    }
    const body = {
      title: form.title,
      description: form.description || null,
      startsAt: fromDateTimeLocalInput(form.startsAt),
      endsAt: form.endsAt ? fromDateTimeLocalInput(form.endsAt) : null,
      projectId: form.projectId || null,
      type: form.type,
      color: form.color,
      externalUrl: form.externalUrl || null,
    };
    if (editing) {
      const result = await mutateApi<TimelineItem>(`/api/timeline/items/${editing.id}`, {
        method: "PUT",
        body,
        label: `Update ${editing.title}`,
        dedupeKey: `timeline:${editing.id}`,
        entityType: "timeline_item",
        entityId: editing.id,
        resourceKind: "timeline",
        resourceId: editing.projectId || "studio",
        baseRevision: editing.revision,
        baseSnapshot: editing as unknown as Record<string, unknown>,
        localSnapshot: body,
        changedFields: Object.keys(body),
        optimisticResult: { ...editing, ...body, startsAt: String(body.startsAt), endsAt: body.endsAt ? String(body.endsAt) : null },
        invalidate: ["/api/timeline", "/api/calendar"],
      });
      if (result.result) commitTimelineItem(result.result as TimelineItem)
      setStatus(result.queued ? "Timeline change saved on this device." : "Timeline item updated.");
      if (!result.queued) scheduleTimelineRevalidation();
    } else {
      const result = await mutateApi<TimelineItem>("/api/timeline/items", {
        method: "POST",
        body,
        label: `Create ${body.title}`,
        entityType: "timeline_item",
        resourceKind: "timeline",
        resourceId: body.projectId || "studio",
        localSnapshot: body,
        changedFields: Object.keys(body),
        invalidate: ["/api/timeline", "/api/calendar"],
      });
      if (result.result) commitTimelineItem(result.result as TimelineItem)
      setStatus(result.queued ? "Timeline item queued for synchronization." : "Timeline item created.");
      if (!result.queued) scheduleTimelineRevalidation();
    }
    resetForm();
  }
  async function deleteItem(item: TimelineItem) {
    if (!await confirmCluster({ title: "Delete timeline item?", message: `Delete ${item.title}?`, confirmLabel: "Delete item", tone: "danger" })) return;
    const result = await mutateApi(`/api/timeline/items/${item.id}`, {
      method: "DELETE",
      body: item.revision ? { expectedRevision: item.revision } : undefined,
      label: `Delete ${item.title}`,
      entityType: "timeline_item",
      entityId: item.id,
      resourceKind: "timeline",
      resourceId: item.projectId || "studio",
      baseRevision: item.revision,
      baseSnapshot: item as unknown as Record<string, unknown>,
      localSnapshot: { deleted: true },
      changedFields: ["deleted"],
      invalidate: ["/api/timeline", "/api/calendar"],
    });
    setStatus(result.queued ? "Deletion queued for synchronization." : "Timeline item deleted.");
    commitTimelinePayload((current) => removeTimelineItem(current, item.id));
    if (editing?.id === item.id) resetForm();
    if (selectedTimelineEntryId === item.id) timelineDetailHistory.closeDetail();
    if (!result.queued) scheduleTimelineRevalidation();
  }
  function setTimelineRangePreset(preset: "month" | "quarter" | "half" | "year") {
    const base = new Date();
    const startDate = new Date(base.getFullYear(), base.getMonth(), 1);
    const months = preset === "month" ? 1 : preset === "quarter" ? 3 : preset === "half" ? 6 : 12;
    const endDate = new Date(base.getFullYear(), base.getMonth() + months, 0);
    setStart(startDate.toISOString().slice(0, 10));
    setEnd(endDate.toISOString().slice(0, 10));
  }
  function timelineTypeLabel(type?: string | null) {
    if (type === "release") return "Release";
    if (type === "meeting") return "Meeting";
    if (type === "deadline") return "Deadline";
    if (type === "note") return "Note";
    return "Milestone";
  }
  function timelineSourceLabel(source?: string | null) {
    if (source === "calendar") return "Calendar";
    if (source === "card") return "Due date";
    if (source === "schedule") return "Schedule";
    if (source === "time") return "Scheduler";
    return "Manual";
  }
  const manualItems = payload?.manualItems || [];
  const entries = useMemo(() => [...(payload?.entries || [])].filter((entry) => entry.source !== "time" && !/clock\s*(in|out)/i.test(entry.title)).sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()), [payload]);
  const selectedTimelineEntry = entries.find((entry) => entry.id === selectedTimelineEntryId) || (inspectedTimelineItem?.id === selectedTimelineEntryId ? {
    id: inspectedTimelineItem.id, source: "manual", type: inspectedTimelineItem.type, title: inspectedTimelineItem.title, description: inspectedTimelineItem.description, startsAt: inspectedTimelineItem.startsAt, endsAt: inspectedTimelineItem.endsAt, color: inspectedTimelineItem.color, externalUrl: inspectedTimelineItem.externalUrl,
    project: inspectedTimelineItem.project ? { id: inspectedTimelineItem.project.id, name: inspectedTimelineItem.project.name } : inspectedTimelineItem.projectId ? { id: inspectedTimelineItem.projectId, name: projects.find((project) => project.id === inspectedTimelineItem.projectId)?.name || "Project" } : null,
  } satisfies TimelineEntry : null);
  const selectedTimelineResource = selectedTimelineEntry ? timelineEntryResource(selectedTimelineEntry) : null;
  const selectedTimelineNavigation = clusterResourceNavigation(selectedTimelineResource);
  const selectedTimelineCollaborationKind = selectedTimelineResource && (["ticket", "card", "board", "whiteboard", "timeline", "library", "project_control", "build", "qa_plan", "qa_session", "source_review", "workspace"] as const).includes(selectedTimelineResource.kind as "ticket" | "card" | "board" | "whiteboard" | "timeline" | "library" | "project_control" | "build" | "qa_plan" | "qa_session" | "source_review" | "workspace")
    ? selectedTimelineResource.kind as "ticket" | "card" | "board" | "whiteboard" | "timeline" | "library" | "project_control" | "build" | "qa_plan" | "qa_session" | "source_review" | "workspace"
    : null;
  const todayMs = Date.now();
  const rangeStartMs = new Date(`${start}T00:00:00`).getTime();
  const rangeEndMs = new Date(`${end}T23:59:59`).getTime();
  const rangeSpan = Math.max(rangeEndMs - rangeStartMs, 1);
  const graphicWidth = Math.max(1040, entries.length * 118);
  const timelineLaneLabels = laneMode === "source" ? ["Manual", "Calendar", "Due dates", "Schedule"] : laneMode === "type" ? ["Milestones", "Releases", "Meetings", "Deadlines", "Notes"] : ["Track 1", "Track 2", "Track 3", "Track 4"];
  function timelineLane(entry: TimelineEntry, index: number) {
    if (laneMode === "source") return entry.source === "calendar" ? 1 : entry.source === "card" ? 2 : entry.source === "schedule" ? 3 : 0;
    if (laneMode === "type") return Math.max(0, ["milestone", "release", "meeting", "deadline", "note"].indexOf(entry.type || "note"));
    return index % 4;
  }
  function entryPosition(entry: TimelineEntry) {
    const value = new Date(entry.startsAt).getTime();
    return Math.max(0, Math.min(100, ((value - rangeStartMs) / rangeSpan) * 100));
  }
  const tickDates = useMemo(() => {
    const first = new Date(`${start}T00:00:00`);
    const last = new Date(`${end}T23:59:59`);
    const ticks: Date[] = [];
    const cursor = new Date(first.getFullYear(), first.getMonth(), 1);
    while (cursor <= last && ticks.length < 18) {
      ticks.push(new Date(cursor));
      cursor.setMonth(cursor.getMonth() + 1);
    }
    if (ticks.length === 0) ticks.push(first, last);
    return ticks;
  }, [start, end]);
  const todayPosition = Math.max(0, Math.min(100, ((todayMs - rangeStartMs) / rangeSpan) * 100));
  const entriesInRange = entries.filter((entry) => new Date(entry.startsAt).getTime() >= rangeStartMs && new Date(entry.startsAt).getTime() <= rangeEndMs);
  const upcomingEntries = entries.filter((entry) => new Date(entry.startsAt).getTime() >= todayMs).slice(0, 8);
  const overdueEntries = entries.filter((entry) => new Date(entry.startsAt).getTime() < todayMs && ["deadline", "release", "milestone"].includes(entry.type || "")).slice(0, 8);
  const projectCoverage = new Set(entries.map((entry) => entry.project?.id).filter(Boolean)).size;
  const typeCounts = entries.reduce<Record<string, number>>(
    (acc, entry) => ({
      ...acc,
      [entry.type || "note"]: (acc[entry.type || "note"] || 0) + 1,
    }),
    {},
  );
  const sourceCounts = entries.reduce<Record<string, number>>((acc, entry) => ({ ...acc, [entry.source]: (acc[entry.source] || 0) + 1 }), {});
  const focusEntry = upcomingEntries[0] || entries[0] || null;
  const monthBuckets = useMemo(() => {
    const first = new Date(`${start}T00:00:00`);
    const last = new Date(`${end}T23:59:59`);
    const buckets: Array<{
      key: string;
      label: string;
      entries: TimelineEntry[];
    }> = [];
    const cursor = new Date(first.getFullYear(), first.getMonth(), 1);
    while (cursor <= last && buckets.length < 12) {
      const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}`;
      buckets.push({
        key,
        label: cursor.toLocaleDateString([], {
          month: "short",
          year: "numeric",
        }),
        entries: [],
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    for (const entry of entries) {
      const date = new Date(entry.startsAt);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      const bucket = buckets.find((item) => item.key === key);
      if (bucket) bucket.entries.push(entry);
    }
    return buckets;
  }, [start, end, entries]);
  const grouped = entries.reduce<Record<string, TimelineEntry[]>>((acc, entry) => {
    const key = new Date(entry.startsAt).toLocaleDateString([], {
      month: "long",
      year: "numeric",
    });
    acc[key] ||= [];
    acc[key].push(entry);
    return acc;
  }, {});
  const timelineGroups = Object.entries(grouped) as Array<[string, TimelineEntry[]]>;
  const typeSummary = [
    { value: "all", label: "All", count: entries.length },
    {
      value: "milestone",
      label: "Milestones",
      count: typeCounts.milestone || 0,
    },
    { value: "release", label: "Releases", count: typeCounts.release || 0 },
    { value: "deadline", label: "Deadlines", count: typeCounts.deadline || 0 },
    { value: "meeting", label: "Meetings", count: typeCounts.meeting || 0 },
    { value: "note", label: "Notes", count: typeCounts.note || 0 },
  ];
  const sourceSummary = [
    { source: "manual", label: "Manual" },
    { source: "calendar", label: "Calendar" },
    { source: "card", label: "Due dates" },
    { source: "schedule", label: "Schedule" },
  ];
  const projectRows = projects
    .map((project) => {
      const projectEntries = entries.filter((entry) => entry.project?.id === project.id);
      const next = projectEntries.find((entry) => new Date(entry.startsAt).getTime() >= todayMs) || null;
      const overdue = projectEntries.filter((entry) => new Date(entry.startsAt).getTime() < todayMs && ["deadline", "release", "milestone"].includes(entry.type || "")).length;
      return { project, count: projectEntries.length, next, overdue };
    })
    .filter((row) => row.count || row.project.status !== "archived")
    .slice(0, 8);
  const timelineAttentionItems = [
    ...overdueEntries.slice(0, 3).map((entry) => ({
      title: entry.title,
      meta: `${timelineSourceLabel(entry.source)} · ${compactDateTime(entry.startsAt)}`,
    })),
    ...(!entries.length
      ? [
          {
            title: "Roadmap is empty",
            meta: "Add a milestone or loosen the filters.",
          },
        ]
      : []),
    ...(entries.length > 0 && !upcomingEntries.length
      ? [
          {
            title: "No upcoming roadmap items",
            meta: "Extend the range or add the next milestone.",
          },
        ]
      : []),
  ].slice(0, 4);
  const timelineDurationDays = Math.max(1, Math.ceil(rangeSpan / 86400000));
  const upcoming30Count = entries.filter((entry) => {
    const value = new Date(entry.startsAt).getTime();
    return value >= todayMs && value <= todayMs + 30 * 86400000;
  }).length;
  const timelineTools = [
    {
      label: "Next 30 days",
      value: String(upcoming30Count),
      meta: "",
    },
    {
      label: "Overdue",
      value: String(overdueEntries.length),
      meta: "",
    },
  ];
  const phaseDefinitions = [
    { label: "Concept", terms: ["concept", "pitch", "pre-production", "idea"] },
    { label: "Prototype", terms: ["prototype", "first playable", "graybox"] },
    { label: "Vertical slice", terms: ["vertical slice", "slice"] },
    { label: "Alpha", terms: ["alpha"] },
    { label: "Beta", terms: ["beta"] },
    { label: "Launch", terms: ["launch", "release", "ship", "published"] },
  ];
  const phaseCards = phaseDefinitions.map((phase) => {
    const matches = entries.filter((entry) => {
      const haystack = `${entry.title} ${entry.description || ""} ${entry.type}`.toLowerCase();
      return phase.terms.some((term) => haystack.includes(term));
    });
    const next = matches.filter((entry) => new Date(entry.startsAt).getTime() >= todayMs).sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())[0] || matches[0] || null;
    return { ...phase, count: matches.length, next };
  });
  const weeklyBuckets = Array.from({ length: 6 }, (_, index) => {
    const first = addDays(new Date(), index * 7);
    const last = addDays(first, 6);
    const items = entries.filter((entry) => {
      const value = new Date(entry.startsAt).getTime();
      return value >= new Date(first.getFullYear(), first.getMonth(), first.getDate()).getTime() && value <= new Date(last.getFullYear(), last.getMonth(), last.getDate(), 23, 59, 59).getTime();
    });
    return { first, last, items };
  });
  if (loading && !payload) return <section className="page cluster-specialist-workspace cluster-timeline-workspace cluster-tool-page-v228 timeline-page timeline-page-v156"><TimelineLoadingState label="Loading timeline" rows={8} /></section>;
  if (loadError && !payload) return <section className="page cluster-specialist-workspace cluster-timeline-workspace cluster-tool-page-v228 timeline-page timeline-page-v156"><RequestErrorState error={loadError} title="Timeline unavailable" onRetry={() => void loadTimeline()} /></section>;
  return (
    <section className="page cluster-specialist-workspace cluster-timeline-workspace cluster-tool-page-v228 timeline-page timeline-page-v156">
      <div className="timeline-shell-v153">
        <header className="timeline-commandbar-v254" aria-label="Timeline controls">
          <ToolPageHeader
            title="Timeline"
            metrics={[
              { label: "Items", value: entries.length },
              { label: "Projects", value: projectCoverage },
              {
                label: "Overdue",
                value: overdueEntries.length,
                tone: overdueEntries.length ? "danger" : "neutral",
              },
              {
                label: "Window",
                value: `${new Date(`${start}T00:00:00`).toLocaleDateString()} – ${new Date(`${end}T23:59:59`).toLocaleDateString()}`,
              },
            ]}
            context={
              <ClusterSegmentedControl
                value={timelineView}
                onChange={setTimelineView}
                label="Timeline view"
                options={[
                  { value: "map", label: "Map" },
                  { value: "board", label: "Board" },
                  { value: "list", label: "List" },
                ]}
              />
            }
            actions={
              <>
                <ClusterButton type="button" className="" onClick={() => void loadTimeline()} variant="secondary">
                  Refresh
                </ClusterButton>
                <ClusterButton type="button" className="" onClick={() => openTimelineComposer("milestone")} variant="primary">
                  <ClusterIcon name="plus" /> New item
                </ClusterButton>
              </>
            }
          />
          <div className="timeline-header-filters-v254 cluster-dense-toolbar">
            <div className="timeline-preset-row-v154">
              <ClusterButton unstyled type="button" onClick={() => setTimelineRangePreset("month")}>Month</ClusterButton>
              <ClusterButton unstyled type="button" onClick={() => setTimelineRangePreset("quarter")}>Quarter</ClusterButton>
              <ClusterButton unstyled type="button" onClick={() => setTimelineRangePreset("half")}>6mo</ClusterButton>
              <ClusterButton unstyled type="button" onClick={() => setTimelineRangePreset("year")}>Year</ClusterButton>
            </div>
            <div className="field compact">
              <label>Start</label>
              <ClusterTextInput type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div className="field compact">
              <label>End</label>
              <ClusterTextInput type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
            <div className="field compact timeline-project-filter-v154">
              <label>Project</label>
              <ClusterSelect
                value={projectId}
                onChange={setProjectId}
                ariaLabel="Timeline project filter"
                options={[
                  { value: "all", label: "All projects" },
                  ...projects.map((project) => ({
                    value: project.id,
                    label: project.name,
                  })),
                ]}
              />
            </div>
            <div className="field compact">
              <label>Type</label>
              <ClusterSelect
                value={typeFilter}
                onChange={setTypeFilter}
                ariaLabel="Timeline type filter"
                options={[
                  { value: "all", label: "All types" },
                  { value: "milestone", label: "Milestones" },
                  { value: "release", label: "Releases" },
                  { value: "meeting", label: "Meetings" },
                  { value: "deadline", label: "Deadlines" },
                  { value: "note", label: "Notes" },
                ]}
              />
            </div>
            <div className="field compact">
              <label>Lanes</label>
              <ClusterSelect
                value={laneMode}
                onChange={(value) => setLaneMode(value as typeof laneMode)}
                ariaLabel="Timeline lane grouping"
                options={[
                  { value: "source", label: "Source" },
                  { value: "type", label: "Type" },
                  { value: "auto", label: "Automatic" },
                ]}
              />
            </div>
          </div>
        </header>
        {projectId !== "all" ? <ProjectCollaborationStrip tool="timeline" projectId={projectId} activity={`Timeline · ${timelineView}`} /> : null}

        <section className="timeline-brief-v153" aria-label="Timeline summary">
          {timelineTools.map((tool) => (
            <ClusterButton unstyled type="button" key={tool.label} className="timeline-brief-cell-v153" onClick={() => (tool.label === "Overdue" ? setTimelineView("list") : undefined)}>
              <span>{tool.label}</span>
              <strong>{tool.value}</strong>
            </ClusterButton>
          ))}
          {weeklyBuckets.some((bucket) => bucket.items.length > 0) && <div className="timeline-brief-chart-v34"><ClusterVisualBars label="Next 6 weeks" buckets={weeklyBuckets.map((bucket) => ({ label: `${bucket.first.getMonth() + 1}/${bucket.first.getDate()}`, value: bucket.items.length }))} /></div>}
        </section>

        <div className="timeline-layout-v154">
          <main className="timeline-main-v153">
            {timelineView === "map" && (
              <section className="panel timeline-map-panel-v153">
                <div className="timeline-panel-header-v154">
                  <div>
                    <h2>Roadmap</h2>
                    
                  </div>
                  <span className="soft-pill">{typeSummary.find((row) => row.value === typeFilter)?.label || "All"}</span>
                </div>
                <div className="timeline-graphic-scroll timeline-graphic-scroll-v119 timeline-map-scroll-v153">
                  <div className="timeline-graphic timeline-graphic-v153" style={runtimeStyle({ minWidth: graphicWidth })}>
                    <div className="timeline-rail" />
                    {todayMs >= rangeStartMs && todayMs <= rangeEndMs && (
                      <div className="timeline-today-v059" style={runtimeStyle({ left: `${todayPosition}%` })}>
                        <span>Today</span>
                      </div>
                    )}
                    {tickDates.map((tick) => {
                      const left = Math.max(0, Math.min(100, ((tick.getTime() - rangeStartMs) / rangeSpan) * 100));
                      return (
                        <div className="timeline-tick" key={tick.toISOString()} style={runtimeStyle({ left: `${left}%` })}>
                          <span>
                            {tick.toLocaleDateString([], {
                              month: "short",
                              year: "2-digit",
                            })}
                          </span>
                        </div>
                      );
                    })}
                    {entriesInRange.length ? (
                      entriesInRange.map((entry, index) => {
                        const left = entryPosition(entry);
                        const lane = timelineLane(entry, index);
                        const manual = manualItems.find((item) => item.id === entry.id);
                        return (
                          <ClusterButton unstyled
                            type="button"
                            className={`timeline-point source-${entry.source} type-${entry.type}`}
                            key={`${entry.source}-${entry.id}`}
                            style={
                              {
                                left: `${left}%`,
                                "--point-color": entry.color || "#3b82f6",
                                "--lane-offset": String(lane),
                              } as CSSProperties
                            }
                            onClick={() => timelineDetailHistory.openDetail(entry.id)}
                            title={`${entry.title} · ${compactDateTime(entry.startsAt)}`}
                          >
                            <span className="timeline-point-dot" />
                            <span className="timeline-point-card timeline-point-card-v153">
                              <strong>{entry.title}</strong>
                              <small>
                                {compactDateTime(entry.startsAt)} · {timelineTypeLabel(entry.type)}
                              </small>
                            </span>
                          </ClusterButton>
                        );
                      })
                    ) : (
                      <div className="timeline-empty-graphic">No timeline items in this range.</div>
                    )}
                  </div>
                </div>
              </section>
            )}

            {timelineView === "board" && (
              <section className="panel timeline-board-panel-v153">
                <div className="timeline-panel-header-v154">
                  <div>
                    <h2>Month board</h2>
                    <span>{focusEntry ? `Next: ${compactDateTime(focusEntry.startsAt)}` : "No upcoming dates"}</span>
                  </div>
                </div>
                <div className="timeline-month-board-v153">
                  {monthBuckets.map((bucket) => (
                    <section key={bucket.key} className="timeline-month-column-v153">
                      <header>
                        <strong>{bucket.label}</strong>
                        <span>{bucket.entries.length}</span>
                      </header>
                      <div>
                        {bucket.entries.length ? (
                          bucket.entries.map((entry) => {
                            const manual = manualItems.find((item) => item.id === entry.id);
                            return (
                              <ClusterButton unstyled type="button" key={`${entry.source}-${entry.id}`} className={`timeline-month-item-v153 source-${entry.source} type-${entry.type}`} onClick={() => timelineDetailHistory.openDetail(entry.id)}>
                                <strong>{entry.title}</strong>
                                <span>
                                  {timelineTypeLabel(entry.type)} · {compactDateTime(entry.startsAt)}
                                </span>
                                <em>{entry.project?.name || timelineSourceLabel(entry.source)}</em>
                              </ClusterButton>
                            );
                          })
                        ) : (
                          <p>No items</p>
                        )}
                      </div>
                    </section>
                  ))}
                </div>
              </section>
            )}

            {timelineView === "list" && (
              <section className="panel timeline-list-panel-v153">
                <div className="timeline-panel-header-v154">
                  <div>
                    <h2>Roadmap list</h2>
                    <span>Grouped by month</span>
                  </div>
                </div>
                {timelineGroups.length ? (
                  timelineGroups.map(([group, items]) => (
                    <section className="timeline-group-v153" key={group}>
                      <h3>{group}</h3>
                      <div className="timeline-row-list-v153">
                        {items.map((entry) => {
                          const manual = manualItems.find((item) => item.id === entry.id);
                          return (
                            <article key={`${entry.source}-${entry.id}`} className={`timeline-row-v153 source-${entry.source}`}>
                              <div>
                                <strong>{entry.title}</strong>
                                <span>
                                  {timelineTypeLabel(entry.type)} · {entry.project?.name || timelineSourceLabel(entry.source)}
                                </span>
                                {entry.description && <p>{entry.description}</p>}
                              </div>
                              <time>{compactDateTime(entry.startsAt)}</time>
                              <div className="timeline-row-actions-v153">
                                <ClusterButton type="button" className="" onClick={() => timelineDetailHistory.openDetail(entry.id)} variant="quiet" size="compact">
                                  Discuss
                                </ClusterButton>
                                {entry.externalUrl && (
                                  <ClusterLinkButton className="" href={entry.externalUrl} target="_blank" variant="quiet" size="compact">
                                    Open
                                  </ClusterLinkButton>
                                )}
                                {manual && (
                                  <ClusterButton type="button" className="" onClick={() => editItem(manual)} variant="quiet" size="compact">
                                    Edit
                                  </ClusterButton>
                                )}
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    </section>
                  ))
                ) : (
                  <ClusterEmptyState compact kind="filtered" icon="timeline" title="No timeline items match these filters" description="Clear a filter, widen the date range, or add the next milestone." />
                )}
              </section>
            )}
          </main>
        </div>

        <section className="timeline-support-row-v155">
          <article className="panel timeline-focus-v153 timeline-support-card-v154 timeline-nextbeat-v155">
            <span className="eyebrow">Next beat</span>
            {focusEntry ? (
              <>
                <strong>{focusEntry.title}</strong>
                <em>
                  {compactDateTime(focusEntry.startsAt)} · {focusEntry.project?.name || timelineSourceLabel(focusEntry.source)}
                </em>
                <ClusterButton type="button" className="" onClick={() => timelineDetailHistory.openDetail(focusEntry.id)} variant="quiet" size="compact">
                  Open
                </ClusterButton>
              </>
            ) : (
              <p className="muted tight">No upcoming timeline items.</p>
            )}
          </article>

          <article className="panel timeline-support-card-v154 timeline-attention-v155">
            <div className="timeline-support-title-v155">
              <span className="eyebrow">Attention</span>
              <b>{timelineAttentionItems.length}</b>
            </div>
            <div className="timeline-support-list-v155">
              {timelineAttentionItems.length ? (
                timelineAttentionItems.map((item) => (
                  <ClusterButton unstyled type="button" key={item.title} onClick={() => setTimelineView("list")}>
                    <strong>{item.title}</strong>
                    <em>{item.meta}</em>
                  </ClusterButton>
                ))
              ) : (
                <p className="muted tight">No urgent roadmap issues.</p>
              )}
            </div>
          </article>

          <article className="panel timeline-support-card-v154 timeline-coverage-v155">
            <div className="timeline-support-title-v155">
              <span className="eyebrow">Coverage</span>
              <b>{projectRows.length}</b>
            </div>
            <div className="timeline-source-mini-v155">
              {sourceSummary.map((row) => (
                <span key={row.source}>
                  {row.label}
                  <strong>{sourceCounts[row.source] || 0}</strong>
                </span>
              ))}
            </div>
            <div className="timeline-project-mini-v155">
              {projectRows.length ? (
                projectRows.slice(0, 3).map((row) => (
                  <ClusterButton unstyled type="button" key={row.project.id} onClick={() => setProjectId(row.project.id)}>
                    <strong>{row.project.name}</strong>
                    <span>{row.count} items</span>
                    <em>{row.next ? compactDateTime(row.next.startsAt) : row.overdue ? `${row.overdue} overdue` : "No upcoming"}</em>
                  </ClusterButton>
                ))
              ) : (
                <ClusterEmptyState compact kind="empty" icon="timeline" title="No project timeline coverage yet" description="Project milestones and scheduled work will appear here once they exist." />
              )}
            </div>
          </article>
        </section>

        <section className="panel timeline-workflow-strip-v155">
          <div className="timeline-workflow-header-v155">
            <div>
              <span className="eyebrow">Sync & workflow</span>
              <h2>Roadmap tools</h2>
            </div>
            <span className="soft-pill">{entriesInRange.length} visible</span>
          </div>
          <div className="timeline-workflow-actions-v155">
            <ClusterButton unstyled type="button" onClick={() => setTimelineView("list")}>
              <strong>Saved views</strong>
              <span>Use current filters for roadmap review.</span>
            </ClusterButton>
            <ClusterButton unstyled type="button"
              onClick={() =>
                openTimelineComposer("milestone", {
                  title: "Meeting milestone",
                  details: "Meeting agenda, owner, capacity, decisions, review date, and follow-up rules.",
                })
              }
            >
              <strong>Meeting milestone</strong>
              <span>Create the next planning beat.</span>
            </ClusterButton>
            <ClusterButton unstyled type="button" onClick={() => setTimelineRangePreset("quarter")}>
              <strong>Dependency review</strong>
              <span>Focus the next quarter before handoff.</span>
            </ClusterButton>
            <ClusterButton unstyled type="button" onClick={() => void loadTimeline()}>
              <strong>Calendar sync</strong>
              <span>Refresh imported roadmap dates.</span>
            </ClusterButton>
          </div>
          <div className="timeline-workflow-mini-v155">
            <span>
              <b>{phaseCards.filter((phase) => phase.count).length}</b> phases mapped
            </span>
            <span>
              <b>{weeklyBuckets.reduce((total, bucket) => total + bucket.items.length, 0)}</b> items in 6 weeks
            </span>
            <span>
              <b>{overdueEntries.length}</b> overdue
            </span>
          </div>
        </section>

        <ClusterModal
          open={timelineComposerOpen}
          onClose={resetForm}
          backdropClassName="workspace-detail-backdrop-v254 timeline-editor-backdrop-v254"
          className="panel timeline-form-card timeline-form-card-v153 timeline-editor-fullscreen-v254"
          labelledBy="timeline-editor-title-v393"
        >
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">{editing ? "Edit" : "Create"}</p>
                    <h2 id="timeline-editor-title-v393">{editing ? "Timeline item" : "Roadmap item"}</h2>
                  </div>
                  <ClusterButton type="button" className="" onClick={resetForm} variant="quiet" size="compact">
                    Close
                  </ClusterButton>
                </div>
                <div className="timeline-form-grid-v153">
                  <div className="field timeline-title-field-v118">
                    <label>Title</label>
                    <ClusterTextInput value={form.title} onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))} placeholder="Prototype demo, alpha test, content lock..." />
                  </div>
                  <div className="field">
                    <label>Project</label>
                    <ClusterNativeSelect
                      value={form.projectId}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          projectId: e.target.value,
                        }))
                      }
                    >
                      <option value="">No project</option>
                      {projects.map((project) => (
                        <option key={project.id} value={project.id}>
                          {project.name}
                        </option>
                      ))}
                    </ClusterNativeSelect>
                  </div>
                  <div className="field">
                    <label>Type</label>
                    <ClusterNativeSelect value={form.type} onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value }))}>
                      <option value="milestone">Milestone</option>
                      <option value="release">Release</option>
                      <option value="meeting">Meeting</option>
                      <option value="deadline">Deadline</option>
                      <option value="note">Note</option>
                    </ClusterNativeSelect>
                  </div>
                  <div className="field">
                    <label>Start</label>
                    <ClusterTextInput
                      type="datetime-local"
                      value={form.startsAt}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          startsAt: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="field">
                    <label>End</label>
                    <ClusterTextInput type="datetime-local" value={form.endsAt} onChange={(e) => setForm((prev) => ({ ...prev, endsAt: e.target.value }))} />
                  </div>
                  <ColorField value={form.color} onChange={(color) => setForm((prev) => ({ ...prev, color }))} label="Color" />
                  <div className="field">
                    <label>External link</label>
                    <ClusterTextInput
                      value={form.externalUrl}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          externalUrl: e.target.value,
                        }))
                      }
                    />
                  </div>
                  <div className="field timeline-description-field-v118">
                    <label>Description</label>
                    <ClusterTextArea
                      value={form.description}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          description: e.target.value,
                        }))
                      }
                    />
                  </div>
                </div>
                <div className="button-row">
                  <ClusterButton type="button" className="" onClick={saveItem} variant="primary">
                    {editing ? "Save changes" : "Create item"}
                  </ClusterButton>
                  <ClusterButton type="button" className="" onClick={resetForm} variant="secondary">
                    Cancel
                  </ClusterButton>
                  {editing && (
                    <ClusterButton variant="danger" onClick={() => deleteItem(editing)}>
                      Delete
                    </ClusterButton>
                  )}
                </div>
        </ClusterModal>

        <ClusterModal
          open={Boolean(selectedTimelineEntry)}
          onClose={timelineDetailHistory.closeDetail}
          backdropClassName="workspace-detail-backdrop-v254 timeline-detail-backdrop-v254"
          className="timeline-selected-discussion-v227 timeline-detail-fullscreen-v254 panel"
          labelledBy="timeline-detail-title-v393"
        >
          {selectedTimelineEntry && <>
                <header>
                  <div>
                    <span className="eyebrow">Timeline item</span>
                    <h2 id="timeline-detail-title-v393">{selectedTimelineEntry.title}</h2>
                    <p>
                      {compactDateTime(selectedTimelineEntry.startsAt)} · {selectedTimelineEntry.project?.name || timelineSourceLabel(selectedTimelineEntry.source)}
                    </p>
                  </div>
                  <div className="button-row">
                    {manualItems.find((item) => item.id === selectedTimelineEntry.id) && (
                      <ClusterButton type="button"
                        className=""
                        onClick={() => {
                          const item = manualItems.find((candidate) => candidate.id === selectedTimelineEntry.id) || (inspectedTimelineItem?.id === selectedTimelineEntry.id ? inspectedTimelineItem : null);
                          timelineDetailHistory.closeDetail();
                          if (item) editItem(item);
                        }}
                       variant="secondary">
                        Edit
                      </ClusterButton>
                    )}
                    <ClusterButton unstyled type="button" className="cluster-icon-button-v227" onClick={timelineDetailHistory.closeDetail} aria-label="Close selected timeline item">
                      <ClusterIcon name="close" />
                    </ClusterButton>
                  </div>
                </header>
                <div className="timeline-detail-layout-v254">
                  <main>
                    <section className="timeline-detail-summary-v254">
                      <div>
                        <span>Type</span>
                        <strong>{timelineTypeLabel(selectedTimelineEntry.type)}</strong>
                      </div>
                      <div>
                        <span>Source</span>
                        <strong>{timelineSourceLabel(selectedTimelineEntry.source)}</strong>
                      </div>
                      <div>
                        <span>Starts</span>
                        <strong>{new Date(selectedTimelineEntry.startsAt).toLocaleString()}</strong>
                      </div>
                      <div>
                        <span>Ends</span>
                        <strong>{selectedTimelineEntry.endsAt ? new Date(selectedTimelineEntry.endsAt).toLocaleString() : "Open ended"}</strong>
                      </div>
                    </section>
                    <section className="timeline-detail-notes-v254">
                      <h3>Notes</h3>
                      <p>{selectedTimelineEntry.description || "No notes have been added."}</p>
                      {selectedTimelineEntry.externalUrl && (
                        <ClusterLinkButton className="" href={selectedTimelineEntry.externalUrl} target="_blank" rel="noreferrer" variant="secondary">
                          Open linked resource
                        </ClusterLinkButton>
                      )}
                    </section>
                  </main>
                  <aside>
                    {selectedTimelineResource ? <WorkActionMenu context={{ source: { ...selectedTimelineResource, label: selectedTimelineEntry.title }, navigation: selectedTimelineNavigation, projectId: selectedTimelineResource.projectId || null, boardId: selectedTimelineEntry.boardId || null, startsAt: selectedTimelineEntry.startsAt, endsAt: selectedTimelineEntry.endsAt || null }} label={`${selectedTimelineEntry.title} work actions`} allowMention /> : null}
                    {selectedTimelineResource?.projectId ? <LinkedWorkPanel projectId={selectedTimelineResource.projectId} kind={selectedTimelineResource.kind} entityId={selectedTimelineResource.id} compact /> : null}
                    {selectedTimelineResource && selectedTimelineCollaborationKind ? <CollaborationPanel entityType={selectedTimelineCollaborationKind} entityId={selectedTimelineResource.id} currentUser={currentUser} title="Item discussion" users={users} /> : null}
                  </aside>
                </div>
          </>}
        </ClusterModal>
        {loadError && payload ? <RequestErrorState error={loadError} title="Timeline refresh failed" onRetry={() => void loadTimeline()} compact /> : null}
        {status && !loadError && <div className="status-box system-status-box-v053 timeline-status-v153">{status}</div>}
      </div>
    </section>
  );

}
