import { ClusterTextInput } from "../../components/ClusterTextInput";
import { useCallback, useMemo, useState } from "react";
import type { BuildArtifactRecord, BuildPlatformProfile, User } from "../application/application-models";
import { artifactDisplayVersion, artifactReadinessScore, artifactRisk, BUILD_CHANNELS } from "./project-quality-models";
import { buildPlatformLaneLabel, platformMetaSummary } from "./project-build-domain";
import { runtimeStyle } from "../../core/runtime-style";
import { levelLabel } from "../../core/format";
import { ClusterMasterDetail, useClusterDetailHistory } from "../../components/ClusterMasterDetail";
import { ClusterButton, ClusterLinkButton } from "../../components/ClusterButton";
import { ClusterSelect } from "../../components/ClusterSelect";
import { ClusterCombobox } from "../../components/ClusterCombobox";
import { ClusterSegmentedControl } from "../../components/ClusterSegmentedControl";
import { ClusterCountBadge, ClusterHealthIndicator } from "../../components/ClusterStatusPrimitives";
import { CollaborationPanel } from "../../components/CollaborationPanel";
import { SharedWorkWatchControl } from "../../components/SharedWorkWatchControl";
import { SharedWorkEvidencePanel } from "../../components/SharedWorkEvidencePanel";
import { SharedWorkActivityPanel } from "../../components/SharedWorkActivityPanel";
import { PeopleMultiPicker, PeoplePicker } from "../people/PeoplePicker";
import { openContextualCreate } from "../create/shared-create-handoff";
import { LinkedWorkPanel } from "../workflow/LinkedWorkPanel";
import { WorkActionMenu } from "../workflow/WorkActionMenu";
import { ProjectDeliveryRiskPanel } from "./ProjectDeliveryRiskPanel";

import { ClusterIcon } from "../../components/ClusterIcon";
import { useServerState } from "../../core/server-state";
import { ClusterInput } from "../../components/ClusterNativeControls";

const QA_OPTIONS = [
  { value: "all", label: "Any QA" },
  { value: "untested", label: "Untested" },
  { value: "testing", label: "Testing" },
  { value: "passed", label: "Passed" },
  { value: "failed", label: "Failed" },
];

const APPROVAL_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "pending", label: "Pending" },
  { value: "approved", label: "Approved" },
  { value: "blocked", label: "Blocked" },
];

type Props = {
  projectId: string;
  artifacts: BuildArtifactRecord[];
  profile: BuildPlatformProfile;
  users?: User[];
  currentUser?: User | null;
  readOnly?: boolean;
  canPromote?: boolean;
  onPatch: (id: string, patch: Partial<BuildArtifactRecord>) => void;
  onPromote: (artifact: BuildArtifactRecord) => void;
  onStartQa: (artifact: BuildArtifactRecord) => void;
  onCreateRebuild: (artifact: BuildArtifactRecord) => void | Promise<void>;
};

export function ProjectBuildArtifactWorkbench({ projectId, artifacts, profile, users = [], currentUser = null, readOnly = false, canPromote = false, onPatch, onPromote, onStartQa, onCreateRebuild }: Props) {
  const [query, setQuery] = useState("");
  const [lane, setLane] = useState("all");
  const [channel, setChannel] = useState("all");
  const [qa, setQa] = useState("all");
  const [selectedId, setSelectedId] = useState("");
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [density, setDensity] = useServerState<"compact" | "comfortable">("user", "project.quality-density", "comfortable", { merge: (value, fallback) => value === "compact" || value === "comfortable" ? value : fallback });
  const rows = useMemo(() => artifacts.filter((artifact) => {
    const text = `${artifact.title} ${artifact.version} ${artifact.platform} ${artifact.provenance.repositoryName} ${artifact.sourceBranch} ${artifact.sourceRevision} ${artifact.provenance.reviewTitle || ""} ${artifact.checksum} ${artifact.createdBy}`.toLowerCase();
    return (!query || text.includes(query.toLowerCase()))
      && (lane === "all" || artifact.lane === lane)
      && (channel === "all" || (artifact.channel || "internal") === channel)
      && (qa === "all" || artifact.qaStatus === qa);
  }).sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()), [artifacts, query, lane, channel, qa]);
  const selected = artifacts.find((item) => item.id === selectedId) || null;
  const compared = compareIds.map((id) => artifacts.find((item) => item.id === id)).filter(Boolean) as BuildArtifactRecord[];
  const restoreArtifactDetail = useCallback((id: string | null) => setSelectedId(id || ""), []);
  const artifactDetailHistory = useClusterDetailHistory("build-artifact", selectedId || null, restoreArtifactDetail);
  function toggleCompare(id: string) { setCompareIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current.slice(-1), id]); }
  function scheduleReview(artifact: BuildArtifactRecord) {
    const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
    start.setHours(14, 0, 0, 0);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    openContextualCreate("calendar", {
      projectId,
      title: `${artifact.title} ${artifactDisplayVersion(artifact)} review`,
      details: `Build review for ${artifact.platform}. QA: ${artifact.qaStatus}. Approval: ${artifact.approval}.`,
      assigneeId: artifact.ownerId || currentUser?.id || "",
      attendeeIds: artifact.reviewerIds || [],
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      calendarType: "review",
      source: { kind: "build", id: artifact.id, projectId, label: artifact.title },
      relationship: "scheduled_by",
    });
  }
  function createFollowup(artifact: BuildArtifactRecord) {
    openContextualCreate("ticket", {
      projectId,
      title: `Follow up: ${artifact.title} ${artifactDisplayVersion(artifact)}`,
      details: `Build: ${artifactDisplayVersion(artifact)}\nPlatform: ${artifact.platform}\nQA: ${artifact.qaStatus}\nApproval: ${artifact.approval}\n\n${artifact.changelog || "Add follow-up details."}`,
      assigneeId: artifact.ownerId || currentUser?.id || "",
      priority: artifact.qaStatus === "failed" || artifact.approval === "blocked" ? "urgent" : "medium",
      labels: ["build", artifact.platform, artifact.qaStatus].filter(Boolean),
      source: { kind: "build", id: artifact.id, projectId, label: artifact.title },
      relationship: "tracks",
    });
  }
  return <div className={`build-artifact-workbench-v309 density-${density}`}>
    <div className="quality-toolbar-v309">
      <ClusterTextInput type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search artifacts" aria-label="Search build artifacts" />
      <ClusterCombobox value={lane} onChange={setLane} ariaLabel="Filter artifacts by lane" searchPlaceholder="Search build lanes" options={[{ value: "all", label: "All lanes" }, ...profile.lanes.map((item) => ({ value: item.id, label: item.label }))]} />
      <ClusterSelect value={channel} onChange={setChannel} ariaLabel="Filter artifacts by channel" options={[{ value: "all", label: "All channels" }, ...BUILD_CHANNELS.map((item) => ({ value: item.id, label: item.label }))]} />
      <ClusterSelect value={qa} onChange={setQa} ariaLabel="Filter artifacts by QA status" options={QA_OPTIONS} />
      </div>
    <ClusterSegmentedControl value={density} onChange={setDensity} label="Build artifact density" options={[{ value: "compact", label: "Compact" }, { value: "comfortable", label: "Comfortable" }]} />
    <ClusterMasterDetail
      className="build-workbench-grid-v309"
      label="Build artifacts and inspector"
      masterLabel="Build artifacts"
      detailLabel="Build artifact inspector"
      detailOpen={Boolean(selected)}
      onCloseDetail={artifactDetailHistory.closeDetail}
      detailSize="wide"
      persistKey="build-artifacts"
      master={<div className={`build-artifact-list-v309 ${density === "compact" ? "compact-record-list-v159" : ""}`.trim()}>{rows.length ? rows.map((artifact) => {
        const risk = artifactRisk(artifact);
        return <ClusterButton unstyled type="button" key={artifact.id} className={`${selected?.id === artifact.id ? "active " : ""}${density === "compact" ? "compact-record-button-v491" : ""}`.trim()} onClick={() => artifactDetailHistory.openDetail(artifact.id)}><span><strong>{artifact.pinned ? <ClusterIcon name="star-filled" /> : null}{artifact.title}</strong>{density === "comfortable" ? <em>{artifactDisplayVersion(artifact)} · {artifact.platform}</em> : null}</span><span><ClusterHealthIndicator tone={risk.tone}>{risk.label}</ClusterHealthIndicator><ClusterCountBadge count={artifactReadinessScore(artifact)} label={`${artifact.title} readiness percentage`} max={100} /></span></ClusterButton>;
      }) : <p className="muted">No artifacts match these filters.</p>}</div>}
      detail={selected ? <aside className="build-artifact-inspector-v309">
        <div className="section-heading"><div><p className="eyebrow">{selected.channel || "internal"} · {buildPlatformLaneLabel(profile.lanes, selected.lane)}</p><h3>{selected.title}</h3><p className="muted tight">{artifactDisplayVersion(selected)} · {selected.platform}</p></div><div className="button-row"><WorkActionMenu context={{ source: { kind: "build", id: selected.id, projectId, label: selected.title }, navigation: { screen: "project", projectId, projectTab: "builds", inspectScope: "build-artifact", inspectId: selected.id }, projectId, assigneeId: selected.ownerId || null, attendeeIds: selected.reviewerIds || [] }} label={`${selected.title} work actions`} allowAssign allowMention onAssign={() => document.querySelector<HTMLElement>('[aria-label="Owner"]')?.focus()} /><ClusterButton size="compact" variant="quiet" disabled={readOnly} onClick={() => onPatch(selected.id, { pinned: !selected.pinned })}>{selected.pinned ? "Unpin" : "Pin"}</ClusterButton></div></div>
        <div className="quality-score-v309"><strong>{artifactReadinessScore(selected)}%</strong><span>artifact metadata completeness, not release authorization</span></div>
        <ProjectDeliveryRiskPanel projectId={projectId} kind="build" entityId={selected.id} />
        <div className="quality-field-grid-v309">
          <div className="field"><label>QA</label><strong className={`soft-pill qa-${selected.qaStatus}`}>{levelLabel(selected.qaStatus)}</strong><small className="muted">Derived from first-class QA sessions.</small></div>
          <label>Approval{canPromote ? <ClusterSelect disabled={readOnly} value={selected.approval} onChange={(value) => onPatch(selected.id, { approval: value as BuildArtifactRecord["approval"] })} ariaLabel="Build approval status" options={APPROVAL_OPTIONS} /> : <span className="soft-pill">{levelLabel(selected.approval)}</span>}</label>
          <label className="check-row-v309"><ClusterInput type="checkbox" disabled={readOnly} checked={Boolean(selected.signed)} onChange={(event) => onPatch(selected.id, { signed: event.target.checked })} /> Signed package</label>
        </div>
        <div className="quality-field-grid-v309">
          <PeoplePicker label="Owner" value={selected.ownerId || ""} onChange={(ownerId) => onPatch(selected.id, { ownerId: ownerId || null })} people={users} disabled={readOnly} />
          <PeopleMultiPicker label="Reviewers" values={selected.reviewerIds || []} onChange={(reviewerIds) => onPatch(selected.id, { reviewerIds })} people={users} disabled={readOnly} />
        </div>
        <dl className="quality-detail-list-v309"><div><dt>Repository</dt><dd>{selected.provenance.repositoryName}</dd></div><div><dt>Source</dt><dd>{selected.sourceBranch} · {selected.provenance.shortRevision || selected.sourceRevision.slice(0, 12)}</dd></div><div><dt>Review</dt><dd>{selected.provenance.reviewTitle || "Direct synchronized revision"}</dd></div><div><dt>Changes</dt><dd>{selected.changes.commitCount} commits · +{selected.changes.additions} / −{selected.changes.deletions} · {selected.changes.filesChanged} files</dd></div><div><dt>Previous build</dt><dd>{selected.changes.previousVersion || "First captured build"}</dd></div><div><dt>Checksum</dt><dd>{selected.checksum || "Missing"}</dd></div><div><dt>Size / creator</dt><dd>{selected.fileSize || "Unknown"} · {selected.createdBy || "Unassigned"}</dd></div><div><dt>Tested</dt><dd>{selected.testedPlatforms?.join(", ") || "No platforms recorded"}</dd></div><div><dt>Platform metadata</dt><dd>{platformMetaSummary(profile, selected.metadata) || "None"}</dd></div></dl>{selected.changes.commits.length ? <section className="panel flat-panel-v159"><h4>Changes since previous Build</h4><div className="compact-record-list-v159">{selected.changes.commits.slice(0, 12).map((commit) => <div key={commit.id} className="compact-record-row-v159"><strong>{commit.shortRevision}</strong><span>{commit.message}</span></div>)}</div></section> : null}
        <div className="button-row">
          <ClusterButton size="compact" disabled={readOnly} onClick={() => onStartQa(selected)}>Start QA</ClusterButton>
          <ClusterButton size="compact" variant="primary" disabled={!canPromote} onClick={() => onPromote(selected)}>Promote</ClusterButton>
          <ClusterButton size="compact" disabled={readOnly} onClick={() => scheduleReview(selected)}>Schedule review</ClusterButton>
          {selected.approval === "draft" ? <ClusterButton size="compact" variant="secondary" disabled={readOnly} onClick={() => onPatch(selected.id, { approval: "pending" })}>Request approval</ClusterButton> : null}{(selected.qaStatus === "failed" || selected.approval === "blocked") ? <ClusterButton size="compact" variant="primary" disabled={readOnly} onClick={() => void onCreateRebuild(selected)}>Create rebuild</ClusterButton> : null}
          <ClusterButton size="compact" disabled={readOnly} onClick={() => createFollowup(selected)}>Create follow-up</ClusterButton>
          {selected.artifactUrl && <ClusterLinkButton className="" href={selected.artifactUrl} target="_blank" rel="noreferrer" variant="secondary" size="compact">Open artifact</ClusterLinkButton>}
          <ClusterButton size="compact" onClick={() => toggleCompare(selected.id)}>{compareIds.includes(selected.id) ? "Remove compare" : "Compare"}</ClusterButton>
        </div>
        <LinkedWorkPanel projectId={projectId} kind="build" entityId={selected.id} compact />
        <SharedWorkEvidencePanel projectId={projectId} kind="build" entityId={selected.id} label={selected.title || selected.version || "Build"} compact />
        <SharedWorkWatchControl entity={{ kind: "build", id: selected.id, projectId, label: selected.title || selected.version || "Build" }} compact />
        <SharedWorkActivityPanel entity={{ kind: "build", id: selected.id, projectId, label: selected.title || selected.version || "Build" }} compact />
        <CollaborationPanel title="Build discussion" entityType="build" entityId={selected.id} users={users} currentUser={currentUser} compact />
      </aside> : <div className="empty-state compact-empty">Select an artifact to inspect release readiness.</div>}
    />
    {compared.length === 2 && <section className="build-comparison-v309"><div className="section-heading"><div><h3>Artifact comparison</h3><p className="muted tight">Release metadata side by side.</p></div><ClusterButton variant="quiet" size="compact" onClick={() => setCompareIds([])}>Clear</ClusterButton></div><div className="build-comparison-grid-v309">{compared.map((artifact) => <article key={artifact.id}><strong>{artifact.title}</strong><span>{artifactDisplayVersion(artifact)}</span><span>{artifact.channel || "internal"} · {artifact.platform}</span><span>QA {artifact.qaStatus} · {artifact.approval}</span><span>{artifact.signed ? "Signed" : "Unsigned"} · {artifact.checksum ? "Checksum recorded" : "No checksum"}</span></article>)}</div></section>}
  </div>;
}

export function ProjectBuildMatrix({ artifacts, profile }: { artifacts: BuildArtifactRecord[]; profile: BuildPlatformProfile }) {
  const latest = new Map<string, BuildArtifactRecord>();
  for (const artifact of [...artifacts].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())) {
    const key = `${artifact.platform}:${artifact.channel || "internal"}`;
    if (!latest.has(key)) latest.set(key, artifact);
  }
  return <section className="panel flat-panel-v159"><div className="section-heading"><div><h3>Release matrix</h3><p className="muted tight">Latest package by platform and promotion channel.</p></div></div><div className="build-matrix-grid-v309"><strong>Platform</strong>{BUILD_CHANNELS.map((item) => <strong key={item.id}>{item.label}</strong>)}{profile.platforms.map((platform) => <div key={platform} style={runtimeStyle({ display: "contents" })}><b>{platform}</b>{BUILD_CHANNELS.map((channel) => { const artifact = latest.get(`${platform}:${channel.id}`); return <span key={channel.id} className={artifact ? `qa-${artifact.qaStatus}` : "empty"}>{artifact ? artifactDisplayVersion(artifact) : "—"}</span>; })}</div>)}</div></section>;
}
