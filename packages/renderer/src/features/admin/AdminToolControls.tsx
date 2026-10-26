import { ClusterDisclosureGroup } from "../../components/ClusterDisclosureGroup";
import { CLUSTER_ADMIN_CONFIGURABLE_TOOL_IDS, CLUSTER_TOOL_PERMISSION_MANIFEST, CLUSTER_TOOL_SETTING_KEYS, CLUSTER_LINKED_STUDIO_TOOL_FIELDS, clusterResolveToolConfig, clusterToolNumericRange, clusterToolStudioChangeImpact, type ClusterToolSettingProvenance, type ClusterSettingPrecondition, type ClusterAdminConfigurableToolId } from "@cluster/shared";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterTextArea } from "../../components/ClusterTextArea";
import { ClusterButton } from "../../components/ClusterButton";
import { useEffect, useMemo, useState } from "react";
import { ClusterSelect } from "../../components/ClusterSelect";
import { DangerConfirmDialog } from "../../components/DangerConfirmDialog";
import { api } from "../../core/api";
import { getToolLevel, type ToolPermissionKey, type ToolPermissionLevel, type ToolPermissions } from "../../core/permissions";
import { TIMEZONE_OPTIONS, WORKING_DAY_OPTIONS, optionsWithCurrent } from "../../core/options";
import "./admin-workflows.css";
import { ClusterInput } from "../../components/ClusterNativeControls";
import { ClusterEmptyState } from "../../components/ClusterEmptyState";
import { confirmCluster } from "../../components/cluster-dialog-service";

type ProjectOption = { id: string; name: string; archived?: boolean };
type AdminUserOption = {
  id: string;
  username: string;
  displayName?: string | null;
  workspaceRole?: string | null;
  accountType?: string | null;
  employmentType?: string | null;
  teamName?: string | null;
  title?: string | null;
  accessExpiresAt?: string | null;
  archived?: boolean;
  isAdmin?: boolean;
  toolPermissions?: ToolPermissions | null;
};
export type ToolKey = ClusterAdminConfigurableToolId;
type ToolStatus = "operational" | "degraded" | "disabled";
type AdminOperation = { id: string; label: string; danger?: boolean; requiresDays?: boolean; defaultDays?: number };
type ToolSnapshot = {
  key: ToolKey;
  enabled: boolean;
  status: ToolStatus;
  config: Record<string, any>;
  expectedSettings?: Record<string, ClusterSettingPrecondition> | null;
  settingProvenance?: ClusterToolSettingProvenance[] | null;
  runtime: { records: number; active: number; detail: string; [key: string]: unknown };
  operations: AdminOperation[];
};
type ToolResponse = { ok: true; updatedAt: string; tools: ToolSnapshot[] };
type AdminMode = "controls" | "access" | "operations";
type CalendarProjectDefault = { ok: true; value: "agenda" | "week" | "month" | "day"; source: "studio" | "project"; revision: number | null; storedValue: "agenda" | "week" | "month" | "day" | null; lockUserOverride: boolean };

const TOOL_META = Object.fromEntries(
  CLUSTER_ADMIN_CONFIGURABLE_TOOL_IDS.map((key) => [key, { label: CLUSTER_TOOL_PERMISSION_MANIFEST[key].label, permission: key as ToolPermissionKey }]),
) as Record<ToolKey, { label: string; permission: ToolPermissionKey }>;

const CATEGORY_OPTIONS = ["work", "meeting", "admin", "research", "support", "other"];
const ACCESS_OPTIONS: Array<{ value: ToolPermissionLevel; label: string }> = [
  { value: "none", label: "None" },
  { value: "view", label: "View" },
  { value: "edit", label: "Edit" },
  { value: "manage", label: "Manage" }
];

const FALLBACK_OPERATIONS: Record<ToolKey, AdminOperation[]> = {
  timeline: [
    { id: "resolve-discussions", label: "Resolve open discussions" },
    { id: "remove-past-manual", label: "Delete old manual items", danger: true, requiresDays: true, defaultDays: 180 }
  ],
  tickets: [
    { id: "archive-resolved", label: "Archive resolved tickets" },
    { id: "purge-archived", label: "Delete archived tickets", danger: true, requiresDays: true, defaultDays: 90 }
  ],
  calendar: [
    { id: "remove-cancelled", label: "Delete past cancelled events", danger: true },
    { id: "remove-past", label: "Delete old events", danger: true, requiresDays: true, defaultDays: 365 }
  ],
  scheduler: [
    { id: "stop-stale-timers", label: "Stop stale timers" },
    { id: "lock-closed", label: "Lock old entries", requiresDays: true, defaultDays: 14 },
    { id: "clear-old-schedule", label: "Delete old schedule blocks", danger: true, requiresDays: true, defaultDays: 90 }
  ],
  library: [
    { id: "verify-storage", label: "Verify storage" },
    { id: "archive-deprecated", label: "Archive deprecated items" },
    { id: "archive-stale-drafts", label: "Archive stale drafts", requiresDays: true, defaultDays: 90 },
    { id: "clear-model-thumbnails", label: "Rebuild model thumbnails" },
    { id: "clear-model-cache", label: "Clear converted model cache" }
  ],
  packets: [
    { id: "ensure-root", label: "Create or repair Packets root" },
    { id: "archive-empty", label: "Archive empty packets", danger: true },
    { id: "normalize-folders", label: "Normalize packet folders" }
  ]
};

function fallbackSnapshot(tool: ToolKey, input: Record<string, any> | undefined): ToolSnapshot {
  const snapshots: Record<ToolKey, ToolSnapshot> = {
    timeline: { key: "timeline", enabled: input?.timelineEnabled !== false, status: input?.timelineEnabled === false ? "disabled" : "operational", runtime: { records: 0, active: 0, detail: "Runtime status pending" }, operations: FALLBACK_OPERATIONS.timeline, config: clusterResolveToolConfig("timeline", input || {}) },
    tickets: { key: "tickets", enabled: input?.ticketsEnabled !== false, status: input?.ticketsEnabled === false ? "disabled" : "operational", runtime: { records: 0, active: 0, detail: "Runtime status pending" }, operations: FALLBACK_OPERATIONS.tickets, config: clusterResolveToolConfig("tickets", input || {}) },
    calendar: { key: "calendar", enabled: input?.calendarEnabled !== false, status: input?.calendarEnabled === false ? "disabled" : "operational", runtime: { records: 0, active: 0, detail: "Runtime status pending" }, operations: FALLBACK_OPERATIONS.calendar, config: clusterResolveToolConfig("calendar", input || {}) },
    scheduler: { key: "scheduler", enabled: input?.schedulerEnabled !== false, status: input?.schedulerEnabled === false ? "disabled" : "operational", runtime: { records: 0, active: 0, detail: "Runtime status pending" }, operations: FALLBACK_OPERATIONS.scheduler, config: clusterResolveToolConfig("scheduler", input || {}) },
    library: { key: "library", enabled: input?.libraryEnabled !== false, status: input?.libraryEnabled === false ? "disabled" : "operational", runtime: { records: 0, active: 0, detail: "Runtime status pending" }, operations: FALLBACK_OPERATIONS.library, config: clusterResolveToolConfig("library", input || {}) },
    packets: { key: "packets", enabled: input?.packetsEnabled !== false, status: input?.packetsEnabled === false ? "disabled" : "operational", runtime: { records: 0, active: 0, detail: "Runtime status pending" }, operations: FALLBACK_OPERATIONS.packets, config: clusterResolveToolConfig("packets", input || {}) }
  };
  return snapshots[tool];
}

/** Only compare-and-swap edited controls, never overwrite unrelated Studio keys. */
function editedToolSettings(tool: ToolKey, original: Record<string, any>, draft: Record<string, any>, baselines?: Record<string, ClusterSettingPrecondition> | null) {
  if (!baselines) throw new Error("Tool Settings are not ready for safe editing. Reload this tool before saving.");
  const expectedSettings: Record<string, ClusterSettingPrecondition> = {};
  const map = CLUSTER_TOOL_SETTING_KEYS[tool];
  for (const [field, value] of Object.entries(draft)) {
    if (JSON.stringify(value) === JSON.stringify(original[field])) continue;
    const settingKey = map[field];
    if (!settingKey || !Object.prototype.hasOwnProperty.call(baselines, settingKey)) throw new Error(`Missing authoritative baseline for ${field}. Reload and try again.`);
    expectedSettings[settingKey] = baselines[settingKey];
  }
  return expectedSettings;
}

function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (checked: boolean) => void; children: React.ReactNode }) {
  return <label className="admin-tool-toggle-v232"><ClusterInput type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><span>{children}</span></label>;
}

function NumericField({ label, value, min, max, suffix, onChange }: { label: string; value: number; min: number; max: number; suffix?: string; onChange: (value: number) => void }) {
  return <label className="admin-tool-number-v232"><span>{label}</span><div><ClusterTextInput type="number" min={min} max={max} value={value} onChange={(event) => onChange(Math.min(max, Math.max(min, Number(event.target.value || min))))} />{suffix && <em>{suffix}</em>}</div></label>;
}

function displayUser(user: AdminUserOption) {
  return user.displayName || user.username;
}

export function AdminToolControls({ tool, settings, projects, users = [], onUsersChanged }: { tool: ToolKey; settings?: Record<string, any>; projects: ProjectOption[]; users?: AdminUserOption[]; onUsersChanged?: () => Promise<void> | void }) {
  const [snapshot, setSnapshot] = useState<ToolSnapshot>(() => fallbackSnapshot(tool, settings));
  const [draft, setDraft] = useState<Record<string, any>>(() => fallbackSnapshot(tool, settings).config);
  const [mode, setMode] = useState<AdminMode>("controls");
  const [status, setStatus] = useState("");
  const [calendarProjectId, setCalendarProjectId] = useState("");
  const [calendarProjectDefault, setCalendarProjectDefault] = useState<CalendarProjectDefault | null>(null);
  const [calendarProjectDraft, setCalendarProjectDraft] = useState<CalendarProjectDefault["value"]>("agenda");
  const [calendarProjectLockDraft, setCalendarProjectLockDraft] = useState(false);
  const [calendarProjectBusy, setCalendarProjectBusy] = useState(false);
  const [calendarProjectLoadError, setCalendarProjectLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [studioChangesAcknowledged, setStudioChangesAcknowledged] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [accessDrafts, setAccessDrafts] = useState<Record<string, ToolPermissionLevel>>({});
  const [operationDays, setOperationDays] = useState<Record<string, number>>({});
  const [pendingOperation, setPendingOperation] = useState<{ operation: AdminOperation; days?: number } | null>(null);
  const activeProjects = useMemo(() => projects.filter((project) => !project.archived), [projects]);
  const permissionKey = TOOL_META[tool].permission;
  const linkedStudioSettings = CLUSTER_LINKED_STUDIO_TOOL_FIELDS[tool] || {};
  const changedLinkedStudioSettings = Object.entries(linkedStudioSettings).filter(([field]) => JSON.stringify(draft[field]) !== JSON.stringify(snapshot.config[field]));

  useEffect(() => {
    const next = fallbackSnapshot(tool, settings);
    setSnapshot(next);
    setDraft({ ...next.config });
    setStudioChangesAcknowledged(false);
    setMode("controls");
    void refresh();
  }, [tool]);

  useEffect(() => {
    setAccessDrafts(Object.fromEntries(users.map((user) => [user.id, getToolLevel(user, permissionKey)])));
  }, [users, permissionKey]);

  async function refresh() {
    setBusy(true);
    setStatus("");
    try {
      const response = await api<ToolResponse>("/api/admin/tools");
      const selected = response.tools.find((item) => item.key === tool);
      if (!selected) throw new Error("Tool backend not found.");
      setSnapshot(selected);
      setDraft({ ...selected.config });
      setStudioChangesAcknowledged(false);
      setUpdatedAt(response.updatedAt);
      setOperationDays((current) => ({ ...Object.fromEntries(selected.operations.filter((operation) => operation.requiresDays).map((operation) => [operation.id, current[operation.id] || operation.defaultDays || 30])) }));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Tool backend could not be loaded.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    setCalendarProjectDefault(null);
    setCalendarProjectLockDraft(false);
    setCalendarProjectLoadError(null);
    if (tool === "calendar" && calendarProjectId) {
      void api<CalendarProjectDefault>(`/api/admin/tools/calendar/projects/${encodeURIComponent(calendarProjectId)}/default-view`)
        .then((result) => { if (!cancelled) { setCalendarProjectDefault(result); setCalendarProjectDraft(result.value); setCalendarProjectLockDraft(result.lockUserOverride); } })
        .catch((error) => { if (!cancelled) setCalendarProjectLoadError(error instanceof Error ? error.message : "Could not load Project settings."); });
    }
    return () => { cancelled = true; };
  }, [tool, calendarProjectId]);

  async function saveCalendarProjectView(reset = false) {
    if (!calendarProjectId || !calendarProjectDefault) return;
    setCalendarProjectBusy(true);
    setStatus("");
    try {
      const result = await api<CalendarProjectDefault>(`/api/admin/tools/calendar/projects/${encodeURIComponent(calendarProjectId)}/default-view`, {
        method: "PUT",
        body: JSON.stringify({ value: reset ? null : calendarProjectDraft, expectedRevision: calendarProjectDefault.revision, lockUserOverride: reset ? false : calendarProjectLockDraft }),
      });
      setCalendarProjectDefault(result);
      setCalendarProjectDraft(result.value);
      setCalendarProjectLockDraft(result.lockUserOverride);
      setStatus(reset ? "Project override removed. Studio default now applies." : "Project Calendar default saved.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Project Calendar default could not be saved. Your edit was retained.");
    } finally { setCalendarProjectBusy(false); }
  }

  function patch(key: string, value: unknown) {
    setDraft((current) => ({ ...current, [key]: value }));
    setStudioChangesAcknowledged(false);
  }

  function toggleList(key: "billableProjectIds" | "billableCategories", value: string) {
    const current = Array.isArray(draft[key]) ? draft[key] as string[] : [];
    patch(key, current.includes(value) ? current.filter((item) => item !== value) : [...current, value]);
  }

  async function save() {
    setBusy(true);
    setStatus("");
    try {
      const expectedSettings = editedToolSettings(tool, snapshot.config, draft, snapshot.expectedSettings);
      if (!Object.keys(expectedSettings).length) { setStatus("No settings changes."); return; }
      const studioChanges = clusterToolStudioChangeImpact(tool, Object.keys(expectedSettings));
      // Explicit impact acknowledgement. The server also enforces this for direct API callers.
      if (studioChanges.length && !studioChangesAcknowledged) {
        setStatus("Review and acknowledge the Studio-wide changes before saving.");
        return;
      }
      const result = await api<{ ok: true; config: Record<string, any>; expectedSettings: Record<string, ClusterSettingPrecondition>; settingProvenance: ClusterToolSettingProvenance[]; runtime: ToolSnapshot["runtime"]; operations: AdminOperation[] }>(`/api/admin/tools/${tool}`, { method: "PUT", body: JSON.stringify({ config: draft, expectedSettings, acknowledgeStudioChanges: studioChanges.length > 0 }) });
      setSnapshot((current) => ({ ...current, enabled: result.config.enabled !== false, status: result.config.enabled === false ? "disabled" : "operational", config: result.config, expectedSettings: result.expectedSettings, settingProvenance: result.settingProvenance, runtime: result.runtime, operations: result.operations || current.operations }));
      setDraft({ ...result.config });
      setStudioChangesAcknowledged(false);
      setStatus(`${TOOL_META[tool].label} saved.`);
      setUpdatedAt(new Date().toISOString());
      window.dispatchEvent(new CustomEvent("cluster-tool-settings-changed", { detail: { tool, config: result.config } }));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Controls could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  // Delete an explicit saved Studio/Tool value, returning this editor field to
  // the canonical resolved fallback. Other unsaved form edits are retained.
  async function resetSavedSetting(entry: ClusterToolSettingProvenance) {
    const baseline = snapshot.expectedSettings?.[entry.persistedKey];
    if (busy || entry.source !== "stored" || !baseline?.exists) {
      setStatus("Refresh the setting sources before resetting this field.");
      return;
    }
    const label = entry.field.replace(/([A-Z])/g, " $1");
    const impact = entry.scope === "studio"
      ? ` This is a Studio-wide setting and affects other workspaces (${entry.description}).`
      : "";
    const accepted = await confirmCluster({
      title: `Reset ${label}?`,
      message: `Remove this saved setting and use Cluster's resolved default instead.${impact} Other unsaved edits will be preserved.`,
      confirmLabel: "Reset saved value",
      tone: "default",
    });
    if (!accepted) return;
    setBusy(true);
    setStatus("");
    try {
      const result = await api<{ ok: true; config: Record<string, any>; expectedSettings: Record<string, ClusterSettingPrecondition>; settingProvenance: ClusterToolSettingProvenance[]; runtime: ToolSnapshot["runtime"]; operations: AdminOperation[] }>(
        `/api/admin/tools/${tool}/settings/${entry.field}/reset`,
        { method: "POST", body: JSON.stringify({ expectedSetting: baseline, acknowledgeStudioChanges: entry.scope === "studio" }) },
      );
      setSnapshot((current) => ({ ...current, enabled: result.config.enabled !== false, status: result.config.enabled === false ? "disabled" : "operational", config: result.config, expectedSettings: result.expectedSettings, settingProvenance: result.settingProvenance, runtime: result.runtime, operations: result.operations || current.operations }));
      setDraft((current) => ({ ...current, [entry.field]: result.config[entry.field] }));
      setStudioChangesAcknowledged(false);
      setUpdatedAt(new Date().toISOString());
      setStatus(`${label} now uses its resolved default.`);
      window.dispatchEvent(new CustomEvent("cluster-tool-settings-changed", { detail: { tool, config: result.config } }));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not reset the saved setting. Your draft is retained.");
    } finally {
      setBusy(false);
    }
  }

  async function setToolEnabled(enabled: boolean) {
    setBusy(true);
    setStatus("");
    try {
      const nextConfig = { ...snapshot.config, enabled };
      if (snapshot.config.enabled === enabled) { setStatus(`Tool is already ${enabled ? "enabled" : "disabled"}.`); return; }
      const expectedSettings = editedToolSettings(tool, snapshot.config, nextConfig, snapshot.expectedSettings);
      const result = await api<{ ok: true; config: Record<string, any>; expectedSettings: Record<string, ClusterSettingPrecondition>; settingProvenance: ClusterToolSettingProvenance[]; runtime: ToolSnapshot["runtime"]; operations: AdminOperation[] }>(`/api/admin/tools/${tool}`, { method: "PUT", body: JSON.stringify({ config: nextConfig, expectedSettings }) });
      setSnapshot((current) => ({ ...current, enabled: result.config.enabled !== false, status: result.config.enabled === false ? "disabled" : "operational", config: result.config, expectedSettings: result.expectedSettings, settingProvenance: result.settingProvenance, runtime: result.runtime, operations: result.operations || current.operations }));
      // A quick availability toggle must not discard unsaved controls.
      setDraft((current) => ({ ...current, enabled: result.config.enabled }));
      setStatus(`${TOOL_META[tool].label} ${enabled ? "enabled" : "disabled"}.`);
      setUpdatedAt(new Date().toISOString());
      window.dispatchEvent(new CustomEvent("cluster-tool-settings-changed", { detail: { tool, config: result.config } }));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Tool state could not be changed.");
    } finally {
      setBusy(false);
    }
  }

  async function saveAccess() {
    const changed = users.filter((user) => !user.isAdmin && accessDrafts[user.id] && accessDrafts[user.id] !== getToolLevel(user, permissionKey));
    if (!changed.length) {
      setStatus("No access changes.");
      return;
    }
    setBusy(true);
    setStatus("");
    try {
      for (const user of changed) {
        await api(`/api/users/${user.id}`, {
          method: "PATCH",
          body: JSON.stringify({ toolPermissions: { ...(user.toolPermissions || {}), [permissionKey]: accessDrafts[user.id] } })
        });
      }
      await onUsersChanged?.();
      setStatus(`${changed.length} access change${changed.length === 1 ? "" : "s"} saved.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Access could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function executeOperation(operation: AdminOperation, days?: number) {
    setBusy(true);
    setStatus("");
    try {
      const result = await api<{ ok: true; message: string; runtime: ToolSnapshot["runtime"]; updatedAt: string }>(`/api/admin/tools/${tool}/actions/${operation.id}`, {
        method: "POST",
        body: JSON.stringify({ confirm: true, days })
      });
      setSnapshot((current) => ({ ...current, runtime: result.runtime }));
      setUpdatedAt(result.updatedAt);
      setStatus(result.message);
      setPendingOperation(null);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Operation failed.");
    } finally {
      setBusy(false);
    }
  }

  async function runOperation(operation: AdminOperation) {
    const days = operation.requiresDays ? Math.max(1, Number(operationDays[operation.id] || operation.defaultDays || 30)) : undefined;
    if (operation.danger) {
      setPendingOperation({ operation, days });
      return;
    }
    await executeOperation(operation, days);
  }

  return (
    <section className="admin-tool-console-v232 admin-tool-backend-v235">
      <header className="admin-tool-console-head-v232">
        <div><h2>{TOOL_META[tool].label}</h2><span className={`admin-tool-backend-state-v235 ${snapshot.status}`}><i />{snapshot.status}</span></div>
        <div className="button-row"><ClusterButton type="button" className="" disabled={busy} onClick={() => void refresh()} variant="secondary">Refresh</ClusterButton>{mode === "controls" && <ClusterButton type="button" className="" disabled={busy} onClick={() => void save()} variant="primary">{busy ? "Saving…" : `Save ${TOOL_META[tool].label}`}</ClusterButton>}{mode === "access" && <ClusterButton type="button" className="" disabled={busy} onClick={() => void saveAccess()} variant="primary">Save access</ClusterButton>}</div>
      </header>

      <div className="admin-tool-metrics-v235" aria-label="Runtime status">
        <span><strong>{snapshot.runtime.records ?? 0}</strong> records</span>
        <span><strong>{snapshot.runtime.active ?? 0}</strong> active</span>
        <span>{snapshot.runtime.detail}</span>
        <span>{updatedAt ? new Date(updatedAt).toLocaleString() : "Not checked"}</span>
      </div>

      <nav className="admin-tool-mode-nav-v235" aria-label={`${TOOL_META[tool].label} backend sections`}>
        <ClusterButton unstyled type="button" className={mode === "controls" ? "active" : ""} onClick={() => setMode("controls")}>Controls</ClusterButton>
        <ClusterButton unstyled type="button" className={mode === "access" ? "active" : ""} onClick={() => setMode("access")}>Access</ClusterButton>
        <ClusterButton unstyled type="button" className={mode === "operations" ? "active" : ""} onClick={() => setMode("operations")}>Operations</ClusterButton>
      </nav>

      <div className="admin-tool-state-bar-v243">
        <div><i className={snapshot.enabled ? "online" : "offline"} /><span>{TOOL_META[tool].label}</span><strong>{snapshot.enabled ? "Enabled" : "Disabled"}</strong></div>
        <label><span>Enable tool</span><ClusterInput type="checkbox" checked={snapshot.enabled} disabled={busy} onChange={(event) => void setToolEnabled(event.target.checked)} /></label>
      </div>

      {status && <div className="admin-workflow-status-v231" role="status">{status}</div>}

      {mode === "controls" && <main className="admin-tool-editor-v232 admin-tool-mode-panel-v235">
        <div className="admin-tool-editor-title-v232"><h3>Settings</h3></div>
        {snapshot.settingProvenance && <ClusterDisclosureGroup className="hint-box slim" title="Setting sources" summary={`${snapshot.settingProvenance.filter((entry) => entry.source === "stored").length} saved overrides · ${snapshot.settingProvenance.filter((entry) => entry.source === "resolved").length} resolved defaults`}>
          <p>Saved entries exist in Studio settings storage (their values may be normalized by the resolver). Resolved defaults are not explicitly saved. Studio-owned fields affect other workspaces. Project Calendar view inheritance and its personal-preference lock are managed below. Personal Calendar defaults exist in Account Settings; device-wide inheritance is not implemented.</p>
          <ul>{snapshot.settingProvenance.map((entry) => <li key={entry.persistedKey}>
            <strong>{entry.field.replace(/([A-Z])/g, " $1")}</strong>: {entry.source === "stored" ? "Saved entry" : "Resolved default"} · {entry.scope === "studio" ? "Studio policy" : "Tool configuration"}
            <code> {entry.persistedKey}</code>
            {entry.source === "stored" && <ClusterButton type="button" variant="secondary" size="compact" disabled={busy} onClick={() => void resetSavedSetting(entry)}>Reset saved value</ClusterButton>}
          </li>)}</ul>
        </ClusterDisclosureGroup>}
        {Object.keys(linkedStudioSettings).length > 0 && <div className="hint-box slim" role="note">
          <strong>Linked Studio defaults:</strong> Some settings on this tool also control Studio-wide behavior.
          {Object.values(linkedStudioSettings).length > 0 && <span> Shared: {Object.values(linkedStudioSettings).join(" · ")}</span>}
        </div>}
        {changedLinkedStudioSettings.length > 0 && <div className="hint-box slim" role="group" aria-label="Studio-wide change impact review">
          <strong>Studio-wide change:</strong> These values are shared policy, not private tool defaults.
          <ul>{changedLinkedStudioSettings.map(([field, label]) => <li key={field}>
            <strong>{label}:</strong> {String(snapshot.config[field] ?? "(unset)")} → {String(draft[field] ?? "(unset)")}
          </li>)}</ul>
          <Toggle checked={studioChangesAcknowledged} onChange={setStudioChangesAcknowledged}>I understand these changes affect the whole Studio.</Toggle>
        </div>}

        {tool === "calendar" && <section className="hint-box slim" aria-label="Project Calendar view defaults">
          <h3>Project Calendar default view</h3>
          <p>Project views inherit the Studio Calendar default unless an administrator saves a Project override. Tool availability and access rules are never inherited from here.</p>
          <label><span>Project</span><ClusterSelect ariaLabel="Project Calendar settings" value={calendarProjectId} onChange={setCalendarProjectId} disabled={calendarProjectBusy} options={[{ value: "", label: "Choose a Project" }, ...activeProjects.map((project) => ({ value: project.id, label: project.name }))]} /></label>
          {calendarProjectId && calendarProjectDefault && <div className="admin-tool-field-grid-v232">
            <label><span>Default view ({calendarProjectDefault.source === "project" ? "Project override" : "Inherited from Studio"})</span><ClusterSelect ariaLabel="Project Calendar default view" value={calendarProjectDraft} onChange={(value) => setCalendarProjectDraft(value as CalendarProjectDefault["value"])} options={[{ value: "agenda", label: "Agenda" }, { value: "week", label: "Week" }, { value: "month", label: "Month" }, { value: "day", label: "Day" }]} /></label>
            <Toggle checked={calendarProjectLockDraft} onChange={setCalendarProjectLockDraft}>Ignore personal default-view preferences for this Project. Users may still switch views while working.</Toggle>
            <div className="button-row"><ClusterButton type="button" disabled={calendarProjectBusy || (calendarProjectDraft === calendarProjectDefault.value && calendarProjectLockDraft === calendarProjectDefault.lockUserOverride && calendarProjectDefault.source === "project")} onClick={() => void saveCalendarProjectView(false)} variant="secondary">Save Project default</ClusterButton>
            <ClusterButton type="button" disabled={calendarProjectBusy || calendarProjectDefault.source !== "project"} onClick={() => void saveCalendarProjectView(true)} variant="quiet">Reset to Studio default</ClusterButton></div>
          </div>}
          {calendarProjectId && !calendarProjectDefault && <p>{calendarProjectLoadError || "Loading Project default…"}</p>}
        </section>}

        {tool === "timeline" && <>
          <div className="admin-tool-field-grid-v232"><label><span>Default view</span><ClusterSelect ariaLabel="Timeline default view" value={draft.defaultView} onChange={(value) => patch("defaultView", value)} options={[{ value: "roadmap", label: "Roadmap" }, { value: "calendar", label: "Calendar" }, { value: "list", label: "List" }]} /></label><label><span>Milestone cadence</span><ClusterSelect ariaLabel="Timeline milestone cadence" value={draft.milestoneCadence} onChange={(value) => patch("milestoneCadence", value)} options={[{ value: "weekly", label: "Weekly" }, { value: "biweekly", label: "Biweekly" }, { value: "monthly", label: "Monthly" }, { value: "custom", label: "Custom" }]} /></label><label><span>Status report cadence</span><ClusterSelect ariaLabel="Timeline status report cadence" value={draft.statusReportCadence} onChange={(value) => patch("statusReportCadence", value)} options={[{ value: "off", label: "Off" }, { value: "weekly", label: "Weekly" }, { value: "biweekly", label: "Biweekly" }, { value: "monthly", label: "Monthly" }]} /></label><NumericField label="Default range" value={draft.defaultRangeDays}{...clusterToolNumericRange(tool, "defaultRangeDays")} suffix="days" onChange={(value) => patch("defaultRangeDays", value)} /><NumericField label="Planning horizon" value={draft.maxRangeDays}{...clusterToolNumericRange(tool, "maxRangeDays")} suffix="days" onChange={(value) => patch("maxRangeDays", value)} /><NumericField label="Page limit" value={draft.maxItemsPerPage}{...clusterToolNumericRange(tool, "maxItemsPerPage")} suffix="items" onChange={(value) => patch("maxItemsPerPage", value)} /></div>
          <div className="admin-tool-option-grid-v232"><Toggle checked={draft.includeCalendar} onChange={(value) => patch("includeCalendar", value)}>Calendar events</Toggle><Toggle checked={draft.includeDueDates} onChange={(value) => patch("includeDueDates", value)}>Card due dates</Toggle><Toggle checked={draft.includeSchedule} onChange={(value) => patch("includeSchedule", value)}>Schedule blocks</Toggle><Toggle checked={draft.allowManualItems} onChange={(value) => patch("allowManualItems", value)}>Manual items</Toggle><Toggle checked={draft.allowComments} onChange={(value) => patch("allowComments", value)}>Discussions</Toggle><Toggle checked={draft.allowExports} onChange={(value) => patch("allowExports", value)}>Exports</Toggle></div>
        </>}

        {tool === "tickets" && <>
          <div className="admin-tool-field-grid-v232"><label><span>Default queue</span><ClusterSelect ariaLabel="Tickets default queue" value={draft.defaultQueue} onChange={(value) => patch("defaultQueue", value)} options={[{ value: "all", label: "All" }, { value: "open", label: "Open" }, { value: "urgent", label: "Urgent" }, { value: "review", label: "Review" }]} /></label><label><span>Default priority</span><ClusterSelect ariaLabel="Ticket default priority" value={draft.defaultPriority} onChange={(value) => patch("defaultPriority", value)} options={[{ value: "low", label: "Low" }, { value: "normal", label: "Normal" }, { value: "high", label: "High" }, { value: "urgent", label: "Urgent" }]} /></label><NumericField label="Response target" value={draft.slaHours}{...clusterToolNumericRange(tool, "slaHours")} suffix="hours" onChange={(value) => patch("slaHours", value)} /><NumericField label="Attachment limit" value={draft.attachmentLimitMb}{...clusterToolNumericRange(tool, "attachmentLimitMb")} suffix="MB" onChange={(value) => patch("attachmentLimitMb", value)} /><NumericField label="Archive after" value={draft.autoArchiveDays}{...clusterToolNumericRange(tool, "autoArchiveDays")} suffix="days" onChange={(value) => patch("autoArchiveDays", value)} /></div>
          <div className="admin-tool-option-grid-v232"><Toggle checked={draft.requireProject} onChange={(value) => patch("requireProject", value)}>Require project</Toggle><Toggle checked={draft.autoAssignCreator} onChange={(value) => patch("autoAssignCreator", value)}>Assign creator</Toggle><Toggle checked={draft.allowAttachments} onChange={(value) => patch("allowAttachments", value)}>Attachments</Toggle><Toggle checked={draft.requireAssigneeOnClose} onChange={(value) => patch("requireAssigneeOnClose", value)}>Require assignee to close</Toggle></div>
        </>}

        {tool === "calendar" && <>
          <div className="admin-tool-field-grid-v232"><label><span>Default view</span><ClusterSelect ariaLabel="Calendar default view" value={draft.defaultView} onChange={(value) => patch("defaultView", value)} options={[{ value: "agenda", label: "Agenda" }, { value: "week", label: "Week" }, { value: "month", label: "Month" }, { value: "day", label: "Day" }]} /></label><NumericField label="Event length" value={draft.defaultDurationMinutes}{...clusterToolNumericRange(tool, "defaultDurationMinutes")} suffix="minutes" onChange={(value) => patch("defaultDurationMinutes", value)} /><NumericField label="Maximum length" value={draft.maximumDurationHours}{...clusterToolNumericRange(tool, "maximumDurationHours")} suffix="hours" onChange={(value) => patch("maximumDurationHours", value)} /><NumericField label="Minimum notice" value={draft.minimumNoticeMinutes}{...clusterToolNumericRange(tool, "minimumNoticeMinutes")} suffix="minutes" onChange={(value) => patch("minimumNoticeMinutes", value)} /></div>
          <div className="admin-tool-option-grid-v232"><Toggle checked={draft.weekStartsMonday} onChange={(value) => patch("weekStartsMonday", value)}>Monday week start</Toggle><Toggle checked={draft.includeDueCards} onChange={(value) => patch("includeDueCards", value)}>Card due dates</Toggle><Toggle checked={draft.allowRecurring} onChange={(value) => patch("allowRecurring", value)}>Recurring events</Toggle><Toggle checked={draft.conflictWarnings} onChange={(value) => patch("conflictWarnings", value)}>Conflict warnings</Toggle><Toggle checked={draft.allowExternalGuests} onChange={(value) => patch("allowExternalGuests", value)}>External guests</Toggle></div>
        </>}

        {tool === "scheduler" && <>
          <div className="admin-tool-field-grid-v232"><label><span>Default view</span><ClusterSelect ariaLabel="Scheduler default view" value={draft.defaultView} onChange={(value) => patch("defaultView", value)} options={[{ value: "week", label: "Activity" }, { value: "schedule", label: "Schedule" }, { value: "team", label: "People" }]} /></label><label><span>Timezone</span><ClusterSelect ariaLabel="Scheduler timezone" value={draft.timezone} onChange={(value) => patch("timezone", value)} options={optionsWithCurrent(TIMEZONE_OPTIONS, draft.timezone)} /></label><label><span>Working days</span><ClusterSelect ariaLabel="Scheduler working days" value={draft.workingDaysCsv} onChange={(value) => patch("workingDaysCsv", value)} options={optionsWithCurrent(WORKING_DAY_OPTIONS, draft.workingDaysCsv)} /></label><label><span>Workday start</span><ClusterTextInput type="time" value={draft.workdayStart} onChange={(event) => patch("workdayStart", event.target.value)} /></label><label><span>Workday end</span><ClusterTextInput type="time" value={draft.workdayEnd} onChange={(event) => patch("workdayEnd", event.target.value)} /></label><NumericField label="Overtime" value={draft.overtimeHours}{...clusterToolNumericRange(tool, "overtimeHours")} suffix="hours" onChange={(value) => patch("overtimeHours", value)} /><NumericField label="Timer limit" value={draft.autoCloseHours}{...clusterToolNumericRange(tool, "autoCloseHours")} suffix="hours" onChange={(value) => patch("autoCloseHours", value)} /><NumericField label="Rounding" value={draft.roundingMinutes}{...clusterToolNumericRange(tool, "roundingMinutes")} suffix="minutes" onChange={(value) => patch("roundingMinutes", value)} /><NumericField label="Minimum break" value={draft.minimumBreakMinutes}{...clusterToolNumericRange(tool, "minimumBreakMinutes")} suffix="minutes" onChange={(value) => patch("minimumBreakMinutes", value)} /><NumericField label="Edit window" value={draft.editWindowDays}{...clusterToolNumericRange(tool, "editWindowDays")} suffix="days" onChange={(value) => patch("editWindowDays", value)} /><NumericField label="Lock after" value={draft.lockAfterDays}{...clusterToolNumericRange(tool, "lockAfterDays")} suffix="days" onChange={(value) => patch("lockAfterDays", value)} /></div>
          <div className="admin-tool-option-grid-v232"><Toggle checked={draft.defaultBillable} onChange={(value) => patch("defaultBillable", value)}>Unmatched billable</Toggle><Toggle checked={draft.allowManualEntries} onChange={(value) => patch("allowManualEntries", value)}>Manual entries</Toggle><Toggle checked={draft.requireProject} onChange={(value) => patch("requireProject", value)}>Require project</Toggle><Toggle checked={draft.resourcePlanningEnabled} onChange={(value) => patch("resourcePlanningEnabled", value)}>Resource planning</Toggle><Toggle checked={draft.conflictWarnings} onChange={(value) => patch("conflictWarnings", value)}>Conflict warnings</Toggle><Toggle checked={draft.calendarMirrorDefault} onChange={(value) => patch("calendarMirrorDefault", value)}>Mirror new windows to Calendar</Toggle></div>
          <div className="admin-option-block-v231"><span>Billable projects</span><div>{activeProjects.map((project) => <Toggle key={project.id} checked={(draft.billableProjectIds || []).includes(project.id)} onChange={() => toggleList("billableProjectIds", project.id)}>{project.name}</Toggle>)}{!activeProjects.length && <em>No active projects.</em>}</div></div>
          <div className="admin-option-block-v231"><span>Billable categories</span><div>{CATEGORY_OPTIONS.map((category) => <Toggle key={category} checked={(draft.billableCategories || []).includes(category)} onChange={() => toggleList("billableCategories", category)}>{category}</Toggle>)}</div></div>
        </>}

        {tool === "library" && <>
          <div className="admin-tool-field-grid-v232"><label><span>Root name</span><ClusterTextInput value={draft.rootName} onChange={(event) => patch("rootName", event.target.value)} /></label><label><span>Default license</span><ClusterTextInput value={draft.defaultLicense} onChange={(event) => patch("defaultLicense", event.target.value)} /></label><label><span>Template policy</span><ClusterSelect ariaLabel="Library template policy" value={draft.templatePolicy} onChange={(value) => patch("templatePolicy", value)} options={[{ value: "optional", label: "Optional" }, { value: "recommended", label: "Recommended" }, { value: "required", label: "Required" }]} /></label><label><span>Default layout</span><ClusterSelect ariaLabel="Library default layout" value={draft.defaultLayout} onChange={(value) => patch("defaultLayout", value)} options={[{ value: "grid", label: "Grid" }, { value: "list", label: "List" }]} /></label><NumericField label="Preview limit" value={draft.previewLimitMb}{...clusterToolNumericRange(tool, "previewLimitMb")} suffix="MB" onChange={(value) => patch("previewLimitMb", value)} /><NumericField label="Upload limit" value={draft.maxUploadMb}{...clusterToolNumericRange(tool, "maxUploadMb")} suffix="MB" onChange={(value) => patch("maxUploadMb", value)} /><NumericField label="Model limit" value={draft.modelPreviewMaxMb}{...clusterToolNumericRange(tool, "modelPreviewMaxMb")} suffix="MB" onChange={(value) => patch("modelPreviewMaxMb", value)} /><NumericField label="Thumbnail width" value={draft.thumbnailWidth}{...clusterToolNumericRange(tool, "thumbnailWidth")} suffix="px" onChange={(value) => patch("thumbnailWidth", value)} /><NumericField label="Thumbnail quality" value={draft.thumbnailQuality}{...clusterToolNumericRange(tool, "thumbnailQuality")} suffix="%" onChange={(value) => patch("thumbnailQuality", value)} /></div>
          <label className="admin-tool-wide-field-v237"><span>Tag presets</span><ClusterTextArea value={draft.tagPresetCsv} onChange={(event) => patch("tagPresetCsv", event.target.value)} /></label>
          <div className="admin-tool-field-grid-v232"><label><span>Desktop mount policy</span><ClusterSelect ariaLabel="Library desktop mount policy" value={draft.desktopMountPolicy} onChange={(value) => patch("desktopMountPolicy", value)} options={[{ value: "disabled", label: "Disabled" }, { value: "user-choice", label: "User choice" }, { value: "required", label: "Mount required" }]} /></label><label><span>Mount isolation</span><ClusterSelect ariaLabel="Library mount isolation" value={draft.desktopMountIsolation} onChange={(value) => patch("desktopMountIsolation", value)} options={[{ value: "shared", label: "Shared mount allowed" }, { value: "dedicated", label: "Separate mount required" }, { value: "exclusive", label: "Exclusive mount required" }]} /></label><label><span>Sensitive offline cache</span><ClusterSelect ariaLabel="Library sensitive offline cache policy" value={draft.sensitiveOfflineCachePolicy || "disabled"} onChange={(value) => patch("sensitiveOfflineCachePolicy", value)} options={[{ value: "disabled", label: "Disabled" }, { value: "protected", label: "Protected on supported devices" }]} /></label><label><span>Cross-server moves</span><ClusterSelect ariaLabel="Library cross-server transfer policy" value={draft.crossServerTransferPolicy} onChange={(value) => patch("crossServerTransferPolicy", value)} options={[{ value: "disabled", label: "Disabled" }, { value: "approval", label: "Require approval" }, { value: "trusted-only", label: "Trusted servers only" }, { value: "allowed", label: "Allowed" }]} /></label></div>
          <div className="admin-tool-option-grid-v232"><Toggle checked={draft.createStarterFolder} onChange={(value) => patch("createStarterFolder", value)}>Starter project folder</Toggle><Toggle checked={draft.showFilesInTree} onChange={(value) => patch("showFilesInTree", value)}>Files in tree</Toggle><Toggle checked={draft.allowExternalLinks} onChange={(value) => patch("allowExternalLinks", value)}>External links</Toggle><Toggle checked={draft.allowYoutube} onChange={(value) => patch("allowYoutube", value)}>YouTube</Toggle><Toggle checked={draft.allowModelPreviews} onChange={(value) => patch("allowModelPreviews", value)}>3D previews</Toggle><Toggle checked={draft.allowBlendPreviews} onChange={(value) => patch("allowBlendPreviews", value)}>.blend previews</Toggle><Toggle checked={draft.desktopMountReadOnly} onChange={(value) => patch("desktopMountReadOnly", value)}>Mounted Libraries read only</Toggle></div>
        </>}

        {tool === "packets" && <>
          <div className="admin-tool-field-grid-v232">
            <label><span>Library root name</span><ClusterTextInput value={draft.rootName} onChange={(event) => patch("rootName", event.target.value)} /></label>
            <label><span>Default view</span><ClusterSelect ariaLabel="Packets default view" value={draft.defaultView} onChange={(value) => patch("defaultView", value)} options={[{ value: "grid", label: "Grid" }, { value: "list", label: "List" }]} /></label>
            <NumericField label="Featured limit" value={draft.featuredLimit}{...clusterToolNumericRange(tool, "featuredLimit")} suffix="packets" onChange={(value) => patch("featuredLimit", value)} />
          </div>
          <div className="admin-tool-option-grid-v232"><Toggle checked={draft.showDescriptions} onChange={(value) => patch("showDescriptions", value)}>Descriptions</Toggle><Toggle checked={draft.allowPdf} onChange={(value) => patch("allowPdf", value)}>PDF resources</Toggle><Toggle checked={draft.allowYoutube} onChange={(value) => patch("allowYoutube", value)}>YouTube resources</Toggle><Toggle checked={draft.allowExternalLinks} onChange={(value) => patch("allowExternalLinks", value)}>External links</Toggle></div>
          <div className="hint-box slim"><strong>Library-backed:</strong> every direct folder inside the Packets Library root is a packet. Manage its files from Library.</div>
        </>}
      </main>}

      {mode === "access" && <main className="admin-tool-mode-panel-v235">
        <div className="admin-tool-access-list-v235">
          {users.filter((user) => !user.archived).map((user) => <article key={user.id}>
            <div><strong>{displayUser(user)}</strong><span>{user.workspaceRole || "member"}{user.isAdmin ? " · admin" : ""}</span></div>
            <ClusterSelect ariaLabel={`${displayUser(user)} ${TOOL_META[tool].label} access`} value={user.isAdmin ? "manage" : accessDrafts[user.id] || getToolLevel(user, permissionKey)} onChange={(value) => setAccessDrafts((current) => ({ ...current, [user.id]: value as ToolPermissionLevel }))} options={ACCESS_OPTIONS} disabled={Boolean(user.isAdmin)} />
          </article>)}
          {!users.length && <ClusterEmptyState compact kind="empty" title="No users loaded" description="User controls will appear after workspace accounts are available." />}
        </div>
      </main>}

      {mode === "operations" && <main className="admin-tool-mode-panel-v235">
        <div className="admin-tool-operation-grid-v235">
          {(snapshot.operations || FALLBACK_OPERATIONS[tool]).map((operation) => <article key={operation.id} className={operation.danger ? "danger" : ""}>
            <strong>{operation.label}</strong>
            {operation.requiresDays && <label><span>Older than</span><div><ClusterTextInput type="number" min={1} max={3650} value={operationDays[operation.id] || operation.defaultDays || 30} onChange={(event) => setOperationDays((current) => ({ ...current, [operation.id]: Math.max(1, Number(event.target.value || 1)) }))} /><em>days</em></div></label>}
            <ClusterButton type="button" variant={operation.danger ? "danger" : "secondary"} disabled={busy} onClick={() => void runOperation(operation)}>Run</ClusterButton>
          </article>)}
        </div>
      </main>}
      <DangerConfirmDialog
        open={Boolean(pendingOperation)}
        title={pendingOperation?.operation.label || "Confirm operation"}
        description={`This operation changes ${TOOL_META[tool].label} data and may not be reversible.`}
        resource={`${TOOL_META[tool].label}${pendingOperation?.days ? ` · records older than ${pendingOperation.days} days` : ""}`}
        consequence="Affected records will be removed or archived according to the operation. Review the scope before continuing."
        confirmLabel={pendingOperation?.operation.label || "Run operation"}
        busy={busy}
        onCancel={() => setPendingOperation(null)}
        onConfirm={() => pendingOperation && void executeOperation(pendingOperation.operation, pendingOperation.days)}
      />
    </section>
  );
}
