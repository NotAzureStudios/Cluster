import { useCallback, useEffect, useRef, useState } from "react";
import type { SharedWorkReference } from "@cluster/shared";
import { formatRelativeTime } from "../core/format";
import { ClusterButton } from "./ClusterButton";
import { ClusterStatus } from "./ClusterStatus";
import { loadSharedWorkActivity, type SharedWorkActivityRecord } from "../features/application/shared-work";

function actorLabel(event: SharedWorkActivityRecord) {
  return event.user?.displayName || event.user?.username || "Cluster";
}

export function SharedWorkActivityPanel({
  entity,
  entityType,
  title = "Activity",
  limit = 12,
  compact = false,
}: {
  entity: SharedWorkReference;
  entityType?: string;
  title?: string;
  limit?: number;
  compact?: boolean;
}) {
  const [events, setEvents] = useState<SharedWorkActivityRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const requestSequence = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestSequence.current;
    if (!entity.id) {
      setEvents([]);
      setError("");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const rows = await loadSharedWorkActivity(entity, { entityType, limit });
      if (requestSequence.current === requestId) setEvents(rows);
    } catch (cause) {
      if (requestSequence.current === requestId) setError(cause instanceof Error ? cause.message : "Activity could not be loaded.");
    } finally {
      if (requestSequence.current === requestId) setLoading(false);
    }
  }, [entity.kind, entity.id, entity.projectId, entityType, limit]);

  useEffect(() => {
    setEvents([]);
    void load();
    return () => { requestSequence.current += 1; };
  }, [load]);

  return (
    <section className={`shared-work-activity-v504 ${compact ? "compact" : ""}`} aria-label={`${title} for ${entity.label || entity.kind}`}>
      <header>
        <div><p className="eyebrow">History</p><h4>{title}</h4></div>
        {!loading ? <span>{events.length}</span> : null}
      </header>
      {loading ? <ClusterStatus state="loading" compact>Loading activity</ClusterStatus> : null}
      {!loading && error ? <div className="shared-work-activity-error-v504"><ClusterStatus state="error" compact role="alert">{error}</ClusterStatus><ClusterButton size="compact" variant="quiet" onClick={() => void load()}>Retry</ClusterButton></div> : null}
      {!loading && !error && !events.length ? <p className="muted tight">No recorded activity for this item yet.</p> : null}
      {!loading && !error && events.length ? <ol className="shared-work-activity-list-v504">
        {events.map((event) => <li key={event.id}>
          <span aria-hidden="true" />
          <div><strong>{event.title}</strong><small>{actorLabel(event)} · {formatRelativeTime(event.createdAt)}</small>{event.message ? <p>{event.message}</p> : null}</div>
        </li>)}
      </ol> : null}
    </section>
  );
}
