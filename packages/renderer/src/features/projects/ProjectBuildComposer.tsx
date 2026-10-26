import { ClusterNativeSelect, ClusterInput } from "../../components/ClusterNativeControls";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterTextArea } from "../../components/ClusterTextArea";
import { ClusterButton } from "../../components/ClusterButton";
import type { Dispatch, SetStateAction } from "react";
import type { BuildArtifactRecord, BuildPlatformProfile } from "../application/application-models";

export type ProjectBuildSourceOptions = {
  repositories: Array<{
    bindingId: string;
    repositoryId: string;
    name: string;
    slug?: string | null;
    defaultBranch: string;
    isPrimary: boolean;
    branches: Array<{ id: string; name: string; headRevision?: string | null; isDefault: boolean; lastCommitAt?: string | null }>;
    commits: Array<{ id: string; revision: string; shortRevision: string; message: string; authorName?: string | null; committedAt?: string | null; webUrl?: string | null; branchNames?: string[] }>;
    reviews: Array<{ id: string; title: string; sourceBranch: string; targetBranch: string; sourceRevision: string; mergedRevision?: string | null; status: string; eligibilityState: string; updatedAt: string }>;
  }>;
};

export interface ProjectBuildComposerForm {
  title: string;
  lane: string;
  version: string;
  platform: string;
  sourceRepositoryId: string;
  sourceBranch: string;
  sourceRevision: string;
  sourceReviewId: string;
  artifactUrl: string;
  date: string;
  notes: string;
  channel: NonNullable<BuildArtifactRecord["channel"]>;
  buildNumber: string;
  checksum: string;
  fileSize: string;
  createdBy: string;
  signed: boolean;
  testedPlatforms: string[];
}

export function ProjectBuildComposer({
  open,
  artifactMode,
  profile,
  form,
  setForm,
  platformMeta,
  patchMeta,
  sourceOptions,
  sourceLoading = false,
  onSubmit,
  onCancel,
}: {
  open: boolean;
  artifactMode: boolean;
  profile: BuildPlatformProfile;
  form: ProjectBuildComposerForm;
  setForm: Dispatch<SetStateAction<ProjectBuildComposerForm>>;
  platformMeta: Record<string, string>;
  patchMeta: (key: string, value: string) => void;
  sourceOptions?: ProjectBuildSourceOptions | null;
  sourceLoading?: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  const repositories = sourceOptions?.repositories || [];
  const repository = repositories.find((item) => item.repositoryId === form.sourceRepositoryId) || repositories[0] || null;
  const branch = repository?.branches.find((item) => item.name === form.sourceBranch) || repository?.branches.find((item) => item.isDefault) || repository?.branches[0] || null;
  const commitsForBranch = repository?.commits.filter((commit) => !commit.branchNames?.length || commit.branchNames.includes(form.sourceBranch)) || [];
  const commits = commitsForBranch.length ? commitsForBranch : repository?.commits || [];
  const reviews = repository?.reviews || [];

  function selectRepository(repositoryId: string) {
    const next = repositories.find((item) => item.repositoryId === repositoryId);
    const nextBranch = next?.branches.find((item) => item.name === next.defaultBranch) || next?.branches.find((item) => item.isDefault) || next?.branches[0];
    const nextRevision = next?.commits.find((item) => item.revision === nextBranch?.headRevision)?.revision || nextBranch?.headRevision || next?.commits[0]?.revision || "";
    setForm((current) => ({ ...current, sourceRepositoryId: repositoryId, sourceBranch: nextBranch?.name || next?.defaultBranch || "main", sourceRevision: nextRevision, sourceReviewId: "" }));
  }

  function selectBranch(sourceBranch: string) {
    const nextBranch = repository?.branches.find((item) => item.name === sourceBranch);
    const nextRevision = repository?.commits.find((item) => item.revision === nextBranch?.headRevision)?.revision || nextBranch?.headRevision || repository?.commits.find((item) => item.branchNames?.includes(sourceBranch))?.revision || "";
    setForm((current) => ({ ...current, sourceBranch, sourceRevision: nextRevision, sourceReviewId: "" }));
  }

  function selectReview(sourceReviewId: string) {
    const review = reviews.find((item) => item.id === sourceReviewId);
    if (!review) { setForm((current) => ({ ...current, sourceReviewId: "" })); return; }
    const revision = review.mergedRevision || review.sourceRevision;
    const sourceBranch = review.mergedRevision ? review.targetBranch : review.sourceBranch;
    setForm((current) => ({ ...current, sourceReviewId, sourceBranch, sourceRevision: revision }));
  }

  return (
    <div className="project-inline-composer-v159 platform-build-composer-v160">
      <div className="field span-2">
        <label>Title</label>
        <ClusterTextInput value={form.title} onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))} placeholder={artifactMode ? profile.artifactLabel : "QA handoff, RC1, publish upload..."} />
      </div>
      <div className="field">
        <label>Lane</label>
        <ClusterNativeSelect value={form.lane} onChange={(event) => setForm((prev) => ({ ...prev, lane: event.target.value }))}>
          {profile.lanes.map((lane) => <option key={lane.id} value={lane.id}>{lane.label}</option>)}
        </ClusterNativeSelect>
      </div>
      <div className="field">
        <label>{profile.versionLabel}</label>
        <ClusterTextInput value={form.version} onChange={(event) => setForm((prev) => ({ ...prev, version: event.target.value }))} placeholder="0.4.2" />
      </div>
      <div className="field">
        <label>Output / platform</label>
        <ClusterNativeSelect value={form.platform} onChange={(event) => setForm((prev) => ({ ...prev, platform: event.target.value }))}>
          {profile.platforms.map((platform) => <option key={platform} value={platform}>{platform}</option>)}
        </ClusterNativeSelect>
      </div>
      {!artifactMode ? <div className="field"><label>Date</label><ClusterTextInput type="datetime-local" value={form.date} onChange={(event) => setForm((prev) => ({ ...prev, date: event.target.value }))} /></div> : null}

      {artifactMode ? <>
        <div className="field span-2"><p className="muted tight">Source provenance is captured from synchronized Source Control and becomes immutable when the build is created.</p></div>
        <div className="field"><label>Repository</label><ClusterNativeSelect value={form.sourceRepositoryId} disabled={sourceLoading || !repositories.length} onChange={(event) => selectRepository(event.target.value)}><option value="">{sourceLoading ? "Loading repositories…" : repositories.length ? "Select repository" : "No linked repository"}</option>{repositories.map((item) => <option key={item.repositoryId} value={item.repositoryId}>{item.name}{item.isPrimary ? " · Primary" : ""}</option>)}</ClusterNativeSelect></div>
        <div className="field"><label>Branch</label><ClusterNativeSelect value={form.sourceBranch} disabled={!repository} onChange={(event) => selectBranch(event.target.value)}><option value="">Select branch</option>{repository?.branches.map((item) => <option key={item.id} value={item.name}>{item.name}{item.isDefault ? " · Default" : ""}</option>)}</ClusterNativeSelect></div>
        <div className="field span-2"><label>Review</label><ClusterNativeSelect value={form.sourceReviewId} disabled={!repository} onChange={(event) => selectReview(event.target.value)}><option value="">No review · capture exact revision</option>{reviews.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.sourceBranch} → {item.targetBranch} · {item.status}</option>)}</ClusterNativeSelect></div>
        <div className="field span-2"><label>Revision</label><ClusterNativeSelect value={form.sourceRevision} disabled={!repository} onChange={(event) => setForm((prev) => ({ ...prev, sourceRevision: event.target.value, sourceReviewId: "" }))}><option value="">Select synchronized revision</option>{commits.map((commit) => <option key={commit.id} value={commit.revision}>{commit.shortRevision} · {commit.message.split("\n")[0].slice(0, 100)}</option>)}</ClusterNativeSelect>{branch?.headRevision ? <span className="muted">Branch head: {branch.headRevision.slice(0, 12)}</span> : null}</div>
      </> : null}

      {profile.fields.map((field) => (
        <div key={field.id} className={`field ${field.span === 2 ? "span-2" : ""}`}>
          <label>{field.label}</label>
          <ClusterTextInput value={platformMeta[field.id] || ""} onChange={(event) => patchMeta(field.id, event.target.value)} placeholder={field.placeholder} />
        </div>
      ))}
      {artifactMode && <>
        <div className="field"><label>Channel</label><ClusterNativeSelect value={form.channel} onChange={(event) => setForm((prev) => ({ ...prev, channel: event.target.value as NonNullable<BuildArtifactRecord["channel"]> }))}><option value="nightly">Nightly</option><option value="internal">Internal</option><option value="alpha">Alpha</option><option value="beta">Beta</option><option value="rc">Release candidate</option><option value="release">Release</option></ClusterNativeSelect></div>
        <div className="field"><label>Build number</label><ClusterTextInput value={form.buildNumber} onChange={(event) => setForm((prev) => ({ ...prev, buildNumber: event.target.value }))} placeholder="CI-1842" /></div>
        <div className="field"><label>Created by</label><ClusterTextInput value={form.createdBy} onChange={(event) => setForm((prev) => ({ ...prev, createdBy: event.target.value }))} /></div>
        <div className="field"><label>File size</label><ClusterTextInput value={form.fileSize} onChange={(event) => setForm((prev) => ({ ...prev, fileSize: event.target.value }))} placeholder="2.4 GB" /></div>
        <div className="field span-2"><label>SHA-256 checksum</label><ClusterTextInput value={form.checksum} onChange={(event) => setForm((prev) => ({ ...prev, checksum: event.target.value }))} /></div>
        <div className="field span-2"><label>Tested platforms</label><ClusterTextInput value={form.testedPlatforms.join(", ")} onChange={(event) => setForm((prev) => ({ ...prev, testedPlatforms: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) }))} placeholder="Windows, Steam Deck, Linux server" /></div>
        <label className="field check-row-v309"><ClusterInput type="checkbox" checked={form.signed} onChange={(event) => setForm((prev) => ({ ...prev, signed: event.target.checked }))} /> Signed artifact</label>
      </>}
      <div className="field span-2">
        <label>Artifact URL</label>
        <ClusterTextInput value={form.artifactUrl} onChange={(event) => setForm((prev) => ({ ...prev, artifactUrl: event.target.value }))} placeholder="Library asset, CI artifact, release bucket, or publish draft" />
      </div>
      <div className="field span-2">
        <label>Notes</label>
        <ClusterTextArea value={form.notes} onChange={(event) => setForm((prev) => ({ ...prev, notes: event.target.value }))} placeholder="Changes, risks, QA notes, handoff context" />
      </div>
      <div className="button-row span-2">
        <ClusterButton type="button" disabled={artifactMode && (!form.sourceRepositoryId || !form.sourceRevision || !form.sourceBranch)} onClick={onSubmit} variant="primary">{artifactMode ? `Save ${profile.artifactLabel.toLowerCase()}` : "Create build beat"}</ClusterButton>
        <ClusterButton type="button" onClick={onCancel} variant="secondary">Cancel</ClusterButton>
      </div>
    </div>
  );
}
