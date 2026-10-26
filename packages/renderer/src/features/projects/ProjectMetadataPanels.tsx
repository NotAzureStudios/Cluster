import { ClusterDisclosureGroup } from "../../components/ClusterDisclosureGroup";
import { ClusterNativeSelect, ClusterInput } from "../../components/ClusterNativeControls";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterIcon } from "../../components/ClusterIcon";
import { useCallback, useEffect, useMemo, useState } from "react";
import { compactDateTime } from "../../core/date-time";
import { confirmCluster } from "../../components/cluster-dialog-service";
import { ClusterMetricStrip } from "../../components/ClusterMetricStrip";
import { levelLabel } from "../../core/format";
import { downloadJsonFile, localId, unique } from "../../core/storage";
import { useProjectWorkflowList } from "../../core/project-workflow-storage";
import { normalizeServerCustomFieldDefinition, useServerCustomFieldDefinitions, useServerCustomFieldValues } from "../custom-fields/custom-field-storage";
import { projectHealth } from "./projects-utils";
import type {
  CustomFieldEntity, CustomFieldValueRecord, DependencyStatus,
  EntityKind, EntityReference, Project, StudioCustomFieldDefinition, VersionSnapshotRecord, WorkLinkRecord,
} from "../application/application-models";
import "./project-operations.css";

export interface RelatedRecordsPanelHelpers {
  ENTITY_KIND_OPTIONS: Array<{ value: EntityKind; label: string }>;
  entityRefDisplay: (ref?: EntityReference) => string;
  normalizeLinkRecord: (record: WorkLinkRecord) => WorkLinkRecord;
}
export interface VersionHistoryPanelHelpers {
  snapshotChangeCount: (current: unknown, previous: unknown) => number;
  snapshotDiffEntries: (current: unknown, previous: unknown) => Array<{ key: string; before: unknown; after: unknown }>;
  snapshotValuePreview: (value: unknown) => string;
}
export interface CustomFieldValuesPanelHelpers {
  customFieldVisible: (field: StudioCustomFieldDefinition, values: Record<string, string | boolean>) => boolean;
  customFieldValueIsEmpty: (value: string | boolean | undefined) => boolean;
}

export function RelatedRecordsPanelFeature({ entity, projectId, compact = false, helpers }: { entity: EntityReference; projectId?: string | null; compact?: boolean; helpers: RelatedRecordsPanelHelpers }) {
  const { ENTITY_KIND_OPTIONS, entityRefDisplay, normalizeLinkRecord } = helpers;
  const workflowProjectId = String(projectId || entity.projectId || "");
  const [rawLinks, setLinks, linkSync] = useProjectWorkflowList<WorkLinkRecord>("dependency", workflowProjectId);
  const links = rawLinks.map(normalizeLinkRecord);
  const [targetKind, setTargetKind] = useState<EntityKind>("card");
  const [targetLabel, setTargetLabel] = useState("");
  const [relationship, setRelationship] = useState("relates");
  const matches = links.filter((link) => {
    const refs = [link.source, link.target];
    if (entity.id && refs.some((ref) => ref?.kind === entity.kind && ref.id === entity.id)) return true;
    if (refs.some((ref) => ref?.kind === entity.kind && ref.label === entity.label)) return true;
    return Boolean(projectId && (link.projectId === projectId || refs.some((ref) => ref?.projectId === projectId)));
  });
  function addLink() {
    if (!targetLabel.trim()) return;
    const now = new Date().toISOString();
    const target: EntityReference = {
      kind: targetKind,
      label: targetLabel.trim(),
      projectId: projectId || entity.projectId || null,
    };
    setLinks(
      [
        {
          id: localId("link"),
          projectId: projectId || entity.projectId || null,
          source: entity,
          target,
          relationship,
          status: "open" as DependencyStatus,
          createdAt: now,
          updatedAt: now,
        },
        ...links,
      ].slice(0, 320),
    );
    setTargetLabel("");
  }
  return (
    <section className={`related-records-v195 ${compact ? "compact" : "panel"}`}>
      {linkSync.error && <div className="inline-status danger">{linkSync.error}</div>}
      <div className="settings-card-head-v092">
        <h3>Related</h3>
        <span>
          {matches.length} link{matches.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className="related-record-list-v195">
        {matches.slice(0, compact ? 5 : 10).map((link) => (
          <article key={link.id}>
            <span>{entityRefDisplay(link.source)}</span>
            <em>{levelLabel(link.relationship)}</em>
            <strong>{entityRefDisplay(link.target)}</strong>
            <ClusterButton type="button" className="" onClick={() => setLinks(links.filter((item) => item.id !== link.id))} variant="quiet" size="compact" aria-label={`Remove relationship to ${entityRefDisplay(link.target)}`}>
              <ClusterIcon name="close" />
            </ClusterButton>
          </article>
        ))}
        {!matches.length && <span className="muted">No related records yet.</span>}
      </div>
      <ClusterDisclosureGroup title="Add relationship" className="related-add-v195"> 
        <div>
          <ClusterNativeSelect value={relationship} onChange={(event) => setRelationship(event.target.value)}>
            <option value="relates">Relates to</option>
            <option value="blocks">Blocks</option>
            <option value="depends">Depends on</option>
            <option value="duplicates">Duplicates</option>
            <option value="verifies">Verifies</option>
            <option value="documents">Documents</option>
          </ClusterNativeSelect>
          <ClusterNativeSelect value={targetKind} onChange={(event) => setTargetKind(event.target.value as EntityKind)}>
            {ENTITY_KIND_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </ClusterNativeSelect>
          <ClusterTextInput value={targetLabel} onChange={(event) => setTargetLabel(event.target.value)} placeholder="Record label or identifier" />
          <ClusterButton type="button" className="" onClick={addLink} variant="quiet" size="compact">
            Link
          </ClusterButton>
        </div>
      </ClusterDisclosureGroup>
    </section>
  );
}

type ProjectVersionSnapshotRecord = VersionSnapshotRecord & { projectId?: string | null };
export function VersionHistoryPanelFeature({ entityType, entityId, projectId, label, data, onRestore, helpers }: { entityType: string; entityId: string; projectId?: string | null; label: string; data: unknown; onRestore?: (data: any) => void | Promise<void>; helpers: VersionHistoryPanelHelpers }) {
  const { snapshotChangeCount, snapshotDiffEntries, snapshotValuePreview } = helpers;
  const [history, setHistory, historySync] = useProjectWorkflowList<ProjectVersionSnapshotRecord>("versionSnapshot", String(projectId || ""));
  const [note, setNote] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const dataSignature = useMemo(() => JSON.stringify(data), [data]);
  const entityHistory = history.filter((item) => item.entityType === entityType && item.entityId === entityId).slice(0, 50);
  function retain(next: ProjectVersionSnapshotRecord[]) {
    const entityItems = next.filter((item) => item.entityType === entityType && item.entityId === entityId).slice(0, 50);
    const allowed = new Set(entityItems.map((item) => item.id));
    return next.filter((item) => item.entityType !== entityType || item.entityId !== entityId || allowed.has(item.id)).slice(0, 1000);
  }
  function createSnapshot(kind: VersionSnapshotRecord["kind"] = "manual", snapshotNote = note.trim(), snapshotData: unknown = data) {
    const snapshot: ProjectVersionSnapshotRecord = {
      id: localId("version"),
      entityType,
      entityId,
      projectId: projectId || null,
      label,
      note: snapshotNote || undefined,
      kind,
      createdAt: new Date().toISOString(),
      data: JSON.parse(JSON.stringify(snapshotData)),
    };
    setHistory(retain([snapshot, ...history]));
    if (kind === "manual") setNote("");
    return snapshot;
  }
  useEffect(() => {
    const latest = history.find((item) => item.entityType === entityType && item.entityId === entityId);
    if (latest && JSON.stringify(latest.data) === dataSignature) return;
    const sessionKey = `cluster-history-auto-${entityType}-${entityId}`;
    const lastAuto = Number(window.sessionStorage.getItem(sessionKey) || 0);
    if (Date.now() - lastAuto < 5 * 60 * 1000) return;
    const timer = window.setTimeout(() => {
      const automatic: ProjectVersionSnapshotRecord = {
        id: localId("version"),
        entityType,
        entityId,
        projectId: projectId || null,
        label,
        note: "Automatic restore point",
        kind: "automatic",
        createdAt: new Date().toISOString(),
        data: JSON.parse(dataSignature),
      };
      setHistory(retain([automatic, ...history]));
      window.sessionStorage.setItem(sessionKey, String(Date.now()));
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [entityType, entityId, dataSignature]);
  async function restore(snapshot: VersionSnapshotRecord) {
    if (!onRestore || !await confirmCluster({ title: "Restore snapshot?", message: `Restore ${snapshot.label} from ${compactDateTime(snapshot.createdAt)}? A recovery point will be saved first.`, confirmLabel: "Restore snapshot" })) return;
    createSnapshot("pre-restore", `Before restoring ${compactDateTime(snapshot.createdAt)}`, data);
    await onRestore(JSON.parse(JSON.stringify(snapshot.data)));
  }
  function exportSnapshot(snapshot: VersionSnapshotRecord) {
    downloadJsonFile(`${entityType}-${entityId}-${snapshot.createdAt.slice(0, 10)}.json`, snapshot);
  }
  function exportHistory() {
    downloadJsonFile(`${entityType}-${entityId}-history.json`, {
      entityType,
      entityId,
      label,
      exportedAt: new Date().toISOString(),
      snapshots: entityHistory,
    });
  }
  async function clearHistory() {
    if (await confirmCluster({ title: "Delete snapshot history?", message: `Delete all ${entityHistory.length} snapshots for ${label}?`, confirmLabel: "Delete history", tone: "danger" })) setHistory(history.filter((item) => item.entityType !== entityType || item.entityId !== entityId));
  }
  return (
    <ClusterDisclosureGroup title="History" headerTrailing={entityHistory.length} className="version-history-v195 version-history-v196 version-history-v198" contentClassName="version-history-body-v195">
        {historySync.error && <div className="inline-status danger">{historySync.error}</div>}
        <div className="version-snapshot-create-v196">
          <ClusterTextInput value={note} onChange={(event) => setNote(event.target.value)} placeholder="Snapshot note" />
          <ClusterButton type="button" className="" onClick={() => createSnapshot("manual")} variant="quiet" size="compact">
            Save snapshot
          </ClusterButton>
        </div>
        <div className="version-history-tools-v198">
          <span>Automatic restore points are kept when records change.</span>
          <div className="button-row compact">
            <ClusterButton type="button" className="" disabled={!entityHistory.length} onClick={exportHistory} variant="quiet" size="compact">
              Export all
            </ClusterButton>
            <ClusterButton type="button" className="" disabled={!entityHistory.length} onClick={clearHistory} variant="danger" size="compact">
              Clear
            </ClusterButton>
          </div>
        </div>
        {entityHistory.map((item) => {
          const changes = snapshotChangeCount(data, item.data);
          const diffs = snapshotDiffEntries(data, item.data);
          const previewing = previewId === item.id;
          return (
            <article key={item.id} className={previewing ? "previewing" : ""}>
              <div>
                <strong>{item.note || item.label}</strong>
                <span>
                  {compactDateTime(item.createdAt)} · {item.kind || "manual"} · {changes} difference{changes === 1 ? "" : "s"}
                </span>
              </div>
              <div className="button-row compact">
                <ClusterButton type="button" className="" onClick={() => setPreviewId(previewing ? null : item.id)} variant="quiet" size="compact">
                  {previewing ? "Hide diff" : "Preview"}
                </ClusterButton>
                {onRestore && (
                  <ClusterButton type="button" className="" onClick={() => restore(item)} variant="quiet" size="compact">
                    Restore
                  </ClusterButton>
                )}
                <ClusterButton type="button" className="" onClick={() => exportSnapshot(item)} variant="quiet" size="compact">
                  Export
                </ClusterButton>
                <ClusterButton type="button" className="" onClick={() => setHistory(history.filter((snapshot) => snapshot.id !== item.id))} variant="danger" size="compact">
                  Delete
                </ClusterButton>
              </div>
              {previewing && (
                <div className="snapshot-diff-v198">
                  {diffs.length ? (
                    diffs.map((diff) => (
                      <div key={diff.key}>
                        <strong>{diff.key}</strong>
                        <span>
                          <em>Snapshot</em>
                          {snapshotValuePreview(diff.before)}
                        </span>
                        <span>
                          <em>Current</em>
                          {snapshotValuePreview(diff.after)}
                        </span>
                      </div>
                    ))
                  ) : (
                    <p className="muted">No differences from the current record.</p>
                  )}
                </div>
              )}
            </article>
          );
        })}
        {!entityHistory.length && <span className="muted">No snapshots yet. An automatic restore point will be created after the record changes.</span>}
      
    </ClusterDisclosureGroup>
  );
}

export function ProjectHealthStrip({ project, ticketCount = 0, blockerCount = 0, failedBuilds = 0, qaStatus = "unknown", qaLabel = "QA", overdue = 0, showBuilds = true, showQa = true, onOpenTickets, onOpenBuilds, onOpenQa }: { project: Project; ticketCount?: number; blockerCount?: number; failedBuilds?: number; qaStatus?: string; qaLabel?: string; overdue?: number; showBuilds?: boolean; showQa?: boolean; onOpenTickets?: () => void; onOpenBuilds?: () => void; onOpenQa?: () => void }) {
  const health = projectHealth(project);
  const items = [
    {
      label: "Health",
      value: health.label,
      tone: health.tone,
      action: undefined,
    },
    {
      label: "Open tickets",
      value: String(ticketCount),
      tone: ticketCount ? "warning" : "good",
      action: onOpenTickets,
    },
    {
      label: "Blockers",
      value: String(blockerCount),
      tone: blockerCount ? "danger" : "good",
      action: onOpenTickets,
    },
    ...(showBuilds ? [{
      label: "Build failures",
      value: String(failedBuilds),
      tone: failedBuilds ? "danger" : "good",
      action: onOpenBuilds,
    }] : []),
    ...(showQa ? [{
      label: qaLabel,
      value: qaStatus,
      tone: /pass|clear|ready/i.test(qaStatus) ? "good" : /fail|block/i.test(qaStatus) ? "danger" : "neutral",
      action: onOpenQa,
    }] : []),
    {
      label: "Overdue",
      value: String(overdue),
      tone: overdue ? "warning" : "good",
      action: onOpenTickets,
    },
  ];
  return (
    <ClusterMetricStrip
      className="project-health-strip-v195 project-health-strip-v435"
      label={`${project.name} workspace health`}
      items={items.map((item) => ({
        key: item.label,
        label: item.label,
        value: item.value,
        tone: item.tone === "danger" ? "danger" : item.tone === "warning" ? "warning" : item.tone === "good" ? "good" : "neutral",
        onSelect: item.action,
      }))}
    />
  );
}

export function CustomFieldValuesPanelFeature({ entity, entityId, projectId, title = "Custom fields", compact = false, readOnly = false, updatedBy = "", helpers }: { entity: CustomFieldEntity; entityId: string; projectId?: string | null; title?: string; compact?: boolean; readOnly?: boolean; updatedBy?: string; helpers: CustomFieldValuesPanelHelpers }) {
  const { customFieldVisible, customFieldValueIsEmpty } = helpers;
  const definitionStore = useServerCustomFieldDefinitions(normalizeServerCustomFieldDefinition);
  const valueStore = useServerCustomFieldValues(entity, entityId, projectId || (entity === "project" ? entityId : null));
  const [validation, setValidation] = useState<Record<string, string>>({});
  const definitions = definitionStore.definitions.filter((field) => !field.archivedAt && field.enabled !== false && field.entity === entity);
  const records = valueStore.values;
  const entityRecords = records.filter((record) => record.entity === entity && record.entityId === entityId);
  const values = Object.fromEntries(entityRecords.map((record) => [record.fieldId, record.value])) as Record<string, string | boolean>;
  const visibleFieldIds = new Set(valueStore.visibleFieldIds);
  const editableFieldIds = new Set(valueStore.editableFieldIds);
  const visibleDefinitions = definitions.filter((field) => visibleFieldIds.has(field.id) && customFieldVisible(field, values));
  function validate(field: StudioCustomFieldDefinition, value: string | boolean) {
    if (field.required && customFieldValueIsEmpty(value)) return `${field.label} is required.`;
    if (field.fieldType === "number" && String(value).trim() && !Number.isFinite(Number(value))) return "Enter a valid number.";
    if (field.fieldType === "url" && String(value).trim()) {
      try { new URL(String(value)); } catch { return "Enter a valid URL."; }
    }
    if (field.fieldType === "duration" && String(value).trim() && (!Number.isFinite(Number(value)) || Number(value) < 0)) return "Enter a duration in minutes.";
    return "";
  }
  function save(field: StudioCustomFieldDefinition, value: string | boolean) {
    if (readOnly || !editableFieldIds.has(field.id)) return;
    const error = validate(field, value);
    setValidation((prev) => ({ ...prev, [field.id]: error }));
    if (error) return;
    const next: CustomFieldValueRecord = {
      id: `${entity}:${entityId}:${field.id}`,
      entity,
      entityId,
      projectId: projectId || (entity === "project" ? entityId : null),
      fieldId: field.id,
      value,
      updatedAt: new Date().toISOString(),
      updatedBy: updatedBy || undefined,
    };
    void valueStore.save(next);
  }
  if (!definitions.length && !definitionStore.loading) return null;
  return (
    <section className={`custom-field-values-v195 custom-field-values-v199 ${compact ? "compact" : "project-overview-panel-v147"}`}>
      {(definitionStore.error || valueStore.error) && <div className="inline-status danger">{definitionStore.error || valueStore.error}</div>}
      <div className="settings-card-head-v092">
        <h3>{title}</h3>
        <span>{definitionStore.loading || valueStore.loading ? "Loading server fields…" : `${visibleDefinitions.length} visible · ${definitions.length} configured${valueStore.pending ? " · saving" : ""}`}</span>
      </div>
      <div className="custom-field-values-grid-v195">
        {visibleDefinitions.map((field) => {
          const value = values[field.id] ?? field.defaultValue ?? "";
          const canEdit = !readOnly && editableFieldIds.has(field.id);
          const error = validation[field.id];
          if (field.fieldType === "boolean") return <label className={`tool-check ${!canEdit ? "disabled" : ""}`} key={field.id}><ClusterInput type="checkbox" disabled={!canEdit} checked={Boolean(value)} onChange={(event) => save(field, event.target.checked)} /> {field.label}{field.required ? " *" : ""}{field.helpText && <small>{field.helpText}</small>}</label>;
          if (field.fieldType === "select" || field.fieldType === "department" || field.fieldType === "user") return <div className="field" key={field.id}><label>{field.label}{field.required ? " *" : ""}</label><ClusterNativeSelect disabled={!canEdit} value={String(value || "")} onChange={(event) => save(field, event.target.value)}><option value="">{field.placeholder || "Not set"}</option>{(field.options || []).map((option) => <option key={option} value={option}>{option}</option>)}</ClusterNativeSelect>{field.helpText && <small>{field.helpText}</small>}{error && <small className="field-error-v199">{error}</small>}</div>;
          if (field.fieldType === "multi-select") {
            const selected = String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
            return <div className="field" key={field.id}><label>{field.label}{field.required ? " *" : ""}</label><div className="custom-multiselect-v199">{(field.options || []).map((option) => <label className="tool-check compact" key={option}><ClusterInput type="checkbox" disabled={!canEdit} checked={selected.includes(option)} onChange={(event) => save(field, event.target.checked ? unique([...selected, option]).join(", ") : selected.filter((item) => item !== option).join(", "))} /> {option}</label>)}</div>{error && <small className="field-error-v199">{error}</small>}</div>;
          }
          const inputType = field.fieldType === "number" || field.fieldType === "duration" ? "number" : field.fieldType === "date" ? "date" : field.fieldType === "url" ? "url" : "text";
          return <div className="field" key={field.id}><label>{field.label}{field.required ? " *" : ""}</label><ClusterTextInput disabled={!canEdit} type={inputType} min={field.fieldType === "duration" ? "0" : undefined} value={String(value || "")} placeholder={field.placeholder || ""} onChange={(event) => save(field, event.target.value)} />{field.helpText && <small>{field.helpText}</small>}{error && <small className="field-error-v199">{error}</small>}</div>;
        })}
      </div>
    </section>
  );
}
