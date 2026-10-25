import type {
  ClusterChangeSetExecution,
  ClusterChangeSetPlan,
  ClusterChangeSetPreview,
  ClusterCommandEnvelope,
  ClusterCommandIssue,
  ClusterImpactChange,
  ClusterImpactPreview,
  ClusterResourceAddress,
} from "@cluster/shared";
import { ClusterCommandRuntime, type ClusterCommandDefinition } from "./command-runtime.js";

type RegisteredChange = {
  command: ClusterCommandEnvelope;
  definition: ClusterCommandDefinition<any, any>;
};

function resourceKey(resource: ClusterResourceAddress) {
  return `${resource.kind}:${resource.id}:${resource.projectId || ""}`;
}

function changeKey(change: ClusterImpactChange) {
  return `${resourceKey(change.resource)}:${change.kind}:${change.field || ""}:${JSON.stringify(change.before ?? null)}:${JSON.stringify(change.after ?? null)}`;
}

function mergeImpact(previews: Array<ClusterImpactPreview | null | undefined>): ClusterImpactPreview {
  const resources = new Map<string, ClusterResourceAddress>();
  const issues: ClusterCommandIssue[] = [];
  const changes = new Map<string, ClusterImpactChange>();
  for (const preview of previews) {
    if (!preview) continue;
    for (const resource of preview.affectedResources || []) resources.set(resourceKey(resource), resource);
    for (const change of preview.changes || []) changes.set(changeKey(change), change);
    issues.push(...(preview.issues || []));
  }
  return {
    summary: `${resources.size} unique resource${resources.size === 1 ? "" : "s"} may be affected by this change set.`,
    affectedResources: [...resources.values()],
    issues,
    changes: [...changes.values()],
    metadata: { commandCount: previews.length, changeCount: changes.size },
  };
}

/**
 * Composes the canonical Command Runtime. It deliberately refuses to pretend
 * sequential cross-domain commands are atomic. A future domain transaction
 * adapter may opt into `domain`; the generic runtime only accepts `none`.
 */
export class ClusterChangeSetRuntime {
  constructor(private readonly commands: ClusterCommandRuntime) {}

  async preview(plan: ClusterChangeSetPlan, resolve: (item: ClusterChangeSetPlan["items"][number]) => RegisteredChange): Promise<ClusterChangeSetPreview> {
    if (plan.atomicity !== "none") throw new Error("Generic change sets only support non-atomic preview/execution.");
    const items = [];
    const impacts: Array<ClusterImpactPreview | null | undefined> = [];
    for (const item of plan.items) {
      const registered = resolve(item);
      const command = { ...registered.command, dryRun: true };
      const result = await this.commands.execute(command, registered.definition);
      const issues = result.ok ? result.impact?.issues || [] : [result.error, ...(result.issues || [])];
      impacts.push(result.impact);
      items.push({ key: item.key, commandId: command.id, commandType: command.type, impact: result.impact || null, issues });
    }
    const impact = mergeImpact(impacts);
    return {
      id: plan.id,
      title: plan.title || null,
      atomicity: plan.atomicity,
      executable: items.every((item) => !item.issues.some((entry) => entry.severity === "error")),
      impact,
      items,
    };
  }

  async execute(plan: ClusterChangeSetPlan, resolve: (item: ClusterChangeSetPlan["items"][number]) => RegisteredChange): Promise<ClusterChangeSetExecution> {
    if (plan.atomicity !== "none") throw new Error("Generic change sets cannot guarantee cross-domain atomicity.");
    const results: ClusterChangeSetExecution["results"] = [];
    let failed = 0;
    let stoppedEarly = false;
    for (const item of plan.items) {
      const registered = resolve(item);
      const result = await this.commands.execute({ ...registered.command, dryRun: false }, registered.definition);
      results.push({ key: item.key, result });
      if (!result.ok) {
        failed += 1;
        if (plan.stopOnFailure) {
          stoppedEarly = true;
          break;
        }
      }
    }
    return {
      id: plan.id,
      atomicity: plan.atomicity,
      completed: results.length - failed,
      failed,
      stoppedEarly,
      results,
    };
  }
}
