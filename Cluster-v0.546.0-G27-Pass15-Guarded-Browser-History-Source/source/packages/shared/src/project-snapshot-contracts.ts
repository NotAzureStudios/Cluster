export const CLUSTER_PROJECT_SNAPSHOT_SCHEMA = 1 as const;

export type ClusterProjectSnapshotHealthState = "healthy" | "attention" | "at_risk" | "blocked";
export type ClusterProjectSnapshotScheduleState = "closed" | "overdue" | "due_soon" | "scheduled" | "unscheduled";

export type ClusterProjectSnapshot = {
  schema: typeof CLUSTER_PROJECT_SNAPSHOT_SCHEMA;
  projectId: string;
  generatedAt: string;
  identity: {
    displayName: string;
    internalName: string | null;
    externalName: string | null;
    codename: string | null;
    externalSafe: boolean;
    projectType: string;
    productionProfile: string;
  };
  lifecycle: {
    status: string;
    archived: boolean;
    priority: string;
    updatedAt: string | null;
  };
  lead: {
    configured: boolean;
    userId: string | null;
    displayName: string | null;
    username: string | null;
  };
  team: {
    assigned: number | null;
  };
  readiness: {
    score: number;
    ready: boolean;
    visibleChecks: number;
    completedChecks: number;
    gaps: string[];
  };
  schedule: {
    state: ClusterProjectSnapshotScheduleState;
    label: string;
    targetDate: string | null;
    daysToTarget: number | null;
  };
  nextMilestone: {
    id: string;
    title: string;
    type: string;
    startsAt: string;
  } | null;
  nextCalendar: {
    id: string;
    title: string;
    eventType: string;
    startsAt: string;
  } | null;
  delivery: {
    latestBuildId: string | null;
    latestBuildTitle: string | null;
    latestBuildStatus: string | null;
    failedBuilds: number | null;
    qaAttention: number | null;
  };
  health: {
    state: ClusterProjectSnapshotHealthState;
    attentionScore: number;
    reasons: string[];
  };
};
