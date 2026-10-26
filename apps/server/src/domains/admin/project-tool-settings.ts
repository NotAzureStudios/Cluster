import { clusterResolveProjectCalendarView, isClusterCalendarView, type ClusterCalendarView, type ClusterProjectCalendarViewSnapshot } from "@cluster/shared";

const identity = (projectId: string) => ({ projectId_tool_field: { projectId, tool: "calendar", field: "defaultView" } });
export async function projectCalendarViewSnapshot(prisma: any, projectId: string | null, studioSettings: Record<string, unknown>): Promise<ClusterProjectCalendarViewSnapshot> {
  const row = projectId ? await prisma.projectToolSettingOverride.findUnique({ where: identity(projectId) }) : null;
  return clusterResolveProjectCalendarView(studioSettings, row);
}

/** Optimistic per-field CAS: a stale admin cannot overwrite an intervening edit,
 * and a reset removes the child row so future Studio changes are inherited.
 * Uniqueness prevents two simultaneous creates from silently succeeding.
 */
export async function updateProjectCalendarView(prisma: any, projectId: string, value: ClusterCalendarView | null, expectedRevision: number | null, actorId: string, lockUserOverride = false): Promise<void> {
  if (typeof lockUserOverride !== "boolean") throw new Error("Invalid Project Calendar lock policy.");
  if (value !== null && !isClusterCalendarView(value)) throw new Error("Unsupported Project Calendar view.");
  if (expectedRevision === null) {
    if (value === null) throw new Error("A missing Project override cannot be reset.");
    try {
      await prisma.projectToolSettingOverride.create({ data: { projectId, tool: "calendar", field: "defaultView", valueJson: JSON.stringify(value), lockUserOverride, updatedById: actorId } });
      return;
    } catch (error) {
      if ((error as any)?.code === "P2002") throw conflict();
      throw error;
    }
  }
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) throw new Error("A valid expected Project setting revision is required.");
  const key = { projectId, tool: "calendar", field: "defaultView", revision: expectedRevision };
  if (value === null) {
    const result = await prisma.projectToolSettingOverride.deleteMany({ where: key });
    if (result.count !== 1) throw conflict();
  } else {
    const result = await prisma.projectToolSettingOverride.updateMany({ where: key, data: { valueJson: JSON.stringify(value), lockUserOverride, revision: { increment: 1 }, updatedById: actorId } });
    if (result.count !== 1) throw conflict();
  }
}
function conflict(): Error & { code: string } {
  const error = new Error("Project Calendar view changed since it was loaded. Refresh before saving.") as Error & { code: string };
  error.code = "PROJECT_TOOL_SETTING_CONFLICT";
  return error;
}
