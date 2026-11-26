import { useCallback, useEffect, useState } from "react";
import { queryApi } from "../../core/api";

export type ProjectFocusTeam = { ruleId: string; id: string; name: string; level: string; memberIds: string[] };
export type ProjectFocusDepartment = { id: string; name: string; color?: string | null };
export type ProjectFocusSummary = { projectId: string; department?: ProjectFocusDepartment | null; teams?: ProjectFocusTeam[] };

/** Department and teams for a project, from the shared focus read. */
export function useProjectFocus(projectId: string) {
  const [focus, setFocus] = useState<ProjectFocusSummary | null>(null);
  const load = useCallback(async (force = false) => {
    if (!projectId) return;
    const next = await queryApi<ProjectFocusSummary>(`/api/projects/${projectId}/focus`, { force, staleMs: 10_000, maxAgeMs: 60_000, tags: [`project:${projectId}`] }).catch(() => null);
    if (next?.projectId === projectId) setFocus(next);
  }, [projectId]);
  useEffect(() => { setFocus(null); void load(); }, [load]);
  return { focus, reload: () => load(true) };
}
