import { api, queryApi } from "../../core/api";
import { emitProjectDeliveryUpdate } from "../../core/project-delivery-storage";
import { emitProjectWorkflowUpdate } from "../../core/project-workflow-storage";
import { localId } from "../../core/storage";
import type { ClusterResourceAddress } from "@cluster/shared";
import type { BuildArtifactRecord } from "../application/application-models";

type DeliveryIssue = { id: string; kind: "card" | "ticket"; title: string; done: boolean };
type DeliveryCycle = {
  failedBuild?: { id: string; title: string; version?: string; resource?: ClusterResourceAddress | null } | null;
  issues: DeliveryIssue[];
  openFixes: number;
  resolvedFixes: number;
  rebuild?: { id: string; resource?: ClusterResourceAddress | null } | null;
};
type DeliverySnapshot = { failures?: DeliveryCycle[] };

export async function createSupersedingDeliveryRebuild({ projectId, failedBuildId, creatorLabel = "" }: { projectId: string; failedBuildId: string; creatorLabel?: string }) {
  const delivery = await queryApi<DeliverySnapshot>(`/api/projects/${encodeURIComponent(projectId)}/delivery-lifecycle`, { staleMs: 5_000, maxAgeMs: 60_000, tags: ["project-delivery", "delivery-lifecycle", projectId] });
  const cycle = (delivery.failures || []).find((item) => item.failedBuild?.id === failedBuildId);
  if (!cycle) throw new Error("This build has no failed QA cycle that requires a rebuild.");
  if (cycle.openFixes > 0) throw new Error(`Resolve ${cycle.openFixes} linked fix${cycle.openFixes === 1 ? "" : "es"} before creating the rebuild.`);
  if (!cycle.issues?.length) throw new Error("Capture linked fix work before creating the rebuild.");
  if (cycle.rebuild?.id) return { existing: true as const, rebuildId: cycle.rebuild.id, resource: cycle.rebuild.resource || { kind: "build" as const, id: cycle.rebuild.id, projectId }, cycle };

  const source = await api<BuildArtifactRecord>(`/api/projects/${encodeURIComponent(projectId)}/delivery/build/${encodeURIComponent(failedBuildId)}`);
  const buildList = await api<{ records: BuildArtifactRecord[] }>(`/api/projects/${encodeURIComponent(projectId)}/delivery/build`);
  const siblings = (buildList.records || []).filter((item) => item.version === source.version && item.platform === source.platform);
  const sourceOptions = await api<any>(`/api/projects/${encodeURIComponent(projectId)}/delivery/source-options`);
  const repository = (sourceOptions.repositories || []).find((item: any) => item.repositoryId === source.sourceRepositoryId);
  if (!repository) throw new Error("The failed build repository is no longer linked to this project.");
  const branchCommits = (repository.commits || []).filter((commit: any) => Array.isArray(commit.branchNames) && commit.branchNames.includes(source.sourceBranch));
  const nextCommit = branchCommits.find((commit: any) => commit.revision !== source.sourceRevision);
  if (!nextCommit) throw new Error(`No newer synchronized revision is available on ${source.sourceBranch}. Sync source control after the fixes land, then create the rebuild.`);
  const matchingReview = (repository.reviews || []).find((review: any) => review.sourceRevision === nextCommit.revision && review.sourceBranch === source.sourceBranch) || null;
  const numericBuild = Number(source.buildNumber);
  const rebuild: BuildArtifactRecord = {
    ...source,
    id: localId("build-artifact"),
    projectId,
    title: `${source.title} rebuild`,
    buildNumber: Number.isFinite(numericBuild) && source.buildNumber ? String(numericBuild + 1) : `r${Math.max(1, siblings.length)}`,
    sourceRepositoryId: source.sourceRepositoryId,
    sourceRevision: nextCommit.revision,
    sourceBranch: source.sourceBranch,
    sourceReviewId: matchingReview?.id || null,
    artifactUrl: "",
    changelog: `Superseding rebuild after failed QA for ${source.version}. ${cycle.resolvedFixes || cycle.issues.length} linked fix item(s) resolved.`,
    qaStatus: "untested",
    approval: "draft",
    signed: false,
    pinned: false,
    promotedAt: null,
    checksum: "",
    fileSize: "",
    testedPlatforms: [],
    createdBy: creatorLabel || source.createdBy || "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    revision: 1,
  };
  const payload: any = { ...rebuild };
  delete payload.provenance;
  delete payload.previousBuildId;
  delete payload.changes;
  delete payload.sourceCommitId;
  delete payload.createdAt;
  delete payload.updatedAt;
  delete payload.revision;
  const saved = await api<BuildArtifactRecord>(`/api/projects/${encodeURIComponent(projectId)}/delivery/build/${encodeURIComponent(rebuild.id)}`, { method: "PUT", body: JSON.stringify({ payload }) });
  Object.assign(rebuild, saved);
  await api(`/api/projects/${encodeURIComponent(projectId)}/workflow-links`, { method: "POST", body: JSON.stringify({
    source: { kind: "build", id: rebuild.id, projectId, label: rebuild.title },
    target: { kind: "build", id: source.id, projectId, label: source.title },
    relationship: "supersedes",
    description: "Superseding rebuild created after the failed QA fix loop was resolved.",
    critical: true,
  }) });
  for (const issue of cycle.issues || []) {
    if (!issue.done) continue;
    await api(`/api/projects/${encodeURIComponent(projectId)}/workflow-links`, { method: "POST", body: JSON.stringify({
      source: { kind: issue.kind, id: issue.id, projectId, label: issue.title },
      target: { kind: "build", id: rebuild.id, projectId, label: rebuild.title },
      relationship: "ships_in",
      description: "Resolved fix work carried into the superseding rebuild.",
      critical: false,
    }) }).catch(() => undefined);
  }
  emitProjectDeliveryUpdate({ projectId, kind: "build" });
  emitProjectWorkflowUpdate({ projectId, kind: "relationship" });
  return { existing: false as const, rebuildId: rebuild.id, rebuild, resource: { kind: "build" as const, id: rebuild.id, projectId }, cycle };
}
