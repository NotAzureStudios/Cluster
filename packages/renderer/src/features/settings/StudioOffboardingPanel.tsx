import { useEffect, useMemo, useRef, useState } from "react";
import { api, queryApi } from "../../core/api";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterInput, ClusterNativeSelect, ClusterTextarea } from "../../components/ClusterNativeControls";
import { DangerConfirmDialog } from "../../components/DangerConfirmDialog";
import { RequestErrorState } from "../../components/RequestState";
import { ClusterOperationFeedback } from "../../components/ClusterOperationFeedback";

type PersonOption = { id: string; username: string; displayName: string; employeeNumber?: string | null };
type OffboardingImpact = {
  handoffRequired: boolean;
  projectMemberships: Array<{ projectId: string; projectName: string; isLead: boolean; roleLabel?: string | null }>;
  leadProjects: Array<{ projectId: string; projectName: string }>;
  ownedLibraryItemCount: number;
  reviewLibraryItemCount: number;
  folderPermissionCount: number;
  custodialRecordCount: number;
  teamLeaderships: Array<{ id: string; name: string }>;
  departmentLeaderships: Array<{ id: string; name: string }>;
  sourceWorkingCopyCount: number;
  teamMembershipCount: number;
  equipmentReservationCount: number;
  inventoryAllocationCount: number;
  activePackagePinCount: number;
  assignedKeyCount: number;
  exposedAssignedKeyCount: number;
  activePackageGrantCount: number;
  pendingInventoryRequestCount: number;
  pendingPackageRequestCount: number;
  inventoryPhysicalAllocationCount: number;
  inventoryAllocations: Array<{ id: string; assetId: string; assetTitle: string; kind: string; quantity: number }>;
  equipmentReservations: Array<{ blockId: string; blockTitle: string; resourceName: string; resourceType: string; quantity: number; startsAt: string; endsAt: string }>;
};
type OffboardingCase = {
  id: string;
  subjectUserId: string;
  subject?: PersonOption | null;
  handoffUserId?: string | null;
  handoff?: PersonOption | null;
  status: "planned" | "active" | "completed" | "cancelled";
  scheduledFor?: string | null;
  reason?: string;
  notes?: string;
  equipmentStatus: "pending" | "returned" | "waived";
  equipmentEvidenceNote?: string;
  personnelRecordId?: string | null;
  snapshot?: Partial<OffboardingImpact> | null;
  result?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  revision: number;
  returnedAt?: string | null;
  returnReason?: string | null;
  returnPersonnelRecordId?: string | null;
};
type CredentialClosure = {
  remaining: { digitalSeats: number; assignedKeys: number; packageEntitlements: number; pendingInventoryRequests: number;
    pendingPackageRequests: number; devicePins: number };
  residualAccessDetected: boolean; exposedPreviouslyRevealedKeys: number;
  legacySettlementEvidenceMissing: boolean; providerSideKeyRotationVerified: boolean;
  operatorReviewRequired: boolean; note: string;
};
type ReturnPreview = {
  expectedRevision: number;
  subject: PersonOption;
  currentAccountType: string;
  willPreserve: string[];
  willRevoke: string[];
  willNotRestore: string[];
};

function countSummary(impact: OffboardingImpact | null) {
  if (!impact) return [];
  return [
    ["Project memberships", impact.projectMemberships.length],
    ["Lead projects", impact.leadProjects.length],
    ["Library custody", impact.ownedLibraryItemCount],
    ["Library reviews", impact.reviewLibraryItemCount],
    ["Personnel-record custody", impact.custodialRecordCount],
    ["Team leadership", impact.teamLeaderships.length],
    ["Department leadership", impact.departmentLeaderships.length],
    ["Working copies", impact.sourceWorkingCopyCount],
    ["Folder permissions", impact.folderPermissionCount],
    ["Equipment reservations", impact.equipmentReservationCount],
    ["Inventory allocations", impact.inventoryAllocationCount || 0],
    ["Package device pins to revoke", impact.activePackagePinCount || 0],
    ["Commercial keys to revoke", impact.assignedKeyCount || 0],
    ["Previously revealed keys requiring provider review", impact.exposedAssignedKeyCount || 0],
    ["Package entitlements to revoke", impact.activePackageGrantCount || 0],
    ["Pending Inventory access requests to cancel", impact.pendingInventoryRequestCount || 0],
    ["Pending Package access requests to cancel", impact.pendingPackageRequestCount || 0],
    ["Physical assets to return", impact.inventoryPhysicalAllocationCount || 0],
  ] as const;
}

export function StudioOffboardingPanel() {
  const [users, setUsers] = useState<PersonOption[]>([]);
  const [cases, setCases] = useState<OffboardingCase[]>([]);
  const [subjectUserId, setSubjectUserId] = useState("");
  const [handoffUserId, setHandoffUserId] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [equipmentNotes, setEquipmentNotes] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<OffboardingImpact | null>(null);
  const [previewSelection, setPreviewSelection] = useState<{ userId: string; handoffUserId: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [actionError, setActionError] = useState<unknown>(null);
  const retryActionRef = useRef<null | (() => void)>(null);
  const actionInFlightRef = useRef(false);
  const [confirmCase, setConfirmCase] = useState<OffboardingCase | null>(null);
  const [credentialReviews, setCredentialReviews] = useState<Record<string, CredentialClosure>>({});
  const [reviewingCredentials, setReviewingCredentials] = useState<string | null>(null);
  const [cancelCase, setCancelCase] = useState<OffboardingCase | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [returnCase, setReturnCase] = useState<OffboardingCase | null>(null);
  const [returnPreview, setReturnPreview] = useState<ReturnPreview | null>(null);
  const [returnReason, setReturnReason] = useState("");
  const [returnAccountType, setReturnAccountType] = useState("employee");
  const [returnExpires, setReturnExpires] = useState("");

  async function load(force = false) {
    setLoading(true); setLoadError(null);
    try {
      const [options, caseResponse] = await Promise.all([
        queryApi<{ users: PersonOption[] }>("/api/studio-systems/offboarding/options", { staleMs: 20_000, force, tags: ["people", "offboarding"] }),
        queryApi<{ cases: OffboardingCase[] }>("/api/studio-systems/offboarding", { staleMs: 10_000, force, tags: ["people", "offboarding"] }),
      ]);
      setUsers(options.users || []);
      setCases(caseResponse.cases || []);
      setSubjectUserId((current) => current || options.users?.[0]?.id || "");
    } catch (error) {
      setLoadError(error);
      throw error;
    } finally { setLoading(false); }
  }

  useEffect(() => { void load().catch(() => undefined); }, []);
  useEffect(() => { setPreview(null); setPreviewSelection(null); }, [subjectUserId, handoffUserId]);
  const currentPreview = preview && previewSelection?.userId === subjectUserId && previewSelection.handoffUserId === handoffUserId ? preview : null;
  const subject = useMemo(() => users.find((user) => user.id === subjectUserId) || null, [users, subjectUserId]);
  const availableHandoffs = useMemo(() => users.filter((user) => user.id !== subjectUserId), [users, subjectUserId]);

  async function retryCommittedRefresh() {
    if (actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    setBusy(true);
    setActionError(null);
    setStatus("Refreshing offboarding state after the completed action…");
    retryActionRef.current = () => { void retryCommittedRefresh(); };
    try {
      await load(true);
      retryActionRef.current = null;
      setStatus("Offboarding state refreshed. The previous action was not repeated.");
    } catch (error) {
      setStatus("");
      setActionError(error);
    } finally {
      actionInFlightRef.current = false;
      setBusy(false);
    }
  }

  async function runAction<T>(workingMessage: string, action: () => Promise<T>, onSuccess: (result: T) => Promise<void> | void, readOnly = false) {
    if (actionInFlightRef.current) return;
    actionInFlightRef.current = true;
    setBusy(true);
    setActionError(null);
    setStatus(workingMessage);
    // Mutations with an ambiguous network outcome are never blindly replayed.
    // Preview is safe to retry; all writes reconcile the server first.
    retryActionRef.current = readOnly
      ? () => { void runAction(workingMessage, action, onSuccess, true); }
      : () => { void retryCommittedRefresh(); };
    let result: T;
    try {
      result = await action();
    } catch (error) {
      setStatus("");
      setActionError(error);
      actionInFlightRef.current = false;
      setBusy(false);
      return;
    }

    // The write is committed at this point. A failed refresh must never repeat offboarding mutations.
    retryActionRef.current = null;
    try {
      await onSuccess(result);
    } catch (error) {
      setStatus("");
      setActionError(error);
      retryActionRef.current = () => { void retryCommittedRefresh(); };
    } finally {
      actionInFlightRef.current = false;
      setBusy(false);
    }
  }

  async function previewImpact() {
    if (!subjectUserId) return;
    const requestedUserId = subjectUserId;
    const requestedHandoffId = handoffUserId || null;
    await runAction("Inspecting live responsibilities…",
      () => api<{ impact: OffboardingImpact }>("/api/studio-systems/offboarding/preview", { method: "POST", body: JSON.stringify({ userId: requestedUserId, handoffUserId: requestedHandoffId }) }),
      (response) => {
        setPreview(response.impact);
        setPreviewSelection({ userId: requestedUserId, handoffUserId: requestedHandoffId || "" });
        setStatus("Impact preview refreshed from live authorities.");
      }, true);
  }

  async function createCase() {
    if (!subjectUserId || !currentPreview || (currentPreview.handoffRequired && !handoffUserId)) return;
    const payload = { userId: subjectUserId, handoffUserId: handoffUserId || null, scheduledFor: scheduledFor ? new Date(`${scheduledFor}T12:00:00`).toISOString() : null, reason, notes };
    await runAction("Creating governed offboarding case…",
      () => api("/api/studio-systems/offboarding", { method: "POST", body: JSON.stringify(payload) }),
      async () => {
        setStatus("Offboarding case created with a confidential Personnel Record.");
        setPreview(null);
        setPreviewSelection(null);
        setReason("");
        setNotes("");
        setScheduledFor("");
        await load(true);
      });
  }

  async function recordEquipment(item: OffboardingCase, equipmentStatus: "returned" | "waived") {
    const evidenceNote = equipmentNotes[item.id] || "";
    await runAction(equipmentStatus === "returned" ? "Recording equipment return…" : "Recording equipment waiver…",
      () => api(`/api/studio-systems/offboarding/${encodeURIComponent(item.id)}/equipment`, { method: "PATCH", body: JSON.stringify({ status: equipmentStatus, note: evidenceNote, libraryItemIds: [], expectedRevision: item.revision }) }),
      async () => {
        setEquipmentNotes((current) => { const next = { ...current }; delete next[item.id]; return next; });
        setStatus(equipmentStatus === "returned" ? "Offboarding evidence recorded. Resolve every physical Inventory allocation separately in Inventory before custody is closed." : "Offboarding requirement waived; physical Inventory allocations remain outstanding until return, transfer or write-off.");
        await load(true);
      });
  }

  async function executeCase() {
    const item = confirmCase;
    if (!item) return;
    await runAction("Revoking access and transferring responsibilities…",
      () => api(`/api/studio-systems/offboarding/${encodeURIComponent(item.id)}/execute`, { method: "POST", body: JSON.stringify({ handoffUserId: item.handoffUserId || null, confirmation: "OFFBOARD", expectedRevision: item.revision }) }),
      async () => {
        setConfirmCase(null);
        setStatus("Offboarding completed. Access was revoked and governed evidence finalized.");
        await load(true);
      });
  }


  async function reviewCredentialClosure(item: OffboardingCase) {
    if (reviewingCredentials || busy) return;
    setReviewingCredentials(item.id);
    setActionError(null);
    try {
      const response = await api<{ review: CredentialClosure }>(`/api/studio-systems/offboarding/${encodeURIComponent(item.id)}/credential-review`, { method: "GET" });
      setCredentialReviews((previous) => ({ ...previous, [item.id]: response.review }));
    } catch (error) { setActionError(error); }
    finally { setReviewingCredentials(null); }
  }

  async function inspectReturn(item: OffboardingCase) {
    setReturnPreview(null);
    setReturnCase(item);
    setReturnReason("");
    setReturnExpires("");
    await runAction("Inspecting the completed identity and access history…",
      () => api<ReturnPreview>(`/api/studio-systems/offboarding/${encodeURIComponent(item.id)}/return-preview`),
      (result) => {
        setReturnPreview(result);
        setReturnAccountType((["employee", "contractor", "client", "guest"].includes(result.currentAccountType) ? result.currentAccountType : "employee"));
        setStatus("Return eligibility checked. Access and historical entitlements will not be restored.");
      }, true);
  }

  async function performReturn() {
    const item = returnCase;
    const preview = returnPreview;
    if (!item || !preview || preview.expectedRevision !== item.revision) return;
    const expiration = returnExpires ? new Date(`${returnExpires}T23:59:59`).toISOString() : null;
    await runAction("Preserving identity and recording governed return…",
      () => api(`/api/studio-systems/offboarding/${encodeURIComponent(item.id)}/return`, { method: "POST", body: JSON.stringify({
        expectedRevision: preview.expectedRevision, confirmation: "RETURN", reason: returnReason.trim(),
        accountType: returnAccountType, accessExpiresAt: expiration,
      }) }),
      async () => {
        setReturnCase(null);
        setReturnPreview(null);
        setReturnReason("");
        setReturnExpires("");
        setStatus("Return recorded. The same person identity is available, but disabled until fresh credentials, roles and employment are reviewed.");
        await load(true);
      });
  }

  async function cancelPendingCase() {
    const item = cancelCase;
    const explanation = cancelReason.trim();
    if (!item || !explanation) return;
    await runAction("Cancelling offboarding case…",
      () => api(`/api/studio-systems/offboarding/${encodeURIComponent(item.id)}/cancel`, { method: "POST", body: JSON.stringify({ reason: explanation, expectedRevision: item.revision }) }),
      async () => {
        setCancelCase(null);
        setCancelReason("");
        setStatus("Offboarding case cancelled. No access was revoked by this cancellation.");
        await load(true);
      });
  }


  if (loading && !cases.length) return <div className="settings-card-v092"><span>Loading offboarding cases…</span></div>;
  if (loadError && !cases.length) return <RequestErrorState error={loadError} title="Offboarding could not be loaded" onRetry={() => void load(true).catch(() => undefined)} />;

  return <div className="studio-systems-layout-v34f">
    <aside className="studio-systems-list-v34f">
      <div className="studio-create-strip-v272 studio-systems-create-v34f">
        <div><strong>New offboarding case</strong><span>Preview live responsibilities before revoking anything. Cluster transfers canonical ownership instead of copying a checklist snapshot and hoping reality follows it.</span></div>
        <label><span>Person</span><ClusterNativeSelect value={subjectUserId} disabled={busy} onChange={(event) => setSubjectUserId(event.target.value)}><option value="">Choose person…</option>{users.map((user) => <option key={user.id} value={user.id}>{user.displayName} · {user.username}</option>)}</ClusterNativeSelect></label>
        <label><span>Responsibility handoff</span><ClusterNativeSelect value={handoffUserId} disabled={busy} onChange={(event) => setHandoffUserId(event.target.value)}><option value="">No handoff owner yet</option>{availableHandoffs.map((user) => <option key={user.id} value={user.id}>{user.displayName} · {user.username}</option>)}</ClusterNativeSelect></label>
        <label><span>Last day</span><ClusterInput type="date" value={scheduledFor} disabled={busy} onChange={(event) => setScheduledFor(event.target.value)} /></label>
        <ClusterTextarea aria-label="Offboarding reason or lifecycle context" value={reason} disabled={busy} onChange={(event) => setReason(event.target.value)} placeholder="Reason / lifecycle context" />
        <ClusterTextarea aria-label="Offboarding internal notes" value={notes} disabled={busy} onChange={(event) => setNotes(event.target.value)} placeholder="Internal notes" />
        <div className="studio-explanation-v272" role="status"><strong>{currentPreview ? "Impact preview ready" : "Preview required"}</strong><span>{currentPreview ? "The preview matches the selected person and handoff." : "Preview the selected person and handoff before creating a case."}</span></div><div className="button-row"><ClusterButton type="button" variant="secondary" busy={busy} disabled={busy || !subjectUserId} onClick={() => void previewImpact()}>Preview impact</ClusterButton><ClusterButton type="button" variant="primary" busy={busy} disabled={busy || !subjectUserId || !currentPreview || (currentPreview.handoffRequired === true && !handoffUserId)} onClick={() => void createCase()}>Create case</ClusterButton></div>
      </div>
      <div className="studio-entity-list-v272">{cases.map((item) => <div className="settings-card-v092" key={item.id}><strong>{item.subject?.displayName || item.subjectUserId}</strong><span className="muted">{item.returnedAt ? "returned (account pending provisioning)" : item.status} · equipment {item.equipmentStatus}{item.handoff ? ` · handoff ${item.handoff.displayName}` : ""}</span></div>)}</div>
    </aside>
    <section className="studio-systems-editor-v34f">
      <header className="studio-entity-editor-head-v272"><div><span className="eyebrow">People lifecycle</span><h3>Offboarding</h3><p>Access revocation, responsibility handoff, Project lead reassignment, Library custody, record custody, working-copy shutdown, and equipment-return evidence share one governed lifecycle.</p></div><ClusterButton type="button" variant="quiet" size="compact" disabled={busy || loading} onClick={() => void load(true).catch(() => undefined)}>Refresh</ClusterButton></header>
      {actionError ? <RequestErrorState compact error={actionError} title="Offboarding action could not be completed" onRetry={() => retryActionRef.current?.()} /> : status ? <ClusterOperationFeedback state={busy ? "working" : "success"} message={status} /> : null}
      {currentPreview && <div className="settings-card-v092"><strong>Live impact for {subject?.displayName || "selected person"}</strong><div className="studio-form-grid-v272">{countSummary(currentPreview).map(([label, count]) => <div className="hint-box slim" key={label}><strong>{count}</strong><span>{label}</span></div>)}</div>{currentPreview.handoffRequired && !handoffUserId && <div className="studio-explanation-v272"><strong>Handoff required</strong><span>This person owns or leads resources that must be transferred before access can be revoked.</span></div>}{(currentPreview.equipmentReservations.length > 0 || (currentPreview.inventoryPhysicalAllocationCount || 0) > 0) && <div className="studio-explanation-v272"><strong>Equipment evidence required</strong><span>{[...currentPreview.equipmentReservations.map((entry) => `${entry.resourceName} (${entry.blockTitle})`), ...(currentPreview.inventoryAllocations || []).filter((entry) => ["physical", "equipment"].includes(entry.kind)).map((entry) => `${entry.assetTitle} ×${entry.quantity}`)].join(", ")}</span></div>}</div>}
      <div className="studio-form-field-list-v34f">{cases.map((item) => <article className="settings-card-v092" key={item.id}><div className="studio-entity-editor-head-v272"><div><span className="eyebrow">{item.status}</span><h3>{item.subject?.displayName || item.subjectUserId}</h3><p>{item.reason || "No reason recorded."}</p></div>{item.personnelRecordId && <span className="muted">Record {item.personnelRecordId.slice(0, 8)}</span>}</div><div className="button-row"><span className="muted">Equipment: {item.equipmentStatus}</span>{item.status !== "completed" && item.status !== "cancelled" && <><ClusterButton type="button" size="compact" variant="secondary" disabled={busy} onClick={() => void recordEquipment(item, "returned")}>Mark returned</ClusterButton><ClusterButton type="button" size="compact" variant="quiet" disabled={busy || !(equipmentNotes[item.id] || "").trim()} onClick={() => void recordEquipment(item, "waived")}>Waive</ClusterButton><ClusterButton type="button" size="compact" variant="danger" disabled={busy || (item.equipmentStatus === "pending" && Boolean(item.snapshot?.equipmentReservationCount || item.snapshot?.inventoryPhysicalAllocationCount))} onClick={() => setConfirmCase(item)}>Complete offboarding</ClusterButton><ClusterButton type="button" size="compact" variant="quiet" disabled={busy} onClick={() => { setCancelCase(item); setCancelReason(""); }}>Cancel case</ClusterButton></>}</div>{item.status !== "completed" && item.status !== "cancelled" && <ClusterTextarea aria-label={`Equipment evidence note for ${item.subject?.displayName || item.subjectUserId}`} value={equipmentNotes[item.id] || ""} disabled={busy} onChange={(event) => setEquipmentNotes((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="Equipment evidence / waiver note (required for waiver)" />}{item.status === "completed" && <ClusterButton type="button" size="compact" variant="secondary" disabled={busy || Boolean(reviewingCredentials)} onClick={() => void reviewCredentialClosure(item)}>{reviewingCredentials === item.id ? "Inspecting…" : "Inspect credential closure"}</ClusterButton>}{item.status === "completed" && !item.returnedAt && <ClusterButton type="button" size="compact" variant="secondary" disabled={busy} onClick={() => void inspectReturn(item)}>Return to studio…</ClusterButton>}{credentialReviews[item.id] && <div className="studio-explanation-v272" role="status"><strong>Credential closure review · {credentialReviews[item.id].operatorReviewRequired ? "Operator review required" : "No remaining Cluster grants detected"}</strong><span>{Object.entries(credentialReviews[item.id].remaining).map(([kind, value]) => `${kind}: ${value}`).join(" · ")}</span>{credentialReviews[item.id].legacySettlementEvidenceMissing && <span>Older case: no credential settlement evidence recorded.</span>}{credentialReviews[item.id].exposedPreviouslyRevealedKeys > 0 && <span>{credentialReviews[item.id].exposedPreviouslyRevealedKeys} previously revealed keys still require external provider review.</span>}<span>{credentialReviews[item.id].note}</span></div>}{item.returnedAt && <span className="muted">Returned: {new Date(item.returnedAt).toLocaleDateString()} · fresh access provisioning required</span>}{item.status === "completed" && item.result && <div className="studio-explanation-v272"><strong>Completed</strong><span>{String(item.result.projectMembershipsEnded || 0)} project memberships ended · {String(item.result.libraryItemsTransferred || 0)} Library items transferred · {String(item.result.sessionsRevoked || 0)} sessions revoked · {String(item.result.inventoryAllocationsRevoked || 0)} digital Inventory allocations revoked · {String(item.result.physicalCustodyOutstanding || 0)} physical allocations still awaiting custody disposition · {String(item.result.packagePinsRevoked || 0)} Package pins revoked · {String(item.result.assignedKeysRevoked || 0)} keys revoked · {String(item.result.packageEntitlementsRevoked || 0)} Package entitlements revoked · {String(item.result.pendingInventoryRequestsCancelled || 0) + Number(item.result.pendingPackageRequestsCancelled || 0)} pending access reviews cancelled.</span>{Number(item.result.exposedKeysRequireExternalReview || 0) > 0 && <span role="alert">{String(item.result.exposedKeysRequireExternalReview)} previously revealed commercial keys require external provider-side revocation or rotation review. Disabling their Vault access cannot retract already disclosed values.</span>}</div>}</article>)}</div>
    </section>
    {returnCase && <div className="settings-card-v092" role="group" aria-label="Return to studio review">
      <strong>Return to studio: {returnCase.subject?.displayName || returnCase.subjectUserId}</strong>
      <p>This preserves the original person and historical records, but never restores previous Projects, roles, inventory entitlements, Package pins, security credentials, or employment automatically.</p>
      {returnPreview ? <>
        <div className="studio-explanation-v272"><strong>Identity retained, access reset</strong><span>Prior password, Discord link, security PIN and authenticators are invalidated. The account stays DISABLED until an authorized administrator provisions new credentials and permissions.</span></div>
        <label><span>New account type</span><ClusterNativeSelect value={returnAccountType} disabled={busy} onChange={(event) => setReturnAccountType(event.target.value)}><option value="employee">Employee</option><option value="contractor">Contractor</option><option value="client">Client</option><option value="guest">Guest</option></ClusterNativeSelect></label>
        <label><span>New access expiration{ returnAccountType !== "employee" ? " (required)" : " (optional)" }</span><ClusterInput type="date" value={returnExpires} disabled={busy} onChange={(event) => setReturnExpires(event.target.value)} /></label>
        <ClusterTextarea aria-label="Reason for return to studio" value={returnReason} disabled={busy} onChange={(event) => setReturnReason(event.target.value)} placeholder="Required: approval and reason for returning (10+ characters)" />
        <div className="button-row"><ClusterButton type="button" variant="quiet" disabled={busy} onClick={() => { setReturnCase(null); setReturnPreview(null); }}>Cancel return</ClusterButton><ClusterButton type="button" variant="primary" busy={busy} disabled={busy || returnReason.trim().length < 10 || (returnAccountType !== "employee" && !returnExpires) || (returnExpires ? new Date(`${returnExpires}T23:59:59`) <= new Date() : false)} onClick={() => void performReturn()}>Confirm governed return</ClusterButton></div>
      </> : <div className="button-row"><ClusterButton type="button" variant="quiet" disabled={busy} onClick={() => setReturnCase(null)}>Dismiss</ClusterButton></div>}
    </div>}
    {cancelCase && <div className="settings-card-v092" role="group" aria-label="Cancel offboarding case">
      <strong>Cancel planned offboarding for {cancelCase.subject?.displayName || cancelCase.subjectUserId}?</strong>
      <p>Cancellation preserves the case and its evidence. It does not revoke access or roll back an already completed offboarding.</p>
      <ClusterTextarea aria-label="Offboarding cancellation reason" value={cancelReason} disabled={busy} onChange={(event) => setCancelReason(event.target.value)} placeholder="Reason for cancellation (required)" />
      <div className="button-row"><ClusterButton type="button" variant="secondary" disabled={busy} onClick={() => { setCancelCase(null); setCancelReason(""); }}>Keep case</ClusterButton><ClusterButton type="button" variant="danger" busy={busy} disabled={busy || !cancelReason.trim()} onClick={() => void cancelPendingCase()}>Confirm cancellation</ClusterButton></div>
    </div>}
    <DangerConfirmDialog open={Boolean(confirmCase)} title="Complete offboarding?" description="This disables the account, revokes sessions, commercial-key access, digital seats and Package entitlements, cancels pending access approvals, and transfers governed responsibilities. Already revealed keys require separate provider-side review." resource={confirmCase?.subject?.displayName || confirmCase?.subjectUserId || "Person"} consequence="The user will no longer be able to sign in. Historical records remain preserved." confirmLabel="Complete offboarding" busy={busy} onCancel={() => !busy && setConfirmCase(null)} onConfirm={() => void executeCase()} />
  </div>;
}
