import "../styles/project-delivery.css";
import { ClusterNativeSelect } from "../../../components/ClusterNativeControls";

import { useEffect, useId, useMemo, useState } from "react";
import { api } from "../../../core/api";
import { useProjectWorkflowList } from "../../../core/project-workflow-storage";
import { useProjectDeliveryList } from "../../../core/project-delivery-storage";
import { TOOL_LEVEL_OPTIONS, TOOL_PERMISSION_OPTIONS, type ToolPermissionKey, type ToolPermissionLevel, type ToolPermissions } from "../../../core/permissions";
import { localId } from "../../../core/storage";
import { addDays, compactDateTime, toDateTimeLocalInput } from "../../../core/date-time";
import { levelLabel } from "../../../core/format";
import { LazyFeatureBoundary } from "../../../components/FeatureBoundary";
import { CollaborationPanel } from "../../../components/CollaborationPanel";
import { confirmCluster } from "../../../components/cluster-dialog-service";
import { ClusterButton } from "../../../components/ClusterButton";
import { ClusterDisclosureGroup } from "../../../components/ClusterDisclosureGroup";
import { ClusterIcon } from "../../../components/ClusterIcon";
import { ClusterTextInput } from "../../../components/ClusterTextInput";
import { ClusterTextArea } from "../../../components/ClusterTextArea";
import { useProgressiveList } from "../../../components/useProgressiveList";

import type { BoardWorkspacePageProps } from "../../boards/BoardWorkspacePage";
import type { WhiteboardWorkspacePageProps } from "../../whiteboards/WhiteboardWorkspacePage";

import { projectHasBuildSignals } from "../../projects/ProjectBuildsPanel";
import { PROJECT_STATUS_OPTIONS, importantBuildEntries, isExternalProject, normalizeProjectStatus, projectAssignedIds, collectBoardCards, projectCompleteness, projectHasDiscord, projectHasGit, projectSetupGaps, projectSourceMeta, projectStatusLabel, projectStatusMeta } from "../../projects/projects-utils";
import { SavedViewsToolbar } from "../../../components/SavedViewsToolbar";
import { useServerCustomFieldDefinitions } from "../../custom-fields/custom-field-storage";
import type { User, Project, Priority, Card, Board, TimelineItem, TimelineEntry, TimelinePayload, DetailDrawerItem, QATestPlan, CustomFieldEntity, CustomFieldType, CustomFieldAccess, StudioCustomFieldDefinition, AutomationTrigger, AutomationConditionOperator, AutomationActionType, AutomationCondition, AutomationAction, StudioAutomationRule, AutomationRunRecord, AutomationQueueRecord } from "../application-models";import { BuildArtifactRegistry, ProjectBudgetPanel, QATestPlansPanel, ReleaseNotesGenerator, normalizeTestPlan } from "../../operations/modules/operations-delivery";
import { CustomFieldValuesPanel, WorkLinkManager, WorkflowOpsPanel } from "../../operations/modules/operations-workflows";
import { DetailDrawer } from "../../operations/modules/operations-admin";
import { fromDateTimeLocalInput } from "../../operations/modules/operations-foundation";

import { RelatedRecordsPanel, VersionHistoryPanel, buildProjectLinkRows, openSharedCreate, reportLifecycleStage, LazyBoardWorkspacePage, LazyTicketSystemPageFeature, LazyWhiteboardWorkspacePage } from "./application-foundation";

import { runtimeStyle } from "../../../core/runtime-style";

export function BuildsPage({ projects }: { projects: Project[] }) {
  const buildFilterId = useId();
  const [timeline, setTimeline] = useState<TimelinePayload | null>(null);
  const [status, setStatus] = useState("Loading build ops...");
  const [projectFilter, setProjectFilter] = useState("");
  const [laneFilter, setLaneFilter] = useState("all");
  const [windowFilter, setWindowFilter] = useState("upcoming");
  const [form, setForm] = useState({
    title: "",
    projectId: projects[0]?.id || "",
    version: "",
    platform: "Windows",
    branch: "main",
    lane: "internal",
    date: toDateTimeLocalInput(addDays(new Date(), 7).toISOString()),
    notes: "",
    artifactUrl: "",
    blockers: "",
  });
  const [selectedBuildDetail, setSelectedBuildDetail] = useState<DetailDrawerItem | null>(null);
  const buildLaneOptions = [
    {
      value: "internal",
      label: "Internal build",
      type: "milestone",
      color: "#60a5fa",
      detail: "Dev drop, nightly, branch package, or team-only build.",
    },
    {
      value: "playtest",
      label: "Playtest",
      type: "milestone",
      color: "#a78bfa",
      detail: "Playable build that needs structured feedback.",
    },
    {
      value: "qa",
      label: "QA handoff",
      type: "deadline",
      color: "#f59e0b",
      detail: "Build ready for QA, regression, or verification.",
    },
    {
      value: "rc",
      label: "Release candidate",
      type: "release",
      color: "#22c55e",
      detail: "Candidate build with ship blockers tracked.",
    },
    {
      value: "launch",
      label: "Launch / publish",
      type: "release",
      color: "#38bdf8",
      detail: "Public release, upload, or deployment target.",
    },
  ];
  async function loadBuilds() {
    const start = addDays(new Date(), -30);
    const end = addDays(new Date(), 365);
    const result = await api<TimelinePayload>(`/api/timeline?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`);
    setTimeline(result);
    setStatus("");
  }
  useEffect(() => {
    loadBuilds().catch((err) => setStatus(err instanceof Error ? err.message : "Builds failed"));
  }, []);
  function buildLaneForEntry(entry: TimelineEntry) {
    const text = `${entry.type} ${entry.title} ${entry.description || ""}`.toLowerCase();
    if (/launch|publish|ship|release\s+day|go live|gold/.test(text)) return "launch";
    if (/release candidate|\brc\b|candidate|cert/.test(text)) return "rc";
    if (/qa|handoff|regression|verification|test pass/.test(text)) return "qa";
    if (/playtest|play test|beta|alpha|feedback/.test(text)) return "playtest";
    return "internal";
  }
  function buildStatusForEntry(entry: TimelineEntry) {
    const text = `${entry.title} ${entry.description || ""}`.toLowerCase();
    const startsAt = new Date(entry.startsAt).getTime();
    if (/blocked|blocker|failed|broken|reject|crash|no-go/.test(text)) return { label: "Blocked", tone: "danger" };
    if (/shipped|published|released|complete|done/.test(text)) return { label: "Shipped", tone: "good" };
    if (startsAt < Date.now() && !/shipped|published|released|complete|done/.test(text)) return { label: "Review", tone: "warning" };
    if (/qa|verify|test|review/.test(text)) return { label: "In review", tone: "warning" };
    return { label: "Planned", tone: "neutral" };
  }
  function buildVersionForEntry(entry: TimelineEntry) {
    const text = `${entry.title} ${entry.description || ""}`;
    return text.match(/v?\d+\.\d+(?:\.\d+)?(?:[-+][\w.-]+)?/i)?.[0] || "No version";
  }
  const entries = timeline?.entries || [];
  const buildRows = importantBuildEntries(entries).map((entry) => {
    const lane = buildLaneForEntry(entry);
    const statusMeta = buildStatusForEntry(entry);
    return {
      entry,
      lane,
      laneMeta: buildLaneOptions.find((option) => option.value === lane) || buildLaneOptions[0],
      statusMeta,
      version: buildVersionForEntry(entry),
      timestamp: new Date(entry.startsAt).getTime(),
    };
  });
  const filteredRows = buildRows.filter((row) => {
    if (projectFilter && row.entry.project?.id !== projectFilter) return false;
    if (laneFilter !== "all" && row.lane !== laneFilter) return false;
    if (windowFilter === "upcoming" && row.timestamp < Date.now() - 24 * 60 * 60 * 1000) return false;
    if (windowFilter === "past" && row.timestamp >= Date.now()) return false;
    return true;
  });
  const buildQueueProgress = useProgressiveList(filteredRows, {
    initial: 80,
    step: 80,
    resetKey: `${projectFilter}|${laneFilter}|${windowFilter}`,
  });
  const attentionRows = buildRows.filter((row) => row.statusMeta.tone === "danger" || row.statusMeta.label === "Review").slice(0, 4);
  const laneCounts = buildLaneOptions.map((lane) => ({
    ...lane,
    count: buildRows.filter((row) => row.lane === lane.value).length,
    attention: buildRows.filter((row) => row.lane === lane.value && row.statusMeta.tone !== "neutral" && row.statusMeta.tone !== "good").length,
  }));
  const flowStages = buildLaneOptions.map((lane, index) => {
    const rows = buildRows.filter((row) => row.lane === lane.value);
    const upcoming = rows.filter((row) => row.timestamp >= Date.now()).sort((a, b) => a.timestamp - b.timestamp)[0] || null;
    const blocked = rows.filter((row) => row.statusMeta.tone === "danger").length;
    const review = rows.filter((row) => row.statusMeta.tone === "warning").length;
    const shipped = rows.filter((row) => row.statusMeta.tone === "good").length;
    const state = blocked ? "blocked" : review ? "review" : rows.length ? "active" : "empty";
    return { ...lane, index, rows, upcoming, blocked, review, shipped, state };
  });
  const buildTimelineRows = [...filteredRows].sort((a, b) => a.timestamp - b.timestamp).slice(0, 10);
  const buildGateRows = [
    {
      label: "Playtest ready",
      requirement: "Internal build exists before playtest",
      passed: buildRows.some((row) => row.lane === "internal") && buildRows.some((row) => row.lane === "playtest"),
      detail: "Internal → Playtest",
    },
    {
      label: "QA handoff",
      requirement: "QA lane has a handoff and no blocker text",
      passed: buildRows.some((row) => row.lane === "qa") && !buildRows.some((row) => row.lane === "qa" && row.statusMeta.tone === "danger"),
      detail: "Playtest → QA",
    },
    {
      label: "Release candidate",
      requirement: "RC exists after QA context",
      passed: buildRows.some((row) => row.lane === "qa") && buildRows.some((row) => row.lane === "rc"),
      detail: "QA → RC",
    },
    {
      label: "Launch gate",
      requirement: "Launch target exists and blockers are clear",
      passed: buildRows.some((row) => row.lane === "launch") && !buildRows.some((row) => row.lane === "launch" && row.statusMeta.tone === "danger"),
      detail: "RC → Launch",
    },
    {
      label: "Release notes",
      requirement: "Build items include notes/changelog/artifact context",
      passed: buildRows.some((row) => /notes:|changelog|artifact:/i.test(row.entry.description || "")),
      detail: "Docs attached",
    },
  ];
  const releaseCount = buildRows.filter((row) => ["rc", "launch"].includes(row.lane)).length;
  const qaCount = buildRows.filter((row) => row.lane === "qa").length;
  const blockedCount = buildRows.filter((row) => row.statusMeta.tone === "danger").length;
  const nextBuild = [...buildRows].filter((row) => row.timestamp >= Date.now()).sort((a, b) => a.timestamp - b.timestamp)[0] || null;
  const projectRows = projects
    .map((project) => {
      const rows = buildRows.filter((row) => row.entry.project?.id === project.id);
      const next = rows.filter((row) => row.timestamp >= Date.now()).sort((a, b) => a.timestamp - b.timestamp)[0] || null;
      return {
        project,
        rows,
        next,
        blocked: rows.filter((row) => row.statusMeta.tone === "danger").length,
      };
    })
    .filter((row) => row.rows.length || !projectFilter);
  async function createBuild() {
    const lane = buildLaneOptions.find((option) => option.value === form.lane) || buildLaneOptions[0];
    const titleBase = form.title.trim() || lane.label;
    const title = [titleBase, form.version.trim()].filter(Boolean).join(" · ");
    const description = [`Lane: ${lane.label}`, form.platform.trim() ? `Platform: ${form.platform.trim()}` : "", form.branch.trim() ? `Branch: ${form.branch.trim()}` : "", form.artifactUrl.trim() ? `Artifact: ${form.artifactUrl.trim()}` : "", form.blockers.trim() ? `Blockers: ${form.blockers.trim()}` : "", form.notes.trim() ? `Notes: ${form.notes.trim()}` : ""].filter(Boolean).join("\n");
    await api<TimelineItem>("/api/timeline/items", {
      method: "POST",
      body: JSON.stringify({
        title,
        description,
        startsAt: fromDateTimeLocalInput(form.date),
        endsAt: null,
        projectId: form.projectId || null,
        type: lane.type,
        color: lane.color,
        externalUrl: form.artifactUrl.trim() || null,
      }),
    });
    setForm((prev) => ({
      ...prev,
      title: "",
      version: "",
      notes: "",
      artifactUrl: "",
      blockers: "",
    }));
    setStatus(`${lane.label} added to the build queue.`);
    await loadBuilds();
  }
  return (
    <section className="page builds-page-v072 builds-page-v115 builds-page-v156">
      <div className="page-header panel ops-hero-v072 builds-hero-v115">
        <div>
          <p className="eyebrow">Builds</p>
          <h1>Build operations</h1>
          <div className="ops-hero-meta-v072 builds-kpi-strip-v156">
            <span>{buildRows.length} builds</span>
            <span>{releaseCount} release</span>
            <span>{qaCount} QA</span>
            <span>{blockedCount} blocked</span>
          </div>
        </div>
        <div className="build-hero-actions-v115">
          <span className="soft-pill">Next: {nextBuild ? `${nextBuild.entry.title} · ${compactDateTime(nextBuild.entry.startsAt)}` : "No build scheduled"}</span>
          <ClusterButton type="button" className="" onClick={loadBuilds} variant="secondary">
            Refresh
          </ClusterButton>
        </div>
        <div className="builds-filter-bar-v156">
          <div className="field compact">
            <label htmlFor={`${buildFilterId}-project`}>Project</label>
            <ClusterNativeSelect id={`${buildFilterId}-project`} value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
              <option value="">All projects</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </ClusterNativeSelect>
          </div>
          <div className="field compact">
            <label htmlFor={`${buildFilterId}-lane`}>Lane</label>
            <ClusterNativeSelect id={`${buildFilterId}-lane`} value={laneFilter} onChange={(event) => setLaneFilter(event.target.value)}>
              <option value="all">All lanes</option>
              {buildLaneOptions.map((lane) => (
                <option key={lane.value} value={lane.value}>
                  {lane.label}
                </option>
              ))}
            </ClusterNativeSelect>
          </div>
          <div className="field compact">
            <label htmlFor={`${buildFilterId}-window`}>Window</label>
            <ClusterNativeSelect id={`${buildFilterId}-window`} value={windowFilter} onChange={(event) => setWindowFilter(event.target.value)}>
              <option value="upcoming">Upcoming</option>
              <option value="all">All</option>
              <option value="past">Past</option>
            </ClusterNativeSelect>
          </div>
        </div>
      </div>

      {attentionRows.length > 0 && (
        <div className="needs-attention-bar-v0103 builds-attention-v115">
          <strong>Builds need attention</strong>
          <span>{attentionRows.map((row) => row.entry.title).join(" · ")}</span>
        </div>
      )}

      {/* The visible Builds filter bar above is the single owner of these three filters.
          The old expandable duplicate was hidden by application-overrides.css and was
          never reachable; keep the filter state and release-flow controls in one place. */}

      <SavedViewsToolbar
        scope="builds"
        label="Build filters"
        current={{ projectFilter, laneFilter, windowFilter }}
        onApply={(values) => {
          setProjectFilter(values.projectFilter || "");
          setLaneFilter(values.laneFilter || "all");
          setWindowFilter(values.windowFilter || "upcoming");
        }}
        summary="Save QA, release-candidate, launch, and project-specific build views so leads stop rebuilding filters like it is a personality trait."
      />

      <section className="panel build-flow-map-v119">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Flow map</p>
            <h2>Build pipeline</h2>
          </div>
          <span className="soft-pill">
            {flowStages.filter((stage) => stage.rows.length).length}/{flowStages.length} active lanes
          </span>
        </div>
        <div className="build-flow-track-v119">
          {flowStages.map((stage) => (
            <ClusterButton type="button" key={stage.value} className={`build-flow-node-v119 ${stage.value} ${stage.state} ${laneFilter === stage.value ? "selected" : ""}`} onClick={() => setLaneFilter(stage.value)}>
              <span className="build-flow-index-v119">{stage.index + 1}</span>
              <strong>{stage.label}</strong>
              <em>{stage.upcoming ? compactDateTime(stage.upcoming.entry.startsAt) : "No date"}</em>
              <b>{stage.rows.length}</b>
              <small>{stage.blocked ? `${stage.blocked} blocked` : stage.review ? `${stage.review} review` : stage.shipped ? `${stage.shipped} shipped` : stage.rows.length ? "active" : "empty"}</small>
            </ClusterButton>
          ))}
        </div>
      </section>

      <section className="panel build-gates-panel-v120">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Approval gates</p>
            <h2>Release readiness checks</h2>
          </div>
          <span className="soft-pill">
            {buildGateRows.filter((gate) => gate.passed).length}/{buildGateRows.length} passed
          </span>
        </div>
        <div className="build-gates-grid-v120">
          {buildGateRows.map((gate) => (
            <div key={gate.label} className={gate.passed ? "passed" : "blocked"}>
              <span>{gate.detail}</span>
              <strong>{gate.label}</strong>
              <em>{gate.requirement}</em>
              <b>{gate.passed ? "Passed" : "Needs work"}</b>
            </div>
          ))}
        </div>
      </section>

      <div className="builds-layout-v115">
        <details className="panel build-composer-v115 build-composer-v156">
          <summary>
            <div>
              <p className="eyebrow">Create</p>
              <h2>Build item</h2>
            </div>
            <span className="soft-pill">Add build</span>
          </summary>
          <div className="build-lane-picker-v115">
            {buildLaneOptions.map((lane) => (
              <ClusterButton type="button" key={lane.value} className={form.lane === lane.value ? "active" : ""} onClick={() => setForm((prev) => ({ ...prev, lane: lane.value }))}>
                <strong>{lane.label}</strong>
                <span>{lane.detail}</span>
              </ClusterButton>
            ))}
          </div>
          <div className="time-form-grid clean-form-grid builds-form-grid-v115">
            <div className="field">
              <label>Title</label>
              <ClusterTextInput value={form.title} onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))} placeholder="Nightly drop, QA build, RC1..." />
            </div>
            <div className="field">
              <label>Version</label>
              <ClusterTextInput value={form.version} onChange={(event) => setForm((prev) => ({ ...prev, version: event.target.value }))} placeholder="v0.3.1" />
            </div>
            <div className="field">
              <label>Project</label>
              <ClusterNativeSelect
                value={form.projectId}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    projectId: event.target.value,
                  }))
                }
              >
                <option value="">Studio-wide</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </ClusterNativeSelect>
            </div>
            <div className="field">
              <label>Target date</label>
              <ClusterTextInput type="datetime-local" value={form.date} onChange={(event) => setForm((prev) => ({ ...prev, date: event.target.value }))} />
            </div>
            <div className="field">
              <label>Platform</label>
              <ClusterTextInput value={form.platform} onChange={(event) => setForm((prev) => ({ ...prev, platform: event.target.value }))} placeholder="Windows, Steam, Itch, Android..." />
            </div>
            <div className="field">
              <label>Branch / stream</label>
              <ClusterTextInput value={form.branch} onChange={(event) => setForm((prev) => ({ ...prev, branch: event.target.value }))} placeholder="main, release, qa..." />
            </div>
            <div className="field full">
              <label>Artifact / upload URL</label>
              <ClusterTextInput
                value={form.artifactUrl}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    artifactUrl: event.target.value,
                  }))
                }
                placeholder="Build folder, installer, CI artifact, store page..."
              />
            </div>
            <div className="field full">
              <label>Blockers</label>
              <ClusterTextArea value={form.blockers} onChange={(event) => setForm((prev) => ({ ...prev, blockers: event.target.value }))} placeholder="Crash on map load, missing cert, upload failed..." />
            </div>
            <div className="field full">
              <label>Notes / changelog</label>
              <ClusterTextArea value={form.notes} onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))} placeholder="Fixes, test scope, known issues, QA instructions..." />
            </div>
            <ClusterButton type="button" className="" onClick={createBuild} variant="primary">
              Add to build queue
            </ClusterButton>
          </div>
        </details>

        <div className="builds-main-stack-v116">
          <section className="panel build-lanes-panel-v115">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Pipeline</p>
                <h2>Release lanes</h2>
              </div>
              <span className="soft-pill">{buildRows.length} items</span>
            </div>
            <div className="build-lane-grid-v115">
              {laneCounts.map((lane) => (
                <ClusterButton type="button" key={lane.value} className={`build-lane-card-v115 ${lane.value} ${laneFilter === lane.value ? "active" : ""}`} onClick={() => setLaneFilter(lane.value)}>
                  <span>{lane.label}</span>
                  <strong>{lane.count}</strong>
                  <em>{lane.attention ? `${lane.attention} need review` : "clean"}</em>
                </ClusterButton>
              ))}
            </div>
          </section>

          <section className="panel build-queue-panel-v115">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Queue</p>
                <h2>Build queue</h2>
              </div>
              <span className="soft-pill">{filteredRows.length}</span>
            </div>
            <div className="build-queue-list-v115">
              {filteredRows.length ? (
                buildQueueProgress.visibleItems.map((row) => (
                  <article
                    className={`build-queue-row-v115 ${row.statusMeta.tone}`}
                    key={`${row.entry.source}-${row.entry.id}`}
                  >
                    <div className="build-row-main-v115">
                      <span className={`build-lane-pill-v115 ${row.lane}`}>{row.laneMeta.label}</span>
                      <strong>{row.entry.title}</strong>
                      <p>{row.entry.description || "No build notes yet."}</p>
                    </div>
                    <div className="build-row-side-v115">
                      <b>{row.version}</b>
                      <span>{row.entry.project?.name || "Studio"}</span>
                      <em>{compactDateTime(row.entry.startsAt)}</em>
                      <span className={`build-status-pill-v115 ${row.statusMeta.tone}`}>{row.statusMeta.label}</span>
                      <ClusterButton type="button" className="build-row-details-v393" onClick={() =>
                      setSelectedBuildDetail({
                        kind: "Build",
                        title: row.entry.title,
                        subtitle: `${row.laneMeta.label} · ${row.version}`,
                        description: row.entry.description || "No build notes yet.",
                        fields: [
                          {
                            label: "Project",
                            value: row.entry.project?.name || "Studio",
                          },
                          { label: "Status", value: row.statusMeta.label },
                          {
                            label: "Date",
                            value: compactDateTime(row.entry.startsAt),
                          },
                          {
                            label: "Artifact",
                            value: row.entry.externalUrl ? (
                              <a href={row.entry.externalUrl} target="_blank">
                                Open artifact
                              </a>
                            ) : (
                              "Not linked"
                            ),
                          },
                        ],
                        actions: [
                          {
                            label: "Filter lane",
                            onClick: () => setLaneFilter(row.lane),
                          },
                        ],
                      })
                    } variant="quiet" size="compact">Details</ClusterButton>
                    </div>
                  </article>
                ))
              ) : (
                <div className="empty-state compact">No build items match these filters.</div>
              )}
              {buildQueueProgress.hasMore ? <div className="build-queue-load-more-v495"><ClusterButton size="compact" variant="quiet" onClick={buildQueueProgress.showMore}>Show {Math.min(80, buildQueueProgress.remaining)} more · {buildQueueProgress.remaining} remaining</ClusterButton></div> : null}
            </div>
          </section>

          <section className="panel build-timeline-panel-v119">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Timeline</p>
                <h2>Build handoff schedule</h2>
                <p className="muted tight">Date-ordered build beats with lane and status context.</p>
              </div>
              <span className="soft-pill">{buildTimelineRows.length}</span>
            </div>
            <div className="build-timeline-list-v119">
              {buildTimelineRows.length ? (
                buildTimelineRows.map((row) => (
                  <article key={`${row.entry.source}-${row.entry.id}`} className={`build-timeline-row-v119 ${row.statusMeta.tone}`}>
                    <span className={`build-lane-pill-v115 ${row.lane}`}>{row.laneMeta.label}</span>
                    <div>
                      <strong>{row.entry.title}</strong>
                      <em>
                        {row.entry.project?.name || "Studio"} · {row.version}
                      </em>
                    </div>
                    <time>{compactDateTime(row.entry.startsAt)}</time>
                    <b>{row.statusMeta.label}</b>
                  </article>
                ))
              ) : (
                <div className="empty-state compact">No build dates in this filter.</div>
              )}
            </div>
          </section>

          <section className="panel build-projects-panel-v115">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Coverage</p>
                <h2>Project build coverage</h2>
              </div>
            </div>
            <div className="build-project-table-v115">
              {projectRows.map(({ project, rows, next, blocked }) => (
                <ClusterButton type="button" key={project.id} onClick={() => setProjectFilter(project.id)}>
                  <strong>{project.name}</strong>
                  <span>{rows.length ? `${rows.length} build item${rows.length === 1 ? "" : "s"}` : "No build items"}</span>
                  <em>{next ? `Next ${compactDateTime(next.entry.startsAt)}` : "No upcoming build"}</em>
                  <b>{blocked ? `${blocked} blocked` : "OK"}</b>
                </ClusterButton>
              ))}
            </div>
          </section>
        </div>
      </div>
      <WorkflowOpsPanel projects={projects} timelineEntries={entries} compact />
      <BuildArtifactRegistry projects={projects} rows={buildRows} />
      <ReleaseNotesGenerator projects={projects} buildRows={buildRows} />
      <div className="builds-systems-grid-v121">
        <CollaborationPanel scope="builds" title="Build comments and handoff notes" />
      </div>
      <DetailDrawer item={selectedBuildDetail} onClose={() => setSelectedBuildDetail(null)} />

      {status && <div className="status-box system-status-box-v053">{status}</div>}
    </section>
  );
}

export function QAPage({ projects, onOpenBoard }: { projects: Project[]; onOpenBoard: (boardId: string) => void }) {
  const qaFilterId = useId();
  const [boards, setBoards] = useState<Board[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [projectId, setProjectId] = useState(projects[0]?.id || "");
  const [boardId, setBoardId] = useState("");
  const [listId, setListId] = useState("");
  const [form, setForm] = useState({
    title: "",
    severity: "high" as Priority,
    platform: "Windows",
    build: "",
    steps: "",
    expected: "",
    actual: "",
  });
  const [status, setStatus] = useState("Loading QA...");
  const [showCreate, setShowCreate] = useState(false);
  const [showAdvancedCreate, setShowAdvancedCreate] = useState(false);
  const [severityFilter, setSeverityFilter] = useState<"all" | Priority>("all");
  const [queueFilter, setQueueFilter] = useState<"open" | "high" | "needs-repro" | "resolved" | "all">("open");
  const [query, setQuery] = useState("");
  async function loadQaBoards() {
    const boardIds = projects.flatMap((project) => project.boards.map((board) => board.id)).slice(0, 30);
    const loaded = await Promise.all(boardIds.map((id) => api<Board>(`/api/boards/${id}`).catch(() => null)));
    const clean = loaded.filter(Boolean) as Board[];
    setBoards(clean);
    const firstBoard = clean.find((board) => !projectId || board.project.id === projectId) || clean[0];
    if (firstBoard && !boardId) {
      setBoardId(firstBoard.id);
      setListId(firstBoard.lists[0]?.id || "");
    }
    setStatus(`Loaded ${clean.length} board${clean.length === 1 ? "" : "s"}.`);
  }
  useEffect(() => {
    loadQaBoards().catch((err) => setStatus(err instanceof Error ? err.message : "QA failed"));
  }, [projects.length]);
  const visibleBoards = boards.filter((board) => !projectId || board.project.id === projectId);
  const selectedBoard = boards.find((board) => board.id === boardId) || visibleBoards[0];
  const qaCards = boards
    .flatMap((board) =>
      board.lists.flatMap((list) =>
        list.cards.map((card) => ({
          ...card,
          boardName: board.name,
          projectName: board.project.name,
          projectId: board.project.id,
          listTitle: list.title,
          listIsDone: Boolean(list.isDone),
          boardId: board.id,
        })),
      ),
    )
    .filter((card) => card.labels.some((label) => /bug|qa|test|crash|regression/i.test(label)) || /bug|crash|qa|test|fix|broken|regression|repro/i.test(`${card.title} ${card.description || ""}`));
  const urgent = qaCards.filter((card) => card.priority === "urgent" || card.priority === "high");
  const resolved = qaCards.filter((card) => /done|closed|complete|resolved|shipped/i.test(card.listTitle));
  const open = qaCards.filter((card) => !/done|closed|complete|resolved|shipped/i.test(card.listTitle));
  const needsRepro = open.filter((card) => /not provided|needs repro|repro needed/i.test(card.description || "") || !card.description?.trim());
  const selectedProjectName = projectId ? projects.find((project) => project.id === projectId)?.name || "Selected project" : "All projects";
  const severityCounts = (["urgent", "high", "medium", "low"] as Priority[]).map((priority) => ({
    priority,
    count: qaCards.filter((card) => card.priority === priority).length,
  }));
  const platformCounts = Array.from(new Set(qaCards.flatMap((card) => card.labels.filter((label) => !/bug|qa|test|ticket|report/i.test(label)).slice(0, 2))))
    .slice(0, 5)
    .map((label) => ({
      label,
      count: qaCards.filter((card) => card.labels.includes(label)).length,
    }));
  const projectCounts = projects
    .map((project) => ({
      project,
      count: qaCards.filter((card) => card.projectId === project.id).length,
      high: urgent.filter((card) => card.projectId === project.id).length,
    }))
    .filter((row) => row.count > 0)
    .sort((a, b) => b.high - a.high || b.count - a.count)
    .slice(0, 8);
  const filteredQaCards = qaCards.filter((card) => {
    const searchable = `${card.title} ${card.description || ""} ${card.projectName} ${card.boardName} ${card.listTitle} ${card.labels.join(" ")}`.toLowerCase();
    const matchesQuery = !query.trim() || searchable.includes(query.trim().toLowerCase());
    const matchesProject = !projectId || card.projectId === projectId;
    const matchesSeverity = severityFilter === "all" || card.priority === severityFilter;
    const matchesQueue = queueFilter === "all" || (queueFilter === "open" && open.some((item) => item.id === card.id)) || (queueFilter === "high" && urgent.some((item) => item.id === card.id)) || (queueFilter === "needs-repro" && needsRepro.some((item) => item.id === card.id)) || (queueFilter === "resolved" && resolved.some((item) => item.id === card.id));
    return matchesQuery && matchesProject && matchesSeverity && matchesQueue;
  });
  async function createBug() {
    const targetList = listId || selectedBoard?.lists[0]?.id;
    if (!targetList || !form.title.trim()) {
      setStatus("Pick a target list and title.");
      return;
    }
    const description = `Build: ${form.build || "Unknown"}\nPlatform: ${form.platform}\n\nSteps to reproduce:\n${form.steps || "Not provided"}\n\nExpected:\n${form.expected || "Not provided"}\n\nActual:\n${form.actual || "Not provided"}`;
    await api<Card>("/api/cards", {
      method: "POST",
      body: JSON.stringify({
        listId: targetList,
        title: form.title.trim(),
        description,
        priority: form.severity,
        labels: ["bug", "qa", form.platform].filter(Boolean),
        dueDate: null,
        assigneeId: null,
      }),
    });
    setForm({
      title: "",
      severity: "high",
      platform: form.platform,
      build: form.build,
      steps: "",
      expected: "",
      actual: "",
    });
    setShowCreate(false);
    setShowAdvancedCreate(false);
    setStatus("Bug report created.");
    await loadQaBoards();
  }
  return (
    <section className="page qa-page-v072 qa-page-v085">
      <div className="page-header panel ops-hero-v072 qa-hero-v085">
        <div>
          <p className="eyebrow">QA</p>
          <h1>Quality assurance</h1>
          <p className="muted">Log bugs, review high-risk issues, and keep test work connected to the boards that own the fixes.</p>
          <div className="ops-hero-meta-v072">
            <span>{qaCards.length} QA cards</span>
            <span>{urgent.length} high risk</span>
            <span>{open.length} open</span>
            <span>{needsRepro.length} need repro</span>
          </div>
        </div>
        <div className="button-row qa-hero-actions-v085">
          <ClusterButton type="button" className="" onClick={loadQaBoards} variant="secondary">
            Refresh
          </ClusterButton>
          <ClusterButton type="button" className="" onClick={() => setShowCreate((open) => !open)} variant="primary">
            {showCreate ? "Close report" : "New QA report"}
          </ClusterButton>
        </div>
      </div>

      <div className="qa-kpi-grid-v085">
        <ClusterButton type="button" className={queueFilter === "open" ? "active" : ""} onClick={() => setQueueFilter("open")}>
          <span>Open</span>
          <strong>{open.length}</strong>
          <em>Needs action</em>
        </ClusterButton>
        <ClusterButton type="button" className={queueFilter === "high" ? "active danger" : "danger"} onClick={() => setQueueFilter("high")}>
          <span>High risk</span>
          <strong>{urgent.length}</strong>
          <em>High / urgent</em>
        </ClusterButton>
        <ClusterButton type="button" className={queueFilter === "needs-repro" ? "active warning" : "warning"} onClick={() => setQueueFilter("needs-repro")}>
          <span>Needs repro</span>
          <strong>{needsRepro.length}</strong>
          <em>Missing steps</em>
        </ClusterButton>
        <ClusterButton type="button" className={queueFilter === "resolved" ? "active good" : "good"} onClick={() => setQueueFilter("resolved")}>
          <span>Resolved</span>
          <strong>{resolved.length}</strong>
          <em>Closed lists</em>
        </ClusterButton>
      </div>

      {showCreate && (
        <section className="panel qa-create-panel-v085">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Report</p>
              <h2>New QA issue</h2>
              <p className="muted tight">Keep this short, reproducible, and tied to the right board. The board card can hold follow-up once it exists.</p>
            </div>
          </div>
          <div className="qa-create-grid-v085">
            <div className="field qa-title-field-v085">
              <label>Bug title</label>
              <ClusterTextInput value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} placeholder="Crash when opening inventory" />
            </div>
            <div className="field">
              <label>Severity</label>
              <ClusterNativeSelect
                value={form.severity}
                onChange={(e) =>
                  setForm((p) => ({
                    ...p,
                    severity: e.target.value as Priority,
                  }))
                }
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </ClusterNativeSelect>
            </div>
            <div className="field">
              <label>Project</label>
              <ClusterNativeSelect
                value={projectId}
                onChange={(e) => {
                  setProjectId(e.target.value);
                  setBoardId("");
                  setListId("");
                }}
              >
                <option value="">All projects</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </ClusterNativeSelect>
            </div>
            <div className="field">
              <label>Board</label>
              <ClusterNativeSelect
                value={boardId}
                onChange={(e) => {
                  setBoardId(e.target.value);
                  const next = boards.find((board) => board.id === e.target.value);
                  setListId(next?.lists[0]?.id || "");
                }}
              >
                {visibleBoards.map((board) => (
                  <option key={board.id} value={board.id}>
                    {board.project.name} / {board.name}
                  </option>
                ))}
              </ClusterNativeSelect>
            </div>
            <div className="field">
              <label>List</label>
              <ClusterNativeSelect value={listId} onChange={(e) => setListId(e.target.value)}>
                {(selectedBoard?.lists || []).map((list) => (
                  <option key={list.id} value={list.id}>
                    {list.title}
                  </option>
                ))}
              </ClusterNativeSelect>
            </div>
            <div className="field">
              <label>Platform</label>
              <ClusterTextInput value={form.platform} onChange={(e) => setForm((p) => ({ ...p, platform: e.target.value }))} />
            </div>
            <div className="field">
              <label>Build version</label>
              <ClusterTextInput value={form.build} onChange={(e) => setForm((p) => ({ ...p, build: e.target.value }))} placeholder="v0.3.1" />
            </div>
            <div className="field qa-textarea-field-v085">
              <label>Steps to reproduce</label>
              <ClusterTextArea value={form.steps} onChange={(e) => setForm((p) => ({ ...p, steps: e.target.value }))} placeholder="1. Open inventory\n2. Equip item\n3. Observe crash" />
            </div>
            <div className="field">
              <label>Expected</label>
              <ClusterTextArea value={form.expected} onChange={(e) => setForm((p) => ({ ...p, expected: e.target.value }))} />
            </div>
            <div className="field">
              <label>Actual</label>
              <ClusterTextArea value={form.actual} onChange={(e) => setForm((p) => ({ ...p, actual: e.target.value }))} />
            </div>
          </div>
          <div className="button-row">
            <ClusterButton type="button" className="" disabled={!form.title.trim()} onClick={createBug} variant="primary">
              Create QA card
            </ClusterButton>
            <ClusterButton type="button" className="" onClick={() => setShowCreate(false)} variant="secondary">
              Cancel
            </ClusterButton>
          </div>
        </section>
      )}

      <ClusterDisclosureGroup className="panel qa-control-panel-v085 filter-menu-v0102 qa-filter-panel-v118" defaultOpen
        title="QA filters" summary={`${filteredQaCards.length} matching`}>
        <div className="qa-filter-grid-v085 filter-menu-content-v0102 qa-filter-grid-v118">
          <div className="field">
            <label htmlFor={`${qaFilterId}-search`}>Search QA</label>
            <ClusterTextInput  id={`${qaFilterId}-search`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Crash, platform, build, project..." />
          </div>
          <div className="field">
            <label htmlFor={`${qaFilterId}-project`}>Project</label>
            <ClusterNativeSelect id={`${qaFilterId}-project`} 
              value={projectId}
              onChange={(e) => {
                setProjectId(e.target.value);
                setBoardId("");
                setListId("");
              }}
            >
              <option value="">All projects</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </ClusterNativeSelect>
          </div>
          <div className="field">
            <label htmlFor={`${qaFilterId}-queue`}>Queue</label>
            <ClusterNativeSelect id={`${qaFilterId}-queue`}  value={queueFilter} onChange={(e) => setQueueFilter(e.target.value as typeof queueFilter)}>
              <option value="open">Open</option>
              <option value="high">High risk</option>
              <option value="needs-repro">Needs repro</option>
              <option value="resolved">Resolved</option>
              <option value="all">All</option>
            </ClusterNativeSelect>
          </div>
          <div className="field">
            <label htmlFor={`${qaFilterId}-severity`}>Severity</label>
            <ClusterNativeSelect id={`${qaFilterId}-severity`}  value={severityFilter} onChange={(e) => setSeverityFilter(e.target.value as typeof severityFilter)}>
              <option value="all">All severities</option>
              <option value="urgent">Urgent</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </ClusterNativeSelect>
          </div>
          <div className="qa-filter-actions-v118">
            <ClusterButton type="button" className={severityFilter === "all" ? "active" : ""} onClick={() => setSeverityFilter("all")}>
              <span>All severities</span>
              <strong>{qaCards.length}</strong>
            </ClusterButton>
            {severityCounts.map((row) => (
              <ClusterButton type="button" key={row.priority} className={severityFilter === row.priority ? "active" : ""} onClick={() => setSeverityFilter(row.priority)}>
                <span>{row.priority}</span>
                <strong>{row.count}</strong>
              </ClusterButton>
            ))}
          </div>
        </div>
      </ClusterDisclosureGroup>

      <QATestPlansPanel projects={projects} qaCards={qaCards} />

      <div className="qa-workspace-grid-v085">
        <section className="panel qa-queue-panel-v085">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Queue</p>
              <h2>{selectedProjectName}</h2>
              <p className="muted tight">
                {filteredQaCards.length} matching QA item
                {filteredQaCards.length === 1 ? "" : "s"}
              </p>
            </div>
            <span className="soft-pill">{queueFilter}</span>
          </div>
          <div className="qa-card-list-v085">
            {filteredQaCards.length ? (
              filteredQaCards.slice(0, 32).map((card) => (
                <ClusterButton type="button" className={`qa-card-row-v085 priority-${card.priority}`} key={card.id} onClick={() => onOpenBoard(card.boardId)}>
                  <div className="qa-card-title-v085">
                    <strong>{card.title}</strong>
                    <span>
                      {card.projectName} · {card.boardName} · {card.listTitle}
                    </span>
                  </div>
                  <div className="qa-card-meta-v085">
                    <em>{card.priority}</em>
                    <span>{card.labels.slice(0, 3).join(", ") || "qa"}</span>
                  </div>
                </ClusterButton>
              ))
            ) : (
              <div className="empty-state-v085">
                <strong>No QA items found.</strong>
                <span>Try another filter or create a new QA report.</span>
              </div>
            )}
          </div>
        </section>
        <aside className="qa-side-panel-v085 qa-side-panel-v118">
          <section className="panel qa-breakdown-card-v085">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Coverage</p>
                <h2>Projects</h2>
              </div>
            </div>
            <div className="qa-project-list-v085">
              {projectCounts.length ? (
                projectCounts.map((row) => (
                  <ClusterButton type="button" key={row.project.id} onClick={() => setProjectId(row.project.id)} className={projectId === row.project.id ? "active" : ""}>
                    <span>{row.project.name}</span>
                    <strong>{row.count}</strong>
                    <em>{row.high} risk</em>
                  </ClusterButton>
                ))
              ) : (
                <p className="muted">No project QA data yet.</p>
              )}
            </div>
          </section>
          <section className="panel qa-breakdown-card-v085">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Platforms</p>
                <h2>Labels</h2>
              </div>
            </div>
            <div className="qa-platform-tags-v085">
              {platformCounts.length ? (
                platformCounts.map((row) => (
                  <span key={row.label}>
                    {row.label}
                    <em>{row.count}</em>
                  </span>
                ))
              ) : (
                <p className="muted">Platform labels show after reports are created.</p>
              )}
            </div>
          </section>
        </aside>
      </div>
      {status && <div className="status-box system-status-box-v053">{status}</div>}
    </section>
  );
}

export function QAFoldedIntoProjectsPage({ projects, onOpenProject }: { projects: Project[]; onOpenProject: (projectId: string) => void }) {
  const projectIds = useMemo(() => projects.map((project) => project.id), [projects]);
  const [serverPlans, , planSync] = useProjectDeliveryList<QATestPlan>("qa-plan", projectIds);
  const plans = serverPlans.map(normalizeTestPlan);
  return (
    <section className="page qa-folded-page-v158">
      <div className="page-header panel ops-hero-v072 qa-hero-v085 qa-folded-hero-v158">
        <div>
          <p className="eyebrow">QA moved</p>
          <h1>QA lives inside Projects</h1>
          <p className="muted">Open a project and use its QA tab for test plans, bug reports, runs, and release checks.</p>
        </div>
      </div>
      {planSync.error && <div className="status-box error">{planSync.error}</div>}
      <div className="qa-project-launcher-v158">
        {projects.length ? (
          projects.map((project) => {
            const projectPlans = plans.filter((plan) => plan.projectId === project.id);
            const blockers = projectPlans.filter((plan) => ["failed", "blocked"].includes(plan.status)).length;
            return (
              <ClusterButton type="button" key={project.id} onClick={() => onOpenProject(project.id)} className={blockers ? "has-blockers" : ""}>
                <strong>{project.name}</strong>
                <span>
                  {projectPlans.length} plans · {blockers} blockers
                </span>
                <em>Open project QA</em>
              </ClusterButton>
            );
          })
        ) : (
          <div className="empty-state panel">
            <h2>No visible projects</h2>
            <p>Create or restore a project before planning QA.</p>
          </div>
        )}
      </div>
    </section>
  );
}

export function timelineSourceLabel(source?: string | null) {
  if (source === "calendar") return "Calendar";
  if (source === "card") return "Due date";
  if (source === "schedule") return "Schedule";
  if (source === "time") return "Scheduler";
  return "Manual";
}

export function StatusPage({ projects, onOpenProject, onOpenTickets, onOpenQa, onOpenTime, embedded = false }: { projects: Project[]; onOpenProject: (projectId: string) => void; onOpenTickets: () => void; onOpenQa: () => void; onOpenTime: () => void; embedded?: boolean }) {
  const [boards, setBoards] = useState<Board[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [timeline, setTimeline] = useState<TimelinePayload | null>(null);
  const [status, setStatus] = useState("Loading status...");
  async function loadReports() {
    const boardIds = projects.flatMap((project) => project.boards.map((board) => board.id)).slice(0, 45);
    const loaded = await Promise.all(boardIds.map((id) => api<Board>(`/api/boards/${id}`).catch(() => null)));
    const clean = loaded.filter(Boolean) as Board[];
    setBoards(clean);
    const timelineStart = new Date();
    const timelineEnd = addDays(timelineStart, 180);
    const timelineResult = await api<TimelinePayload>(`/api/timeline?start=${encodeURIComponent(timelineStart.toISOString())}&end=${encodeURIComponent(timelineEnd.toISOString())}`).catch(() => null);
    setTimeline(timelineResult);
    setStatus(`Loaded ${clean.length} board${clean.length === 1 ? "" : "s"} and refreshed studio status.`);
  }
  useEffect(() => {
    loadReports().catch((err) => setStatus(err instanceof Error ? err.message : "Status failed"));
  }, [projects.length]);
  const cards = collectBoardCards(boards);
  const openCards = cards.filter((card) => !/done|closed|complete|approved|shipped/i.test(card.listTitle));
  const urgentCards = cards.filter((card) => ["urgent", "high"].includes(card.priority));
  const dueSoonCards = cards.filter((card) => card.dueDate && new Date(card.dueDate).getTime() < Date.now() + 1000 * 60 * 60 * 24 * 7);
  const tickets = cards.filter((card) => card.labels.some((label) => /ticket|request|support|access|review/i.test(label)) || /ticket|request|support|access|review/i.test(`${card.title} ${card.description || ""}`));
  const qaCards = cards.filter((card) => card.labels.some((label) => /bug|qa|test/i.test(label)) || /bug|crash|qa|test|fix|broken/i.test(`${card.title} ${card.description || ""}`));
  const activeProjects = projects.filter((project) => !project!.archived && normalizeProjectStatus(project.status) === "active");
  const pausedProjects = projects.filter((project) => !project!.archived && ["on_hold", "paused"].includes(normalizeProjectStatus(project.status)));
  const externalProjects = projects.filter(isExternalProject);
  const archivedCount = projects.filter((project) => project.archived).length;
  const unassignedProjects = projects.filter((project) => isExternalProject(project) && !projectAssignedIds(project).length);
  const noBoardProjects = projects.filter((project) => !project.boards.length);
  const noWhiteboardProjects = projects.filter((project) => !(project.whiteboards?.length || 0));
  const libraryLinkedProjects = projects.filter((project) => project.libraryItems?.some((item) => item.type === "folder"));
  const integrationProjects = projects.filter((project) => projectHasGit(project) || projectHasDiscord(project) || isExternalProject(project));
  const timelineEntries = timeline?.entries || [];
  const upcomingRoadmap = timelineEntries.filter((entry) => new Date(entry.startsAt).getTime() >= Date.now()).sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime());
  const sourceCounts = timelineEntries.reduce<Record<string, number>>((acc, entry) => ({ ...acc, [entry.source]: (acc[entry.source] || 0) + 1 }), {});
  const linkRows = buildProjectLinkRows(projects, cards, timelineEntries);
  const statusCounts = PROJECT_STATUS_OPTIONS.map((option) => ({
    ...option,
    count: projects.filter((project) => !project!.archived && normalizeProjectStatus(project.status) === option.value).length,
  }));
  const projectRows = projects
    .map((project) => {
      const projectCards = cards.filter((card) => card.projectId === project.id);
      const open = projectCards.filter((card) => !/done|closed|complete|approved|shipped/i.test(card.listTitle)).length;
      const urgent = projectCards.filter((card) => ["urgent", "high"].includes(card.priority)).length;
      const next = upcomingRoadmap.find((entry) => entry.project?.id === project.id) || null;
      const readiness = projectCompleteness(project);
      const setup = projectSetupGaps(project);
      return {
        project,
        cards: projectCards.length,
        open,
        urgent,
        next,
        readiness,
        setup,
      };
    })
    .sort((a, b) => b.open - a.open || b.urgent - a.urgent || a.project.name.localeCompare(b.project.name));
  const readinessAverage = projectRows.length ? Math.round(projectRows.reduce((total, row) => total + row.readiness, 0) / projectRows.length) : 0;
  const actionItems = dueSoonCards.length + unassignedProjects.length + noBoardProjects.length + noWhiteboardProjects.length;
  const setupRows = [
    {
      label: "External owners",
      value: projects.filter((project) => !isExternalProject(project) || projectAssignedIds(project).length).length,
      total: projects.length,
      note: `${unassignedProjects.length} external missing`,
    },
    {
      label: "Task boards",
      value: projects.length - noBoardProjects.length,
      total: projects.length,
      note: `${noBoardProjects.length} missing`,
    },
    {
      label: "Whiteboards",
      value: projects.length - noWhiteboardProjects.length,
      total: projects.length,
      note: `${noWhiteboardProjects.length} missing`,
    },
    {
      label: "Library folders",
      value: libraryLinkedProjects.length,
      total: projects.length,
      note: `${libraryLinkedProjects.length} linked`,
    },
    {
      label: "Connections",
      value: integrationProjects.length,
      total: projects.length,
      note: `${externalProjects.length} external`,
    },
  ];
  function exportReport() {
    const payload = {
      generatedAt: new Date().toISOString(),
      projectCount: projects.length,
      activeProjects: activeProjects.length,
      pausedProjects: pausedProjects.length,
      externalProjects: externalProjects.length,
      archivedCount,
      openCards: openCards.length,
      urgentCards: urgentCards.length,
      dueSoonCards: dueSoonCards.length,
      tickets: tickets.length,
      qaCards: qaCards.length,
      readinessAverage,
      actionItems,
      projects: projectRows.map((row) => ({
        id: row.project.id,
        name: row.project.name,
        status: projectStatusLabel(row.project),
        source: projectSourceMeta(row.project).label,
        readiness: row.readiness,
        open: row.open,
        urgent: row.urgent,
        setup: row.setup,
        nextRoadmapItem: row.next?.title || null,
      })),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `cluster-status-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }
  const attentionRows = [
    {
      label: "Due soon",
      count: dueSoonCards.length,
      detail: "cards due inside 7 days",
      action: onOpenTickets,
    },
    {
      label: "Missing external owners",
      count: unassignedProjects.length,
      detail: "external projects without an owner",
      action: () => (unassignedProjects[0] || projects[0]) && onOpenProject((unassignedProjects[0] || projects[0]).id),
    },
    {
      label: "No board",
      count: noBoardProjects.length,
      detail: "projects without task boards",
      action: () => projects[0] && onOpenProject(projects[0].id),
    },
    {
      label: "No whiteboard",
      count: noWhiteboardProjects.length,
      detail: "projects missing whiteboards",
      action: () => projects[0] && onOpenProject(projects[0].id),
    },
  ];
  const liveRows = [
    {
      label: "Active projects",
      count: activeProjects.length,
      detail: `${pausedProjects.length} paused / waiting`,
    },
    {
      label: "Open cards",
      count: openCards.length,
      detail: `${urgentCards.length} high or urgent`,
    },
    {
      label: "Tickets",
      count: tickets.length,
      detail: `${qaCards.length} QA-linked items`,
    },
    {
      label: "External",
      count: externalProjects.length,
      detail: "partner/client tracked",
    },
  ];
  return (
    <section className={`page status-page-v078 reports-page-v077 ops-page-v077 status-page-v0113 ${embedded ? "status-embedded-v128" : ""}`}>
      <div className="page-header panel status-command-hero-v113">
        <div>
          <p className="eyebrow">{embedded ? "Activity / Status" : "Status"}</p>
          <h1>Studio command board</h1>
          <p className="muted">Current actions, live work, scheduled items, and project setup coverage.</p>
          <div className="ops-hero-meta-v072">
            <span>{projects.length} projects</span>
            <span>{openCards.length} open cards</span>
            <span>{upcomingRoadmap.length} roadmap items</span>
            <span>{readinessAverage}% ready</span>
          </div>
        </div>
        <div className="status-command-actions-v113">
          <ClusterButton type="button" className="" onClick={loadReports} variant="secondary">
            Refresh
          </ClusterButton>
          <ClusterButton type="button" className="" onClick={exportReport} variant="primary">
            Export JSON
          </ClusterButton>
        </div>
      </div>

      <div className="status-command-strip-v113">
        {liveRows.map((row) => (
          <div className="panel status-command-tile-v113" key={row.label}>
            <span>{row.label}</span>
            <strong>{row.count}</strong>
            <em>{row.detail}</em>
          </div>
        ))}
      </div>

      <div className="status-command-grid-v113">
        <section className="panel status-command-panel-v113 status-attention-panel-v113">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Action</p>
              <h2>Needs attention</h2>
              <p className="muted tight">Direct cleanup items derived from current project and workflow signals.</p>
            </div>
            <span className="soft-pill">{actionItems}</span>
          </div>
          <div className="status-attention-list-v113">
            {attentionRows.map((row) => (
              <ClusterButton type="button" key={row.label} onClick={row.action}>
                <strong>{row.label}</strong>
                <span>{row.detail}</span>
                <em>{row.count}</em>
              </ClusterButton>
            ))}
          </div>
          {!actionItems && <div className="empty-state compact">No obvious setup/action issues.</div>}
        </section>

        <section className="panel status-command-panel-v113">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Setup</p>
              <h2>Coverage checklist</h2>
            </div>
          </div>
          <div className="status-setup-list-v0112 status-setup-list-v113">
            {setupRows.map((row) => {
              const pct = row.total ? Math.round((row.value / row.total) * 100) : 0;
              return (
                <div className="status-setup-row-v0112" key={row.label}>
                  <div>
                    <strong>{row.label}</strong>
                    <span>{row.note}</span>
                  </div>
                  <div className="completion-meter">
                    <span style={runtimeStyle({ width: `${pct}%` })} />
                  </div>
                  <em>{pct}%</em>
                </div>
              );
            })}
          </div>
        </section>

        <section className="panel status-command-panel-v113 status-wide-v113">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Roadmap</p>
              <h2>Next scheduled work</h2>
            </div>
            <span className="soft-pill">{timelineEntries.length} total</span>
          </div>
          <div className="status-roadmap-list-v0112 status-roadmap-list-v113">
            {upcomingRoadmap.slice(0, 8).map((entry) => (
              <ClusterButton type="button" key={`${entry.source}-${entry.id}`} onClick={() => entry.project?.id && onOpenProject(entry.project.id)}>
                <strong>{entry.title}</strong>
                <span>
                  {entry.project?.name || "Studio"} · {timelineSourceLabel(entry.source)}
                </span>
                <em>{compactDateTime(entry.startsAt)}</em>
              </ClusterButton>
            ))}
            {!upcomingRoadmap.length && <p className="muted">No upcoming roadmap items.</p>}
          </div>
          <div className="status-source-row-v0112">
            {[
              { source: "manual", label: "Manual" },
              { source: "calendar", label: "Calendar" },
              { source: "card", label: "Due dates" },
              { source: "schedule", label: "Schedule" },
              { source: "time", label: "Scheduler" },
            ].map((row) => (
              <span key={row.source}>
                {row.label}: <strong>{sourceCounts[row.source] || 0}</strong>
              </span>
            ))}
          </div>
        </section>

        <section className="panel status-command-panel-v113 status-wide-v113 work-link-map-panel-v120">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Links</p>
              <h2>Work item linking map</h2>
              <p className="muted tight">Shows whether projects connect their boards, whiteboards, Library folders, Tickets, and roadmap items.</p>
            </div>
            <span className="soft-pill">
              {linkRows.filter((row) => row.linkedScore >= 3).length}/{projects.length || 0} connected
            </span>
          </div>
          <div className="work-link-map-v120">
            {linkRows.slice(0, 10).map((row) => (
              <ClusterButton type="button" key={row.project.id} onClick={() => onOpenProject(row.project.id)}>
                <strong>{row.project.name}</strong>
                <span>
                  Boards <b>{row.boards}</b>
                </span>
                <span>
                  Whiteboards <b>{row.whiteboards}</b>
                </span>
                <span>
                  Library <b>{row.files}</b>
                </span>
                <span>
                  Reports <b>{row.reports}</b>
                </span>
                <span>
                  Roadmap <b>{row.roadmap}</b>
                </span>
                <em>{row.linkedScore >= 3 ? "linked" : "needs links"}</em>
              </ClusterButton>
            ))}
          </div>
        </section>

        <section className="panel status-command-panel-v113 status-wide-v113">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Directory</p>
              <h2>Project operating table</h2>
              <p className="muted tight">Status, source, open work, readiness, and next date in one row.</p>
            </div>
            <span className="soft-pill">{projectRows.length}</span>
          </div>
          <div className="status-project-table-v0112 status-project-table-v113">
            {projectRows.length ? (
              projectRows.map((row) => {
                const source = projectSourceMeta(row.project);
                return (
                  <ClusterButton type="button" key={row.project.id} onClick={() => onOpenProject(row.project.id)}>
                    <strong>{row.project.name}</strong>
                    <span className={`project-status-pill-v077 ${projectStatusMeta(row.project).tone}`}>{projectStatusLabel(row.project)}</span>
                    <span className={`project-source-pill-v0112 ${source.tone}`}>
                      <ClusterIcon name={source.icon} /> {source.label}
                    </span>
                    <span>{row.open} open</span>
                    <span>{row.readiness}% ready</span>
                    <em>{row.next ? compactDateTime(row.next.startsAt) : "No date"}</em>
                  </ClusterButton>
                );
              })
            ) : (
              <p className="muted">No project status data yet.</p>
            )}
          </div>
        </section>
      </div>

      <div className="status-systems-grid-v121">
        <WorkLinkManager projects={projects} />
      </div>
      <ProjectBudgetPanel projects={projects} />

      {status && <div className="status-box system-status-box-v053">{status}</div>}
    </section>
  );
}
