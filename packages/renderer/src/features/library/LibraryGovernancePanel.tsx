import { ClusterDisclosureGroup } from "../../components/ClusterDisclosureGroup";
import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api, queryApi } from "../../core/api";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterToggle } from "../../components/ClusterToggle";
import { confirmCluster, promptCluster } from "../../components/cluster-dialog-service";
import type { LibraryItem, LibraryMetadata } from "./library-types";

type LibraryBacklink = {
  id: string;
  itemId: string;
  sourceResourceKind: string;
  sourceResourceId: string;
  relationKind: string;
  label?: string | null;
  metadata?: LibraryMetadata;
  createdAt: string;
  updatedAt: string;
};

type LibraryBacklinksPayload = { ok: true; itemId: string; backlinks: LibraryBacklink[] };
type RetentionDecision = { eligible: boolean; code: string; reason: string };
type DestructionPreview = {
  ok: true;
  itemId: string;
  revision: number;
  retention: RetentionDecision;
  dependencies: { children: number; backlinks: number; versions: number };
  evidence?: {
    children?: Array<{ id: string; title: string; type: string; status: string }>;
    backlinks?: LibraryBacklink[];
    versions?: Array<{ id: string; versionNumber: number; title: string; originalName?: string | null; createdAt: string; checksumSha256?: string | null }>;
  };
  canDestroy: boolean;
};

type DispositionPayload = {
  ok: true;
  itemId: string;
  blockers: string[];
  reviewAfter: string;
  activeRequest: { id: string; status: string; reason: string; reviewAfter: string; requestedAt: string } | null;
  reviewBlockers: string[];
  readyForHumanReview: boolean;
  physicalDisposalAllowed: false;
  canInspectStorageOwnership: boolean;
  canReviewDisposition: boolean;
  canApproveDisposition: boolean;
  canWithdrawMyDispositionApproval: boolean;
  decisionRevision: number;
  approvalCount: number;
  requiredApprovers: number;
  approvalValidNow: boolean;
  decisions: Array<{ id: string; actorId: string; action: string; reason: string; occurredAt: string; snapshotVersion: number }>;
  history: Array<{ id: string; status: string; requestedAt: string; cancelledAt?: string | null }>;
};

type QuarantineSimulation = {
  mode: "SIMULATION_ONLY";
  fingerprint: string;
  requestId: string | null;
  decisionRevision: number | null;
  blockers: string[];
  expiresAt: string;
  quarantineAllowed: false;
  physicalDisposalAllowed: false;
};
type QuarantinePlan = { id: string; actorId: string; reason: string; recordedAt: string;
  expiresAt: string; snapshotSha256: string;
  journal: Array<{ id: string; actorId: string; eventType: string; occurredAt: string }> };

type StorageOwnershipReport = {
  readOnly: true;
  quarantineAllowed: false;
  physicalDisposalAllowed: false;
  databaseInventoryComplete: boolean;
  providerInventoryComplete: boolean;
  ownerRecordsScanned: number;
  fingerprint: string;
  blockers: string[];
  limitation: string;
  relatedAuthority: {
    correlation: string;
    fingerprint: string;
    knownDigests: number;
    contentPointersWithoutVerifiedDigest: number;
    managedBlobs: Array<{ id: string; provider: string; tier: string; referenceCount: number; gcState: string }>;
    uploadSessions: Array<{ id: string; status: string; provider?: string | null; tier?: string | null }>;
    publishedReleases: Array<{ id: string; versionLabel: string; revokedAt?: string | null }>;
    publishedDerivativeRows: number;
    blockers: string[];
    providerGenerationVerified: false;
    quarantineAllowed: false;
  };
  objects: Array<{
    source: string; id: string; storage: string; relativeKey?: string;
    state: string | { state: string; sizeBytes?: number; links?: number };
    owners?: Array<{ source: string; id: string; itemId: string }>;
  }>;
};

type Props = {
  item: LibraryItem;
  onSaved: (item: LibraryItem) => void;
  onDestroyed: (itemId: string) => void;
};

function formatDate(value?: string | null) {
  if (!value) return "Not set";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "Invalid date";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

function inputDate(value?: string | null) {
  if (!value) return "";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "";
  return parsed.toISOString().slice(0, 10);
}

function readableKind(value: string) {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function LibraryGovernancePanel({ item, onSaved }: Props) {
  const [backlinks, setBacklinks] = useState<LibraryBacklink[]>([]);
  const [preview, setPreview] = useState<DestructionPreview | null>(null);
  const [disposition, setDisposition] = useState<DispositionPayload | null>(null);
  const [storageOwnership, setStorageOwnership] = useState<StorageOwnershipReport | null>(null);
  const [ownershipLoading, setOwnershipLoading] = useState(false);
  const [quarantineSimulation, setQuarantineSimulation] = useState<QuarantineSimulation | null>(null);
  const [quarantinePlans, setQuarantinePlans] = useState<QuarantinePlan[]>([]);
  const [quarantineLoading, setQuarantineLoading] = useState(false);
  const ownershipRequest = useRef(0);
  const [manageDenied, setManageDenied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [retentionPolicyKey, setRetentionPolicyKey] = useState(item.retentionPolicyKey || "");
  const [retentionUntil, setRetentionUntil] = useState(inputDate(item.retentionUntil));
  const [legalHold, setLegalHold] = useState(Boolean(item.legalHold));

  const trashed = item.status === "trashed" || item.lifecycleState === "trashed";
  const dependencyCount = useMemo(() => (preview?.dependencies.children || 0) + (preview?.dependencies.backlinks || 0) + (preview?.dependencies.versions || 0), [preview]);

  async function loadEvidence(force = false) {
    setLoading(true);
    setMessage("");
    setManageDenied(false);
    try {
      const backlinksResult = await queryApi<LibraryBacklinksPayload>(`/api/library/${item.id}/backlinks`, {
        force,
        staleMs: 15_000,
        maxAgeMs: 5 * 60_000,
        tags: ["library", `library:${item.id}:backlinks`],
      });
      setBacklinks(backlinksResult.backlinks || []);
      try {
        const destruction = await queryApi<DestructionPreview>(`/api/library/${item.id}/destruction-preview`, {
          force,
          staleMs: 5_000,
          maxAgeMs: 60_000,
          tags: ["library", `library:${item.id}:governance`],
        });
        setPreview(destruction);
        const currentDisposition = await queryApi<DispositionPayload>(`/api/library/${item.id}/disposition`, {
          force, staleMs: 0, maxAgeMs: 0, tags: ["library", `library:${item.id}:governance`],
        });
        setDisposition(currentDisposition);
      } catch (error) {
        if (error instanceof ApiError && error.status === 403) {
          setManageDenied(true);
          setPreview(null);
          setDisposition(null);
        } else {
          throw error;
        }
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Library lifecycle evidence could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setRetentionPolicyKey(item.retentionPolicyKey || "");
    setRetentionUntil(inputDate(item.retentionUntil));
    setLegalHold(Boolean(item.legalHold));
    ownershipRequest.current += 1;
    setStorageOwnership(null);
    setQuarantineSimulation(null);
    setQuarantinePlans([]);
    setQuarantineLoading(false);
    setOwnershipLoading(false);
    void loadEvidence();
  }, [item.id, item.updatedAt]);

  async function inspectStorageOwnership() {
    const requestNumber = ++ownershipRequest.current;
    setOwnershipLoading(true);
    setStorageOwnership(null);
    setMessage("");
    try {
      // Deliberately bypass API query caches. This is an operator inspection,
      // not a durable filesystem lease or authorization for physical removal.
      const response = await api<{ ok: true; ownership: StorageOwnershipReport }>(`/api/library/${item.id}/disposition/ownership`);
      if (ownershipRequest.current === requestNumber) setStorageOwnership(response.ownership);
    } catch (error) {
      if (ownershipRequest.current === requestNumber) setMessage(error instanceof Error ? error.message : "Storage ownership inspection failed.");
    } finally {
      if (ownershipRequest.current === requestNumber) setOwnershipLoading(false);
    }
  }

  async function inspectQuarantineReadiness() {
    const requestNumber = ++ownershipRequest.current;
    setQuarantineLoading(true);
    setQuarantineSimulation(null);
    setMessage("");
    try {
      // Always fresh, never a mutation permit. No cached storage ownership.
      const [report, history] = await Promise.all([
        api<{ ok: true; simulation: QuarantineSimulation }>(`/api/library/${item.id}/disposition/quarantine-simulation`),
        api<{ ok: true; plans: QuarantinePlan[] }>(`/api/library/${item.id}/disposition/quarantine-simulations`),
      ]);
      if (ownershipRequest.current === requestNumber) {
        setQuarantineSimulation(report.simulation);
        setQuarantinePlans(history.plans);
      }
    } catch (error) {
      if (ownershipRequest.current === requestNumber) setMessage(error instanceof Error ? error.message : "Quarantine simulation could not be inspected.");
    } finally {
      if (ownershipRequest.current === requestNumber) setQuarantineLoading(false);
    }
  }

  async function recordQuarantineSimulation() {
    if (!disposition?.approvalValidNow || !quarantineSimulation || busy) return;
    const simulation = quarantineSimulation;
    if (simulation.decisionRevision !== disposition.decisionRevision) {
      setMessage("The review changed. Inspect a fresh simulation before recording."); return;
    }
    const reason = await promptCluster({
      title: "Record non-executable quarantine simulation",
      message: "This retains a snapshot of safety blockers for audit. It DOES NOT move, quarantine, or delete any files.",
      label: "Operator reason (12–1,000 characters)", confirmLabel: "Record simulation",
    });
    if (!reason || reason.trim().length < 12 || reason.trim().length > 1000) return;
    setBusy(true); setMessage("");
    try {
      await api(`/api/library/${item.id}/disposition/quarantine-simulations`, {
        method: "POST", body: JSON.stringify({ reason: reason.trim(), planKey: crypto.randomUUID(),
          expectedDecisionRevision: simulation.decisionRevision }),
      });
      setMessage("Simulation evidence recorded. No storage was changed.");
      await inspectQuarantineReadiness();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Quarantine simulation could not be recorded.");
    } finally { setBusy(false); }
  }

  async function saveRetention() {
    setBusy(true);
    setMessage("");
    try {
      const previousDate = item.retentionUntil ? new Date(item.retentionUntil).getTime() : null;
      const shorter = previousDate !== null && (!retentionUntil || new Date(retentionUntil).getTime() < previousDate);
      const override = shorter || (item.legalHold && !legalHold);
      const reason = override ? await promptCluster({
        title: "Justify retention override",
        message: "Shortening retention or releasing an active hold requires administrator authorization and an audit reason.",
        label: "Reason (12–1,000 characters)", confirmLabel: "Review override", tone: "danger",
      }) : null;
      if (override && (!reason || reason.trim().length < 12)) { setMessage("Retention override requires a reason of at least 12 characters."); return; }
      const updated = await api<LibraryItem>(`/api/library/${item.id}/retention`, {
        method: "PUT",
        body: JSON.stringify({
          retentionPolicyKey: retentionPolicyKey.trim() || null,
          retentionUntil: retentionUntil || null,
          legalHold,
          expectedRevision: item.revision,
          ...(override ? { reason: reason?.trim() } : {}),
        }),
      });
      onSaved(updated);
      setMessage("Lifecycle policy saved.");
      await loadEvidence(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Lifecycle policy could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  async function restoreItem() {
    if (!trashed) return;
    const confirmed = await confirmCluster({
      title: "Restore Library item?",
      message: `${item.title} will return to active Library browsing.`,
      confirmLabel: "Restore",
    });
    if (!confirmed) return;
    setBusy(true);
    setMessage("");
    try {
      const restored = await api<LibraryItem>(`/api/library/${item.id}/restore`, { method: "POST" });
      onSaved(restored);
      setMessage("Library item restored.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Library item could not be restored.");
    } finally {
      setBusy(false);
    }
  }

  async function requestDisposition() {
    if (!preview || !disposition || disposition.blockers.length || disposition.activeRequest) return;
    const reason = await promptCluster({
      title: "Request governed Library disposition",
      message: `Explain why ${item.title} should be retired. This begins an audited review window of at least 30 days. It does NOT delete file bytes or the Library record.`,
      label: "Business / retention reason (12–1,000 characters)", confirmLabel: "Continue", tone: "danger",
    });
    if (!reason || reason.trim().length < 12 || reason.trim().length > 1000) {
      setMessage("A disposition reason between 12 and 1,000 characters is required."); return;
    }
    const typed = await promptCluster({
      title: "Confirm disposition review request",
      message: `The Library item and all versions remain preserved. Earliest review: ${formatDate(disposition.reviewAfter)}. Releasing physical storage is NOT authorized by this request.`,
      label: "Type the exact Library title", expectedValue: item.title,
      confirmLabel: "Request disposition", tone: "danger",
    });
    if (typed !== item.title) return;
    setBusy(true); setMessage("");
    try {
      await api(`/api/library/${item.id}/disposition`, { method: "POST", body: JSON.stringify({
        confirmTitle: typed, expectedRevision: preview.revision, reason: reason.trim(), requestKey: crypto.randomUUID(),
      }) });
      setMessage("Disposition review requested. Library files remain preserved during the restore window.");
      await loadEvidence(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Disposition request failed.");
      await loadEvidence(true);
    } finally { setBusy(false); }
  }

  async function cancelDisposition() {
    if (!disposition?.activeRequest) return;
    const reason = await promptCluster({
      title: "Cancel disposition review",
      message: "Cancellation preserves the Library record and file bytes, and is written to the audit ledger.",
      label: "Cancellation reason (at least five characters)", confirmLabel: "Cancel request",
    });
    if (!reason || reason.trim().length < 5) return;
    setBusy(true); setMessage("");
    try {
      await api(`/api/library/${item.id}/disposition/cancel`, { method: "POST", body: JSON.stringify({ reason: reason.trim() }) });
      setMessage("Disposition request cancelled. Files remain preserved.");
      await loadEvidence(true);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Cancellation failed."); }
    finally { setBusy(false); }
  }

  async function decideDisposition(action: "APPROVE" | "REJECT" | "REVOKE") {
    const current = disposition;
    if (!current?.activeRequest || !current.canReviewDisposition || busy) return;
    if (action === "APPROVE" && !current.canApproveDisposition) return;
    if (action === "REVOKE" && !current.canWithdrawMyDispositionApproval) return;
    const reason = await promptCluster({
      title: action === "APPROVE" ? "Approve disposition governance review" : action === "REJECT" ? "Reject disposition review" : "Withdraw your approval",
      message: action === "APPROVE"
        ? `Approve the currently reviewed evidence for ${item.title}. Two distinct administrators other than the requester are required. This does NOT authorize quarantine or physical deletion.`
        : `Record a permanent ${action.toLowerCase()} decision for ${item.title}. No file bytes will be deleted.`,
      label: "Review decision reason (12–1,000 characters)", confirmLabel: "Record decision", tone: action === "APPROVE" ? undefined : "danger",
    });
    if (!reason || reason.trim().length < 12 || reason.trim().length > 1000) return;
    const confirmed = await confirmCluster({
      title: "Record independent decision?",
      message: `Your decision is append-only governance evidence. Current request revision: ${current.decisionRevision}. File storage remains unchanged.`,
      confirmLabel: "Confirm decision",
    });
    if (!confirmed) return;
    setBusy(true); setMessage("");
    try {
      const response = await api<{ status: string; approvalCount: number }>(`/api/library/${item.id}/disposition/decision`, {
        method: "POST", body: JSON.stringify({ action, reason: reason.trim(), expectedDecisionRevision: current.decisionRevision }),
      });
      setMessage(`${action === "APPROVE" ? "Approval" : action === "REVOKE" ? "Withdrawal" : "Rejection"} recorded. ${response.approvalCount} independent approval(s). Physical disposal remains disabled.`);
      await loadEvidence(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Disposition decision failed.");
      await loadEvidence(true);
    } finally { setBusy(false); }
  }

  return <div className="library-inspector-scroll-v217 library-governance-v516">
    <section className="library-governance-summary-v516">
      <div>
        <span>Lifecycle</span>
        <strong>{readableKind(item.lifecycleState || item.status || "active")}</strong>
      </div>
      <div>
        <span>Retention</span>
        <strong>{item.legalHold ? "Hold active" : item.retentionUntil ? `Until ${formatDate(item.retentionUntil)}` : "No expiry"}</strong>
      </div>
      <div>
        <span>Traceability</span>
        <strong>{loading ? "Loading…" : `${backlinks.length} backlink${backlinks.length === 1 ? "" : "s"}`}</strong>
      </div>
    </section>

    <section className="library-governance-section-v516">
      <div className="library-section-title-v504"><strong>References & backlinks</strong><span>{loading ? "Loading…" : backlinks.length}</span></div>
      {backlinks.length ? <div className="library-governance-evidence-v516">
        {backlinks.map((entry) => <article key={entry.id}>
          <div><strong>{entry.label || readableKind(entry.sourceResourceKind)}</strong><span>{readableKind(entry.relationKind)}</span></div>
          <p>{entry.sourceResourceKind} · {entry.sourceResourceId}</p>
          <small>Updated {formatDate(entry.updatedAt)}</small>
        </article>)}
      </div> : !loading ? <p className="muted">No Cluster backlinks currently reference this item.</p> : null}
    </section>

    <section className="library-governance-section-v516">
      <div className="library-section-title-v504"><strong>Retention & hold</strong><span>{manageDenied ? "Read only" : "Managed lifecycle"}</span></div>
      <label><span>Retention policy key</span><ClusterTextInput value={retentionPolicyKey} disabled={manageDenied || busy} onChange={(event) => setRetentionPolicyKey(event.target.value)} placeholder="studio-default, project-record, legal…" /></label>
      <label><span>Retain until</span><ClusterTextInput type="date" value={retentionUntil} disabled={manageDenied || busy} onChange={(event) => setRetentionUntil(event.target.value)} /></label>
      <ClusterToggle checked={legalHold} disabled={manageDenied || busy} onCheckedChange={setLegalHold} label="Legal / administrative hold" description="Blocks permanent destruction until the hold is explicitly released." />
      {!manageDenied && <ClusterButton type="button" variant="secondary" disabled={busy} onClick={() => void saveRetention()}>{busy ? "Saving…" : "Save lifecycle policy"}</ClusterButton>}
      {manageDenied && <p className="muted">Management access is required to change retention or hold policy.</p>}
    </section>

    <section className="library-governance-section-v516">
      <div className="library-section-title-v504"><strong>Disposition evidence</strong><span>{preview ? `${dependencyCount} dependency signal${dependencyCount === 1 ? "" : "s"}` : manageDenied ? "Restricted" : "Loading…"}</span></div>
      {preview ? <>
        <dl className="library-governance-facts-v516">
          <div><dt>Child items</dt><dd>{preview.dependencies.children}</dd></div>
          <div><dt>Backlinks</dt><dd>{preview.dependencies.backlinks}</dd></div>
          <div><dt>Saved versions</dt><dd>{preview.dependencies.versions}</dd></div>
          <div className="full"><dt>Retention decision</dt><dd>{preview.retention.reason}</dd></div>
        </dl>
        {preview.evidence?.children?.length ? <ClusterDisclosureGroup title="Child item evidence" headerTrailing={<span>{preview.evidence.children.length}</span>} className="library-governance-evidence-disclosure-v546" contentClassName="library-governance-evidence-v516">{preview.evidence.children.map((child) => <article key={child.id}><div><strong>{child.title}</strong><span>{child.type}</span></div><p>{child.status}</p></article>)}</ClusterDisclosureGroup> : null}
        {preview.evidence?.versions?.length ? <ClusterDisclosureGroup title="Version evidence" headerTrailing={<span>{preview.evidence.versions.length}</span>} className="library-governance-evidence-disclosure-v546" contentClassName="library-governance-evidence-v516">{preview.evidence.versions.map((version) => <article key={version.id}><div><strong>v{version.versionNumber} · {version.title}</strong><span>{formatDate(version.createdAt)}</span></div><p>{version.originalName || "Stored Library version"}</p>{version.checksumSha256 ? <small>{version.checksumSha256}</small> : null}</article>)}</ClusterDisclosureGroup> : null}
      </> : manageDenied ? <p className="muted">Management access is required to view destruction eligibility and dependency evidence.</p> : null}
    </section>

    {disposition?.canInspectStorageOwnership && <section className="library-governance-section-v516">
      <div className="library-section-title-v504"><strong>Storage ownership</strong><span>Read-only operator audit</span></div>
      <p className="muted">Inspect original files, historical versions and derivatives for shared pointers, path hazards and filesystem evidence. Nothing is quarantined or deleted.</p>
      <ClusterButton type="button" variant="secondary" disabled={busy || ownershipLoading} onClick={() => void inspectStorageOwnership()}>{ownershipLoading ? "Inspecting ownership…" : "Inspect storage ownership"}</ClusterButton>
      {storageOwnership && <ClusterDisclosureGroup title="Ownership report" headerTrailing={<span>{storageOwnership.objects.length} pointers</span>} className="library-governance-evidence-disclosure-v546" contentClassName="library-governance-evidence-v516">
        <article><div><strong>Disposal remains blocked</strong><span>{storageOwnership.ownerRecordsScanned} records scanned</span></div>
          <p>{storageOwnership.limitation}</p>
          <small>Evidence fingerprint: {storageOwnership.fingerprint}</small>
        </article>
        {storageOwnership.objects.map((object, index) => <article key={`${object.source}-${object.id}-${index}`}>
          <div><strong>{readableKind(object.source)}</strong><span>{typeof object.state === "string" ? object.state : object.state.state}</span></div>
          <p>{object.relativeKey || "Unresolved or external storage path"}</p>
          <small>{object.owners?.length || 0} known owners</small>
        </article>)}
        <article><div><strong>Related storage authority</strong><span>SQL correlation only</span></div>
          <p>{storageOwnership.relatedAuthority.knownDigests} content digests · {storageOwnership.relatedAuthority.managedBlobs.length} managed blobs · {storageOwnership.relatedAuthority.uploadSessions.length} upload sessions · {storageOwnership.relatedAuthority.publishedReleases.length} published releases ({storageOwnership.relatedAuthority.publishedDerivativeRows} detached derivatives)</p>
          {storageOwnership.relatedAuthority.contentPointersWithoutVerifiedDigest > 0 &&
            <small>{storageOwnership.relatedAuthority.contentPointersWithoutVerifiedDigest} pointers have no valid content hash. Correlation is incomplete.</small>}
          <small>Published derivatives are stored independently; content matches do not establish identical storage ownership.</small>
          <small>Related evidence: {storageOwnership.relatedAuthority.fingerprint}</small>
        </article>
        {storageOwnership.relatedAuthority.managedBlobs.map((blob) => <article key={`managed-${blob.id}`}>
          <div><strong>Related managed blob</strong><span>{blob.gcState}</span></div>
          <p>{blob.provider} / {blob.tier} · {blob.referenceCount} recorded references</p>
        </article>)}
        {storageOwnership.relatedAuthority.uploadSessions.map((session) => <article key={`upload-${session.id}`}>
          <div><strong>Related upload session</strong><span>{session.status}</span></div>
          <p>{session.provider || "Unknown provider"} / {session.tier || "Unknown tier"}</p>
        </article>)}
        {storageOwnership.relatedAuthority.publishedReleases.map((release) => <article key={`release-${release.id}`}>
          <div><strong>Published Packet source reference</strong><span>v{release.versionLabel}</span></div>
          <p>{release.revokedAt ? "Revoked release retained as historical evidence" : "Published immutable source reference"}</p>
        </article>)}
        <article><div><strong>Unresolved safety constraints</strong></div><p>{storageOwnership.blockers.map(readableKind).join(" · ")}</p></article>
      </ClusterDisclosureGroup>}
    </section>}

    {disposition?.canInspectStorageOwnership && <section className="library-governance-section-v516">
      <div className="library-section-title-v504"><strong>Quarantine readiness</strong><span>Simulation only</span></div>
      <p className="muted">Generate an operator safety report and record an immutable simulation after independent approval. Provider writes, quarantine and physical reclamation remain disabled.</p>
      <div className="button-row">
        <ClusterButton type="button" variant="secondary" disabled={busy || quarantineLoading} onClick={() => void inspectQuarantineReadiness()}>{quarantineLoading ? "Inspecting…" : "Inspect quarantine readiness"}</ClusterButton>
        {quarantineSimulation && disposition.approvalValidNow && <ClusterButton type="button" variant="secondary" disabled={busy || quarantineLoading} onClick={() => void recordQuarantineSimulation()}>Record simulation evidence</ClusterButton>}
      </div>
      {quarantineSimulation && <ClusterDisclosureGroup title="Current safety blockers" headerTrailing={<span>{quarantineSimulation.blockers.length}</span>} className="library-governance-evidence-disclosure-v546" contentClassName="library-governance-evidence-v516">
        <article><div><strong>Quarantine disabled</strong><span>{quarantineSimulation.mode}</span></div>
          <small>Inspection fingerprint: {quarantineSimulation.fingerprint}</small>
          <p>Expires {formatDate(quarantineSimulation.expiresAt)}. Expiration does not enable storage mutation.</p></article>
        {quarantineSimulation.blockers.map((blocker) => <article key={blocker}><strong>{readableKind(blocker)}</strong></article>)}
      </ClusterDisclosureGroup>}
      {quarantinePlans.length > 0 && <ClusterDisclosureGroup title="Recorded simulations" headerTrailing={<span>{quarantinePlans.length}</span>} className="library-governance-evidence-disclosure-v546" contentClassName="library-governance-evidence-v516">
        {quarantinePlans.map((plan) => <article key={plan.id}><div><strong>{plan.journal.some((event) => event.eventType === "WITHDRAWN") ? "Withdrawn simulation" : "Audit-only simulation"}</strong><span>{formatDate(plan.recordedAt)}</span></div>
          <p>{plan.reason}</p><small>Operator {plan.actorId} · Snapshot {plan.snapshotSha256}</small></article>)}
      </ClusterDisclosureGroup>}
    </section>}

    <section className="library-governance-danger-v516">
      <div><strong>Governed disposition</strong><p>Disposal requires a recorded reason, reference review, and at least 30 days to restore. No physical file deletion is enabled.</p></div>
      <div className="button-row">
        {trashed && <ClusterButton type="button" variant="secondary" disabled={busy} onClick={() => void restoreItem()}>Restore</ClusterButton>}
        {preview && !disposition?.activeRequest && <ClusterButton type="button" variant="danger" disabled={busy || !trashed || Boolean(disposition?.blockers.length)} title={disposition?.blockers.join(", ") || undefined} onClick={() => void requestDisposition()}>Request disposition review</ClusterButton>}
        {disposition?.activeRequest && <ClusterButton type="button" variant="secondary" disabled={busy} onClick={() => void cancelDisposition()}>Cancel disposition request</ClusterButton>}
        {disposition?.activeRequest && disposition.canApproveDisposition && <ClusterButton type="button" variant="secondary" disabled={busy} onClick={() => void decideDisposition("APPROVE")}>Approve review</ClusterButton>}
        {disposition?.activeRequest && disposition.canWithdrawMyDispositionApproval && <ClusterButton type="button" variant="secondary" disabled={busy} onClick={() => void decideDisposition("REVOKE")}>Withdraw my approval</ClusterButton>}
        {disposition?.activeRequest && disposition.canReviewDisposition && <ClusterButton type="button" variant="danger" disabled={busy} onClick={() => void decideDisposition("REJECT")}>Reject review</ClusterButton>}
      </div>
      {!trashed && <small>Move the item to Trash before requesting disposition.</small>}
      {disposition?.activeRequest && <small>Requested {formatDate(disposition.activeRequest.requestedAt)} · Earliest review {formatDate(disposition.activeRequest.reviewAfter)} · Status: {readableKind(disposition.activeRequest.status)} · {disposition.approvalCount}/{disposition.requiredApprovers} independent approvals · {disposition.approvalValidNow ? "Governance approved, storage still protected" : disposition.reviewBlockers.length ? `Blocked: ${disposition.reviewBlockers.join(", ")}` : "Awaiting independent review"}</small>}
      {disposition?.decisions?.length ? <ClusterDisclosureGroup title="Independent review decisions" headerTrailing={<span>{disposition.decisions.length}</span>} className="library-governance-evidence-disclosure-v546" contentClassName="library-governance-evidence-v516">{disposition.decisions.map((decision) => <article key={decision.id}><div><strong>{readableKind(decision.action)}</strong><span>{formatDate(decision.occurredAt)}</span></div><p>{decision.reason}</p><small>Reviewer {decision.actorId} · Evidence format v{decision.snapshotVersion}</small></article>)}</ClusterDisclosureGroup> : null}
      {disposition?.blockers.length ? <small>Current blockers: {disposition.blockers.join(", ")}</small> : null}
      {disposition?.history?.length ? <small>{disposition.history.length} recorded disposition request{disposition.history.length === 1 ? "" : "s"}; evidence retained.</small> : null}
    </section>

    {message && <div className={/saved|restored/i.test(message) ? "status-box slim" : "error-box slim"}>{message}</div>}
  </div>;
}
