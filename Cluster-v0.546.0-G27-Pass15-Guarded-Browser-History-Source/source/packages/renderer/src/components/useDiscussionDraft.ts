import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../core/api";

type DraftRecord = { body: string; revision: number | null; updatedAt: string | null };
type DraftStatus = "loading" | "saved" | "unsaved" | "saving" | "conflict" | "error";

/**
 * TD6 G24: private, server-backed composer drafts. No localStorage (drafts may
 * contain confidential studio text). CAS + a serialized write queue prevent
 * delayed autosaves from clobbering later keystrokes in this window. The server
 * also rejects competing sessions until the user explicitly resolves a conflict.
 */
export function useDiscussionDraft(entityType: string, entityId: string, slotKey: string) {
  const identity = `${entityType}:${entityId}:${slotKey}`;
  const base = { entityType, entityId, slotKey };
  const query = `/api/entity-comments/draft?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}&slotKey=${encodeURIComponent(slotKey)}`;
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<DraftStatus>("loading");
  const [error, setError] = useState("");
  const [reloadCounter, setReloadCounter] = useState(0);
  const revision = useRef<number | null>(null);
  const persisted = useRef("");
  const current = useRef("");
  const generation = useRef(0);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const blocked = useRef(false);
  const ready = status !== "loading";

  const change = useCallback((text: string | ((previous: string) => string)) => {
    const next = typeof text === "function" ? text(current.current) : text;
    current.current = next;
    setValue(next);
    if (!blocked.current) setStatus("unsaved");
  }, []);

  useEffect(() => {
    const epoch = ++generation.current;
    blocked.current = false;
    revision.current = null;
    persisted.current = "";
    current.current = "";
    setValue("");
    setError("");
    setStatus("loading");
    void api<DraftRecord>(query).then((draft) => {
      if (generation.current !== epoch) return;
      // Composer is disabled while loading; never silently merge remote data
      // into an unsaved in-flight edit from a different resource.
      revision.current = draft.revision;
      persisted.current = draft.body;
      current.current = draft.body;
      setValue(draft.body);
      setStatus("saved");
    }).catch((err) => {
      if (generation.current !== epoch) return;
      setError(err instanceof Error ? err.message : "Draft could not be loaded.");
      blocked.current = true; // Do not allow a blind first write on lookup failure.
      setStatus("error");
    });
    return () => { generation.current += 1; };
  }, [identity, reloadCounter]);

  // Writes are serialized and bound to the resource generation that scheduled
  // them. A slow earlier request cannot overwrite a later response locally.
  const persist = useCallback((text: string) => {
    const epoch = generation.current;
    const task = queue.current.catch(() => undefined).then(async () => {
      if (generation.current !== epoch || blocked.current) throw new Error("Draft needs review before saving.");
      if (text === persisted.current) return revision.current;
      setStatus("saving");
      try {
        let draft: DraftRecord;
        if (!text.length) {
          if (revision.current !== null) {
            await api("/api/entity-comments/draft", { method: "DELETE", body: JSON.stringify({ ...base, expectedRevision: revision.current }) });
          }
          draft = { body: "", revision: null, updatedAt: null };
        } else {
          draft = await api<DraftRecord>("/api/entity-comments/draft", { method: "PUT", body: JSON.stringify({ ...base, body: text, expectedRevision: revision.current }) });
        }
        if (generation.current !== epoch) return null;
        revision.current = draft.revision;
        persisted.current = text;
        setStatus(current.current === text ? "saved" : "unsaved");
        setError("");
        return draft.revision;
      } catch (err) {
        if (generation.current === epoch) {
          const message = err instanceof Error ? err.message : "Draft could not be saved.";
          setError(message);
          blocked.current = true; // Explicit recovery required, not repeated conflict writes.
          setStatus(/409|conflict|changed/i.test(message) ? "conflict" : "error");
        }
        throw err;
      }
    });
    queue.current = task;
    return task;
  }, [identity]);

  useEffect(() => {
    if (!ready || blocked.current || value === persisted.current) return;
    const timer = window.setTimeout(() => { void persist(value).catch(() => undefined); }, 800);
    return () => window.clearTimeout(timer);
  }, [value, ready, persist]);

  const flush = useCallback(async () => {
    if (blocked.current || !ready) throw new Error("Review the draft before posting.");
    return persist(current.current);
  }, [persist, ready]);

  const posted = useCallback((draftCleared: boolean | undefined) => {
    if (draftCleared === false) {
      blocked.current = true;
      setStatus("conflict");
      setError("Comment posted, but a newer draft exists in another session. Load or replace that draft before posting again.");
      return;
    }
    revision.current = null;
    persisted.current = "";
    current.current = "";
    setValue("");
    blocked.current = false;
    setStatus("saved");
  }, []);

  const reload = useCallback(() => setReloadCounter((value) => value + 1), []);
  const overwrite = useCallback(async () => {
    const typed = current.current;
    const epoch = generation.current;
    try {
      await queue.current.catch(() => undefined);
      const latest = await api<DraftRecord>(query);
      if (generation.current !== epoch) return;
      revision.current = latest.revision;
      persisted.current = latest.body;
      blocked.current = false;
      setError("");
      setStatus("unsaved");
      await persist(typed); // Intentional CAS replace; new concurrent change still conflicts.
    } catch (err) {
      if (generation.current !== epoch) return;
      blocked.current = true;
      setStatus("conflict");
      setError(err instanceof Error ? err.message : "Draft replacement failed.");
    }
  }, [identity, persist]);

  return { value, change, ready: ready && !blocked.current, status, error, flush, posted, reload, overwrite };
}
