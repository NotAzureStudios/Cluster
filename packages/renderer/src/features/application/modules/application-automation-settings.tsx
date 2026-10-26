import "../styles/automation-settings.css";
import {
  CLUSTER_CUSTOM_FIELD_ACCESS,
  CLUSTER_CUSTOM_FIELD_ENTITIES,
  CLUSTER_CUSTOM_FIELD_TYPES,
  CLUSTER_STUDIO_AUTOMATION_ACTION_TYPES,
  CLUSTER_STUDIO_AUTOMATION_CONDITION_OPERATORS,
  CLUSTER_STUDIO_AUTOMATION_TRIGGERS,
} from "@cluster/shared";
import { ClusterNativeSelect, ClusterInput } from "../../../components/ClusterNativeControls";

import { useEffect, useMemo, useState } from "react";
import { api } from "../../../core/api";
import { useProjectWorkflowList } from "../../../core/project-workflow-storage";
import { TOOL_LEVEL_OPTIONS, TOOL_PERMISSION_OPTIONS, type ToolPermissionKey, type ToolPermissionLevel, type ToolPermissions } from "../../../core/permissions";
import { localId } from "../../../core/storage";
import { addDays, compactDateTime, toDateTimeLocalInput } from "../../../core/date-time";
import { levelLabel } from "../../../core/format";
import { LazyFeatureBoundary } from "../../../components/FeatureBoundary";
import { CollaborationPanel } from "../../../components/CollaborationPanel";
import { confirmCluster } from "../../../components/cluster-dialog-service";
import { ClusterButton } from "../../../components/ClusterButton";
import { ClusterIcon } from "../../../components/ClusterIcon";
import { ClusterTextInput } from "../../../components/ClusterTextInput";
import { ClusterTextArea } from "../../../components/ClusterTextArea";

import type { BoardWorkspacePageProps } from "../../boards/BoardWorkspacePage";
import type { WhiteboardWorkspacePageProps } from "../../whiteboards/WhiteboardWorkspacePage";

import { projectHasBuildSignals } from "../../projects/ProjectBuildsPanel";
import { PROJECT_STATUS_OPTIONS, importantBuildEntries, isExternalProject, normalizeProjectStatus, projectAssignedIds, collectBoardCards, projectCompleteness, projectHasDiscord, projectHasGit, projectSetupGaps, projectSourceMeta, projectStatusLabel, projectStatusMeta } from "../../projects/projects-utils";
import { SavedViewsToolbar } from "../../../components/SavedViewsToolbar";
import { customFieldSlug, normalizeServerCustomFieldDefinition, useServerCustomFieldDefinitions } from "../../custom-fields/custom-field-storage";
import type { User, Project, Priority, Card, Board, TimelineItem, TimelineEntry, TimelinePayload, DetailDrawerItem, QATestPlan, CustomFieldEntity, CustomFieldType, CustomFieldAccess, StudioCustomFieldDefinition, AutomationTrigger, AutomationConditionOperator, AutomationActionType, AutomationCondition, AutomationAction, StudioAutomationRule, AutomationRunRecord, AutomationQueueRecord } from "../application-models";import { BuildArtifactRegistry, ProjectBudgetPanel, QATestPlansPanel, ReleaseNotesGenerator, normalizeTestPlan } from "../../operations/modules/operations-delivery";
import { CustomFieldValuesPanel, WorkLinkManager, WorkflowOpsPanel } from "../../operations/modules/operations-workflows";
import { DetailDrawer } from "../../operations/modules/operations-admin";
import { fromDateTimeLocalInput } from "../../operations/modules/operations-foundation";

import { RelatedRecordsPanel, VersionHistoryPanel, buildProjectLinkRows, openSharedCreate, reportLifecycleStage, LazyBoardWorkspacePage, LazyTicketSystemPageFeature, LazyWhiteboardWorkspacePage } from "./application-foundation";

import { runtimeStyle } from "../../../core/runtime-style";

export function normalizeAutomationRule(rule: StudioAutomationRule): StudioAutomationRule {
  return {
    ...rule,
    conditions: rule.conditions || [],
    actions: rule.actions || [],
    priority: Math.max(1, Math.min(100, Number(rule.priority || 50))),
    projectId: rule.projectId || "",
    delayMinutes: Math.max(0, Number(rule.delayMinutes || 0)),
    maxRetries: Math.max(0, Math.min(10, Number(rule.maxRetries ?? 3))),
    stopProcessing: Boolean(rule.stopProcessing),
    enabled: rule.enabled !== false,
  };
}

export async function applyTicketAutomations(
  form: {
    type: string; severity: Priority; department: string; assigneeId: string; labels: string; title?: string; projectId?: string; dueDate?: string; customValues?: Record<string, string | boolean>;
  },
) {
  const fallback = {
    priority: form.severity, assigneeId: form.assigneeId, labels: form.labels.split(",").map((item) => item.trim()).filter(Boolean), dueDate: form.dueDate || "",
    customFieldValues: { ...(form.customValues || {}) }, matched: [] as string[], inboxSignals: [] as string[], deferredActions: [] as Array<{ ruleId: string; actionId: string }>,
  };
  try {
    const response = await api<{ ok: true; result: typeof fallback }>("/api/automation/tickets/preview", { method: "POST", body: JSON.stringify(form) });
    return response.result || fallback;
  } catch {
    return fallback;
  }
}

export function CustomFieldDefinitionsPanel() {
  const fieldStore = useServerCustomFieldDefinitions(normalizeServerCustomFieldDefinition);
  const fields = fieldStore.definitions;
  const [usageCounts, setUsageCounts] = useState<Record<string, number>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [entityFilter, setEntityFilter] = useState<CustomFieldEntity | "all">("all");
  const [statusFilter, setStatusFilter] = useState<"active" | "archived" | "all">("active");
  const emptyForm: Omit<StudioCustomFieldDefinition, "id"> = {
    label: "",
    slug: "",
    entity: "ticket",
    fieldType: "text",
    options: [],
    placeholder: "",
    helpText: "",
    showWhenFieldId: "",
    showWhenValue: "",
    required: false,
    enabled: true,
    defaultValue: "",
    filterable: true,
    viewAccess: "everyone",
    editAccess: "members",
    archivedAt: null,
  };
  const [form, setForm] = useState<Omit<StudioCustomFieldDefinition, "id">>(emptyForm);
  useEffect(() => {
    let cancelled = false;
    void Promise.all(fields.map(async (field) => [field.id, await fieldStore.usage(field.id)] as const)).then((entries) => {
      if (!cancelled) setUsageCounts(Object.fromEntries(entries));
    });
    return () => { cancelled = true; };
  }, [fields.map((field) => field.id).join("|")]);
  function persist(next: StudioCustomFieldDefinition[]) {
    const normalized = next.map(normalizeServerCustomFieldDefinition);
    fieldStore.setDefinitions(normalized);
    const previous = new Map(fields.map((field) => [field.id, JSON.stringify(normalizeServerCustomFieldDefinition(field))]));
    normalized.forEach((field) => {
      if (previous.get(field.id) !== JSON.stringify(field)) void fieldStore.save(field);
    });
  }
  function resetForm(entity: CustomFieldEntity = form.entity) {
    setEditingId(null);
    setForm({ ...emptyForm, entity });
  }
  function saveField() {
    const label = form.label.trim();
    if (!label) return;
    const now = new Date().toISOString();
    const duplicateSlug = fields.some((field) => field.id !== editingId && field.entity === form.entity && (field.slug || customFieldSlug(field.label)) === (form.slug || customFieldSlug(label)));
    const safeSlug = duplicateSlug ? `${form.slug || customFieldSlug(label)}-${Date.now().toString().slice(-4)}` : form.slug || customFieldSlug(label);
    if (editingId) {
      persist(
        fields.map((field) =>
          field.id === editingId
            ? normalizeServerCustomFieldDefinition({
                ...field,
                ...form,
                label,
                slug: safeSlug,
                updatedAt: now,
              })
            : field,
        ),
      );
    } else {
      persist([
        ...fields,
        normalizeServerCustomFieldDefinition({
          ...form,
          id: localId("field"),
          label,
          slug: safeSlug,
          createdAt: now,
          updatedAt: now,
        }),
      ]);
    }
    resetForm(form.entity);
  }
  function editField(field: StudioCustomFieldDefinition) {
    setEditingId(field.id);
    setForm({
      label: field.label,
      slug: field.slug || customFieldSlug(field.label),
      entity: field.entity,
      fieldType: field.fieldType,
      options: field.options || [],
      placeholder: field.placeholder || "",
      helpText: field.helpText || "",
      showWhenFieldId: field.showWhenFieldId || "",
      showWhenValue: field.showWhenValue || "",
      required: Boolean(field.required),
      enabled: field.enabled !== false,
      defaultValue: field.defaultValue ?? "",
      filterable: field.filterable !== false,
      viewAccess: field.viewAccess || "everyone",
      editAccess: field.editAccess || "members",
      archivedAt: field.archivedAt || null,
    });
  }
  function duplicateField(field: StudioCustomFieldDefinition) {
    const now = new Date().toISOString();
    persist([
      ...fields,
      normalizeServerCustomFieldDefinition({
        ...field,
        id: localId("field"),
        label: `${field.label} copy`,
        slug: `${field.slug || customFieldSlug(field.label)}-copy-${Date.now().toString().slice(-4)}`,
        archivedAt: null,
        enabled: true,
        createdAt: now,
        updatedAt: now,
      }),
    ]);
  }
  function archiveField(field: StudioCustomFieldDefinition) {
    const now = new Date().toISOString();
    persist(fields.map((item) => (item.id === field.id ? { ...item, enabled: false, archivedAt: now, updatedAt: now } : item)));
    if (editingId === field.id) resetForm(field.entity);
  }
  function restoreField(field: StudioCustomFieldDefinition) {
    const now = new Date().toISOString();
    persist(fields.map((item) => (item.id === field.id ? { ...item, enabled: true, archivedAt: null, updatedAt: now } : item)));
  }
  async function purgeField(field: StudioCustomFieldDefinition) {
    const usage = usageCounts[field.id] || 0;
    if (!await confirmCluster({ title: "Permanently delete custom field?", message: `Delete ${field.label}${usage ? ` and ${usage} stored value${usage === 1 ? "" : "s"}` : ""}? This cannot be undone.`, confirmLabel: "Delete field", tone: "danger" })) return;
    void fieldStore.remove(field, true);
    setUsageCounts((current) => { const next = { ...current }; delete next[field.id]; return next; });
  }
  const filtered = fields.filter((field) => {
    if (entityFilter !== "all" && field.entity !== entityFilter) return false;
    if (statusFilter === "active" && field.archivedAt) return false;
    if (statusFilter === "archived" && !field.archivedAt) return false;
    return true;
  });
  const entityOptions: CustomFieldEntity[] = [...CLUSTER_CUSTOM_FIELD_ENTITIES];
  const fieldTypeOptions: CustomFieldType[] = [...CLUSTER_CUSTOM_FIELD_TYPES];
  const accessOptions: CustomFieldAccess[] = [...CLUSTER_CUSTOM_FIELD_ACCESS];
  return (
    <div className="settings-card-grid-v092 custom-fields-manager-v195 custom-fields-manager-v199">
      {(fieldStore.loading || fieldStore.pending > 0) && <div className="inline-status">{fieldStore.loading ? "Loading server fields…" : "Saving field changes…"}</div>}
      {fieldStore.error && <div className="inline-status danger">{fieldStore.error}</div>}
      <section className="settings-card-v092">
        <div className="settings-card-head-v092">
          <h3>{editingId ? "Edit field" : "Add field"}</h3>
          <span>Shared structured metadata</span>
        </div>
        <div className="settings-stack compact-fields-v092">
          <div className="field">
            <label>Label</label>
            <ClusterTextInput
              value={form.label}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  label: event.target.value,
                  slug: prev.slug || customFieldSlug(event.target.value),
                }))
              }
              placeholder="Impact, client code, target channel..."
            />
          </div>
          <div className="field">
            <label>Field key</label>
            <ClusterTextInput
              value={form.slug || ""}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  slug: customFieldSlug(event.target.value),
                }))
              }
              placeholder="stable-field-key"
            />
            <small>The key stays stable when the label changes.</small>
          </div>
          <div className="two-col">
            <div className="field">
              <label>Entity</label>
              <ClusterNativeSelect
                value={form.entity}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    entity: event.target.value as CustomFieldEntity,
                    showWhenFieldId: "",
                    showWhenValue: "",
                  }))
                }
              >
                {entityOptions.map((entity) => (
                  <option key={entity} value={entity}>
                    {levelLabel(entity)}
                  </option>
                ))}
              </ClusterNativeSelect>
            </div>
            <div className="field">
              <label>Type</label>
              <ClusterNativeSelect
                value={form.fieldType}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    fieldType: event.target.value as CustomFieldType,
                    options: ["select", "multi-select"].includes(event.target.value) ? prev.options : [],
                  }))
                }
              >
                {fieldTypeOptions.map((type) => (
                  <option key={type} value={type}>
                    {levelLabel(type)}
                  </option>
                ))}
              </ClusterNativeSelect>
            </div>
          </div>
          {["select", "multi-select", "department"].includes(form.fieldType) && (
            <div className="field">
              <label>Options</label>
              <ClusterTextInput
                value={(form.options || []).join(", ")}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    options: event.target.value
                      .split(",")
                      .map((item) => item.trim())
                      .filter(Boolean),
                  }))
                }
                placeholder="Internal, External, Client"
              />
            </div>
          )}
          <div className="two-col">
            <div className="field">
              <label>Placeholder</label>
              <ClusterTextInput
                value={form.placeholder || ""}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    placeholder: event.target.value,
                  }))
                }
                placeholder="Shown inside the field"
              />
            </div>
            <div className="field">
              <label>Default value</label>
              <ClusterTextInput
                value={String(form.defaultValue ?? "")}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    defaultValue: event.target.value,
                  }))
                }
                placeholder="Optional default"
              />
            </div>
          </div>
          <div className="field">
            <label>Helper text</label>
            <ClusterTextInput value={form.helpText || ""} onChange={(event) => setForm((prev) => ({ ...prev, helpText: event.target.value }))} placeholder="Explain what belongs here" />
          </div>
          <div className="two-col">
            <div className="field">
              <label>Show when field</label>
              <ClusterNativeSelect
                value={form.showWhenFieldId || ""}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    showWhenFieldId: event.target.value,
                  }))
                }
              >
                <option value="">Always visible</option>
                {fields
                  .filter((field) => field.id !== editingId && field.entity === form.entity && !field.archivedAt)
                  .map((field) => (
                    <option key={field.id} value={field.id}>
                      {field.label}
                    </option>
                  ))}
              </ClusterNativeSelect>
            </div>
            <div className="field">
              <label>Equals</label>
              <ClusterTextInput
                disabled={!form.showWhenFieldId}
                value={form.showWhenValue || ""}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    showWhenValue: event.target.value,
                  }))
                }
                placeholder="Value that reveals this field"
              />
            </div>
          </div>
          <div className="two-col">
            <div className="field">
              <label>Visible to</label>
              <ClusterNativeSelect
                value={form.viewAccess || "everyone"}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    viewAccess: event.target.value as CustomFieldAccess,
                  }))
                }
              >
                {accessOptions.map((access) => (
                  <option key={access}>{access}</option>
                ))}
              </ClusterNativeSelect>
            </div>
            <div className="field">
              <label>Editable by</label>
              <ClusterNativeSelect
                value={form.editAccess || "members"}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    editAccess: event.target.value as CustomFieldAccess,
                  }))
                }
              >
                {accessOptions.map((access) => (
                  <option key={access}>{access}</option>
                ))}
              </ClusterNativeSelect>
            </div>
          </div>
          <div className="button-row compact">
            <label className="tool-check">
              <ClusterInput
                type="checkbox"
                checked={Boolean(form.required)}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    required: event.target.checked,
                  }))
                }
              />{" "}
              Required when visible
            </label>
            <label className="tool-check">
              <ClusterInput
                type="checkbox"
                checked={form.filterable !== false}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    filterable: event.target.checked,
                  }))
                }
              />{" "}
              Filterable
            </label>
          </div>
          <div className="button-row">
            <ClusterButton type="button" className="" onClick={saveField} variant="primary">
              {editingId ? "Save changes" : "Add field"}
            </ClusterButton>
            {editingId && (
              <ClusterButton type="button" className="" onClick={() => resetForm(form.entity)} variant="secondary">
                Cancel
              </ClusterButton>
            )}
          </div>
        </div>
      </section>
      <section className="settings-card-v092 span-2">
        <div className="settings-card-head-v092">
          <h3>Field catalog</h3>
          <span>
            {fields.filter((field) => !field.archivedAt && field.enabled !== false).length} active · {fields.filter((field) => field.archivedAt).length} archived
          </span>
        </div>
        <div className="custom-field-toolbar-v199">
          <ClusterNativeSelect value={entityFilter} onChange={(event) => setEntityFilter(event.target.value as CustomFieldEntity | "all")}>
            <option value="all">All entities</option>
            {entityOptions.map((entity) => (
              <option key={entity} value={entity}>
                {levelLabel(entity)}
              </option>
            ))}
          </ClusterNativeSelect>
          <ClusterNativeSelect value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
            <option value="active">Active</option>
            <option value="archived">Archived</option>
            <option value="all">All states</option>
          </ClusterNativeSelect>
        </div>
        <div className="custom-field-list-v195">
          {filtered.map((field) => {
            const usage = usageCounts[field.id] || 0;
            return (
              <article key={field.id} className={field.archivedAt || field.enabled === false ? "disabled" : ""}>
                <div>
                  <strong>{field.label}</strong>
                  <span>
                    {levelLabel(field.entity)} · {levelLabel(field.fieldType)} · {field.slug}
                    {field.required ? " · required" : ""}
                    {field.showWhenFieldId ? " · conditional" : ""} · {usage} value{usage === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="button-row compact">
                  <ClusterButton type="button" className="" onClick={() => editField(field)} variant="quiet" size="compact">
                    Edit
                  </ClusterButton>
                  <ClusterButton type="button" className="" onClick={() => duplicateField(field)} variant="quiet" size="compact">
                    Duplicate
                  </ClusterButton>
                  {field.archivedAt ? (
                    <>
                      <ClusterButton type="button" className="" onClick={() => restoreField(field)} variant="quiet" size="compact">
                        Restore
                      </ClusterButton>
                      <ClusterButton type="button" className="" onClick={() => purgeField(field)} variant="danger" size="compact">
                        Purge
                      </ClusterButton>
                    </>
                  ) : (
                    <ClusterButton type="button" className="" onClick={() => archiveField(field)} variant="danger" size="compact">
                      Archive
                    </ClusterButton>
                  )}
                </div>
              </article>
            );
          })}
          {!filtered.length && <span className="muted">No fields match this view.</span>}
        </div>
      </section>
    </div>
  );
}

export function automationCustomFieldAssignment(value: string) {
  const [fieldId, ...rest] = value.split("::");
  return { fieldId: fieldId.trim(), value: rest.join("::").trim() };
}

export function automationActionLabel(action: AutomationAction, fields: StudioCustomFieldDefinition[]) {
  if (action.type === "set_custom_field") {
    const assignment = automationCustomFieldAssignment(action.value);
    const field = fields.find((item) => item.id === assignment.fieldId);
    return `set ${field?.label || assignment.fieldId || "custom field"} to ${assignment.value || "empty"}`;
  }
  return `${action.type.replace(/_/g, " ")}${action.value ? ` ${action.value}` : ""}`;
}

export function AutomationRulesPanel() {
  const customFieldDefinitionStore = useServerCustomFieldDefinitions(normalizeServerCustomFieldDefinition);
  const [rules, setRules] = useState<StudioAutomationRule[]>([]);
  const [ruleRevision, setRuleRevision] = useState(0);
  const [runs, setRuns] = useState<AutomationRunRecord[]>([]);
  const [jobs, setJobs] = useState<AutomationQueueRecord[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [testInput, setTestInput] = useState({
    type: "Task",
    severity: "medium" as Priority,
    department: "Production",
    projectId: "",
    title: "Sample ticket",
  });
  const [testResult, setTestResult] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [conditionDraft, setConditionDraft] = useState({
    field: "type",
    operator: "equals" as AutomationConditionOperator,
    value: "",
  });
  const [actionDraft, setActionDraft] = useState({
    type: "add_label" as AutomationActionType,
    value: "",
  });
  const emptyForm: Omit<StudioAutomationRule, "id" | "createdAt"> = {
    name: "",
    trigger: "ticket_created",
    conditions: [],
    actions: [],
    priority: 50,
    projectId: "",
    delayMinutes: 0,
    maxRetries: 3,
    stopProcessing: false,
    enabled: true,
  };
  const [form, setForm] = useState(emptyForm);
  const fields = customFieldDefinitionStore.definitions.filter((field) => !field.archivedAt && field.enabled !== false);
  async function loadAutomationState() {
    const [ruleResult, runResult, jobResult] = await Promise.all([
      api<{ ok: true; rules: StudioAutomationRule[]; revision: number }>("/api/automation/rules"),
      api<{ ok: true; runs: AutomationRunRecord[] }>("/api/automation/runs?limit=200"),
      api<{ ok: true; jobs: AutomationQueueRecord[] }>("/api/automation/jobs?limit=200"),
    ]);
    setRules((ruleResult.rules || []).map(normalizeAutomationRule));
    setRuleRevision(Number(ruleResult.revision || 0));
    setRuns(runResult.runs || []);
    setJobs(jobResult.jobs || []);
  }
  useEffect(() => {
    api<Project[]>("/api/projects").then(setProjects).catch(() => setProjects([]));
    loadAutomationState().catch(() => undefined);
  }, []);
  async function persist(next: StudioAutomationRule[]) {
    const normalized = next.map(normalizeAutomationRule);
    setRules(normalized);
    try {
      const result = await api<{ ok: true; rules: StudioAutomationRule[]; revision: number }>("/api/automation/rules", {
        method: "PUT",
        body: JSON.stringify({ rules: normalized, expectedRevision: ruleRevision }),
      });
      setRules((result.rules || normalized).map(normalizeAutomationRule));
      setRuleRevision(Number(result.revision || ruleRevision + 1));
    } catch {
      await loadAutomationState().catch(() => undefined);
    }
  }
  function resetForm(trigger: AutomationTrigger = form.trigger) {
    setEditingId(null);
    setForm({ ...emptyForm, trigger });
    setConditionDraft({ field: "type", operator: "equals", value: "" });
    setActionDraft({ type: "add_label", value: "" });
  }
  function saveRule() {
    if (!form.name?.trim() || !(form.actions || []).length) return;
    const now = new Date().toISOString();
    if (editingId) {
      persist(
        rules.map((rule) =>
          rule.id === editingId
            ? normalizeAutomationRule({
                ...rule,
                ...form,
                name: form.name?.trim() || rule.name,
                updatedAt: now,
              })
            : rule,
        ),
      );
    } else {
      persist([
        ...rules,
        normalizeAutomationRule({
          ...form,
          id: localId("automation"),
          name: form.name?.trim() || "Automation",
          createdAt: now,
        }),
      ]);
    }
    resetForm(form.trigger);
  }
  function editRule(rule: StudioAutomationRule) {
    const normalized = normalizeAutomationRule(rule);
    setEditingId(rule.id);
    setForm({
      name: normalized.name,
      trigger: normalized.trigger,
      conditions: normalized.conditions || [],
      actions: normalized.actions || [],
      priority: normalized.priority,
      projectId: normalized.projectId || "",
      delayMinutes: normalized.delayMinutes,
      maxRetries: normalized.maxRetries,
      stopProcessing: normalized.stopProcessing,
      enabled: normalized.enabled,
      updatedAt: normalized.updatedAt,
    });
  }
  function duplicateRule(rule: StudioAutomationRule) {
    const now = new Date().toISOString();
    persist([
      ...rules,
      normalizeAutomationRule({
        ...rule,
        id: localId("automation"),
        name: `${rule.name} copy`,
        enabled: false,
        createdAt: now,
        updatedAt: now,
      }),
    ]);
  }
  function addCondition() {
    if (!conditionDraft.field) return;
    setForm((prev) => ({
      ...prev,
      conditions: [...(prev.conditions || []), { id: localId("condition"), ...conditionDraft }],
    }));
    setConditionDraft({
      field: conditionDraft.field,
      operator: "equals",
      value: "",
    });
  }
  function addAction() {
    if (!actionDraft.type) return;
    setForm((prev) => ({
      ...prev,
      actions: [...(prev.actions || []), { id: localId("action"), ...actionDraft }],
    }));
    setActionDraft({ type: actionDraft.type, value: "" });
  }
  async function testRules() {
    const result = await api<{ ok: true; result: { matched: string[]; priority: Priority; assigneeId: string; dueDate?: string; labels: string[] } }>("/api/automation/tickets/preview", {
      method: "POST",
      body: JSON.stringify({ ...testInput, labels: "", assigneeId: "", customValues: {} }),
    }).catch(() => null);
    const matched = result?.result?.matched || [];
    setTestResult(matched.length ? `${matched.length} rule${matched.length === 1 ? "" : "s"} would run: ${matched.join(", ")}. Resulting priority: ${result?.result?.priority || testInput.severity}.` : "No enabled rules matched this sample.");
  }
  async function runQueue(force = false, jobId?: string) {
    await api("/api/automation/jobs/run", { method: "POST", body: JSON.stringify({ force, jobId }) });
    await loadAutomationState();
  }
  async function cancelJob(jobId: string) {
    await api(`/api/automation/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
    await loadAutomationState();
  }
  async function clearCompletedJobs() {
    await api("/api/automation/jobs/completed", { method: "DELETE" });
    await loadAutomationState();
  }
  const triggerOptions: AutomationTrigger[] = [...CLUSTER_STUDIO_AUTOMATION_TRIGGERS];
  const actionOptions: AutomationActionType[] = [...CLUSTER_STUDIO_AUTOMATION_ACTION_TYPES];
  return (
    <div className="settings-card-grid-v092 automation-manager-v195 automation-manager-v199">
      <section className="settings-card-v092 span-2">
        <div className="settings-card-head-v092">
          <h3>{editingId ? "Edit automation" : "New automation"}</h3>
          <span>Priority, conditions, chained actions, delays, and retries</span>
        </div>
        <div className="automation-rule-form-v195 automation-rule-form-v199">
          <div className="field">
            <label>Name</label>
            <ClusterTextInput value={form.name || ""} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} placeholder="Route urgent production requests" />
          </div>
          <div className="field">
            <label>Trigger</label>
            <ClusterNativeSelect
              value={form.trigger}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  trigger: event.target.value as AutomationTrigger,
                }))
              }
            >
              {triggerOptions.map((trigger) => (
                <option key={trigger} value={trigger}>
                  {levelLabel(trigger.replace(/_/g, " "))}
                </option>
              ))}
            </ClusterNativeSelect>
          </div>
          <div className="field">
            <label>Project scope</label>
            <ClusterNativeSelect value={form.projectId || ""} onChange={(event) => setForm((prev) => ({ ...prev, projectId: event.target.value }))}>
              <option value="">All projects</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </ClusterNativeSelect>
          </div>
          <div className="field">
            <label>Priority</label>
            <ClusterTextInput
              type="number"
              min="1"
              max="100"
              value={form.priority || 50}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  priority: Number(event.target.value) || 1,
                }))
              }
            />
          </div>
          <div className="field">
            <label>Delay</label>
            <ClusterTextInput
              type="number"
              min="0"
              value={form.delayMinutes || 0}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  delayMinutes: Number(event.target.value) || 0,
                }))
              }
            />
            <small>Minutes before queued actions run.</small>
          </div>
          <div className="field">
            <label>Retries</label>
            <ClusterTextInput
              type="number"
              min="0"
              max="10"
              value={form.maxRetries ?? 3}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  maxRetries: Number(event.target.value) || 0,
                }))
              }
            />
          </div>
        </div>

        <div className="automation-builder-grid-v199">
          <div className="automation-builder-column-v199">
            <div className="settings-card-head-v092">
              <h4>Conditions</h4>
              <span>{(form.conditions || []).length || "All records"}</span>
            </div>
            <div className="automation-builder-row-v199">
              <ClusterNativeSelect
                value={conditionDraft.field}
                onChange={(event) =>
                  setConditionDraft((prev) => ({
                    ...prev,
                    field: event.target.value,
                  }))
                }
              >
                <option value="type">Ticket type</option>
                <option value="priority">Priority</option>
                <option value="department">Department</option>
                <option value="title">Title</option>
                <option value="projectId">Project ID</option>
                {fields
                  .filter((field) => field.entity === "ticket")
                  .map((field) => (
                    <option key={field.id} value={`custom.${field.id}`}>
                      Field: {field.label}
                    </option>
                  ))}
              </ClusterNativeSelect>
              <ClusterNativeSelect
                value={conditionDraft.operator}
                onChange={(event) =>
                  setConditionDraft((prev) => ({
                    ...prev,
                    operator: event.target.value as AutomationConditionOperator,
                  }))
                }
              >
                {CLUSTER_STUDIO_AUTOMATION_CONDITION_OPERATORS.map((operator) => (
                  <option key={operator} value={operator}>
                    {operator === "not_equals" ? "Does not equal" : operator === "in" ? "Is one of" : levelLabel(operator.replace(/_/g, " "))}
                  </option>
                ))}
              </ClusterNativeSelect>
              <ClusterTextInput
                disabled={["is_empty", "is_not_empty"].includes(conditionDraft.operator)}
                value={conditionDraft.value}
                onChange={(event) =>
                  setConditionDraft((prev) => ({
                    ...prev,
                    value: event.target.value,
                  }))
                }
                placeholder="Match value"
              />
              <ClusterButton type="button" className="" onClick={addCondition} variant="quiet" size="compact">
                Add
              </ClusterButton>
            </div>
            <div className="automation-chip-list-v199">
              {(form.conditions || []).map((condition) => (
                <ClusterButton type="button"
                  key={condition.id}
                  onClick={() =>
                    setForm((prev) => ({
                      ...prev,
                      conditions: (prev.conditions || []).filter((item) => item.id !== condition.id),
                    }))
                  }
                >
                  {condition.field} {condition.operator.replace(/_/g, " ")} {condition.value || "∅"} <ClusterIcon name="close" />
                </ClusterButton>
              ))}
              {!(form.conditions || []).length && <span className="muted">No conditions. The rule matches every record for this trigger and scope.</span>}
            </div>
          </div>

          <div className="automation-builder-column-v199">
            <div className="settings-card-head-v092">
              <h4>Actions</h4>
              <span>{(form.actions || []).length} chained</span>
            </div>
            <div className="automation-builder-row-v199">
              <ClusterNativeSelect
                value={actionDraft.type}
                onChange={(event) =>
                  setActionDraft((prev) => ({
                    ...prev,
                    type: event.target.value as AutomationActionType,
                    value: "",
                  }))
                }
              >
                {actionOptions.map((action) => (
                  <option key={action} value={action}>
                    {levelLabel(action.replace(/_/g, " "))}
                  </option>
                ))}
              </ClusterNativeSelect>
              {actionDraft.type === "set_custom_field" ? (
                <>
                  <ClusterNativeSelect
                    value={automationCustomFieldAssignment(actionDraft.value).fieldId}
                    onChange={(event) =>
                      setActionDraft((prev) => ({
                        ...prev,
                        value: `${event.target.value}::${automationCustomFieldAssignment(prev.value).value}`,
                      }))
                    }
                  >
                    <option value="">Choose field</option>
                    {fields
                      .filter((field) => field.entity === "ticket")
                      .map((field) => (
                        <option key={field.id} value={field.id}>
                          {field.label}
                        </option>
                      ))}
                  </ClusterNativeSelect>
                  <ClusterTextInput
                    value={automationCustomFieldAssignment(actionDraft.value).value}
                    onChange={(event) =>
                      setActionDraft((prev) => ({
                        ...prev,
                        value: `${automationCustomFieldAssignment(prev.value).fieldId}::${event.target.value}`,
                      }))
                    }
                    placeholder="Field value"
                  />
                </>
              ) : (
                <ClusterTextInput
                  value={actionDraft.value}
                  onChange={(event) =>
                    setActionDraft((prev) => ({
                      ...prev,
                      value: event.target.value,
                    }))
                  }
                  placeholder={actionDraft.type === "set_due_offset" ? "Days from trigger" : actionDraft.type === "assign_user" ? "User ID or name" : "Action value"}
                />
              )}
              <ClusterButton type="button" className="" onClick={addAction} variant="quiet" size="compact">
                Add
              </ClusterButton>
            </div>
            <div className="automation-chip-list-v199">
              {(form.actions || []).map((action) => (
                <ClusterButton type="button"
                  key={action.id}
                  onClick={() =>
                    setForm((prev) => ({
                      ...prev,
                      actions: (prev.actions || []).filter((item) => item.id !== action.id),
                    }))
                  }
                >
                  {automationActionLabel(action, fields)} <ClusterIcon name="close" />
                </ClusterButton>
              ))}
              {!(form.actions || []).length && <span className="muted">Add at least one action before saving.</span>}
            </div>
          </div>
        </div>

        <div className="button-row">
          <label className="tool-check">
            <ClusterInput type="checkbox" checked={Boolean(form.enabled)} onChange={(event) => setForm((prev) => ({ ...prev, enabled: event.target.checked }))} /> Enabled
          </label>
          <label className="tool-check">
            <ClusterInput
              type="checkbox"
              checked={Boolean(form.stopProcessing)}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  stopProcessing: event.target.checked,
                }))
              }
            />{" "}
            Stop lower-priority rules after match
          </label>
          <ClusterButton type="button" className="" onClick={saveRule} variant="primary">
            {editingId ? "Save changes" : "Add rule"}
          </ClusterButton>
          {editingId && (
            <ClusterButton type="button" className="" onClick={() => resetForm(form.trigger)} variant="secondary">
              Cancel
            </ClusterButton>
          )}
        </div>
      </section>

      <section className="settings-card-v092 span-2">
        <div className="settings-card-head-v092">
          <h3>Rule catalog</h3>
          <span>{rules.filter((rule) => rule.enabled).length} enabled · priority ordered</span>
        </div>
        <div className="automation-rule-list-v195">
          {[...rules]
            .sort((a, b) => Number(b.priority || 50) - Number(a.priority || 50))
            .map((rule) => (
              <article key={rule.id} className={rule.enabled ? "" : "disabled"}>
                <div>
                  <strong>{rule.name}</strong>
                  <span>
                    P{rule.priority || 50} · {levelLabel(rule.trigger.replace(/_/g, " "))} · {(rule.conditions || []).length} condition
                    {(rule.conditions || []).length === 1 ? "" : "s"} · {(rule.actions || []).length} action
                    {(rule.actions || []).length === 1 ? "" : "s"}
                    {rule.projectId ? ` · ${projects.find((project) => project.id === rule.projectId)?.name || "project scoped"}` : ""}
                    {rule.delayMinutes ? ` · ${rule.delayMinutes}m delay` : ""}
                  </span>
                </div>
                <div className="button-row compact">
                  <label className="tool-check compact">
                    <ClusterInput
                      type="checkbox"
                      checked={rule.enabled}
                      onChange={(event) =>
                        persist(
                          rules.map((item) =>
                            item.id === rule.id
                              ? {
                                  ...item,
                                  enabled: event.target.checked,
                                  updatedAt: new Date().toISOString(),
                                }
                              : item,
                          ),
                        )
                      }
                    />{" "}
                    Enabled
                  </label>
                  <ClusterButton type="button" className="" onClick={() => editRule(rule)} variant="quiet" size="compact">
                    Edit
                  </ClusterButton>
                  <ClusterButton type="button" className="" onClick={() => duplicateRule(rule)} variant="quiet" size="compact">
                    Duplicate
                  </ClusterButton>
                  <ClusterButton type="button" className="" onClick={() => persist(rules.filter((item) => item.id !== rule.id))} variant="danger" size="compact">
                    Remove
                  </ClusterButton>
                </div>
              </article>
            ))}
        </div>
      </section>

      <section className="settings-card-v092">
        <div className="settings-card-head-v092">
          <h3>Dry run</h3>
          <span>Preview priority and stop behavior</span>
        </div>
        <div className="settings-stack compact-fields-v092">
          <div className="field">
            <label>Ticket type</label>
            <ClusterTextInput value={testInput.type} onChange={(event) => setTestInput((prev) => ({ ...prev, type: event.target.value }))} />
          </div>
          <div className="two-col">
            <div className="field">
              <label>Priority</label>
              <ClusterNativeSelect
                value={testInput.severity}
                onChange={(event) =>
                  setTestInput((prev) => ({
                    ...prev,
                    severity: event.target.value as Priority,
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
              <label>Department</label>
              <ClusterTextInput
                value={testInput.department}
                onChange={(event) =>
                  setTestInput((prev) => ({
                    ...prev,
                    department: event.target.value,
                  }))
                }
              />
            </div>
          </div>
          <div className="field">
            <label>Project</label>
            <ClusterNativeSelect
              value={testInput.projectId}
              onChange={(event) =>
                setTestInput((prev) => ({
                  ...prev,
                  projectId: event.target.value,
                }))
              }
            >
              <option value="">No project scope</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </ClusterNativeSelect>
          </div>
          <ClusterButton type="button" className="" onClick={testRules} variant="secondary">
            Run dry test
          </ClusterButton>
          {testResult && <p className="muted tight">{testResult}</p>}
        </div>
      </section>

      <section className="settings-card-v092">
        <div className="settings-card-head-v092">
          <h3>Execution queue</h3>
          <span>{jobs.filter((job) => ["pending", "failed", "running"].includes(job.status)).length} active</span>
        </div>
        <div className="button-row compact">
          <ClusterButton type="button" className="" onClick={() => void runQueue(false)} variant="quiet" size="compact">
            Run due
          </ClusterButton>
          <ClusterButton type="button" className="" onClick={() => void runQueue(true)} variant="quiet" size="compact">
            Run all pending
          </ClusterButton>
          <ClusterButton type="button"
            className=""
onClick={() => void clearCompletedJobs()}
           variant="danger" size="compact">
            Clear completed
          </ClusterButton>
        </div>
        <div className="automation-run-list-v196 automation-queue-list-v199">
          {jobs.slice(0, 12).map((job) => (
            <article key={job.id}>
              <div>
                <strong>{job.ruleName}</strong>
                <span>
                  {job.entityLabel} · {automationActionLabel(job.action, fields)} · {job.status}
                  {job.lastError ? ` · ${job.lastError}` : ""}
                </span>
              </div>
              <div className="button-row compact">
                <em>
                  {compactDateTime(job.scheduledFor)} · {job.attempts}/{job.maxRetries + 1}
                </em>
                {["pending", "failed"].includes(job.status) && (
                  <ClusterButton type="button"
                    className=""
onClick={() => void runQueue(true, job.id)}
                   variant="quiet" size="compact">
                    Run
                  </ClusterButton>
                )}
                {!["succeeded", "cancelled"].includes(job.status) && (
                  <ClusterButton type="button"
                    className=""
onClick={() => void cancelJob(job.id)}
                   variant="danger" size="compact">
                    Cancel
                  </ClusterButton>
                )}
              </div>
            </article>
          ))}
          {!jobs.length && <span className="muted">No delayed or retrying actions.</span>}
        </div>
      </section>

      <section className="settings-card-v092 span-2">
        <div className="settings-card-head-v092">
          <h3>Run history</h3>
          <span>{runs.length} recorded</span>
        </div>
        <div className="automation-run-list-v196 automation-run-list-v199">
          {runs.slice(0, 20).map((run) => (
            <article key={run.id}>
              <div>
                <strong>{run.ruleName}</strong>
                <span>
                  {run.entityLabel} · {run.result} · {run.status}
                </span>
              </div>
              <em>
                {compactDateTime(run.createdAt)}
                {run.attempt ? ` · attempt ${run.attempt}` : ""}
              </em>
            </article>
          ))}
          {!runs.length && <span className="muted">No rule executions recorded yet.</span>}
        </div>
      </section>
    </div>
  );
}

export const STUDIO_PERMISSION_GROUPS: Array<{ label: string; description: string; tools: ToolPermissionKey[] }> = [
  {
    label: "Personal workspace",
    description: "The member's own queue, inbox, calendar, schedule, and account preferences.",
    tools: ["mywork", "inbox", "calendar", "scheduler", "settings"],
  },
  {
    label: "Project production",
    description: "Project pages and the tools used to plan, create, review, and deliver work.",
    tools: ["projects", "boards", "whiteboards", "timeline", "builds", "qa", "tickets"],
  },
  {
    label: "Content and assets",
    description: "Studio files, media, reusable resources, and curated packet content.",
    tools: ["viewer", "library", "packets"],
  },
  {
    label: "Studio administration",
    description: "People, activity, integrations, and protected configuration surfaces.",
    tools: ["people", "activity", "integrations", "serverConfig"],
  },
];

export function StudioPermissionEditor({
  permissions,
  inherited,
  onChange,
  readOnly = false,
}: {
  permissions?: ToolPermissions;
  inherited: ToolPermissions;
  onChange: (tool: ToolPermissionKey, level: ToolPermissionLevel | "inherit") => void;
  readOnly?: boolean;
}) {
  return (
    <div className="studio-permission-editor-v272">
      {STUDIO_PERMISSION_GROUPS.map((group) => (
        <section key={group.label} className="studio-permission-group-v272">
          <div className="studio-permission-group-head-v272">
            <div>
              <strong>{group.label}</strong>
              <span>{group.description}</span>
            </div>
          </div>
          <div className="studio-permission-list-v272">
            {group.tools.map((toolKey) => {
              const option = TOOL_PERMISSION_OPTIONS.find((item) => item.key === toolKey);
              const explicit = permissions?.[toolKey];
              const effective = explicit || inherited[toolKey] || "none";
              return (
                <label key={toolKey} className="studio-permission-row-v272">
                  <span className="studio-permission-copy-v272">
                    <strong>{option?.label || toolKey}</strong>
                    <small>{option?.description}</small>
                  </span>
                  <span className="studio-permission-effective-v272">Effective: {effective}</span>
                  <ClusterNativeSelect value={explicit || "inherit"} disabled={readOnly} onChange={(event) => onChange(toolKey, event.target.value as ToolPermissionLevel | "inherit") }>
                    <option value="inherit">Inherit ({inherited[toolKey] || "none"})</option>
                    {TOOL_LEVEL_OPTIONS.map((level) => (
                      <option key={level} value={level}>
                        {level === "none" ? "No access" : level[0].toUpperCase() + level.slice(1)}
                      </option>
                    ))}
                  </ClusterNativeSelect>
                </label>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

