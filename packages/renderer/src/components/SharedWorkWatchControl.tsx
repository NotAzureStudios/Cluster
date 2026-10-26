import { useEffect, useMemo, useState } from "react";
import {
  SHARED_WORK_WATCH_SCOPES,
  normalizeSharedWorkWatchScopes,
  type SharedWorkWatchReference,
  type SharedWorkWatchScope,
} from "@cluster/shared";
import { ClusterButton } from "./ClusterButton";
import { ClusterMultiSelect } from "./ClusterMultiSelect";
import { ClusterStatus } from "./ClusterStatus";
import { loadSharedWorkWatch, setSharedWorkWatch, unwatchSharedWork } from "../features/application/shared-work";

const WATCH_SCOPES: Array<{ value: SharedWorkWatchScope; label: string }> = [
  { value: "all", label: "Everything" },
  { value: "status", label: "Status" },
  { value: "comments", label: "Comments" },
  { value: "files", label: "Files" },
  { value: "approvals", label: "Approvals" },
];

function nextWatchScopes(current: readonly SharedWorkWatchScope[], rawValues: readonly string[]) {
  const raw = rawValues.filter((value): value is SharedWorkWatchScope => WATCH_SCOPES.some((option) => option.value === value));
  const selectedAll = raw.includes("all");
  const hadAll = current.includes("all");
  if (selectedAll && !hadAll) return ["all"] as SharedWorkWatchScope[];
  if (hadAll && raw.length > 1) return normalizeSharedWorkWatchScopes(raw.filter((scope) => scope !== "all"));
  return normalizeSharedWorkWatchScopes(raw);
}

export function SharedWorkWatchControl({
  entity,
  compact = false,
  singleScope,
}: {
  entity: SharedWorkWatchReference;
  compact?: boolean;
  singleScope?: SharedWorkWatchScope;
}) {
  const [scopes, setScopes] = useState<SharedWorkWatchScope[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const watching = singleScope ? scopes.includes("all") || scopes.includes(singleScope) : scopes.length > 0;
  const label = entity.label?.trim() || entity.kind.replaceAll("_", " ");
  const scopeLabel = singleScope ? WATCH_SCOPES.find((option) => option.value === singleScope)?.label || singleScope : null;
  const options = useMemo(() => WATCH_SCOPES.map((option) => ({ ...option })), []);

  useEffect(() => {
    let cancelled = false;
    setScopes([]);
    setError("");
    setLoading(true);
    void loadSharedWorkWatch(entity)
      .then((state) => {
        if (cancelled) return;
        setScopes(normalizeSharedWorkWatchScopes(state.scopes));
      })
      .catch((cause) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : "Watch state could not be loaded.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [entity.kind, entity.id]);

  async function toggle() {
    setBusy(true);
    setError("");
    try {
      if (singleScope) {
        const next = watching
          ? scopes.includes("all")
            ? SHARED_WORK_WATCH_SCOPES.filter((scope): scope is SharedWorkWatchScope => scope !== "all" && scope !== singleScope)
            : scopes.filter((scope) => scope !== singleScope)
          : normalizeSharedWorkWatchScopes([...scopes, singleScope]);
        if (!next.length) {
          await unwatchSharedWork(entity);
          setScopes([]);
        } else {
          const state = await setSharedWorkWatch(entity, next);
          setScopes(normalizeSharedWorkWatchScopes(state.scopes));
        }
      } else if (watching) {
        await unwatchSharedWork(entity);
        setScopes([]);
      } else {
        const state = await setSharedWorkWatch(entity, ["all"]);
        setScopes(normalizeSharedWorkWatchScopes(state.scopes));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Watch state could not be changed.");
    } finally {
      setBusy(false);
    }
  }

  async function changeScopes(rawValues: string[]) {
    const next = nextWatchScopes(scopes, rawValues);
    setBusy(true);
    setError("");
    try {
      if (next.length === 0) {
        await unwatchSharedWork(entity);
        setScopes([]);
      } else {
        const state = await setSharedWorkWatch(entity, next);
        setScopes(normalizeSharedWorkWatchScopes(state.scopes));
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Watch scope could not be changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="cluster-field-v425" data-cluster-state={error ? "error" : busy || loading ? "loading" : "default"}>
      <div className="cluster-action-group-v425" role="group" aria-label={`Watch ${label}`}>
        <ClusterButton
          type="button"
          variant={watching ? "secondary" : "quiet"}
          size="compact"
          selected={watching}
          busy={busy || (loading && Boolean(singleScope))}
          busyLabel={loading ? "Loading" : "Updating"}
          disabled={loading}
          onClick={() => void toggle()}
        >
          {singleScope ? (watching ? `Following ${scopeLabel?.toLowerCase()}` : `Follow ${scopeLabel?.toLowerCase()}`) : watching ? "Watching" : "Watch"}
        </ClusterButton>
        {watching && !singleScope ? (
          <ClusterMultiSelect
            values={scopes}
            options={options}
            onChange={(values) => void changeScopes(values)}
            ariaLabel={`Watch updates for ${label}`}
            placeholder="Choose updates"
            searchable={false}
            disabled={busy || loading}
          />
        ) : null}
      </div>
      {loading && !singleScope ? <ClusterStatus state="loading" compact={compact} role="status">Loading watch settings</ClusterStatus> : null}
      {!loading && watching && !singleScope ? (
        <ClusterStatus tone="info" compact={compact} role="status" aria-live="polite">
          Following {scopes.map((scope) => WATCH_SCOPES.find((option) => option.value === scope)?.label || scope).join(", ").toLowerCase()}
        </ClusterStatus>
      ) : null}
      {error ? <ClusterStatus state="error" compact={compact} role="alert">{error}</ClusterStatus> : null}
    </div>
  );
}
