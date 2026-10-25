import { useEffect, useMemo, useState } from "react";
import { api } from "../../core/api";
import type { HomeDeliveryLifecycleSummary } from "./home-widget-phase7-data";

export function useHomeDeliveryLifecycleSummaries(projectIds: string[], enabled: boolean) {
  const signature = useMemo(() => projectIds.join(","), [projectIds]);
  const [rows, setRows] = useState<HomeDeliveryLifecycleSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!enabled || !projectIds.length) {
      setRows([]);
      return () => { cancelled = true; };
    }
    void api<{ projects?: HomeDeliveryLifecycleSummary[] }>(`/api/project-delivery/lifecycle?projectIds=${encodeURIComponent(signature)}`)
      .then((payload) => { if (!cancelled) setRows(Array.isArray(payload.projects) ? payload.projects : []); })
      .catch(() => { if (!cancelled) setRows([]); });
    return () => { cancelled = true; };
  }, [enabled, signature]);

  return rows;
}
