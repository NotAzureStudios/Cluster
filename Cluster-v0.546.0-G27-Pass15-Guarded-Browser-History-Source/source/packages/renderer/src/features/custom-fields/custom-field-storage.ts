import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, formatApiError, mutateApi } from "../../core/api";
import type { CustomFieldEntity, CustomFieldValueRecord, StudioCustomFieldDefinition } from "../application/application-models";
export const CUSTOM_FIELD_DEFINITIONS_EVENT = "cluster-custom-fields-changed";
export const CUSTOM_FIELD_VALUES_EVENT = "cluster-custom-field-values-changed";

export function customFieldSlug(label: string) {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "field";
}
export function normalizeServerCustomFieldDefinition(field: StudioCustomFieldDefinition): StudioCustomFieldDefinition {
  const now = new Date().toISOString();
  return {
    ...field,
    slug: field.slug || customFieldSlug(field.label),
    options: Array.from(new Set((field.options || []).map((item) => item.trim()).filter(Boolean))),
    enabled: field.enabled !== false,
    filterable: field.filterable !== false,
    viewAccess: field.viewAccess || "everyone",
    editAccess: field.editAccess || "members",
    archivedAt: field.archivedAt || null,
    createdAt: field.createdAt || now,
    updatedAt: field.updatedAt || field.createdAt || now,
  };
}
type ServerRecord<T> = { id: string; entityId: string; revision: number; createdAt: string; updatedAt: string; payload: T };
type ListResponse<T> = { records: Array<ServerRecord<T>> };
type CustomFieldValueListResponse<T> = ListResponse<T> & { visibleFieldIds: string[]; editableFieldIds: string[] };

function dispatch(name: string) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(name));
}

export function useServerCustomFieldDefinitions(
  normalize: (field: StudioCustomFieldDefinition) => StudioCustomFieldDefinition,
) {
  const [definitions, setDefinitions] = useState<StudioCustomFieldDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState("");
  const records = useRef(new Map<string, ServerRecord<StudioCustomFieldDefinition>>());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api<ListResponse<StudioCustomFieldDefinition>>("/api/custom-fields/definitions?archived=true");
      const nextMap = new Map<string, ServerRecord<StudioCustomFieldDefinition>>();
      response.records.forEach((record) => nextMap.set(record.entityId, record));
      records.current = nextMap;
      const nextDefinitions = Array.from(nextMap.values()).map((record) => normalize({ ...record.payload, id: record.entityId })).sort((a, b) => a.label.localeCompare(b.label));
      setDefinitions(nextDefinitions);
      setError("");
    } catch (caught) {
      setError(formatApiError(caught));
    } finally {
      setLoading(false);
    }
  }, [normalize]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const listener = () => { void load(); };
    window.addEventListener(CUSTOM_FIELD_DEFINITIONS_EVENT, listener);
    return () => window.removeEventListener(CUSTOM_FIELD_DEFINITIONS_EVENT, listener);
  }, [load]);

  const save = useCallback(async (field: StudioCustomFieldDefinition) => {
    setPending((count) => count + 1);
    try {
      const current = records.current.get(field.id);
      const result = await mutateApi<ServerRecord<StudioCustomFieldDefinition>>(`/api/custom-fields/definitions/${encodeURIComponent(field.id)}`, {
        method: "PUT",
        body: { payload: normalize(field) },
        label: "Save custom field",
        dedupeKey: `custom-field-definition:${field.id}`,
        entityType: "custom_field_definition",
        entityId: field.id,
        resourceKind: "customFieldDefinition",
        resourceId: field.id,
        baseRevision: current?.revision || null,
        baseSnapshot: current?.payload as unknown as Record<string, unknown> | undefined,
        localSnapshot: field as unknown as Record<string, unknown>,
        invalidate: ["/api/custom-fields/definitions"],
      });
      if (!result.queued && result.result) records.current.set(field.id, result.result);
      setDefinitions((currentFields) => {
        const next = [...currentFields.filter((item) => item.id !== field.id), normalize(field)].sort((a, b) => a.label.localeCompare(b.label));
        return next;
      });
      setError("");
      dispatch(CUSTOM_FIELD_DEFINITIONS_EVENT);
      return true;
    } catch (caught) {
      setError(formatApiError(caught));
      await load();
      return false;
    } finally {
      setPending((count) => Math.max(0, count - 1));
    }
  }, [load, normalize]);

  const remove = useCallback(async (field: StudioCustomFieldDefinition, purge = false) => {
    setPending((count) => count + 1);
    try {
      const current = records.current.get(field.id);
      const query = new URLSearchParams();
      if (purge) query.set("purge", "true");
      if (current?.revision) query.set("expectedRevision", String(current.revision));
      await api(`/api/custom-fields/definitions/${encodeURIComponent(field.id)}?${query.toString()}`, { method: "DELETE" });
      if (purge) {
        records.current.delete(field.id);
        setDefinitions((items) => {
          const next = items.filter((item) => item.id !== field.id).map((item) => item.showWhenFieldId === field.id ? { ...item, showWhenFieldId: "", showWhenValue: "" } : item);
            return next;
        });
      } else {
        const archived = normalize({ ...field, enabled: false, archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
        setDefinitions((items) => {
          const next = items.map((item) => item.id === field.id ? archived : item);
            return next;
        });
      }
      setError("");
      dispatch(CUSTOM_FIELD_DEFINITIONS_EVENT);
      dispatch(CUSTOM_FIELD_VALUES_EVENT);
      return true;
    } catch (caught) {
      setError(formatApiError(caught));
      await load();
      return false;
    } finally {
      setPending((count) => Math.max(0, count - 1));
    }
  }, [load, normalize]);

  const usage = useCallback(async (fieldId: string) => {
    try { return (await api<{ count: number }>(`/api/custom-fields/usage/${encodeURIComponent(fieldId)}`)).count || 0; }
    catch { return 0; }
  }, []);

  return { definitions, setDefinitions, loading, pending, error, refresh: load, save, remove, usage };
}


export function useServerCustomFieldValueCollection(
  entity: CustomFieldEntity,
  entries: Array<{ entityId: string; projectId?: string | null }>,
) {
  const entriesKey = entries.map((entry) => `${entry.entityId}:${entry.projectId || ""}`).sort().join("|");
  const normalizedEntries = useMemo(() => {
    const seen = new Set<string>();
    return entries.filter((entry) => {
      const entityId = String(entry.entityId || "").trim();
      if (!entityId || seen.has(entityId)) return false;
      seen.add(entityId);
      return true;
    }).map((entry) => ({ entityId: entry.entityId, projectId: entry.projectId || null }));
  }, [entriesKey]);
  const [values, setValues] = useState<CustomFieldValueRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!normalizedEntries.length) { setValues([]); setLoading(false); setError(""); return; }
    setLoading(true);
    const entityIds = new Set(normalizedEntries.map((entry) => entry.entityId));
    try {
      const chunks: Array<typeof normalizedEntries> = [];
      for (let index = 0; index < normalizedEntries.length; index += 400) chunks.push(normalizedEntries.slice(index, index + 400));
      const responses = await Promise.all(chunks.map((chunk) => api<ListResponse<CustomFieldValueRecord>>("/api/custom-fields/values/query", {
        method: "POST",
        body: JSON.stringify({ entity, entries: chunk }),
      })));
      const records = responses.flatMap((response) => response.records || []);
      const byId = new Map<string, CustomFieldValueRecord>();
      records.forEach((record) => byId.set(record.payload.id, record.payload));
      const next = Array.from(byId.values());
      setValues(next);
      setError("");
    } catch (caught) {
      setError(formatApiError(caught));
    } finally {
      setLoading(false);
    }
  }, [entity, entriesKey]);

  useEffect(() => { setValues([]); void load(); }, [load]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const listener = () => { void load(); };
    window.addEventListener(CUSTOM_FIELD_VALUES_EVENT, listener);
    return () => window.removeEventListener(CUSTOM_FIELD_VALUES_EVENT, listener);
  }, [load]);

  return useMemo(() => ({ values, loading, error, refresh: load }), [values, loading, error, load]);
}

export function useServerCustomFieldValues(entity: CustomFieldEntity, entityId: string, projectId?: string | null) {
  const [values, setValues] = useState<CustomFieldValueRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState("");
  const [visibleFieldIds, setVisibleFieldIds] = useState<string[]>([]);
  const [editableFieldIds, setEditableFieldIds] = useState<string[]>([]);
  const records = useRef(new Map<string, ServerRecord<CustomFieldValueRecord>>());
  const scopeKey = `${entity}:${entityId}:${projectId || ""}`;

  const load = useCallback(async () => {
    if (!entityId) { setValues([]); setVisibleFieldIds([]); setEditableFieldIds([]); setLoading(false); return; }
    setLoading(true);
    try {
      const query = new URLSearchParams({ entity, entityId });
      if (projectId) query.set("projectId", projectId);
      const response = await api<CustomFieldValueListResponse<CustomFieldValueRecord>>(`/api/custom-fields/values?${query.toString()}`);
      const nextMap = new Map<string, ServerRecord<CustomFieldValueRecord>>();
      response.records.forEach((record) => nextMap.set(record.payload.id, record));
      records.current = nextMap;
      const scopedValues = Array.from(nextMap.values()).map((record) => ({ ...record.payload, id: record.payload.id || `${entity}:${entityId}:${record.payload.fieldId}` }));
      setValues(scopedValues);
      setVisibleFieldIds(response.visibleFieldIds || []);
      setEditableFieldIds(response.editableFieldIds || []);
      setError("");
    } catch (caught) {
      setError(formatApiError(caught));
      setVisibleFieldIds([]);
      setEditableFieldIds([]);
    } finally {
      setLoading(false);
    }
  }, [scopeKey]);

  useEffect(() => { setValues([]); setVisibleFieldIds([]); setEditableFieldIds([]); void load(); }, [load]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const listener = () => { void load(); };
    window.addEventListener(CUSTOM_FIELD_VALUES_EVENT, listener);
    return () => window.removeEventListener(CUSTOM_FIELD_VALUES_EVENT, listener);
  }, [load]);

  const save = useCallback(async (record: CustomFieldValueRecord) => {
    const enriched = { ...record, projectId: projectId || (entity === "project" ? entityId : null) };
    const key = record.id || `${entity}:${entityId}:${record.fieldId}`;
    setPending((count) => count + 1);
    setValues((items) => {
      const next = [enriched, ...items.filter((item) => item.id !== key)];
      return next;
    });
    try {
      const current = records.current.get(key);
      const result = await mutateApi<ServerRecord<CustomFieldValueRecord>>(`/api/custom-fields/values/${encodeURIComponent(entity)}/${encodeURIComponent(entityId)}/${encodeURIComponent(record.fieldId)}`, {
        method: "PUT",
        body: { payload: enriched },
        label: "Save custom field value",
        dedupeKey: `custom-field-value:${key}`,
        entityType: "custom_field_value",
        entityId: key,
        resourceKind: "customFieldValue",
        resourceId: key,
        baseRevision: current?.revision || null,
        baseSnapshot: current?.payload as unknown as Record<string, unknown> | undefined,
        localSnapshot: enriched as unknown as Record<string, unknown>,
        invalidate: ["/api/custom-fields/values"],
      });
      if (!result.queued && result.result) records.current.set(key, result.result);
      setError("");
      dispatch(CUSTOM_FIELD_VALUES_EVENT);
      return true;
    } catch (caught) {
      setError(formatApiError(caught));
      await load();
      return false;
    } finally {
      setPending((count) => Math.max(0, count - 1));
    }
  }, [entity, entityId, load, projectId]);

  return useMemo(() => ({ values, visibleFieldIds, editableFieldIds, loading, pending, error, refresh: load, save }), [values, visibleFieldIds, editableFieldIds, loading, pending, error, load, save]);
}
