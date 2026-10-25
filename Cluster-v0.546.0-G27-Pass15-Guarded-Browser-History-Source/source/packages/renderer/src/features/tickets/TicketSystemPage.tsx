import { ClusterNativeSelect, ClusterInput } from "../../components/ClusterNativeControls";
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { api, mutateApi, queryApi } from "../../core/api";
import { compactDateTime } from "../../core/date-time";
import { dedupeBy, unique } from "../../core/storage";
import { ClusterIcon } from "../../components/ClusterIcon";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterEmptyState } from "../../components/ClusterEmptyState";
import { DataViewAggregationStrip, DataViewDerivedFieldBuilder, DataViewFacetBar, DataViewGroupControl, DataViewProjection, DataViewProjectionComposer, DataViewSelectionBar, DataViewSelectionSetBar, selectedDataSummary, useDataViewDrilldownHistory } from "../../components/DataView";
import { ClusterTableToolbar } from "../../components/ClusterTableToolbar";
import { ClusterDataView } from "../../components/ClusterDataView";
import { ClusterDisclosureGroup } from "../../components/ClusterDisclosureGroup";
import { ClusterActionMenu, ClusterBulkActionBar } from "../../components/ClusterContextActions";
import { ClusterSelect } from "../../components/ClusterSelect";
import { ClusterMasterDetail, useClusterDetailHistory } from "../../components/ClusterMasterDetail";
import { TICKET_DATA_FIELDS, clusterDataDerivedSemanticFields, clusterDataSelectionSetFilterGroup, createClusterDataViewLayout, evaluateClusterDataDerivedFields, mergeClusterDataFilterGroups, normalizeClusterDataSorts, planClusterDataDerivedFields, type ClusterDataDerivedField, type ClusterDataExportDelivery, type ClusterDataExportFormat, type ClusterDataGroup, type ClusterDataProjection, type ClusterDataQuery, type ClusterDataSelection, type ClusterDataSelectionSet, type ClusterDataSort, type ClusterDataViewLayout, type ClusterSavedDataView, type ClusterSemanticField } from "@cluster/shared";
import { ClusterDataTable, type ClusterDataTableColumn } from "../../components/ClusterDataTable";
import { requestClusterDataExport } from "../../core/data-export-client";
import { DataExportOperationFeedback } from "../../components/DataExportOperationFeedback";
import { DataExportBuilder } from "../../components/DataExportBuilder";
import { DataImportBuilder } from "../../components/DataImportBuilder";
import { useClusterRowWindow } from "../../components/useClusterRowWindow";
import { useClusterCursorData, type ClusterCursorPage } from "../../components/useClusterCursorData";
import { clusterDataQueryParameter } from "../../components/data-view-query";
import { ClusterSegmentedControl } from "../../components/ClusterSegmentedControl";
import { RequestErrorState } from "../../components/RequestState";
import { CollaborationPanel } from "../../components/CollaborationPanel";
import { SharedWorkWatchControl } from "../../components/SharedWorkWatchControl";
import { SharedWorkEvidencePanel } from "../../components/SharedWorkEvidencePanel";
import { SharedWorkActivityPanel } from "../../components/SharedWorkActivityPanel";
import { ToolPageHeader } from "../../components/ToolPageHeader";
import { collectBoardCards } from "../projects/projects-utils";
import { displayUserName } from "../people/people-utils";
import { PeoplePicker } from "../people/PeoplePicker";
import { CUSTOM_FIELD_VALUES_EVENT, normalizeServerCustomFieldDefinition, useServerCustomFieldDefinitions, useServerCustomFieldValueCollection } from "../custom-fields/custom-field-storage";
import type {
  Board,
  Card,
  Priority,
  Project,
  StudioCustomFieldDefinition,
  TicketCard,
  User,
} from "../application/application-models";
import "./tickets.css";
import { runtimeStyle } from "../../core/runtime-style";
import { usePersistedScrollPosition } from "../../core/perceived-performance";
import { openContextualCreate } from "../create/shared-create-handoff";
import { LinkedWorkPanel } from "../workflow/LinkedWorkPanel";
import { WorkActionMenu } from "../workflow/WorkActionMenu";
import { ProjectDeliveryTicketFollowup } from "../projects/ProjectDeliveryTicketFollowup";
import { CLUSTER_TICKET_WORKSPACE_EVENT, readPendingTicketWorkspaceContext, type ClusterTicketWorkspaceContext } from "./ticket-navigation";
import { ClusterTextArea } from "../../components/ClusterTextArea";
import { ClusterTextInput } from "../../components/ClusterTextInput";

const TICKET_TYPES = ["Task", "Bug", "Feature", "Improvement", "Technical Debt", "Performance", "Regression", "Support", "Incident", "Security", "Access Request", "Infrastructure", "Tooling", "Pipeline", "Build Issue", "Release Request", "Publishing", "Deployment", "Data Migration", "Documentation", "Research", "Localization", "Compliance", "Legal Review", "Art Request", "Design Request", "Audio Request", "Animation Request", "VFX Request", "UI/UX Request", "Production Request", "Marketing Request", "Community Request", "Client Feedback", "Partner Request", "Discussion"] as const;
const TICKET_TYPE_SLUGS = new Set(TICKET_TYPES.map((type) => type.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")));

const DEFAULT_TICKET_PROJECTIONS: ClusterDataProjection[] = [
  { id: "ticket_priority", kind: "grouped", dimensions: ["priority"], measures: [{ id: "count", kind: "count", label: "Tickets" }], limit: 12, drilldown: { mode: "filter", presentation: "table" } },
  { id: "ticket_project", kind: "grouped", dimensions: ["projectName"], measures: [{ id: "count", kind: "count", label: "Tickets" }], limit: 20, drilldown: { mode: "filter", presentation: "table" } },
  { id: "ticket_project_queue", kind: "matrix", dimensions: ["projectName", "queueLane"], measures: [{ id: "count", kind: "count", label: "Tickets" }], limit: 80, drilldown: { mode: "filter", presentation: "table" } },
];

type TicketAutomationResult = {
  customFieldValues: Record<string, string | boolean>;
  labels: string[];
  priority: Priority;
  dueDate?: string | null;
  assigneeId?: string | null;
  deferredActions: unknown[];
  inboxSignals: unknown[];
  matched: unknown[];
};

export type TicketSystemHelpers = {
  customFieldVisible: (field: StudioCustomFieldDefinition, values: Record<string, string | boolean>) => boolean;
  customFieldValueIsEmpty: (value: string | boolean | undefined) => boolean;
  reportLifecycleStage: (card: TicketCard) => string;
  applyTicketAutomations: (...args: any[]) => Promise<TicketAutomationResult>;
};

export type TicketSystemComponents = {
  CustomFieldValuesPanel: ComponentType<any>;
  RelatedRecordsPanel: ComponentType<any>;
  VersionHistoryPanel: ComponentType<any>;
};

export type TicketSystemPageProps = {
  projects: Project[];
  currentUser: User;
  onOpenBoard: (boardId: string) => void;
  onOpenProject: (projectId: string) => void;
  onOpenUser: (userId: string) => void;
  onOpenSharedCreate: (mode: "ticket", context?: { projectId?: string }) => void;
  helpers: TicketSystemHelpers;
  components: TicketSystemComponents;
};

function useNarrowTicketRows() {
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 760px)");
    const update = () => setNarrow(query.matches);
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return narrow;
}

type VirtualTicketListProps = {
  items: TicketCard[];
  selectedIds: Set<string>;
  activeId: string | null;
  ticketType: (card: TicketCard) => string;
  lifecycle: (card: TicketCard) => string;
  assigneeName: (card: TicketCard) => string;
  fieldValue: (card: TicketCard, name: string) => string;
  onToggle: (cardId: string, checked: boolean) => void;
  onOpen: (card: TicketCard) => void;
  scrollKey: string;
  emptyState?: ReactNode;
};

const TicketRow = memo(function TicketRow({ card, selected, active, ticketType, lifecycle, assigneeName, fieldValue, onToggle, onOpen }: { card: TicketCard; selected: boolean; active: boolean; ticketType: (card: TicketCard) => string; lifecycle: (card: TicketCard) => string; assigneeName: (card: TicketCard) => string; fieldValue: (card: TicketCard, name: string) => string; onToggle: (cardId: string, checked: boolean) => void; onOpen: (card: TicketCard) => void }) {
  return (
    <article className={`tickets-row-v184 priority-${card.priority} ${active ? "active" : ""}`}>
      <ClusterInput type="checkbox" checked={selected} onChange={(event) => onToggle(card.id, event.target.checked)} aria-label={`Select ${card.title}`} />
      <ClusterButton unstyled type="button" onClick={() => onOpen(card)}>
        <div><strong>{card.title}</strong><span>{card.projectName} · {card.listTitle}</span></div>
        <div className="tickets-row-chips-v184"><span>{ticketType(card)}</span><span>{lifecycle(card)}</span><span className={`priority-${card.priority}`}>{card.priority}</span></div>
        <em>{assigneeName(card)} · {fieldValue(card, "Department") || fieldValue(card, "Component") || card.boardName}</em>
      </ClusterButton>
    </article>
  );
});

function VirtualTicketList(props: VirtualTicketListProps) {
  const narrow = useNarrowTicketRows();
  const rowHeight = narrow ? 116 : 76;
  const overscan = 8;
  const viewportHeight = Math.min(narrow ? 620 : 720, Math.max(rowHeight * 4, props.items.length * rowHeight));
  const { elementRef, scrollTop, onScroll } = usePersistedScrollPosition(props.scrollKey);
  const rowWindow = useClusterRowWindow({ itemCount: props.items.length, rowHeight, viewportHeight, scrollTop, overscan });
  if (!props.items.length) return <>{props.emptyState || <ClusterEmptyState compact kind="empty" icon="ticket" title="No tickets in this queue" description="New tickets that belong in this queue will appear here." />}</>;
  const start = rowWindow.start;
  const end = rowWindow.end;
  return (
    <div ref={elementRef} className="tickets-list-v184 tickets-virtual-list-v296" style={runtimeStyle({ height: viewportHeight })} onScroll={onScroll} role="list" aria-label={`${props.items.length} tickets`}>
      <div className="tickets-virtual-spacer-v296" style={runtimeStyle({ height: rowWindow.totalHeight })}>
        {props.items.slice(start, end).map((card, index) => (
          <div className="tickets-virtual-row-v296" key={card.id} style={runtimeStyle({ height: rowHeight, transform: `translateY(${(start + index) * rowHeight}px)` })} role="listitem">
            <TicketRow card={card} selected={props.selectedIds.has(card.id)} active={props.activeId === card.id} ticketType={props.ticketType} lifecycle={props.lifecycle} assigneeName={props.assigneeName} fieldValue={props.fieldValue} onToggle={props.onToggle} onOpen={props.onOpen} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function TicketSystemPageFeature({
  projects,
  currentUser,
  onOpenBoard,
  onOpenProject,
  onOpenUser,
  onOpenSharedCreate,
  helpers,
  components,
}: TicketSystemPageProps) {
  const {
    customFieldVisible,
    customFieldValueIsEmpty,
    reportLifecycleStage,
    applyTicketAutomations,
  } = helpers;
  const { CustomFieldValuesPanel, RelatedRecordsPanel, VersionHistoryPanel } = components;

  const [boards, setBoards] = useState<Board[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [queue, setQueue] = useState<"triage" | "open" | "urgent" | "waiting" | "review" | "resolved" | "rejected" | "all">("all");
  const [queueView, setQueueView] = useState<"list" | "table">("list");
  const [ticketSorts, setTicketSorts] = useState<ClusterDataSort[]>([{ fieldId: "updated", direction: "desc" }]);
  const [ticketGroups, setTicketGroups] = useState<ClusterDataGroup[]>([]);
  const [ticketProjections, setTicketProjections] = useState<ClusterDataProjection[]>(() => DEFAULT_TICKET_PROJECTIONS);
  const [ticketDerivedFields, setTicketDerivedFields] = useState<ClusterDataDerivedField[]>([]);
  const ticketPortableDerivedPlan = useMemo(() => planClusterDataDerivedFields(ticketDerivedFields, TICKET_DATA_FIELDS), [ticketDerivedFields]);
  const ticketAnalyticalFields = useMemo<ClusterSemanticField[]>(() => [...TICKET_DATA_FIELDS, ...clusterDataDerivedSemanticFields(ticketPortableDerivedPlan.fields)], [ticketPortableDerivedPlan.fields]);
  const ticketExportFields = ticketAnalyticalFields;
  const [ticketAnalyticalSelection, setTicketAnalyticalSelection] = useState<ClusterDataSelection | null>(null);
  const [ticketAnalyticalSelectionSet, setTicketAnalyticalSelectionSet] = useState<ClusterDataSelectionSet>({ logic: "or", selections: [] });
  const [ticketTableLayout, setTicketTableLayout] = useState<ClusterDataViewLayout | null>(null);
  const [ticketCursorRefresh, setTicketCursorRefresh] = useState(0);
  const [projectId, setProjectId] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  const [customFieldFilterId, setCustomFieldFilterId] = useState("");
  const [customFieldFilterValue, setCustomFieldFilterValue] = useState("");
  const customFieldDefinitionStore = useServerCustomFieldDefinitions(normalizeServerCustomFieldDefinition);
  const [boardId, setBoardId] = useState("");
  const [listId, setListId] = useState("");
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const [showCreate, setShowCreate] = useState(false);
  const [showAdvancedCreate, setShowAdvancedCreate] = useState(false);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [ticketExporting, setTicketExporting] = useState(false);
  const [ticketExportJobId, setTicketExportJobId] = useState("");
  const [ticketExportStatus, setTicketExportStatus] = useState("");
  const ticketDrilldown = useDataViewDrilldownHistory(
    { queue, projectId, priorityFilter, assigneeFilter, selection: ticketAnalyticalSelection, selectionSet: ticketAnalyticalSelectionSet, queueView },
    (snapshot) => { setQueue(snapshot.queue); setProjectId(snapshot.projectId); setPriorityFilter(snapshot.priorityFilter); setAssigneeFilter(snapshot.assigneeFilter); setTicketAnalyticalSelection(snapshot.selection); setTicketAnalyticalSelectionSet(snapshot.selectionSet); setQueueView(snapshot.queueView); },
  );
  const [bulkPriority, setBulkPriority] = useState<Priority>("medium");
  const [bulkLabel, setBulkLabel] = useState("");
  const [bulkAssigneeId, setBulkAssigneeId] = useState("");
  const [form, setForm] = useState({
    title: "",
    severity: "medium" as Priority,
    type: "Task",
    assigneeId: "",
    description: "",
    acceptance: "",
    source: "",
    platform: "",
    buildNumber: "",
    component: "",
    department: "",
    labels: "",
    dueDate: "",
  });
  const [customValues, setCustomValues] = useState<Record<string, string | boolean>>({});
  const [status, setStatus] = useState("");
  const [loadError, setLoadError] = useState<unknown>(null);
  const [createError, setCreateError] = useState("");
  useEffect(() => {
    const applyWorkspaceContext = (context: ClusterTicketWorkspaceContext | null | undefined) => {
      if (!context) return;
      if (context.assigneeId) {
        setAssigneeFilter(context.assigneeId);
        setQueue("open");
      }
      if (context.projectId) {
        setProjectId(context.projectId);
        setQueue("open");
      }
      if (context.query) {
        setQuery(context.query);
        setQueue("all");
      }
    };
    applyWorkspaceContext(readPendingTicketWorkspaceContext());
    const onWorkspaceContext = (event: Event) => applyWorkspaceContext((event as CustomEvent<ClusterTicketWorkspaceContext>).detail);
    window.addEventListener(CLUSTER_TICKET_WORKSPACE_EVENT, onWorkspaceContext);
    return () => window.removeEventListener(CLUSTER_TICKET_WORKSPACE_EVENT, onWorkspaceContext);
  }, []);
  const ticketTypes = TICKET_TYPES;
const ticketTypeSlugs = TICKET_TYPE_SLUGS;
  function ticketCustomFieldControl(field: StudioCustomFieldDefinition) {
    const value = customValues[field.id] ?? field.defaultValue ?? "";
    if (field.fieldType === "boolean")
      return (
        <label className="tool-check" key={field.id}>
          <ClusterInput
            type="checkbox"
            checked={Boolean(value)}
            onChange={(event) =>
              setCustomValues((prev) => ({
                ...prev,
                [field.id]: event.target.checked,
              }))
            }
          />{" "}
          {field.label}
          {field.required ? " *" : ""}
          {field.helpText && <small>{field.helpText}</small>}
        </label>
      );
    if (["select", "department", "user"].includes(field.fieldType))
      return (
        <div className="field" key={field.id}>
          <label>
            {field.label}
            {field.required ? " *" : ""}
          </label>
          <ClusterNativeSelect
            value={String(value || "")}
            onChange={(event) =>
              setCustomValues((prev) => ({
                ...prev,
                [field.id]: event.target.value,
              }))
            }
          >
            <option value="">{field.placeholder || "Select"}</option>
            {(field.options || []).map((option) => (
              <option key={option}>{option}</option>
            ))}
          </ClusterNativeSelect>
          {field.helpText && <small>{field.helpText}</small>}
        </div>
      );
    if (field.fieldType === "multi-select") {
      const selected = String(value || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
      return (
        <div className="field" key={field.id}>
          <label>
            {field.label}
            {field.required ? " *" : ""}
          </label>
          <div className="custom-multiselect-v199">
            {(field.options || []).map((option) => (
              <label className="tool-check compact" key={option}>
                <ClusterInput
                  type="checkbox"
                  checked={selected.includes(option)}
                  onChange={(event) =>
                    setCustomValues((prev) => ({
                      ...prev,
                      [field.id]: event.target.checked ? unique([...selected, option]).join(", ") : selected.filter((item) => item !== option).join(", "),
                    }))
                  }
                />{" "}
                {option}
              </label>
            ))}
          </div>
          {field.helpText && <small>{field.helpText}</small>}
        </div>
      );
    }
    return (
      <div className="field" key={field.id}>
        <label>
          {field.label}
          {field.required ? " *" : ""}
        </label>
        <ClusterInput
          type={field.fieldType === "number" || field.fieldType === "duration" ? "number" : field.fieldType === "date" ? "date" : field.fieldType === "url" ? "url" : "text"}
          min={field.fieldType === "duration" ? "0" : undefined}
          placeholder={field.placeholder || ""}
          value={String(value || "")}
          onChange={(event) =>
            setCustomValues((prev) => ({
              ...prev,
              [field.id]: event.target.value,
            }))
          }
        />
        {field.fieldType === "duration" && <small>Minutes</small>}
        {field.helpText && <small>{field.helpText}</small>}
      </div>
    );
  }
  const loadRequestRef = useRef<AbortController | null>(null);
  const loadTickets = useCallback(async (force = false) => {
    loadRequestRef.current?.abort();
    setLoadError(null);
    const controller = new AbortController();
    loadRequestRef.current = controller;
    let workspace: { boards: Board[]; users: User[] };
    try {
      workspace = await queryApi<{ boards: Board[]; users: User[] }>("/api/tickets/workspace?detail=summary", {
        staleMs: 5_000,
        maxAgeMs: 30 * 60 * 1000,
        staleWhileRevalidate: true,
        force,
        signal: controller.signal,
        tags: ["tickets", "workspace"],
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      throw error;
    }
    if (controller.signal.aborted) return;
    const nextBoards = workspace.boards || [];
    setBoards(nextBoards);
    setUsers((workspace.users || []).filter((user) => !user.archived));
    setTicketCursorRefresh((current) => current + 1);
  }, []);
  useEffect(() => {
    void loadTickets().catch((err) => {
      if (err instanceof Error && err.name === "AbortError") return;
      setLoadError(err);
    });
    const refresh = () => void loadTickets(true).catch(() => undefined);
    window.addEventListener("cluster-ticket-workspace-changed", refresh);
    return () => {
      loadRequestRef.current?.abort();
      window.removeEventListener("cluster-ticket-workspace-changed", refresh);
    };
  }, [projects.length, loadTickets]);
  const cards = useMemo(() => collectBoardCards(boards), [boards]);
  const availableProjects = useMemo(() => dedupeBy([...projects, ...boards.map((board) => board.project)], (project) => project.id), [projects, boards]);
  const userById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const workspaceTickets = useMemo(() => cards.filter((card) => card.workItemKind === "ticket"), [cards]);
  const ticketServerSorts = useMemo<ClusterDataSort[]>(() => {
    const normalized = normalizeClusterDataSorts(ticketSorts, new Set(["ticket", "updated"]));
    if (normalized.length !== 1) return [];
    const sort = normalized[0];
    return [{ fieldId: sort.fieldId === "ticket" ? "title" : "updatedAt", direction: sort.direction }];
  }, [ticketSorts]);
  const ticketServerGroups = useMemo<ClusterDataGroup[]>(() => {
    if (typeFilter || customFieldFilterId || customFieldFilterValue) return [];
    const fieldMap: Record<string, string> = { priority: "priority", queue: "listTitle" };
    if (!ticketGroups.length || ticketGroups.length > 2 || ticketGroups.some((group) => !fieldMap[group.fieldId])) return [];
    return ticketGroups.map((group) => ({ ...group, fieldId: fieldMap[group.fieldId] }));
  }, [ticketGroups, typeFilter, customFieldFilterId, customFieldFilterValue]);
  const ticketServerDataQuery = useMemo<ClusterDataQuery>(() => {
    const conditions = [
      ...(queue !== "all" ? [{ fieldId: "queueLane", operator: "equals" as const, value: queue }] : []),
      ...(projectId ? [{ fieldId: "projectId", operator: "equals" as const, value: projectId }] : []),
      ...(priorityFilter ? [{ fieldId: "priority", operator: "equals" as const, value: priorityFilter }] : []),
      ...(assigneeFilter === "unassigned" ? [{ fieldId: "assigneeId", operator: "is_empty" as const }] : assigneeFilter ? [{ fieldId: "assigneeId", operator: "equals" as const, value: assigneeFilter }] : []),
    ];
    return {
      search: deferredQuery.trim() || undefined,
      filters: mergeClusterDataFilterGroups(conditions.length ? { logic: "and", conditions } : null, clusterDataSelectionSetFilterGroup(ticketAnalyticalSelectionSet)),
      sorts: ticketServerSorts,
      facets: ["queueLane", "priority", "projectName", "listTitle"],
      aggregations: [{ id: "count", kind: "count", label: "Tickets" }],
      groups: ticketServerGroups,
      projections: ticketProjections,
      derivedFields: ticketPortableDerivedPlan.fields,
    };
  }, [deferredQuery, queue, projectId, priorityFilter, assigneeFilter, ticketServerSorts, ticketServerGroups, ticketProjections, ticketPortableDerivedPlan.fields, ticketAnalyticalSelectionSet]);
  const ticketServerQueryKey = useMemo(() => JSON.stringify(ticketServerDataQuery), [ticketServerDataQuery]);
  const ticketCursor = useClusterCursorData<TicketCard>({
    resetKey: `${ticketCursorRefresh}:${ticketServerQueryKey}`,
    rowKey: (card) => card.id,
    placeholderRows: deferredQuery.trim() ? [] : workspaceTickets,
    loadPage: async (cursor): Promise<ClusterCursorPage<TicketCard>> => queryApi<ClusterCursorPage<TicketCard>>(`/api/tickets/data-view?limit=80&dataQuery=${clusterDataQueryParameter(ticketServerDataQuery)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { staleMs: 3_000, maxAgeMs: 60_000, force: Boolean(cursor), tags: ["tickets", "data-view"] }),
  });
  const tickets = ticketCursor.rows;
  const selectedTicket = useMemo(() => tickets.find((card) => card.id === selectedTicketId) || null, [tickets, selectedTicketId]);
  function openTicketSchedule(target: "calendar" | "time", ticket: TicketCard) {
    const start = ticket.dueDate ? new Date(ticket.dueDate) : new Date();
    if (Number.isNaN(start.getTime())) start.setTime(Date.now());
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    openContextualCreate(target === "time" ? "scheduler" : target, {
      projectId: ticket.projectId,
      boardId: ticket.boardId,
      assigneeId: ticket.assigneeId || undefined,
      priority: ticket.priority,
      dueDate: ticket.dueDate || undefined,
      labels: ticket.labels,
      title: `${target === "calendar" ? "Review" : "Work"}: ${ticket.title}`,
      details: ticket.description || undefined,
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      calendarType: target === "calendar" ? "review" : undefined,
      timeBlockType: target === "time" ? "work" : undefined,
      source: { kind: "ticket", id: ticket.id, projectId: ticket.projectId, label: ticket.title },
      relationship: "scheduled_by",
    });
  }
  const restoreTicketDetail = useCallback((id: string | null) => setSelectedTicketId(id), []);
  const ticketDetailHistory = useClusterDetailHistory("ticket", selectedTicketId, restoreTicketDetail);
  const ticketValueEntries = useMemo(() => tickets.map((card) => ({ entityId: card.id, projectId: card.projectId || null })), [tickets]);
  const ticketValueStore = useServerCustomFieldValueCollection("ticket", ticketValueEntries);
  const ticketCustomFieldRecords = ticketValueStore.values;
  const customFieldRecordByKey = useMemo(() => new Map(ticketCustomFieldRecords.map((record) => [`${record.entity}:${record.entityId}:${record.fieldId}`, record])), [ticketCustomFieldRecords]);
  const ticketCustomFields = customFieldDefinitionStore.definitions.filter((field) => field.entity === "ticket" && field.enabled !== false && !field.archivedAt);
  const visibleTicketCustomFields = ticketCustomFields.filter((field) => customFieldVisible(field, customValues));
  const selectedCustomFieldFilter = ticketCustomFields.find((field) => field.id === customFieldFilterId) || null;
  const customFieldFilterOptions =
    selectedCustomFieldFilter?.options ||
    unique(
      ticketCustomFieldRecords
        .filter((record) => record.fieldId === customFieldFilterId)
        .map((record) => String(record.value))
        .filter(Boolean),
    );
  const isClosed = useCallback((card: TicketCard) => card.ticketStage ? ["resolved", "rejected"].includes(card.ticketStage) : Boolean(card.listIsDone || /done|closed|complete|approved|resolved|shipped/i.test(card.listTitle)), []);
  const ticketType = useCallback((card: TicketCard) => {
    const typeLine = (card.description || "").match(/^Type:\s*(.+)$/im)?.[1]?.trim();
    if (typeLine) return typeLine;
    const label = card.labels.find((item) => ticketTypeSlugs.has(item.toLowerCase()));
    return label ? label.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) : "Task";
  }, [ticketTypeSlugs]);
  const fieldValue = useCallback((card: TicketCard, name: string) => (card.description || "").match(new RegExp(`^${name}:\\s*(.+)$`, "im"))?.[1]?.trim() || "", []);
  const assigneeName = useCallback((card: TicketCard) => (card.assignee ? displayUserName(card.assignee) : card.assigneeId && userById.has(card.assigneeId) ? displayUserName(userById.get(card.assigneeId) as User) : "Unassigned"), [userById]);
  const lifecycle = useCallback((card: TicketCard) => reportLifecycleStage(card), [reportLifecycleStage]);
  const openTickets = useMemo(() => tickets.filter((card) => !isClosed(card)), [tickets, isClosed]);
  const resolvedTickets = useMemo(() => tickets.filter((card) => card.ticketStage === "resolved"), [tickets]);
  const rejectedTickets = useMemo(() => tickets.filter((card) => card.ticketStage === "rejected"), [tickets]);
  const triageTickets = useMemo(() => openTickets.filter((card) => card.ticketStage ? card.ticketStage === "new" : !card.labels.includes("triaged") && !card.labels.includes("rejected") && (!card.assigneeId || card.labels.includes("intake"))), [openTickets]);
  const urgentTickets = useMemo(() => openTickets.filter((card) => ["urgent", "high"].includes(card.priority)), [openTickets]);
  const waitingTickets = useMemo(() => openTickets.filter((card) => card.ticketStage ? card.ticketStage === "waiting" : /waiting|blocked|hold|pending/i.test(`${card.listTitle} ${card.labels.join(" ")}`)), [openTickets]);
  const reviewTickets = useMemo(() => openTickets.filter((card) => card.ticketStage ? card.ticketStage === "review" : /review|approval|verify|validation/i.test(`${card.listTitle} ${card.labels.join(" ")}`)), [openTickets]);
  const visibleBoards = useMemo(() => boards.filter((board) => !projectId || board.project.id === projectId), [boards, projectId]);
  const selectedBoard = useMemo(() => visibleBoards.find((board) => board.id === boardId) || null, [boardId, visibleBoards]);
  const visibleLists = selectedBoard?.lists || [];
  const sourceQueue = useMemo(() => queue === "all" ? tickets : queue === "triage" ? triageTickets : queue === "urgent" ? urgentTickets : queue === "waiting" ? waitingTickets : queue === "review" ? reviewTickets : queue === "resolved" ? resolvedTickets : queue === "rejected" ? rejectedTickets : openTickets, [queue, tickets, triageTickets, urgentTickets, waitingTickets, reviewTickets, resolvedTickets, rejectedTickets, openTickets]);
  const needle = deferredQuery.trim().toLowerCase();
  const filteredTickets = useMemo(() => sourceQueue.filter((card) => {
    if (projectId && card.projectId !== projectId) return false;
    if (typeFilter && ticketType(card) !== typeFilter) return false;
    if (priorityFilter && card.priority !== priorityFilter) return false;
    if (assigneeFilter === "unassigned" && card.assigneeId) return false;
    if (assigneeFilter && assigneeFilter !== "unassigned" && card.assigneeId !== assigneeFilter) return false;
    if (customFieldFilterId) {
      const fieldRecord = customFieldRecordByKey.get(`ticket:${card.id}:${customFieldFilterId}`);
      const actual = String(fieldRecord?.value ?? "");
      if (customFieldFilterValue && actual.toLowerCase() !== customFieldFilterValue.toLowerCase()) return false;
      if (!customFieldFilterValue && !actual) return false;
    }
    return true;
  }), [sourceQueue, projectId, typeFilter, priorityFilter, assigneeFilter, customFieldFilterId, customFieldFilterValue, customFieldRecordByKey, ticketType]);
  const hasTicketFilters = Boolean(needle || projectId || typeFilter || priorityFilter || assigneeFilter || customFieldFilterId || customFieldFilterValue);
  const ticketDataView = useMemo(() => ({
    presentation: queueView,
    density: "comfortable" as const,
    query: {
      search: query,
      sorts: ticketSorts,
      groups: ticketGroups,
      projections: ticketProjections,
      derivedFields: ticketDerivedFields,
      filters: {
        logic: "and" as const,
        conditions: [
          ...(queue !== "all" ? [{ fieldId: "queue_lane", operator: "equals" as const, value: queue }] : []),
          ...(projectId ? [{ fieldId: "project", operator: "equals" as const, value: projectId }] : []),
          ...(typeFilter ? [{ fieldId: "type", operator: "equals" as const, value: typeFilter }] : []),
          ...(priorityFilter ? [{ fieldId: "priority", operator: "equals" as const, value: priorityFilter }] : []),
          ...(assigneeFilter ? [{ fieldId: "assignee", operator: "equals" as const, value: assigneeFilter }] : []),
          ...(customFieldFilterId ? [{ fieldId: `custom:${customFieldFilterId}`, operator: "equals" as const, value: customFieldFilterValue || "__populated__" }] : []),
        ],
      },
    },
    layout: ticketTableLayout || createClusterDataViewLayout(["ticket", "type", "stage", "priority", "assignee", "queue", "due", "updated", ...ticketDerivedFields.map((field) => field.id)]),
  }), [queueView, query, ticketSorts, ticketGroups, ticketProjections, ticketDerivedFields, queue, projectId, typeFilter, priorityFilter, assigneeFilter, customFieldFilterId, customFieldFilterValue, ticketTableLayout]);
  function applySavedTicketDataView(view: ClusterSavedDataView) {
    setQuery(view.query.search || "");
    const conditions = view.query.filters?.conditions || [];
    const valueFor = (fieldId: string) => { const condition = conditions.find((item) => item.fieldId === fieldId && item.operator === "equals"); return typeof condition?.value === "string" ? condition.value : ""; };
    const savedQueue = valueFor("queue_lane");
    setQueue((["triage", "open", "urgent", "waiting", "review", "resolved", "rejected"] as string[]).includes(savedQueue) ? savedQueue as typeof queue : "all");
    setProjectId(valueFor("project"));
    setTypeFilter(valueFor("type"));
    setPriorityFilter(valueFor("priority"));
    setAssigneeFilter(valueFor("assignee"));
    const custom = conditions.find((item) => item.fieldId.startsWith("custom:") && item.operator === "equals");
    setCustomFieldFilterId(custom ? custom.fieldId.slice("custom:".length) : "");
    setCustomFieldFilterValue(custom && typeof custom.value === "string" && custom.value !== "__populated__" ? custom.value : "");
    setTicketSorts(view.query.sorts?.length ? view.query.sorts : [{ fieldId: "updated", direction: "desc" }]);
    setTicketGroups((view.query.groups || []).slice(0, 3));
    setTicketProjections(view.query.projections?.length ? view.query.projections : DEFAULT_TICKET_PROJECTIONS);
    setTicketDerivedFields(view.query.derivedFields || []);
    setTicketAnalyticalSelection(null);
    setTicketAnalyticalSelectionSet({ logic: "or", selections: [] });
    if (view.presentation === "list" || view.presentation === "table") setQueueView(view.presentation);
    setTicketTableLayout(view.layout);
    setSelectedIds([]);
  }
  function applyTicketAnalyticalSelection(selection: ClusterDataSelection | null) {
    if (selection) ticketDrilldown.capture();
    setTicketAnalyticalSelectionSet({ logic: "or", selections: [] });
    setTicketAnalyticalSelection(selection);
    if (!selection) return;
    for (const condition of selection.conditions) {
      const value = condition.operator === "equals" && typeof condition.value === "string" ? condition.value : "";
      if (condition.fieldId === "priority" && ["urgent", "high", "medium", "low"].includes(value)) setPriorityFilter(value);
      if (condition.fieldId === "queueLane" && ["open", "triage", "urgent", "waiting", "review", "resolved", "rejected"].includes(value)) setQueue(value as typeof queue);
      if (condition.fieldId === "projectName") { const project = availableProjects.find((candidate) => candidate.name === value); if (project) setProjectId(project.id); }
    }
  }
  const clearTicketFilters = useCallback(() => {
    ticketDrilldown.reset();
    setTicketAnalyticalSelection(null);
    setTicketAnalyticalSelectionSet({ logic: "or", selections: [] });
    setQuery("");
    setProjectId("");
    setTypeFilter("");
    setPriorityFilter("");
    setAssigneeFilter("");
    setCustomFieldFilterId("");
    setCustomFieldFilterValue("");
  }, []);
  const applyCardPatch = useCallback((cardId: string, patch: Partial<Card>) => {
    setBoards((currentBoards) => currentBoards.map((board) => ({
      ...board,
      lists: board.lists.map((list) => ({
        ...list,
        cards: list.cards.map((card) => card.id === cardId ? { ...card, ...patch } : card),
      })),
    })));
  }, []);

  async function createTicket() {
    if (!form.title.trim()) return;
    setCreateError("");
    setStatus("");
    try {
      const targetBoard = selectedBoard;
      const targetList = targetBoard?.lists.find((list) => list.id === listId && !list.isDone);
      if (projectId && (!targetBoard || !targetList)) {
        setCreateError("Choose the Project's destination Board and an active List before creating a Ticket. No Board will be changed automatically.");
        return;
      }
      const targetListId = targetList?.id || null;
      const automation = await applyTicketAutomations(
        {
          ...form,
          projectId: targetBoard?.project.id || projectId || "",
          dueDate: form.dueDate,
          customValues,
        },
        users,
      );
      const effectiveCustomValues = automation.customFieldValues;
      const effectiveVisibleTicketCustomFields = ticketCustomFields.filter((field) => customFieldVisible(field, effectiveCustomValues));
      const missingRequired = effectiveVisibleTicketCustomFields.filter((field) => field.required && customFieldValueIsEmpty(effectiveCustomValues[field.id]));
      if (missingRequired.length) {
        setCreateError(`Complete required fields: ${missingRequired.map((field) => field.label).join(", ")}.`);
        return;
      }
      const customLines = effectiveVisibleTicketCustomFields
        .map((field) => {
          const value = effectiveCustomValues[field.id];
          if (value === undefined || value === "") return "";
          return `${field.label}: ${typeof value === "boolean" ? (value ? "Yes" : "No") : value}`;
        })
        .filter(Boolean);
      const description = [`Type: ${form.type}`, form.department ? `Department: ${form.department}` : "", form.component ? `Component: ${form.component}` : "", form.source ? `Source: ${form.source}` : "", form.platform ? `Platform: ${form.platform}` : "", form.buildNumber ? `Build: ${form.buildNumber}` : "", ...customLines, form.description ? `Details:\n${form.description}` : "", form.acceptance ? `Acceptance criteria:\n${form.acceptance}` : ""].filter(Boolean).join("\n\n");
      const manualLabels = form.labels
        .split(",")
        .map((label) => label.trim())
        .filter(Boolean);
      const labels = unique([
        "intake",
        form.type
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, ""),
        ...manualLabels,
        ...automation.labels,
        ...(automation.inboxSignals.length ? ["inbox-attention"] : []),
      ]);
      const ticketPayload = {
        projectId: projectId || null, boardId: projectId ? targetBoard?.id || null : null, listId: targetListId, title: form.title.trim(), description,
        priority: automation.priority, labels, dueDate: automation.dueDate || null, assigneeId: automation.assigneeId || null,
        automationContext: { type: form.type, department: form.department, severity: form.severity, labels: form.labels, customValues: effectiveCustomValues },
        automationActions: automation.deferredActions,
      };
      const createResult = await mutateApi<Card & { projectId?: string; projectName?: string; boardId?: string; boardName?: string; listTitle?: string }>("/api/tickets", {
        method: "POST", body: ticketPayload, label: `Create ticket ${ticketPayload.title}`, entityType: "ticket", resourceKind: "tickets", resourceId: projectId || "studio",
        localSnapshot: ticketPayload, changedFields: Object.keys(ticketPayload), invalidate: ["/api/tickets", "/api/projects"],
      });
      const createdCard = createResult.result;
      if (createResult.queued || !createdCard) {
        setForm({ title: "", severity: "medium", type: form.type, assigneeId: "", description: "", acceptance: "", source: "", platform: "", buildNumber: "", component: "", department: "", labels: "", dueDate: "" });
        setCustomValues({}); setShowCreate(false); setQueue("all");
        setStatus("Ticket stored on this device and queued for synchronization.");
        window.dispatchEvent(new Event("cluster-ticket-workspace-changed"));
        return;
      }
      const createdValues = effectiveVisibleTicketCustomFields.flatMap((field) => {
        const value = effectiveCustomValues[field.id];
        if (value === undefined || value === "") return [];
        return [{
          id: `ticket:${createdCard.id}:${field.id}`,
          entity: "ticket" as const,
          entityId: createdCard.id,
          fieldId: field.id,
          projectId: createdCard.projectId || targetBoard?.project.id || projectId || null,
          value,
          updatedAt: new Date().toISOString(),
          updatedBy: currentUser.id,
        }];
      });
      let customFieldWriteFailures = 0;
      for (const record of createdValues) {
        try {
          await mutateApi(`/api/custom-fields/values/ticket/${encodeURIComponent(record.entityId)}/${encodeURIComponent(record.fieldId)}`, {
            method: "PUT",
            body: { payload: record },
            label: `Save ticket custom field ${record.fieldId}`,
            dedupeKey: `custom-field-value:${record.id}`,
            entityType: "custom_field_value",
            entityId: record.id,
            resourceKind: "customFieldValue",
            resourceId: record.id,
            localSnapshot: record as unknown as Record<string, unknown>,
            changedFields: ["value"],
            invalidate: ["/api/custom-fields/values"],
          });
        } catch {
          customFieldWriteFailures += 1;
        }
      }
      if (createdValues.length) window.dispatchEvent(new CustomEvent(CUSTOM_FIELD_VALUES_EVENT));
      setForm({
        title: "",
        severity: "medium",
        type: form.type,
        assigneeId: "",
        description: "",
        acceptance: "",
        source: "",
        platform: "",
        buildNumber: "",
        component: "",
        department: "",
        labels: "",
        dueDate: "",
      });
      setCustomValues({});
      setShowCreate(false);
      setQueue("all");
      setStatus(`Ticket created in ${createdCard.projectName || "Studio tickets"}${automation.matched.length ? ` · ${automation.matched.length} automation rule${automation.matched.length === 1 ? "" : "s"} applied` : ""}${customFieldWriteFailures ? ` · ${customFieldWriteFailures} custom field update${customFieldWriteFailures === 1 ? "" : "s"} need retry` : ""}.`);
      await loadTickets(true);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Could not create ticket.");
    }
  }
  async function patchTicketStage(card: TicketCard, ticketStage: NonNullable<TicketCard["ticketStage"]>) {
    const body = { ticketStage, expectedRevision: card.revision };
    const result = await mutateApi(`/api/cards/${card.id}`, { method: "PATCH", body, label: `Change Ticket ${card.title} to ${ticketStage}`, dedupeKey: `ticket:${card.id}:stage`, entityType: "ticket", entityId: card.id, resourceKind: "tickets", resourceId: card.projectId || "studio", baseRevision: card.revision, baseSnapshot: card as unknown as Record<string, unknown>, localSnapshot: body, changedFields: ["ticketStage"], invalidate: ["/api/tickets", "/api/projects"] });
    applyCardPatch(card.id, { ticketStage });
    setStatus(result.queued ? "Ticket stage queued for synchronization." : `Ticket stage updated to ${ticketStage}.`);
    window.dispatchEvent(new Event("cluster-ticket-workspace-changed"));
  }
  async function patchTicketPriority(card: TicketCard, priority: string) {
    if (!["low", "medium", "high", "urgent"].includes(priority)) throw new Error("Choose a valid ticket priority.");
    const body = { listId: card.listId, title: card.title, description: card.description || "", priority, dueDate: card.dueDate || null, labels: card.labels, assigneeId: card.assigneeId || null };
    const result = await mutateApi(`/api/cards/${card.id}`, { method: "PATCH", body, label: `Update ticket ${card.title} priority`, dedupeKey: `ticket:${card.id}:priority`, entityType: "ticket", entityId: card.id, resourceKind: "tickets", resourceId: card.projectId || "studio", baseRevision: card.revision, baseSnapshot: card as unknown as Record<string, unknown>, localSnapshot: body, changedFields: ["priority"], invalidate: ["/api/tickets", "/api/projects"] });
    applyCardPatch(card.id, { priority: priority as Priority });
    setStatus(`${result.queued ? "Queued priority update for" : "Updated"} ${card.title}.`);
    window.dispatchEvent(new Event("cluster-ticket-workspace-changed"));
  }

  async function patchTickets(patchFactory: (card: TicketCard) => Record<string, unknown>) {
    const targets = tickets.filter((card) => selectedIdSet.has(card.id));
    if (!targets.length) return;
    const patches = new Map<string, Record<string, unknown>>(targets.map((card) => [card.id, patchFactory(card)]));
    const results = await Promise.all(targets.map((card) => {
      const patch = patches.get(card.id) || {};
      const body = { listId: card.listId, title: card.title, description: card.description || "", priority: card.priority, dueDate: card.dueDate || null, labels: card.labels, assigneeId: card.assigneeId || null, ...patch };
      return mutateApi(`/api/cards/${card.id}`, { method: "PATCH", body, label: `Update ticket ${card.title}`, dedupeKey: `ticket:${card.id}`, entityType: "ticket", entityId: card.id, resourceKind: "tickets", resourceId: card.projectId || "studio", baseRevision: card.revision, baseSnapshot: card as unknown as Record<string, unknown>, localSnapshot: body, changedFields: Object.keys(patch), invalidate: ["/api/tickets", "/api/projects"] });
    }));
    targets.forEach((card) => applyCardPatch(card.id, patches.get(card.id) as Partial<Card>));
    setSelectedIds([]);
    setStatus(`${results.some((result) => result.queued) ? "Queued updates for" : "Updated"} ${targets.length} ticket${targets.length === 1 ? "" : "s"}.`);
    window.dispatchEvent(new Event("cluster-ticket-workspace-changed"));
  }
  async function assignTicket(card: TicketCard, assigneeId: string) {
    const body = { listId: card.listId, title: card.title, description: card.description || "", priority: card.priority, dueDate: card.dueDate || null, labels: card.labels, assigneeId: assigneeId || null };
    const result = await mutateApi(`/api/cards/${card.id}`, { method: "PATCH", body, label: `Assign ticket ${card.title}`, dedupeKey: `ticket:${card.id}`, entityType: "ticket", entityId: card.id, resourceKind: "tickets", resourceId: card.projectId || "studio", baseRevision: card.revision, baseSnapshot: card as unknown as Record<string, unknown>, localSnapshot: body, changedFields: ["assigneeId"], invalidate: ["/api/tickets", "/api/projects"] });
    const assignee = users.find((user) => user.id === assigneeId) || null;
    applyCardPatch(card.id, { assigneeId: assigneeId || null, assignee });
    setStatus(result.queued ? "Assignment queued for synchronization." : assigneeId && assignee ? `Assigned ticket to ${displayUserName(assignee)}.` : "Ticket unassigned.");
    window.dispatchEvent(new Event("cluster-ticket-workspace-changed"));
  }
  async function triageTicket(card: TicketCard, action: "accept" | "info" | "duplicate" | "snooze" | "reject") {
    const labels = new Set(card.labels.filter((label) => label !== "intake"));
    let assigneeId = card.assigneeId || null;
    if (action === "accept") {
      labels.add("triaged");
      assigneeId = assigneeId || currentUser.id;
    }
    if (action === "info") labels.add("needs-info");
    if (action === "duplicate") {
      labels.add("duplicate");
      labels.add("triaged");
    }
    if (action === "snooze") labels.add("snoozed");
    if (action === "reject") {
      labels.add("rejected");
      labels.add("triaged");
    }
    const ticketStage: NonNullable<TicketCard["ticketStage"]> = action === "accept" ? "accepted" : action === "info" || action === "snooze" ? "waiting" : "rejected";
    const body = { listId: card.listId, title: card.title, description: card.description || "", priority: card.priority, dueDate: card.dueDate || null, labels: [...labels], assigneeId, ticketStage, expectedRevision: card.revision };
    const result = await mutateApi(`/api/cards/${card.id}`, { method: "PATCH", body, label: `Triage ticket ${card.title}`, dedupeKey: `ticket:${card.id}`, entityType: "ticket", entityId: card.id, resourceKind: "tickets", resourceId: card.projectId || "studio", baseRevision: card.revision, baseSnapshot: card as unknown as Record<string, unknown>, localSnapshot: body, changedFields: ["labels", "assigneeId"], invalidate: ["/api/tickets", "/api/projects"] });
    applyCardPatch(card.id, { labels: [...labels], assigneeId, ticketStage, assignee: assigneeId ? users.find((user) => user.id === assigneeId) || card.assignee : null });
    setStatus(result.queued ? `Triage action ${action} queued for synchronization.` : `Triage action applied: ${action}.`);
    ticketDetailHistory.closeDetail();
    window.dispatchEvent(new Event("cluster-ticket-workspace-changed"));
  }
  async function exportTickets(format: ClusterDataExportFormat, fieldIds: string[], scope: "view" | "selection", delivery: ClusterDataExportDelivery) {
    setTicketExporting(true);
    setTicketExportStatus(delivery === "library" || format === "xlsx" ? "Queueing ticket export..." : "Exporting ticket data...");
    try {
      if (scope === "view" && (typeFilter || customFieldFilterId || customFieldFilterValue)) throw new Error("Current-view export cannot include local-only ticket type or custom-field filters. Clear those filters, or export selected tickets instead.");
      const result = await requestClusterDataExport({
        resourceKind: "ticket", format, scope, delivery, fieldIds,
        query: scope === "view" ? ticketServerDataQuery : {},
        selectedIds: scope === "selection" ? selectedIds : undefined,
        fileName: `tickets-${new Date().toISOString().slice(0, 10)}`,
      });
      if (result.mode === "background") { setTicketExportJobId(result.jobId); setTicketExportStatus("Ticket export queued. The completed file will be saved to Library."); }
      else setTicketExportStatus(`${result.rowCount} ticket${result.rowCount === 1 ? "" : "s"} exported${result.truncated ? " (bounded immediate export)" : ""}.`);
    } catch (error) { setTicketExportStatus(error instanceof Error ? error.message : "Ticket export failed."); }
    finally { setTicketExporting(false); }
  }

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allVisibleSelected = filteredTickets.length > 0 && filteredTickets.every((card) => selectedIdSet.has(card.id));
  const ticketTableColumns = useMemo<ClusterDataTableColumn<TicketCard>[]>(() => {
    const valueMap = (card: TicketCard) => ({ id: card.id, title: card.title, projectName: card.projectName || "", projectId: card.projectId || "", boardName: card.boardName || "", listTitle: card.listTitle || "", priority: card.priority || "", assignee: assigneeName(card), assigneeId: card.assigneeId || "", queueLane: lifecycle(card), dueDate: card.dueDate || null, labels: (card.labels || []).join(", "), createdAt: card.createdAt || null, updatedAt: card.updatedAt || null });
    const base: ClusterDataTableColumn<TicketCard>[] = [
      { id: "ticket", header: "Ticket", hideable: false, pinnable: true, defaultWidth: 300, sortValue: (card) => card.title, cell: (card) => <ClusterButton unstyled type="button" onClick={() => ticketDetailHistory.openDetail(card.id)}><strong>{card.title}</strong><span className="muted">{card.projectName} · {card.boardName}</span></ClusterButton> },
      { id: "type", header: "Type", defaultWidth: 150, sortValue: ticketType, groupValue: ticketType, cell: ticketType },
      { id: "stage", header: "Stage", defaultWidth: 150, sortValue: lifecycle, groupValue: lifecycle,
        editor: { kind: "select", value: (card) => card.ticketStage || "new", options: ["new", "accepted", "working", "waiting", "review", "resolved", "rejected"].map((value) => ({ value, label: ({new:"New / Untriaged",accepted:"Accepted",working:"Working",waiting:"Waiting",review:"Needs review",resolved:"Resolved",rejected:"Rejected"} as Record<string,string>)[value] })), commit: (card,value) => patchTicketStage(card, value as NonNullable<TicketCard["ticketStage"]>) },
        cell: (card) => <span className="ticket-stage-label-v550">{lifecycle(card)}</span> },
      { id: "priority", header: "Priority", defaultWidth: 110, sortValue: (card) => card.priority, groupValue: (card) => card.priority, copyValue: (card) => card.priority, editor: { kind: "select", value: (card) => card.priority, options: [{ value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }, { value: "urgent", label: "Urgent" }], commit: (card, value) => patchTicketPriority(card, value) }, cell: (card) => <span className={`soft-pill priority-${card.priority}`}>{card.priority}</span> },
      { id: "assignee", header: "Assignee", defaultWidth: 170, sortValue: assigneeName, groupValue: assigneeName, cell: assigneeName },
      { id: "queue", header: "Queue", defaultWidth: 180, sortValue: (card) => card.listTitle, groupValue: (card) => card.listTitle || "Unsorted", cell: (card) => card.listTitle || "Unsorted" },
      { id: "due", header: "Due", defaultWidth: 150, sortValue: (card) => card.dueDate ? new Date(card.dueDate) : null, cell: (card) => card.dueDate ? compactDateTime(card.dueDate) : "No due date" },
      { id: "updated", header: "Updated", defaultWidth: 160, sortValue: (card) => card.updatedAt ? new Date(card.updatedAt) : null, cell: (card) => card.updatedAt ? compactDateTime(card.updatedAt) : "Unknown" },
    ];
    return base.concat(ticketDerivedFields.map((derived) => ({
      id: derived.id, header: derived.label, defaultWidth: 170,
      sortValue: (card) => evaluateClusterDataDerivedFields(ticketDerivedFields, valueMap(card), TICKET_DATA_FIELDS).values[derived.id] as string | number | boolean | null,
      cell: (card) => { const value = evaluateClusterDataDerivedFields(ticketDerivedFields, valueMap(card), TICKET_DATA_FIELDS).values[derived.id]; return typeof value === "number" ? value.toLocaleString(undefined, { maximumFractionDigits: derived.display?.precision ?? 2 }) : String(value ?? "—"); },
    })));
  }, [ticketType, lifecycle, assigneeName, ticketDetailHistory, ticketDerivedFields]);
  const ticketDataFields = useMemo<ClusterSemanticField[]>(() => [
    { id: "ticket", label: "Ticket", type: "resource", sortable: true, resourceKind: "ticket" },
    { id: "type", label: "Type", type: "enum", sortable: true, filterable: true, groupable: true, facet: true },
    { id: "stage", label: "Stage", type: "status", sortable: true, groupable: true, facet: true },
    { id: "priority", label: "Priority", type: "enum", sortable: true, filterable: true, groupable: true, facet: true, enumValues: ["urgent", "high", "medium", "low"] },
    { id: "assignee", label: "Assignee", type: "person", sortable: true, filterable: true, groupable: true, resourceKind: "user" },
    { id: "queue", label: "Queue", type: "enum", sortable: true, groupable: true, facet: true },
    { id: "due", label: "Due", type: "datetime", sortable: true },
    { id: "updated", label: "Updated", type: "datetime", sortable: true },
  ], []);
  const allowedTicketSortFields = useMemo(() => new Set(ticketTableColumns.filter((column) => Boolean(column.sortValue)).map((column) => column.id)), [ticketTableColumns]);
  const normalizedTicketSorts = useMemo(() => normalizeClusterDataSorts(ticketSorts, allowedTicketSortFields), [ticketSorts, allowedTicketSortFields]);
  const orderedTickets = useMemo(() => {
    if (!normalizedTicketSorts.length) return filteredTickets;
    const columns = new Map(ticketTableColumns.map((column) => [column.id, column]));
    const compare = (left: unknown, right: unknown) => { if (left == null && right == null) return 0; if (left == null) return 1; if (right == null) return -1; if (left instanceof Date || right instanceof Date) return new Date(left as never).getTime() - new Date(right as never).getTime(); if (typeof left === "number" && typeof right === "number") return left - right; return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" }); };
    return [...filteredTickets].sort((left, right) => { for (const sort of normalizedTicketSorts) { const column = columns.get(sort.fieldId); const comparison = compare(column?.sortValue?.(left), column?.sortValue?.(right)); if (comparison) return comparison * (sort.direction === "asc" ? 1 : -1); } return 0; });
  }, [filteredTickets, normalizedTicketSorts, ticketTableColumns]);
  const ticketServerAnalytics = ticketCursor.dataView?.analytics || null;
  const ticketAnalyticsExact = !typeFilter && !customFieldFilterId && !customFieldFilterValue;
  const ticketQueueCounts = useMemo(() => {
    const fallback = { all: tickets.length, open: openTickets.length, urgent: urgentTickets.length, waiting: waitingTickets.length, review: reviewTickets.length, resolved: resolvedTickets.length, rejected: rejectedTickets.length, triage: triageTickets.length };
    if (!ticketAnalyticsExact || !ticketServerAnalytics) return fallback;
    const queueFacet = ticketServerAnalytics.facets.find((facet) => facet.fieldId === "queueLane");
    const bucket = new Map((queueFacet?.buckets || []).map((entry) => [String(entry.value), entry.count] as const));
    return {
      all: Number(ticketServerAnalytics.aggregations.queue_scope_count ?? (queue === "all" ? ticketServerAnalytics.total : fallback.all)),
      open: bucket.get("open") ?? 0,
      urgent: bucket.get("urgent") ?? 0,
      waiting: bucket.get("waiting") ?? 0,
      review: bucket.get("review") ?? 0,
      resolved: bucket.get("resolved") ?? 0,
      rejected: bucket.get("rejected") ?? 0,
      triage: bucket.get("triage") ?? 0,
    };
  }, [ticketAnalyticsExact, ticketServerAnalytics, tickets.length, openTickets.length, urgentTickets.length, waitingTickets.length, reviewTickets.length, resolvedTickets.length, rejectedTickets.length, triageTickets.length, queue]);
  const ticketSelectedSummary = useMemo(() => selectedDataSummary(orderedTickets, selectedIdSet, {
    highPriority: (rows) => rows.filter((card) => card.priority === "urgent" || card.priority === "high").length,
    unassigned: (rows) => rows.filter((card) => !card.assigneeId).length,
  }), [orderedTickets, selectedIdSet]);
  const ticketSummaryRows = useMemo(() => [
    ...(ticketSelectedSummary.count ? [{ key: "tickets-selected", label: "Selected tickets", scope: ticketSelectedSummary.scope, values: { ticket: `${ticketSelectedSummary.count} ticket${ticketSelectedSummary.count === 1 ? "" : "s"}`, priority: `${ticketSelectedSummary.values.highPriority || 0} high priority`, assignee: `${ticketSelectedSummary.values.unassigned || 0} unassigned` } }] : []),
    ...(ticketAnalyticsExact && ticketServerAnalytics ? [{ key: "tickets-dataset", label: "Filtered queue", scope: "dataset" as const, values: { ticket: `${ticketServerAnalytics.total} ticket${ticketServerAnalytics.total === 1 ? "" : "s"}` } }] : []),
    { key: "tickets-visible", label: "Loaded tickets", scope: "visible" as const, values: { ticket: `${orderedTickets.length} ticket${orderedTickets.length === 1 ? "" : "s"}`, priority: `${orderedTickets.filter((card) => card.priority === "urgent" || card.priority === "high").length} high priority`, assignee: `${orderedTickets.filter((card) => !card.assigneeId).length} unassigned` } },
  ], [orderedTickets, ticketSelectedSummary, ticketAnalyticsExact, ticketServerAnalytics]);
  return (
    <section className="page cluster-page-shell cluster-tool-page-v228 tickets-workspace-v184 tickets-workspace-v186">
      <ToolPageHeader
        className="cluster-page-header"
        title="Tickets"
        description="Triage defects, requests, incidents, and follow-up work across projects from one production queue."
        metrics={[
          { label: "All", value: ticketQueueCounts.all },
          { label: "Open", value: ticketQueueCounts.open },
          {
            label: "Urgent",
            value: ticketQueueCounts.urgent,
            tone: ticketQueueCounts.urgent ? "danger" : "neutral",
          },
          {
            label: "Needs review",
            value: ticketQueueCounts.triage,
            tone: ticketQueueCounts.triage ? "warning" : "neutral",
          },
        ]}
        actions={
          <>
            <ClusterActionMenu
              label="More ticket actions"
              items={[
                { id: "refresh", label: "Refresh tickets", icon: "refresh", onSelect: () => loadTickets(true) },
                              ]}
            />
            {currentUser.isAdmin ? <DataImportBuilder resourceKind="ticket" label="Tickets" /> : null}
            <DataExportBuilder fields={ticketExportFields} selectionCount={selectedIds.length} busy={ticketExporting} onExport={({ format, fieldIds, scope, delivery }) => exportTickets(format, fieldIds, scope, delivery)} />
            <ClusterButton
              variant="primary"
              onClick={() => onOpenSharedCreate("ticket", { projectId: projectId || undefined })}
            >
              <ClusterIcon name="plus" /> New ticket
            </ClusterButton>
          </>
        }
      />
      <nav className="tickets-queue-tabs-v186 tickets-queue-tabs-v216" aria-label="Ticket queues">
        <ClusterButton unstyled type="button" onClick={() => setQueue("all")} className={queue === "all" ? "active" : ""}>
          All <strong>{ticketQueueCounts.all}</strong>
        </ClusterButton>
        <ClusterButton unstyled type="button" onClick={() => setQueue("open")} className={queue === "open" ? "active" : ""}>
          Open <strong>{ticketQueueCounts.open}</strong>
        </ClusterButton>
        <ClusterButton unstyled type="button" onClick={() => setQueue("urgent")} className={queue === "urgent" ? "active" : ""}>
          Urgent <strong>{ticketQueueCounts.urgent}</strong>
        </ClusterButton>
        <ClusterButton unstyled type="button" onClick={() => setQueue("waiting")} className={queue === "waiting" ? "active" : ""}>
          Waiting <strong>{ticketQueueCounts.waiting}</strong>
        </ClusterButton>
        <ClusterButton unstyled type="button" onClick={() => setQueue("review")} className={queue === "review" ? "active" : ""}>
          Review <strong>{ticketQueueCounts.review}</strong>
        </ClusterButton>
        <ClusterButton unstyled type="button" onClick={() => setQueue("resolved")} className={queue === "resolved" ? "active" : ""}>
          Resolved <strong>{ticketQueueCounts.resolved}</strong>
        </ClusterButton>
        <ClusterButton unstyled type="button" onClick={() => setQueue("rejected")} className={queue === "rejected" ? "active" : ""} title="Rejected Tickets need an explicit reconsideration; they do not count as resolved delivery.">
          Rejected <strong>{ticketQueueCounts.rejected}</strong>
        </ClusterButton>
        <ClusterButton unstyled type="button" title="New or unassigned tickets that still need an owner or initial review." onClick={() => setQueue("triage")} className={queue === "triage" ? "active" : ""}>
          Needs review <strong>{ticketQueueCounts.triage}</strong>
        </ClusterButton>
      </nav>

      <ClusterDisclosureGroup className="tickets-advanced-tools" contentClassName="tickets-advanced-tools-body"
        title="Analytics & saved views" summary="Projections, formulas, facets, and reusable queue layouts" headerTrailing={<b>Advanced</b>}>
          <DataViewProjectionComposer fields={ticketAnalyticalFields} projections={ticketProjections} onChange={setTicketProjections} label="Ticket analytical projections" />
          {queueView === "table" ? <DataViewDerivedFieldBuilder fields={TICKET_DATA_FIELDS} derivedFields={ticketDerivedFields} onChange={(next) => { setTicketDerivedFields(next); setTicketTableLayout(null); }} label="Ticket formula columns" /> : null}
          <ClusterDataView scope="tickets.queue" label="Ticket queue" resourceKind="ticket" current={ticketDataView} onApply={applySavedTicketDataView} allowStudio={currentUser.isAdmin} summary="Save queue lane, search, filters, sorting, grouping, analytical projections and drilldowns, presentation, and the exact ticket table layout together." />
          {ticketAnalyticsExact && ticketServerAnalytics ? <>
            <DataViewAggregationStrip aggregations={ticketServerDataQuery.aggregations || []} values={ticketServerAnalytics.aggregations} fields={TICKET_DATA_FIELDS} label="Filtered queue totals" />
            <DataViewFacetBar facets={ticketServerAnalytics.facets.filter((facet) => facet.fieldId === "queueLane" || facet.fieldId === "priority")} fields={TICKET_DATA_FIELDS} selectedValues={{ queueLane: queue !== "all" ? [queue] : [], priority: priorityFilter ? [priorityFilter] : [] }} onToggle={(fieldId, value) => { const next = String(value); if (fieldId === "queueLane") setQueue(queue === next ? "all" : next as typeof queue); if (fieldId === "priority") setPriorityFilter(priorityFilter === next ? "" : next); }} />
            {ticketServerAnalytics.projections?.length ? <div className="cluster-data-projections-v504">{ticketServerAnalytics.projections.map((projection) => <DataViewProjection key={projection.id} result={projection} fields={ticketAnalyticalFields} label={`Ticket ${projection.kind} projection`} selection={ticketAnalyticalSelection} selectionSet={ticketAnalyticalSelectionSet} onSelectionChange={applyTicketAnalyticalSelection} onSelectionSetChange={(next) => { if (!ticketAnalyticalSelectionSet.selections.length && next.selections.length) ticketDrilldown.capture(); setTicketAnalyticalSelection(null); setTicketAnalyticalSelectionSet(next); }} onDrilldown={(_selection, drilldown) => { if (drilldown?.presentation === "table") setQueueView("table"); }} />)}</div> : null}
          </> : null}
      </ClusterDisclosureGroup>
      <DataViewSelectionBar selection={ticketAnalyticalSelection} fields={TICKET_DATA_FIELDS} historyDepth={ticketDrilldown.depth} onBack={ticketDrilldown.back} onExit={ticketDrilldown.exit} onClear={() => setTicketAnalyticalSelection(null)} label="Ticket analytical selection" />
      <DataViewSelectionSetBar selectionSet={ticketAnalyticalSelectionSet} fields={TICKET_DATA_FIELDS} onChange={(next) => { setTicketAnalyticalSelection(null); setTicketAnalyticalSelectionSet(next); }} label="Ticket cross-highlight selections" />
      {ticketExportStatus ? <p className="muted" aria-live="polite">{ticketExportStatus}</p> : null}
      <DataExportOperationFeedback jobId={ticketExportJobId} onDismiss={() => setTicketExportJobId("")} />



      {false && showCreate && (
        <section className="panel tickets-composer-v184">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Create</p>
              <h2>New ticket</h2>
            </div>
            <span className="soft-pill">{form.type}</span>
          </div>
          <div className="tickets-composer-grid-v184 tickets-composer-basic-v186">
            <div className="field span-2">
              <label>Title</label>
              <ClusterTextInput value={form.title} onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))} placeholder="What needs attention?" />
            </div>
            <div className="field">
              <label>Type</label>
              <ClusterNativeSelect value={form.type} onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value }))}>
                {ticketTypes.map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </ClusterNativeSelect>
            </div>
            <PeoplePicker value={form.assigneeId} onChange={(assigneeId) => setForm((prev) => ({ ...prev, assigneeId }))} people={users} label="Assignee" ariaLabel="New ticket assignee" />
            <div className="field">
              <label>Priority</label>
              <ClusterNativeSelect
                value={form.severity}
                onChange={(e) =>
                  setForm((prev) => ({
                    ...prev,
                    severity: e.target.value as Priority,
                  }))
                }
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </ClusterNativeSelect>
            </div>
            <div className="field">
              <label>Project</label>
              <ClusterNativeSelect
                value={projectId}
                onChange={(e) => {
                  setProjectId(e.target.value);
                  setBoardId("");
                  setListId("");
                }}
              >
                <option value="">Studio Tickets queue</option>
                {availableProjects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </ClusterNativeSelect>
              <small>{projectId ? "Choose a Board and List below. Cluster won't populate an empty Board." : "Uses the managed Studio Tickets queue, without changing Project Boards."}</small>
            </div>
            <div className="field">
              <label>Due date</label>
              <ClusterTextInput type="date" value={form.dueDate} onChange={(e) => setForm((prev) => ({ ...prev, dueDate: e.target.value }))} />
            </div>
            <div className="field span-2">
              <label>Details</label>
              <ClusterTextArea value={form.description} onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))} placeholder="Context, problem, requested outcome..." />
            </div>
            {projectId && (
              <>
                <div className="field">
                  <label>Ticket destination Board</label>
                  <ClusterNativeSelect
                    value={boardId}
                    onChange={(e) => {
                      setBoardId(e.target.value);
                      setListId("");
                    }}
                  >
                    <option value="">Choose Board...</option>
                    {visibleBoards.map((board) => (
                      <option key={board.id} value={board.id}>
                        {board.name}
                      </option>
                    ))}
                  </ClusterNativeSelect>
                </div>
                <div className="field">
                  <label>Ticket destination List</label>
                  <ClusterNativeSelect value={listId} onChange={(e) => setListId(e.target.value)} disabled={!selectedBoard}>
                    <option value="">Choose active List...</option>
                    {visibleLists.filter((list) => !list.isDone).map((list) => (
                      <option key={list.id} value={list.id}>
                        {list.title}
                      </option>
                    ))}
                  </ClusterNativeSelect>
                </div>
              </>
            )}
            {showAdvancedCreate && (
              <>
                <div className="field">
                  <label>Department</label>
                  <ClusterTextInput
                    value={form.department}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        department: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="field">
                  <label>Component</label>
                  <ClusterTextInput
                    value={form.component}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        component: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="field">
                  <label>Build/version</label>
                  <ClusterTextInput
                    value={form.buildNumber}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        buildNumber: e.target.value,
                      }))
                    }
                  />
                </div>
                <div className="field">
                  <label>Labels</label>
                  <ClusterTextInput value={form.labels} onChange={(e) => setForm((prev) => ({ ...prev, labels: e.target.value }))} placeholder="frontend, blocker, client" />
                </div>
                {visibleTicketCustomFields.map(ticketCustomFieldControl)}
                <div className="field span-2">
                  <label>Acceptance criteria</label>
                  <ClusterTextArea
                    value={form.acceptance}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        acceptance: e.target.value,
                      }))
                    }
                    placeholder="What must be true before this can close?"
                  />
                </div>
              </>
            )}
          </div>
          {createError && <div className="error-box slim tickets-create-error-v216">{createError}</div>}
          <div className="button-row">
            <ClusterButton type="button" className="" disabled={!form.title.trim()} onClick={createTicket} variant="primary">
              Create ticket
            </ClusterButton>
            <ClusterButton type="button" className="" onClick={() => setShowAdvancedCreate((open) => !open)} variant="secondary">
              {showAdvancedCreate ? "Hide optional fields" : "More fields"}
            </ClusterButton>
            <ClusterButton type="button"
              className=""
              onClick={() => {
                setShowCreate(false);
                setShowAdvancedCreate(false);
              }}
             variant="quiet" size="compact">
              Cancel
            </ClusterButton>
          </div>
        </section>
      )}

      <ClusterTableToolbar
        className="tickets-control-bar-v184 panel"
        query={query}
        onQueryChange={setQuery}
        searchLabel="Search tickets"
        placeholder="Title, project, component, build, label…"
        countLabel={`${filteredTickets.length} shown · ${sourceQueue.length} in queue`}
        filters={
          <>
            <label className="field"><span>Project</span><ClusterSelect value={projectId} onChange={setProjectId} ariaLabel="Ticket project filter" options={[{ value: "", label: "All projects" }, ...projects.map((project) => ({ value: project.id, label: project.name }))]} /></label>
            <label className="field"><span>Type</span><ClusterSelect value={typeFilter} onChange={setTypeFilter} ariaLabel="Ticket type filter" options={[{ value: "", label: "All types" }, ...ticketTypes.map((type) => ({ value: type, label: type }))]} /></label>
            <label className="field"><span>Priority</span><ClusterSelect value={priorityFilter} onChange={setPriorityFilter} ariaLabel="Ticket priority filter" options={[{ value: "", label: "All priorities" }, { value: "urgent", label: "Urgent" }, { value: "high", label: "High" }, { value: "medium", label: "Medium" }, { value: "low", label: "Low" }]} /></label>
            <label className="field"><span>Assignee</span><ClusterSelect value={assigneeFilter} onChange={setAssigneeFilter} ariaLabel="Ticket assignee filter" options={[{ value: "", label: "All assignees" }, { value: "unassigned", label: "Unassigned" }, ...users.map((user) => ({ value: user.id, label: displayUserName(user) }))]} /></label>
            {ticketCustomFields.some((field) => field.filterable !== false) ? <label className="field"><span>Custom field</span><ClusterSelect value={customFieldFilterId} onChange={(value) => { setCustomFieldFilterId(value); setCustomFieldFilterValue(""); }} ariaLabel="Ticket custom field filter" options={[{ value: "", label: "No field filter" }, ...ticketCustomFields.filter((field) => field.filterable !== false).map((field) => ({ value: field.id, label: field.label }))]} /></label> : null}
            {customFieldFilterId ? <label className="field"><span>Field value</span>{customFieldFilterOptions.length ? <ClusterSelect value={customFieldFilterValue} onChange={setCustomFieldFilterValue} ariaLabel="Ticket custom field value" options={[{ value: "", label: "Any populated value" }, ...customFieldFilterOptions.map((option) => ({ value: option, label: option }))]} /> : <ClusterTextInput value={customFieldFilterValue} onChange={(event) => setCustomFieldFilterValue(event.target.value)} placeholder="Exact value" />}</label> : null}
          </>
        }
        actions={hasTicketFilters ? <ClusterButton variant="quiet" size="compact" onClick={clearTicketFilters}>Clear filters</ClusterButton> : undefined}
      />

      <ClusterBulkActionBar selectionCount={selectedIds.length} label="Selected ticket actions" onClear={() => setSelectedIds([])} className="tickets-bulk-bar-v184">
        <ClusterSelect value={bulkPriority} onChange={(value) => setBulkPriority(value as Priority)} ariaLabel="Bulk ticket priority" options={[{ value: "low", label: "Low" }, { value: "medium", label: "Medium" }, { value: "high", label: "High" }, { value: "urgent", label: "Urgent" }]} />
        <ClusterButton size="compact" onClick={() => patchTickets(() => ({ priority: bulkPriority }))}>Apply priority</ClusterButton>
        <ClusterSelect value={bulkAssigneeId} onChange={setBulkAssigneeId} ariaLabel="Bulk ticket assignee" options={[{ value: "", label: "Unassign" }, ...users.map((user) => ({ value: user.id, label: displayUserName(user) }))]} />
        <ClusterButton size="compact" onClick={() => patchTickets(() => ({ assigneeId: bulkAssigneeId || null }))}>{bulkAssigneeId ? "Assign" : "Unassign"}</ClusterButton>
        <ClusterTextInput aria-label="Bulk ticket label" value={bulkLabel} onChange={(e) => setBulkLabel(e.target.value)} placeholder="Label" />
        <ClusterButton size="compact" disabled={!bulkLabel.trim()} onClick={() => patchTickets((card) => ({ labels: unique([...card.labels, bulkLabel.trim()]) }))}>Add label</ClusterButton>
      </ClusterBulkActionBar>

      <ClusterMasterDetail
        className="tickets-main-grid-v184"
        label="Ticket queue and inspector"
        masterLabel="Ticket queue"
        detailLabel="Ticket inspector"
        detailOpen={Boolean(selectedTicket)}
        onCloseDetail={ticketDetailHistory.closeDetail}
        detailSize="wide"
        persistKey="tickets"
        master={<section className="panel tickets-queue-v184">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Queue</p>
              <h2>{queue === "all" ? "All tickets" : queue === "triage" ? "Needs review" : queue[0].toUpperCase() + queue.slice(1)}</h2>
            </div>
            <div className="button-row"><span className="soft-pill">{filteredTickets.length}</span><ClusterSegmentedControl value={queueView} onChange={setQueueView} label="Ticket queue layout" options={[{ value: "list", label: "List" }, { value: "table", label: "Table" }]} /></div>
          </div>
          {queueView === "table" ? <>
            <DataViewGroupControl fields={ticketDataFields} groups={ticketGroups} onChange={setTicketGroups} label="Group tickets" />
            <ClusterDataTable
            rows={orderedTickets}
            columns={ticketTableColumns}
            rowKey={(card) => card.id}
            rowLabel={(card) => card.title}
            label="Ticket queue table"
            selectedKeys={selectedIdSet}
            onSelectionChange={(keys) => setSelectedIds([...keys])}
            sorts={normalizedTicketSorts}
            onSortsChange={setTicketSorts}
            groups={ticketGroups}
            groupSummaries={ticketAnalyticsExact && ticketServerGroups.length === ticketGroups.length ? ticketServerAnalytics?.groupedSummaries : undefined}
            groupSummaryFieldMap={{ queue: "listTitle" }}
            groupSubtotalMode="row"
            onRowActivate={(card) => ticketDetailHistory.openDetail(card.id)}
            configurableColumns
            persistKey="ticket-queue"
            controlledLayout={ticketTableLayout || undefined}
            onLayoutChange={setTicketTableLayout}
            summaryRows={ticketSummaryRows}
            virtualization={{ rowHeight: 52, maxHeight: 720, minimumRows: 140, overscan: 12 }}
            incremental={{ hasMore: ticketCursor.hasMore, loading: ticketCursor.loading, prefetchRows: 24, loadLabel: "Load 80 more tickets", onLoadMore: ticketCursor.loadMore }}
            empty={hasTicketFilters ? <ClusterEmptyState compact kind="filtered" icon="ticket" title="No tickets match these filters" description="The queue still exists. Clear the current search and filters to widen the result set." actions={<ClusterButton variant="secondary" size="compact" onClick={clearTicketFilters}>Clear filters</ClusterButton>} /> : tickets.length === 0 ? <ClusterEmptyState compact kind="first-use" icon="ticket" title="No tickets yet" description="Create the first ticket when work needs tracking outside the normal board flow." actions={<ClusterButton variant="primary" size="compact" onClick={() => setShowCreate(true)}>New ticket</ClusterButton>} /> : <ClusterEmptyState compact kind="empty" icon="ticket" title="No tickets in this queue" description="New tickets that belong in this queue will appear here." />}
          /></> : <>
            <label className="tickets-select-all-v184">
              <ClusterInput type="checkbox" checked={allVisibleSelected} onChange={(e) => setSelectedIds(e.target.checked ? unique([...selectedIds, ...orderedTickets.map((card) => card.id)]) : selectedIds.filter((id) => !orderedTickets.some((card) => card.id === id)))} /> Select visible
            </label>
            <VirtualTicketList
              items={orderedTickets}
              selectedIds={selectedIdSet}
              activeId={selectedTicketId}
              ticketType={ticketType}
              lifecycle={lifecycle}
              assigneeName={assigneeName}
              fieldValue={fieldValue}
              onToggle={(cardId, checked) => setSelectedIds((prev) => (checked ? unique([...prev, cardId]) : prev.filter((id) => id !== cardId)))}
              onOpen={(card) => ticketDetailHistory.openDetail(card.id)}
              scrollKey={`tickets:${queue}:${projectId || "all"}:${typeFilter || "all"}:${priorityFilter || "all"}:${assigneeFilter || "all"}:${customFieldFilterId || "none"}:${customFieldFilterValue || "any"}:${needle}`}
              emptyState={hasTicketFilters ? (
                <ClusterEmptyState compact kind="filtered" icon="ticket" title="No tickets match these filters" description="The queue still exists. Clear the current search and filters to widen the result set." actions={<ClusterButton variant="secondary" size="compact" onClick={clearTicketFilters}>Clear filters</ClusterButton>} />
              ) : tickets.length === 0 ? (
                <ClusterEmptyState compact kind="first-use" icon="ticket" title="No tickets yet" description="Create the first ticket when work needs tracking outside the normal board flow." actions={<ClusterButton variant="primary" size="compact" onClick={() => setShowCreate(true)}>New ticket</ClusterButton>} />
              ) : undefined}
            />
            {ticketCursor.hasMore ? <div className="tickets-cursor-more-v504"><ClusterButton variant="quiet" size="compact" disabled={ticketCursor.loading} onClick={ticketCursor.loadMore}>{ticketCursor.loading ? "Loading more…" : "Load 80 more tickets"}</ClusterButton></div> : null}
          </>}
        </section>}
        detail={<aside className="tickets-side-v184">
          <section className="panel tickets-detail-v184">
            {selectedTicket ? (
              <>
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Ticket</p>
                    <h2>{selectedTicket.title}</h2>
                  </div>
                  <div className="button-row compact interoperability-actions-v188">
                    <ClusterButton variant="quiet" size="compact" onClick={() => onOpenProject(selectedTicket.projectId)}>Project</ClusterButton>
                    <ClusterButton variant="quiet" size="compact" onClick={() => onOpenBoard(selectedTicket.boardId)}>Board</ClusterButton>
                    {selectedTicket.assigneeId ? <ClusterButton variant="quiet" size="compact" onClick={() => onOpenUser(selectedTicket.assigneeId as string)}>Assignee</ClusterButton> : null}
                    <WorkActionMenu
                      context={{ source: { kind: "ticket", id: selectedTicket.id, projectId: selectedTicket.projectId, label: selectedTicket.title }, navigation: { screen: "tickets", projectId: selectedTicket.projectId, inspectScope: "ticket", inspectId: selectedTicket.id }, projectId: selectedTicket.projectId, boardId: selectedTicket.boardId, assigneeId: selectedTicket.assigneeId || null, dueDate: selectedTicket.dueDate || null }}
                      label={`${selectedTicket.title} work actions`}
                      allowAssign
                      allowMention
                      onAssign={() => document.querySelector<HTMLElement>(".tickets-assignment-v185 button")?.focus()}
                    />
                  </div>
                </div>
                <div className="tickets-detail-grid-v184">
                  <div>
                    <span>Type</span>
                    <strong>{ticketType(selectedTicket)}</strong>
                  </div>
                  <div>
                    <span>Status</span>
                    <ClusterNativeSelect aria-label="Ticket triage stage" value={selectedTicket.ticketStage || "new"} onChange={(event) => void patchTicketStage(selectedTicket, event.target.value as NonNullable<TicketCard["ticketStage"]>)}>
                      <option value="new">New / Untriaged</option><option value="accepted">Accepted</option><option value="working">Working</option><option value="waiting">Waiting</option><option value="review">Needs review</option><option value="resolved">Resolved</option><option value="rejected">Rejected</option>
                    </ClusterNativeSelect>
                  </div>
                  <div>
                    <span>Priority</span>
                    <strong>{selectedTicket.priority}</strong>
                  </div>
                  <div>
                    <span>Project</span>
                    <strong>{selectedTicket.projectName}</strong>
                  </div>
                  <div>
                    <span>Assignee</span>
                    <strong>{assigneeName(selectedTicket)}</strong>
                  </div>
                  <div>
                    <span>Department</span>
                    <strong>{fieldValue(selectedTicket, "Department") || "Unassigned"}</strong>
                  </div>
                  <div>
                    <span>Component</span>
                    <strong>{fieldValue(selectedTicket, "Component") || "General"}</strong>
                  </div>
                  <div>
                    <span>Build</span>
                    <strong>{fieldValue(selectedTicket, "Build") || "Not linked"}</strong>
                  </div>
                  <div>
                    <span>Due</span>
                    <strong>{selectedTicket.dueDate ? compactDateTime(selectedTicket.dueDate) : "No due date"}</strong>
                  </div>
                </div>
                <div className="tickets-assignment-v185">
                  <PeoplePicker
                    value={selectedTicket.assigneeId || ""}
                    onChange={(assigneeId) => assignTicket(selectedTicket, assigneeId)}
                    people={users}
                    label="Resolve owner"
                    ariaLabel="Ticket assignee"
                  />
                </div>
                {triageTickets.some((item) => item.id === selectedTicket.id) && (
                  <div className="ticket-triage-actions-v195">
                    <ClusterButton variant="primary" size="compact" onClick={() => triageTicket(selectedTicket, "accept")}>Accept</ClusterButton>
                    <ClusterButton size="compact" onClick={() => triageTicket(selectedTicket, "info")}>Request info</ClusterButton>
                    <ClusterActionMenu
                      label="More triage actions"
                      items={[
                        { id: "duplicate", label: "Mark duplicate", onSelect: () => triageTicket(selectedTicket, "duplicate") },
                        { id: "snooze", label: "Snooze", onSelect: () => triageTicket(selectedTicket, "snooze") },
                        { id: "reject", label: "Reject ticket", danger: true, separatorBefore: true, onSelect: () => triageTicket(selectedTicket, "reject") },
                      ]}
                    />
                  </div>
                )}
                <p className="muted pre-wrap-v113">{selectedTicket.description || "No ticket details yet."}</p>
                <div className="chip-row">
                  {selectedTicket.labels.map((label) => (
                    <span className="tag-chip" key={label}>
                      {label}
                    </span>
                  ))}
                </div>
                <ProjectDeliveryTicketFollowup
                  projectId={selectedTicket.projectId}
                  ticketId={selectedTicket.id}
                  resolved={isClosed(selectedTicket)}
                  creatorLabel={currentUser.displayName || currentUser.username || ""}
                />
                <LinkedWorkPanel projectId={selectedTicket.projectId} kind="ticket" entityId={selectedTicket.id} compact />
                <SharedWorkEvidencePanel projectId={selectedTicket.projectId} kind="ticket" entityId={selectedTicket.id} label={selectedTicket.title} compact />
                <SharedWorkWatchControl entity={{ kind: "ticket", id: selectedTicket.id, projectId: selectedTicket.projectId, label: selectedTicket.title }} compact />
                <SharedWorkActivityPanel entity={{ kind: "ticket", id: selectedTicket.id, projectId: selectedTicket.projectId, label: selectedTicket.title }} compact />
                <CollaborationPanel entityType="ticket" entityId={selectedTicket.id} currentUser={currentUser} users={users} title="Ticket discussion" compact />
                <CustomFieldValuesPanel compact entity="ticket" entityId={selectedTicket.id} projectId={selectedTicket.projectId} title="Ticket fields" updatedBy={currentUser.id} />
                <RelatedRecordsPanel
                  compact
                  entity={{
                    kind: "ticket",
                    id: selectedTicket.id,
                    label: selectedTicket.title,
                    projectId: selectedTicket.projectId,
                  }}
                  projectId={selectedTicket.projectId}
                />
                <VersionHistoryPanel
                  entityType="ticket"
                  entityId={selectedTicket.id}
                  projectId={selectedTicket.projectId}
                  label={selectedTicket.title}
                  data={selectedTicket}
                  onRestore={async (snapshot: Partial<TicketCard>) => {
                    const restored = {
                      listId: snapshot.listId,
                      title: snapshot.title,
                      description: snapshot.description || "",
                      priority: snapshot.priority,
                      dueDate: snapshot.dueDate || null,
                      labels: snapshot.labels || [],
                      assigneeId: snapshot.assigneeId || null,
                    };
                    await mutateApi(`/api/cards/${selectedTicket.id}`, {
                      method: "PATCH",
                      body: restored,
                      label: `Restore ${selectedTicket.title}`,
                      dedupeKey: `ticket:${selectedTicket.id}`,
                      entityType: "ticket",
                      entityId: selectedTicket.id,
                      resourceKind: "ticket",
                      resourceId: selectedTicket.projectId,
                      baseRevision: selectedTicket.revision,
                      baseSnapshot: selectedTicket as unknown as Record<string, unknown>,
                      localSnapshot: restored,
                      changedFields: Object.keys(restored),
                      invalidate: ["/api/cards", "/api/tickets", `/api/cards/${selectedTicket.id}`],
                    });
                    if (navigator.onLine) await loadTickets(true);
                  }}
                />
              </>
            ) : (
              <ClusterEmptyState compact kind="empty" icon="ticket" title="Select a ticket" description="Choose a ticket from the queue to inspect ownership, routing, build context, and acceptance details." />
            )}
          </section>
        </aside>}
      />
      {loadError ? <RequestErrorState error={loadError} title="Tickets could not be loaded" onRetry={() => void loadTickets(true).catch(setLoadError)} /> : null}
      {status && <div className="status-box slim tickets-status-v216">{status}</div>}
    </section>
  );
}
