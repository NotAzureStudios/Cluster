import { ClusterButton } from "../../components/ClusterButton";
import { ClusterModal } from "../../components/ClusterModal";
import { ClusterIcon } from "../../components/ClusterIcon";
import { ClusterDisclosureGroup } from "../../components/ClusterDisclosureGroup";
import { useCallback, useEffect, useState, type ComponentType } from "react";
import { api, queryApi } from "../../core/api";
import { addDays, compactDateTime, toDateTimeLocalInput } from "../../core/date-time";
import { localId } from "../../core/storage";
import { useProjectDeliveryList } from "../../core/project-delivery-storage";
import { readClusterDetailSelection, useClusterDetailHistory } from "../../components/ClusterMasterDetail";
import { RequestErrorState } from "../../components/RequestState";
import { openClusterWorkNavigation, recoverClusterDetailNavigation } from "../workflow/work-navigation";
import { LinkedWorkPanel } from "../workflow/LinkedWorkPanel";
import { WorkActionMenu } from "../workflow/WorkActionMenu";
import { ProjectCollaborationStrip } from "../collaboration";
import { ProjectDeliveryLifecycle } from "./ProjectDeliveryLifecycle";
import { createSupersedingDeliveryRebuild } from "./project-delivery-actions";
import type {
  BuildArtifactRecord,
  BuildPlatformProfile,
  Project,
  ReleaseNoteDraft,
  TimelineItem,
  TimelinePayload,
  QASessionRecord,
  User,
} from "../application/application-models";
import { ProjectBuildArtifactWorkbench, ProjectBuildMatrix } from "./ProjectBuildArtifactWorkbench";
import { ProjectBuildComposer, type ProjectBuildComposerForm, type ProjectBuildSourceOptions } from "./ProjectBuildComposer";
import { ProjectSectionHeader, ProjectSectionStatus, ProjectSegmentedControl, ProjectSurface } from "./ProjectWorkspacePrimitives";
import { nextBuildChannel } from "./project-quality-models";
import { BUILD_PLATFORM_PROFILES, buildPlatformLaneLabel, defaultPlatformMeta, isProjectBuildEntry, platformMetaSummary, projectBuildLaneFromText, projectHasBuildSignals } from "./project-build-domain";
export { BUILD_PLATFORM_PROFILES, buildPlatformLaneLabel, defaultPlatformMeta, isProjectBuildEntry, platformMetaSummary, projectBuildLaneFromText, projectHasBuildSignals } from "./project-build-domain";
import "./project-operations.css";
import "./delivery.css";
import "./project-quality.css";

export function splitReleaseNoteLines(text: string, fallback: string): string[] {
  const lines = text
    .split(/\n|;|•|-/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length ? Array.from(new Set(lines)).slice(0, 8) : [fallback];
}

export function buildReleaseNoteBody(draft: { title: string; buildVersion: string; platform: string; sourceBranch: string; sourceRevision: string; qaStatus: string; features: string[]; fixes: string[]; knownIssues: string[] }) {
  const list = (items: string[]) => (items.length ? items.map((item) => `- ${item}`).join("\n") : "- None listed");
  return `# ${draft.title}\n\nBuild: ${draft.buildVersion || "Unversioned"}\nPlatform: ${draft.platform || "Any"}\nSource: ${draft.sourceBranch || "unknown"} @ ${(draft.sourceRevision || "unknown").slice(0, 12)}\nQA status: ${draft.qaStatus || "untested"}\n\n## New features\n${list(draft.features)}\n\n## Fixed bugs\n${list(draft.fixes)}\n\n## Known issues\n${list(draft.knownIssues)}\n\n## Ship note\nReview generated release notes before publishing and confirm they match the shipped build.`;
}

export function ProjectBuildsPanelFeature({ project, projects, onOpenTimeline, onOpenQa, getBuildProfile, CustomFieldsPanel, currentUser, users = [], canContribute = false, canManage = false, permissionReason = "Project access is read-only." }: { project: Project; projects: Project[]; onOpenTimeline: () => void; onOpenQa?: () => void; getBuildProfile: (project: Project) => BuildPlatformProfile; CustomFieldsPanel: ComponentType<{ compact?: boolean; entity: "build"; entityId: string; projectId?: string | null; title?: string }>; currentUser?: User; users?: User[]; canContribute?: boolean; canManage?: boolean; permissionReason?: string }) {
  const buildProfile = getBuildProfile(project);
  const [timeline, setTimeline] = useState<TimelinePayload | null>(null);
  const [status, setStatus] = useState("");
  const [loadError, setLoadError] = useState<unknown>(null);
  const [buildView, setBuildView] = useState<"flow" | "artifacts" | "matrix" | "notes">("flow");
  const [selectedReleaseId, setSelectedReleaseId] = useState("");
  const restoreReleaseDetail = useCallback((id: string | null) => { setSelectedReleaseId(id || ""); if (id) setBuildView("notes"); }, []);
  const releaseDetailHistory = useClusterDetailHistory("release", selectedReleaseId || null, restoreReleaseDetail);
  const [composerOpen, setComposerOpen] = useState(false);
  const [artifactComposerOpen, setArtifactComposerOpen] = useState(false);
  const [artifacts, setArtifacts, artifactSync] = useProjectDeliveryList<BuildArtifactRecord>("build", project.id);
  const [releaseNotes, setReleaseNotes, releaseNoteSync] = useProjectDeliveryList<ReleaseNoteDraft>("release", project.id);
  const [qaSessions, setQaSessions, qaSessionSync] = useProjectDeliveryList<QASessionRecord>("qa-session", project.id);
  const [platformMeta, setPlatformMeta] = useState<Record<string, string>>(() => defaultPlatformMeta(buildProfile));
  const [sourceOptions, setSourceOptions] = useState<ProjectBuildSourceOptions | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [form, setForm] = useState<ProjectBuildComposerForm>({
    title: "",
    lane: buildProfile.lanes[0]?.id || "internal",
    version: "",
    platform: buildProfile.defaultPlatform,
    sourceRepositoryId: "",
    sourceBranch: "",
    sourceRevision: "",
    sourceReviewId: "",
    artifactUrl: "",
    date: toDateTimeLocalInput(addDays(new Date(), 7).toISOString()),
    notes: "",
    channel: "internal" as NonNullable<BuildArtifactRecord["channel"]>,
    buildNumber: "",
    checksum: "",
    fileSize: "",
    createdBy: "",
    signed: false,
    testedPlatforms: [] as string[],
  });
  async function loadProjectBuilds() {
    setLoadError(null);
    const start = addDays(new Date(), -45);
    const end = addDays(new Date(), 270);
    const result = await api<TimelinePayload>(`/api/timeline?projectId=${encodeURIComponent(project.id)}&start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`);
    setTimeline(result);
  }
  async function loadBuildSourceOptions() {
    setSourceLoading(true);
    try {
      const next = await queryApi<ProjectBuildSourceOptions>(`/api/projects/${project.id}/delivery/source-options`, { staleMs: 15_000, maxAgeMs: 5 * 60_000, tags: ["project-delivery", "source-control", project.id] });
      setSourceOptions(next);
      const repository = next.repositories.find((item) => item.isPrimary) || next.repositories[0];
      if (!repository) return;
      const branch = repository.branches.find((item) => item.name === repository.defaultBranch) || repository.branches.find((item) => item.isDefault) || repository.branches[0];
      const revision = repository.commits.find((item) => item.revision === branch?.headRevision)?.revision || branch?.headRevision || repository.commits[0]?.revision || "";
      setForm((current) => current.sourceRepositoryId ? current : { ...current, sourceRepositoryId: repository.repositoryId, sourceBranch: branch?.name || repository.defaultBranch || "main", sourceRevision: revision });
    } finally { setSourceLoading(false); }
  }
  useEffect(() => {
    const syncError = artifactSync.error || releaseNoteSync.error || qaSessionSync.error;
    if (syncError) setStatus(syncError);
  }, [artifactSync.error, releaseNoteSync.error, qaSessionSync.error]);
  useEffect(() => {
    const nextProfile = getBuildProfile(project);
    setForm((prev) => ({
      ...prev,
      lane: nextProfile.lanes.some((lane) => lane.id === prev.lane) ? prev.lane : nextProfile.lanes[0]?.id || "internal",
      platform: nextProfile.platforms.includes(prev.platform) ? prev.platform : nextProfile.defaultPlatform,
    }));
    setPlatformMeta((prev) => ({
      ...defaultPlatformMeta(nextProfile),
      ...Object.fromEntries(Object.entries(prev).filter(([key]) => nextProfile.fields.some((field) => field.id === key))),
    }));
    loadProjectBuilds().catch(setLoadError);
    loadBuildSourceOptions().catch(setLoadError);
  }, [project.id, project.projectType]);
  const projectArtifacts = artifacts.filter((artifact) => artifact.projectId === project.id);
  const projectNotes = releaseNotes.filter((draft) => draft.projectId === project.id);
  const selectedRelease = projectNotes.find((draft) => draft.id === selectedReleaseId) || null;
  useEffect(() => {
    const requestedId = readClusterDetailSelection("release");
    if (!requestedId || releaseNoteSync.loading) return;
    if (projectNotes.some((note) => note.id === requestedId)) return;
    setSelectedReleaseId("");
    recoverClusterDetailNavigation("release", { title: "Release note unavailable", message: "That release note may have been removed, archived with its project, or your access may have changed. Builds stayed open.", tone: "warning" });
  }, [releaseNoteSync.loading, projectNotes]);
  const buildEntries = (timeline?.entries || []).filter((entry) => entry.project?.id === project.id && isProjectBuildEntry(entry));
  const laneRows = buildProfile.lanes.map((laneProfile) => {
    const lane = laneProfile.id;
    const laneEntries = buildEntries.filter((entry) => projectBuildLaneFromText(`${entry.type} ${entry.title} ${entry.description || ""}`) === lane || `${entry.description || ""}`.toLowerCase().includes(laneProfile.label.toLowerCase()));
    const laneArtifacts = projectArtifacts.filter((artifact) => artifact.lane === lane || projectBuildLaneFromText(`${artifact.title} ${artifact.changelog || ""}`) === lane);
    const next = [...laneEntries].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())[0] || null;
    const latest = [...laneArtifacts].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] || null;
    const state = next ? "scheduled" : latest ? "artifact" : "empty";
    return {
      lane,
      label: laneProfile.label,
      hint: laneProfile.hint,
      entries: laneEntries.length,
      artifacts: laneArtifacts.length,
      next,
      latest,
      state,
    };
  });
  const blockers = [...buildEntries, ...projectArtifacts].filter((item: any) => /blocked|blocker|failed|crash|no-go|reject/.test(`${item.title || ""} ${item.description || ""} ${item.changelog || ""} ${item.qaStatus || ""} ${item.approval || ""}`.toLowerCase()));
  const latestArtifact = [...projectArtifacts].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0] || null;
  const nextBuild = [...buildEntries].filter((entry) => new Date(entry.startsAt).getTime() >= Date.now()).sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime())[0] || null;
  const platformReadyCount = buildProfile.gates.filter((gate) => Boolean(latestArtifact?.metadata?.[gate.key] || platformMeta[gate.key])).length;
  const verifiedArtifacts = projectArtifacts.filter((artifact) => artifact.qaStatus === "passed");
  const approvedArtifacts = projectArtifacts.filter((artifact) => artifact.approval === "approved");
  const releaseCandidates = projectArtifacts.filter((artifact) => artifact.channel === "rc" || artifact.channel === "release");
  const activeQaSessions = qaSessions.filter((session) => session.projectId === project.id && ["planned", "running"].includes(session.status));
  const releaseStage = blockers.length ? "Blocked" : approvedArtifacts.length ? "Release ready" : activeQaSessions.length ? "In QA" : projectArtifacts.length ? "Artifact ready" : nextBuild ? "Scheduled" : "Not started";
  const shipGates = [
    {
      label: `${buildProfile.artifactLabel} attached`,
      ready: Boolean(projectArtifacts.length),
      detail: projectArtifacts.length ? `${projectArtifacts.length} file${projectArtifacts.length === 1 ? "" : "s"}` : `Add a ${buildProfile.artifactLabel.toLowerCase()}`,
    },
    {
      label: "QA handoff",
      ready: activeQaSessions.length > 0 || laneRows.some((row) => row.lane === "qa" && (row.entries || row.artifacts)),
      detail: activeQaSessions.length ? `${activeQaSessions.length} active test session${activeQaSessions.length === 1 ? "" : "s"}` : "QA lane has context",
    },
    { label: "Verified artifact", ready: verifiedArtifacts.length > 0, detail: verifiedArtifacts.length ? `${verifiedArtifacts.length} QA-passed` : "Run verification" },
    { label: "Approval", ready: approvedArtifacts.length > 0, detail: approvedArtifacts.length ? `${approvedArtifacts.length} approved` : "Approve a release artifact" },
    {
      label: "Release candidate",
      ready: laneRows.some((row) => row.lane === "rc" && (row.entries || row.artifacts)),
      detail: "RC lane has a beat or artifact",
    },
    {
      label: "Release notes",
      ready: Boolean(projectNotes.length),
      detail: projectNotes.length ? `${projectNotes.length} draft${projectNotes.length === 1 ? "" : "s"}` : "Generate draft notes",
    },
    {
      label: "Blockers clear",
      ready: blockers.length === 0,
      detail: blockers.length ? `${blockers.length} blocker${blockers.length === 1 ? "" : "s"}` : "No blockers detected",
    },
    ...buildProfile.gates.map((gate) => ({
      label: gate.label,
      ready: Boolean(latestArtifact?.metadata?.[gate.key] || platformMeta[gate.key]),
      detail: gate.detail,
    })),
  ];
  function patchMeta(key: string, value: string) {
    setPlatformMeta((prev) => ({ ...prev, [key]: value }));
  }
  async function createBuildBeat() {
    if (!canContribute) { setStatus(permissionReason); return; }
    if (!form.title.trim()) {
      setStatus("Name the build beat first.");
      return;
    }
    const title = form.title.trim();
    const metaLines = buildProfile.fields.map((field) => (platformMeta[field.id] ? `${field.label}: ${platformMeta[field.id]}` : "")).filter(Boolean);
    const createdBuild = await api<TimelineItem>("/api/timeline/items", {
      method: "POST",
      body: JSON.stringify({
        projectId: project.id,
        title,
        description: `${buildPlatformLaneLabel(buildProfile.lanes, form.lane)} · ${form.version || "No version"} · ${buildProfile.label}${metaLines.length ? ` · ${metaLines.join(" · ")}` : ""}${form.notes ? ` · ${form.notes}` : ""}`,
        startsAt: new Date(form.date || new Date()).toISOString(),
        type: form.lane === "launch" || form.lane === "rc" ? "release" : "milestone",
        color: form.lane === "launch" ? "#38bdf8" : form.lane === "rc" ? "#22c55e" : form.lane === "qa" ? "#f59e0b" : "#60a5fa",
        externalUrl: form.artifactUrl || null,
      }),
    });
    setStatus("Build beat added to this project.");
    setComposerOpen(false);
    setForm((prev) => ({
      ...prev,
      title: "",
      version: "",
      notes: "",
      artifactUrl: "",
    }));
    await loadProjectBuilds();
  }
  function saveArtifact() {
    if (!canContribute) { setStatus(permissionReason); return; }
    if (!form.title.trim()) {
      setStatus(`Name the ${buildProfile.artifactLabel.toLowerCase()} first.`);
      return;
    }
    if (!form.sourceRepositoryId || !form.sourceBranch || !form.sourceRevision) { setStatus("Select synchronized Source Control provenance before creating a build."); return; }
    const repository = sourceOptions?.repositories.find((item) => item.repositoryId === form.sourceRepositoryId);
    const commit = repository?.commits.find((item) => item.revision === form.sourceRevision);
    if (!repository || !commit) { setStatus("The selected repository/revision is no longer available. Refresh Source Control and try again."); return; }
    const now = new Date().toISOString();
    const next: BuildArtifactRecord = {
      id: localId("build"), projectId: project.id, title: form.title.trim(), version: form.version || "Unversioned", lane: form.lane, platform: form.platform,
      sourceRepositoryId: repository.repositoryId, sourceCommitId: commit.id, sourceReviewId: form.sourceReviewId || null, sourceBranch: form.sourceBranch, sourceRevision: form.sourceRevision,
      provenance: { repositoryId: repository.repositoryId, repositoryName: repository.name, repositorySlug: repository.slug || null, branch: form.sourceBranch, revision: form.sourceRevision, shortRevision: commit.shortRevision, commitId: commit.id, commitMessage: commit.message, commitUrl: commit.webUrl || null, reviewId: form.sourceReviewId || null, capturedAt: now },
      previousBuildId: null, changes: { previousBuildId: null, previousVersion: null, fromRevision: null, toRevision: form.sourceRevision, commitCount: 1, additions: 0, deletions: 0, filesChanged: 0, commits: [{ id: commit.id, revision: commit.revision, shortRevision: commit.shortRevision, message: commit.message, authorName: commit.authorName || null, committedAt: commit.committedAt || null }] },
      artifactUrl: form.artifactUrl, changelog: form.notes, qaStatus: "untested", approval: "draft", channel: form.channel, buildNumber: form.buildNumber, checksum: form.checksum, fileSize: form.fileSize,
      createdBy: form.createdBy || currentUser?.displayName || currentUser?.username || "", createdById: currentUser?.id || null, ownerId: currentUser?.id || null, reviewerIds: [], signed: form.signed, testedPlatforms: form.testedPlatforms, platformKey: buildProfile.key, metadata: { ...platformMeta },
      createdAt: now, updatedAt: now, revision: 0,
    };
    setArtifacts([next, ...artifacts].slice(0, 260));
    setStatus(`${buildProfile.artifactLabel} saved to this project.`);
    setArtifactComposerOpen(false);
    setBuildView("artifacts");
  }
  function patchArtifact(id: string, patch: Partial<BuildArtifactRecord>) {
    if (!canContribute) { setStatus(permissionReason); return; }
    setArtifacts(artifacts.map((artifact) => artifact.id === id ? { ...artifact, ...patch } : artifact));
  }
  function promoteArtifact(artifact: BuildArtifactRecord) {
    if (!canManage) { setStatus(permissionReason); return; }
    const laneIndex = buildProfile.lanes.findIndex((lane) => lane.id === artifact.lane);
    const nextLane = buildProfile.lanes[Math.min(buildProfile.lanes.length - 1, Math.max(0, laneIndex) + 1)]?.id || artifact.lane;
    patchArtifact(artifact.id, { lane: nextLane, channel: nextBuildChannel(artifact.channel), approval: "pending", promotedAt: new Date().toISOString() });
    setStatus(`${artifact.title} promoted to ${buildPlatformLaneLabel(buildProfile.lanes, nextLane)}.`);
  }
  function startArtifactQa(artifact: BuildArtifactRecord) {
    if (!canContribute) { setStatus(permissionReason); return; }
    const now = new Date().toISOString();
    const ownerId = artifact.ownerId || currentUser?.id || null;
    const ownerUser = users.find((user) => user.id === ownerId);
    const session: QASessionRecord = { id: localId("qa-session"), projectId: project.id, buildId: artifact.id, planId: null, retestOfSessionId: null, regressionBaseBuildId: artifact.previousBuildId || null, build: artifact.version, platform: artifact.platform, configuration: artifact.metadata?.configuration || "default", suite: "smoke", environment: "Production-like", scope: "smoke", owner: ownerUser?.displayName || ownerUser?.username || "", ownerId, testerIds: artifact.reviewerIds || [], status: "running", decision: "pending", passed: 0, failed: 0, blocked: 0, skipped: 0, notes: "", startedAt: now, sourceRevision: artifact.sourceRevision, sourceRepositoryId: artifact.sourceRepositoryId, sourceReviewId: artifact.sourceReviewId || null, createdAt: now, updatedAt: now, revision: 0 };
    setQaSessions([session, ...qaSessions].slice(0, 300));
    patchArtifact(artifact.id, { approval: "pending" });
    setStatus(`QA session started for ${artifact.version}.`);
  }
  async function createRebuild(artifact: BuildArtifactRecord) {
    if (!canContribute) { setStatus(permissionReason); return; }
    setStatus("Checking resolved fix work…");
    try {
      const result = await createSupersedingDeliveryRebuild({
        projectId: project.id,
        failedBuildId: artifact.id,
        creatorLabel: currentUser?.displayName || currentUser?.username || artifact.createdBy || "",
      });
      if (!result.existing) await artifactSync.refresh();
      setStatus(result.existing
        ? "A superseding rebuild already exists for this failure cycle."
        : `Rebuild created from ${artifact.version}. Update its commit and package metadata, then run QA.`);
      openClusterWorkNavigation({ screen: "project", projectId: project.id, projectTab: "builds", inspectScope: "build", inspectId: result.rebuildId });
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "The rebuild could not be created.");
    }
  }
  function generateReleaseNoteDraft() {
    if (!canContribute) { setStatus(permissionReason); return; }
    if (!latestArtifact) { setStatus("Create a source-backed build before generating release notes."); return; }
    const metaSummary = platformMetaSummary(buildProfile, latestArtifact.metadata || platformMeta);
    const draftBase = {
      title: `${project.name} ${buildProfile.label} release notes`, buildVersion: latestArtifact.version, platform: latestArtifact.platform, sourceBranch: latestArtifact.sourceBranch, sourceRevision: latestArtifact.sourceRevision, qaStatus: latestArtifact.qaStatus,
      features: [`${buildProfile.label} build update${metaSummary ? `: ${metaSummary}` : ""}`],
      fixes: blockers.length ? blockers.slice(0, 3).map((item: any) => item.title || "Resolved blocker") : ["No fixes listed yet"],
      knownIssues: blockers.length ? blockers.slice(0, 3).map((item: any) => item.title || "Open blocker") : ["No known issues listed yet"],
    };
    const now = new Date().toISOString();
    const draft: ReleaseNoteDraft = { ...draftBase, id: localId("release"), projectId: project.id, buildId: latestArtifact.id, sourceRepositoryId: latestArtifact.sourceRepositoryId, sourceReviewId: latestArtifact.sourceReviewId || null, status: "draft", body: buildReleaseNoteBody(draftBase), publishedAt: null, createdAt: now, updatedAt: now, revision: 0 };
    setReleaseNotes([draft, ...releaseNotes].slice(0, 200));
    setStatus("Release note draft created for this build.");
    setBuildView("notes");
  }
  return (
    <section className="ps-page bd">
      <ProjectSectionHeader eyebrow={`Builds · ${buildProfile.label}`} title={`${buildProfile.artifactLabel} track`} metrics={[{ label: releaseStage === "Blocked" ? "stage" : "", value: releaseStage, tone: blockers.length ? "danger" : approvedArtifacts.length ? "good" : "accent" }, { label: projectArtifacts.length === 1 ? "artifact" : "artifacts", value: projectArtifacts.length }, { label: "QA passed", value: verifiedArtifacts.length, tone: verifiedArtifacts.length ? "good" : "warning" }, { label: blockers.length === 1 ? "blocker" : "blockers", value: blockers.length, tone: blockers.length ? "danger" : "good" }]} actions={<>{onOpenQa ? <ClusterButton type="button" onClick={onOpenQa} variant="quiet" size="compact">QA</ClusterButton> : null}<ClusterButton type="button" onClick={onOpenTimeline} variant="quiet" size="compact">Roadmap</ClusterButton><ClusterButton type="button" size="compact" disabled={!canContribute} onClick={() => { setArtifactComposerOpen((open) => !open); setComposerOpen(false); }} variant="secondary">{buildProfile.artifactLabel}</ClusterButton><ClusterButton type="button" size="compact" disabled={!canContribute} onClick={() => { setComposerOpen((open) => !open); setArtifactComposerOpen(false); }} variant="primary">Build beat</ClusterButton></>} />
      <ProjectCollaborationStrip tool="build" projectId={project.id} activity={`Builds · ${buildView}`} />
      <ProjectSectionStatus tone={!canContribute ? "warning" : status.toLowerCase().includes("failed") ? "danger" : "neutral"}>{!canContribute ? permissionReason : status}</ProjectSectionStatus>
      {loadError ? <RequestErrorState error={loadError} title="Builds could not be loaded" onRetry={() => void loadProjectBuilds().catch(setLoadError)} compact /> : null}

      <ProjectBuildComposer
        open={composerOpen || artifactComposerOpen}
        artifactMode={artifactComposerOpen}
        profile={buildProfile}
        form={form}
        setForm={setForm}
        platformMeta={platformMeta}
        patchMeta={patchMeta}
        sourceOptions={sourceOptions}
        sourceLoading={sourceLoading}
        onSubmit={artifactComposerOpen ? saveArtifact : createBuildBeat}
        onCancel={() => { setComposerOpen(false); setArtifactComposerOpen(false); }}
      />

      {/* Pipeline: one step per lane, the count of artifacts in it and what's
          latest or next. This is the only lane summary on the page. */}
      <ol className="bd-pipe" aria-label={`${buildProfile.label} pipeline`}>
        {laneRows.map((row) => <li key={row.lane} data-state={row.state === "blocked" ? "blocked" : row.artifacts ? "done" : row.entries ? "active" : "empty"} title={row.hint}>
          <span className="bd-pipe__dot" aria-hidden="true" />
          <span className="bd-pipe__copy"><strong>{row.label}</strong><small>{row.next ? compactDateTime(row.next.startsAt) : row.latest ? row.latest.version : "—"}</small></span>
          {row.artifacts ? <em>{row.artifacts}</em> : null}
        </li>)}
      </ol>

      <ProjectDeliveryLifecycle projectId={project.id} canContribute={canContribute} />

      <div className="bd-views">
        <ProjectSegmentedControl label="Build views" activeId={buildView} onChange={setBuildView} items={[
          { id: "flow", label: "Overview" },
          { id: "artifacts", label: buildProfile.artifactLabel === "Artifact" ? "Artifacts" : `${buildProfile.artifactLabel}s`, count: projectArtifacts.length },
          { id: "matrix", label: "Matrix" },
          { id: "notes", label: "Notes", count: projectNotes.length },
        ]} />
        <span className="bd-profile" title={buildProfile.summary}>{buildProfile.label}</span>
      </div>

      {buildView === "flow" && (
        <div className="bd-grid">
          <ProjectSurface title={<>Ship gates <span className="bd-count">{shipGates.filter((gate) => gate.ready).length}/{shipGates.length}</span></>}>
            <ul className="bd-gates">
              {shipGates.map((gate) => <li key={gate.label} data-ready={gate.ready || undefined} title={gate.detail}>
                <ClusterIcon name={gate.ready ? "check" : "minus"} /><span>{gate.label}</span>
              </li>)}
            </ul>
          </ProjectSurface>
          <ProjectSurface title={`Recent ${buildProfile.artifactLabel === "Artifact" ? "artifacts" : `${buildProfile.artifactLabel.toLowerCase()}s`}`} action={projectArtifacts.length ? <ClusterButton type="button" onClick={() => setBuildView("artifacts")} variant="quiet" size="compact">All</ClusterButton> : undefined}>
            {projectArtifacts.length ? <ul className="bd-builds">
              {projectArtifacts.slice(0, 5).map((artifact) => <li key={artifact.id} data-qa={artifact.qaStatus}>
                <i aria-hidden="true" title={`QA ${artifact.qaStatus}`} />
                <strong>{artifact.version}</strong>
                <span>{artifact.platform}</span>
                <em>{buildPlatformLaneLabel(buildProfile.lanes, artifact.lane || "internal")}</em>
                <small>{artifact.qaStatus === "passed" ? "QA passed" : artifact.qaStatus === "failed" ? "QA failed" : artifact.qaStatus === "testing" ? "Testing" : "Untested"}</small>
              </li>)}
            </ul> : <p className="bd-empty">No {buildProfile.artifactLabel.toLowerCase()}s yet</p>}
          </ProjectSurface>
        </div>
      )}

      {buildView === "artifacts" && (
        <ProjectSurface title={`${buildProfile.artifactLabel}s`} action={<ClusterButton type="button" disabled={!canContribute} onClick={() => { setArtifactComposerOpen(true); setComposerOpen(false); }} variant="secondary" size="compact">Add</ClusterButton>}>
          <ProjectBuildArtifactWorkbench projectId={project.id} artifacts={projectArtifacts} profile={buildProfile} users={users} currentUser={currentUser || null} readOnly={!canContribute} canPromote={canManage} onPatch={patchArtifact} onPromote={promoteArtifact} onStartQa={startArtifactQa} onCreateRebuild={createRebuild} />
        </ProjectSurface>
      )}

      {buildView === "matrix" && <ProjectBuildMatrix artifacts={projectArtifacts} profile={buildProfile} />}

      {buildView === "notes" && (
        <ProjectSurface title="Release notes" action={<ClusterButton type="button" disabled={!canContribute} onClick={generateReleaseNoteDraft} variant="secondary" size="compact">Generate draft</ClusterButton>}>
          {projectNotes.length ? <ul className="bd-builds">
            {projectNotes.map((note) => <li key={note.id} data-qa={note.status === "published" ? "passed" : "untested"}>
              <ClusterButton unstyled type="button" className="bd-note" data-cluster-state={selectedRelease?.id === note.id ? "selected" : undefined} onClick={() => releaseDetailHistory.openDetail(note.id)}>
                <i aria-hidden="true" /><strong>{note.title}</strong><span>{note.buildVersion} · {note.platform}</span><em>{note.status}</em><small>{note.updatedAt ? compactDateTime(note.updatedAt) : "Draft"}</small>
              </ClusterButton>
            </li>)}
          </ul> : <p className="bd-empty">No release notes yet</p>}
        </ProjectSurface>
      )}

      <ClusterDisclosureGroup title="Build fields" className="project-tool-meta-v195 build-fields-v206">
        <CustomFieldsPanel compact entity="build" entityId={latestArtifact?.id || nextBuild?.id || `${project.id}-build-workspace`} projectId={project.id} title={latestArtifact ? `${latestArtifact.title} fields` : nextBuild ? `${nextBuild.title} fields` : "Build workspace fields"} />
      </ClusterDisclosureGroup>

      <ClusterModal open={Boolean(selectedRelease)} onClose={releaseDetailHistory.closeDetail} backdropClassName="cluster-dialog-backdrop" className="cluster-dialog release-note-inspector-v491" ariaLabel={selectedRelease ? `Release note ${selectedRelease.title}` : "Release note"}>{selectedRelease && <><div className="section-heading"><div><p className="eyebrow">Release note</p><h3>{selectedRelease.title}</h3><p className="muted tight">{selectedRelease.buildVersion} · {selectedRelease.platform} · {selectedRelease.status}</p></div><span className="soft-pill">{selectedRelease.qaStatus}</span></div><dl className="quality-detail-list-v309"><div><dt>Source revision</dt><dd>{selectedRelease.sourceRevision || "Not linked"}</dd></div><div><dt>Build</dt><dd>{selectedRelease.buildVersion} · {selectedRelease.platform}</dd></div><div><dt>Features</dt><dd>{selectedRelease.features.length}</dd></div><div><dt>Fixes</dt><dd>{selectedRelease.fixes.length}</dd></div><div><dt>Known issues</dt><dd>{selectedRelease.knownIssues.length}</dd></div><div><dt>Updated</dt><dd>{compactDateTime(selectedRelease.updatedAt)}</dd></div></dl><pre className="release-note-body-v491">{selectedRelease.body}</pre><WorkActionMenu context={{ source: { kind: "release", id: selectedRelease.id, projectId: project.id, label: selectedRelease.title }, navigation: { screen: "project", projectId: project.id, projectTab: "builds", inspectScope: "release", inspectId: selectedRelease.id }, projectId: project.id }} label={`${selectedRelease.title} work actions`} /><LinkedWorkPanel projectId={project.id} kind="release" entityId={selectedRelease.id} compact /><div className="button-row"><ClusterButton type="button" className="" onClick={releaseDetailHistory.closeDetail} variant="secondary">Close</ClusterButton></div></>}</ClusterModal>
    </section>
  );
}
