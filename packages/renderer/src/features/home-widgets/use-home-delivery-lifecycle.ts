import { useEffect, useMemo, useRef, useState } from "react";
import { queryApi } from "../../core/api";
import { createHomeRequestAuthority } from "./home-request-authority";
import type { HomeDeliveryLifecycleSummary } from "./home-widget-phase7-data";

/** Delivery readiness is scoped to both the authenticated user and current project set. */
export function useHomeDeliveryLifecycleSummaries(projectIds: string[], enabled: boolean, accountId: string) {
  const signature = useMemo(() => [...new Set(projectIds)].sort().join(","), [projectIds.join("|")]);
  const owner = `${accountId}|${enabled ? "enabled" : "disabled"}|${signature}`;
  const authorityRef = useRef(createHomeRequestAuthority(owner));
  authorityRef.current.setOwner(owner);
  const [result, setResult] = useState<{ owner: string; rows: HomeDeliveryLifecycleSummary[] }>({ owner, rows: [] });

  useEffect(() => {
    const ticket = authorityRef.current.claim("delivery");
    if (!enabled || !accountId || !signature) {
      setResult({ owner, rows: [] });
    } else {
      setResult({ owner, rows: [] });
      void queryApi<{ projects?: HomeDeliveryLifecycleSummary[] }>(`/api/project-delivery/lifecycle?projectIds=${encodeURIComponent(signature)}`, { staleMs: 45_000, maxAgeMs: 2 * 60_000, tags: ["project-delivery", "home", "projects"] })
        .then((payload) => {
          if (authorityRef.current.isCurrent(ticket)) setResult({ owner, rows: Array.isArray(payload.projects) ? payload.projects : [] });
        })
        .catch(() => {
          if (authorityRef.current.isCurrent(ticket)) setResult({ owner, rows: [] });
        });
    }
    return () => authorityRef.current.invalidate("delivery");
  }, [owner, enabled, accountId, signature]);

  // Mask old project names immediately on the first render after an account switch.
  return enabled && accountId && result.owner === owner ? result.rows : [];
}
