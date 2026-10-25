import { useRef, useState } from "react";
import { api } from "../../core/api";
import { ClusterButton, ClusterIconButton } from "../../components/ClusterButton";
import { ClusterSelect } from "../../components/ClusterSelect";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterTextArea } from "../../components/ClusterTextArea";
import { ClusterModal } from "../../components/ClusterModal";
import { LibraryIcon } from "./LibraryIcons";
import type { LibraryItem } from "./library-types";

type Impact = {
  ok: true; action: "place-hold" | "extend-retention"; retentionUntil: string | null; scope?: "hierarchy"; rootCount?: number;
  digest: string; selectedCount: number; changeCount: number; unchangedCount: number; blockedCount: number;
  references: Record<string, number>; coverage: string;
  items: Array<{ id: string; title: string; revision: number; outcome: "change" | "unchanged" | "blocked"; reason: string | null;
    current: { legalHold: boolean; retentionUntil: string | null };
    links: { backlinks: number; versions: number; derivatives: number; personnelAttachments: number; childItems: number; packetDefinitions: number } }>;
};

/** G26 WS9. The modal never authorizes a write: the server rechecks preview evidence
 * and all permissions within the Serializable commit. Any edit invalidates preview.
 */
export function LibraryGovernanceBulkModal({ selected, onClose, onChanged, isSelectionCurrent }: {
  selected: LibraryItem[]; onClose: () => void; onChanged: (changed: number) => void;
  isSelectionCurrent: () => boolean;
}) {
  const [action, setAction] = useState<"place-hold" | "extend-retention">("place-hold");
  const [date, setDate] = useState("");
  const [scope, setScope] = useState<"selected" | "hierarchy">("selected");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<Impact | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const selection = selected.map((item) => ({ id: item.id, revision: item.revision }));
  const hierarchyEligible = selected.length <= 8 && selected.every((item) => item.type === "folder" &&
    !["packets-root", "project-folder"].includes(String(item.source || "")));
  const payload = () => ({
    ...(scope === "hierarchy" ? { roots: selection } : {
      ids: selection.map((item) => item.id),
      expectedRevisions: Object.fromEntries(selection.map((item) => [item.id, item.revision])),
    }),
    action, ...(action === "extend-retention" && date ? { retentionUntil: `${date}T23:59:59.000Z` } : {}),
  });
  const endpoint = (verb: "preview" | "apply") => scope === "hierarchy"
    ? `/api/library/bulk/governance/hierarchy/${verb}` : `/api/library/bulk/governance/${verb}`;
  const changeScope = (next: string) => { setScope(next as typeof scope); setPreview(null); setError(""); };
  const changeAction = (next: string) => { setAction(next as typeof action); setPreview(null); setError(""); };
  const changeDate = (next: string) => { setDate(next); setPreview(null); setError(""); };
  async function fetchPreview() {
    if (inFlight.current || !isSelectionCurrent()) { setError("Library selection changed. Close and reselect the items."); return; }
    if (scope === "hierarchy" && !hierarchyEligible) { setError("Choose up to eight ordinary folders for subtree protection."); return; }
    inFlight.current = true; setBusy(true); setError(""); setPreview(null);
    try {
      const result = await api<Impact>(endpoint("preview"), { method: "POST", body: JSON.stringify(payload()) });
      if (!isSelectionCurrent()) throw new Error("Selection changed while reviewing. Close and select again.");
      setPreview(result);
    } catch (error) { setError(error instanceof Error ? error.message : "Governance preview failed."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function apply() {
    if (inFlight.current || !preview || preview.blockedCount || !preview.changeCount || reason.trim().length < 12) return;
    if (!isSelectionCurrent()) { setPreview(null); setError("Library selection changed. Reopen governance review."); return; }
    inFlight.current = true; setBusy(true); setError("");
    try {
      const result = await api<{ ok: true; changedCount: number }>(endpoint("apply"), {
        method: "POST", body: JSON.stringify({ ...payload(), digest: preview.digest, reason: reason.trim() }),
      });
      onChanged(result.changedCount);
    } catch (error) { setPreview(null); setError(error instanceof Error ? error.message : "Governance could not be applied. Review again."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <ClusterModal open onClose={() => { if (!busy) onClose(); }} className="modal panel library-bulk-rename-v533" ariaLabel="Bulk Library retention and hold review">
    <div className="modal-header"><div><p className="eyebrow">Library · retention governance</p><h2>Review {selection.length} selected items</h2></div>
      <ClusterIconButton label="Close retention review" disabled={busy} onClick={onClose}><LibraryIcon name="close" size={20} /></ClusterIconButton></div>
    <p className="muted">Administrator-only, additive protection. Place holds or extend retention, it cannot lift holds, shorten retention or delete files. Subtree mode protects the folder records and each descendant, with no implicit permissions granted.</p>
    <label className="field"><span>Impact scope</span><ClusterSelect ariaLabel="Retention governance scope" value={scope} disabled={busy} onChange={changeScope} options={[
      { value: "selected", label: "Selected standalone items" },
      { value: "hierarchy", label: "Selected folders and every descendant (up to 160 objects)" },
    ]} /></label>
    {scope === "hierarchy" && !hierarchyEligible && <p role="alert" className="muted">Select 1–8 ordinary folders only. Managed Project and Packet roots are excluded.</p>}
    <label className="field"><span>Governance change</span><ClusterSelect ariaLabel="Retention governance operation" value={action} disabled={busy} onChange={changeAction} options={[
      { value: "place-hold", label: "Place a legal/administrative hold" }, { value: "extend-retention", label: "Extend retention deadline" },
    ]} /></label>
    {action === "extend-retention" && <label className="field"><span>Retain through (UTC)</span><ClusterTextInput type="date" value={date} disabled={busy} onChange={(event) => changeDate(event.target.value)} />
      <small className="muted">Deadline is 23:59:59 UTC on the selected date. Earlier existing deadlines will be extended; later deadlines remain unchanged.</small></label>}
    <label className="field"><span>Audit reason (at least 12 characters)</span><ClusterTextArea value={reason} disabled={busy} maxLength={1000} onChange={(event) => setReason(event.target.value)} placeholder="Why are these materials being retained?" /></label>
    {preview && <section className="library-bulk-rename-preview-v533" aria-live="polite">
      <strong>{preview.changeCount} to strengthen · {preview.unchangedCount} already protected · {preview.blockedCount} blocked</strong>
      {preview.scope === "hierarchy" && <p className="muted">{preview.rootCount} root folders · {preview.selectedCount} total objects, including descendants. All must be eligible or nothing changes.</p>}
      <p className="muted">Known relationships: {Object.entries(preview.references).map(([name, count]) => `${name} ${count}`).join(" · ")}</p>
      <p className="muted">{preview.coverage}</p>
      <div className="library-bulk-rename-lines-v533" role="list" aria-label="Retention governance item outcomes">{preview.items.map((item) => <div key={item.id} role="listitem">
        <span title={item.title}>{item.title}</span><span>{item.outcome}</span><span>{item.reason || (item.outcome === "unchanged" ? "Existing protection is stronger" : action === "place-hold" ? "Add hold" : "Extend deadline")}</span>
      </div>)}</div>
      {preview.blockedCount > 0 && <p role="alert">Resolve blocked items separately. The entire bulk commit is disabled; there are no partial governance updates.</p>}
    </section>}
    {error && <p className="error-box slim" role="alert">{error}</p>}
    <div className="modal-actions"><ClusterButton variant="secondary" disabled={busy} onClick={onClose}>Cancel</ClusterButton>
      <ClusterButton variant="secondary" busy={busy} disabled={busy || (scope === "hierarchy" && !hierarchyEligible) || (action === "extend-retention" && !date)} onClick={() => void fetchPreview()}>Preview impact</ClusterButton>
      <ClusterButton variant="primary" busy={busy} disabled={busy || !preview || preview.blockedCount > 0 || preview.changeCount === 0 || reason.trim().length < 12} onClick={() => void apply()}>Apply reviewed protection</ClusterButton>
    </div>
  </ClusterModal>;
}
