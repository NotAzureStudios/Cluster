import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../../core/api";
import { promptCluster } from "../../components/cluster-dialog-service";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterButton } from "../../components/ClusterButton";
import "./data-retention-admin.css";
import { ClusterInput } from "../../components/ClusterNativeControls";

export type RetentionPolicyRow = {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  retentionDays: number;
  defaultDays: number;
  minimumDays: number;
  maximumDays: number;
  cutoff?: string;
  totalCount?: number;
  eligibleCount?: number;
  wouldDelete?: number;
};

type InventoryResponse = {
  ok: true;
  inventory: {
    generatedAt: string;
    configurable: RetentionPolicyRow[];
    protected: Array<{ key: string; label: string; count: number; retention: string; reason: string }>;
    delegated: Array<{ key: string; label: string; retentionDays: number; retention: string; reason: string }>;
  };
};

type PreviewResponse = { ok: true; generatedAt: string; rows: RetentionPolicyRow[]; totalWouldDelete: number };
type RunsResponse = { ok: true; runs: Array<{ id: string; trigger: string; status: string; createdAt: string; completedAt?: string | null; result?: { totalDeleted?: number } }> };

function prettyDate(value?: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function DataRetentionAdminPanel() {
  const [inventory, setInventory] = useState<InventoryResponse["inventory"] | null>(null);
  const [policies, setPolicies] = useState<RetentionPolicyRow[]>([]);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [runs, setRuns] = useState<RunsResponse["runs"]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [inventoryResult, previewResult, runResult] = await Promise.all([
        api<InventoryResponse>("/api/admin/privacy/data-inventory"),
        api<PreviewResponse>("/api/admin/privacy/retention-preview"),
        api<RunsResponse>("/api/admin/privacy/retention-runs?limit=8"),
      ]);
      setInventory(inventoryResult.inventory);
      setPolicies(previewResult.rows);
      setPreview(previewResult);
      setRuns(runResult.runs || []);
      setStatus("");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Retention inventory could not be loaded.");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const eligibleTotal = useMemo(() => policies.reduce((sum, row) => sum + Number(row.wouldDelete || 0), 0), [policies]);

  function patchPolicy(key: string, patch: Partial<RetentionPolicyRow>) {
    setPolicies((current) => current.map((row) => row.key === key ? { ...row, ...patch } : row));
  }

  async function savePolicies() {
    const confirmation = await promptCluster({ title: "Update retention policy?", message: "Saving changes updates the studio retention policy but does not delete records.", label: "Required confirmation", expectedValue: "UPDATE RETENTION POLICY", confirmLabel: "Save policy" }) || "";
    if (confirmation !== "UPDATE RETENTION POLICY") { setStatus("Retention policy update cancelled."); return; }
    setBusy(true);
    try {
      await api("/api/admin/privacy/retention-policies", {
        method: "PUT",
        headers: { "X-Cluster-Confirmation": confirmation },
        body: JSON.stringify({ policies: policies.map((row) => ({ category: row.key, enabled: row.enabled, retentionDays: row.retentionDays })) }),
      });
      setStatus("Retention policy saved. No records were deleted.");
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Retention policy could not be saved.");
      setBusy(false);
    }
  }

  async function applyRetention() {
    const confirmation = await promptCluster({ title: "Apply data retention?", message: `The current dry run finds ${eligibleTotal} eligible record${eligibleTotal === 1 ? "" : "s"}. Only those records will be deleted.`, label: "Required confirmation", expectedValue: "APPLY DATA RETENTION", confirmLabel: "Apply retention", tone: "danger" }) || "";
    if (confirmation !== "APPLY DATA RETENTION") { setStatus("Retention run cancelled."); return; }
    setBusy(true);
    try {
      const result = await api<{ ok: true; totalDeleted: number }>("/api/admin/privacy/retention-apply", { method: "POST", headers: { "X-Cluster-Confirmation": confirmation } });
      setStatus(`Retention completed. ${result.totalDeleted} record${result.totalDeleted === 1 ? "" : "s"} deleted.`);
      await load();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Retention run failed.");
      setBusy(false);
    }
  }

  return <div className="settings-section-v092 studio-settings-section-v272 data-retention-admin-v365">
    <div className="settings-panel-head-v092 studio-section-intro-v272">
      <div>
        <p className="eyebrow">Data lifecycle</p>
        <h2>Inventory & retention</h2>
        <p className="muted">Configure age-based cleanup only for operational data that Cluster can safely prune. Authoritative work, legal evidence, security audit events, and project files remain outside unattended deletion.</p>
      </div>
      <div className="button-row compact">
        <ClusterButton type="button" className="" onClick={() => void load()} disabled={busy} variant="secondary">Refresh dry run</ClusterButton>
        <ClusterButton type="button" className="" onClick={savePolicies} disabled={busy || !policies.length} variant="primary">Save policy</ClusterButton>
      </div>
    </div>

    {status && <div className="status-box system-status-box-v053">{status}</div>}

    <div className="retention-summary-v365">
      <div><span>Configurable categories</span><strong>{policies.length}</strong></div>
      <div><span>Dry-run eligible</span><strong>{preview?.totalWouldDelete ?? eligibleTotal}</strong></div>
      <div><span>Protected/manual</span><strong>{inventory?.protected.length ?? "—"}</strong></div>
      <div><span>Last execution</span><strong>{runs[0] ? prettyDate(runs[0].completedAt || runs[0].createdAt) : "Never"}</strong></div>
    </div>

    <div className="retention-policy-list-v365">
      {policies.map((row) => <article key={row.key} className="settings-card-v092 retention-policy-card-v365">
        <div className="settings-card-head-v092">
          <div><h3>{row.label}</h3><span>{row.totalCount ?? 0} stored · {row.wouldDelete ?? 0} currently eligible</span></div>
          <label className="retention-toggle-v365"><ClusterInput type="checkbox" checked={row.enabled} onChange={(event) => patchPolicy(row.key, { enabled: event.target.checked })} /> Automatic</label>
        </div>
        <p className="muted">{row.description}</p>
        <div className="retention-policy-controls-v365">
          <label>Retain for <ClusterTextInput type="number" min={row.minimumDays} max={row.maximumDays} value={row.retentionDays} disabled={!row.enabled} onChange={(event) => patchPolicy(row.key, { retentionDays: Math.max(row.minimumDays, Math.min(row.maximumDays, Number(event.target.value || row.defaultDays))) })} /> days</label>
          <small>Allowed {row.minimumDays}–{row.maximumDays} days{row.cutoff ? ` · cutoff ${prettyDate(row.cutoff)}` : ""}</small>
        </div>
      </article>)}
    </div>

    <div className="settings-card-grid-v092 retention-inventory-grid-v365">
      <section className="settings-card-v092">
        <div className="settings-card-head-v092"><h3>Protected / manual data</h3><span>No unattended deletion</span></div>
        <div className="retention-inventory-list-v365">
          {(inventory?.protected || []).map((row) => <div key={row.key}><strong>{row.label}</strong><span>{row.count} records · {row.retention}</span><small>{row.reason}</small></div>)}
        </div>
      </section>
      <section className="settings-card-v092">
        <div className="settings-card-head-v092"><h3>Delegated lifecycle rules</h3><span>Managed elsewhere</span></div>
        <div className="retention-inventory-list-v365">
          {(inventory?.delegated || []).map((row) => <div key={row.key}><strong>{row.label}</strong><span>{row.retentionDays} days · {row.retention}</span><small>{row.reason}</small></div>)}
        </div>
      </section>
    </div>

    <section className="settings-card-v092 retention-apply-card-v365">
      <div className="settings-card-head-v092"><h3>Apply retention</h3><span>Destructive · recent authentication required</span></div>
      <p className="muted">The preview is recalculated server-side when the run begins. A single database transaction deletes eligible operational rows; protected/manual categories are not part of the transaction.</p>
      <div className="button-row"><ClusterButton type="button" className="" onClick={applyRetention} disabled={busy || eligibleTotal <= 0} variant="danger">Apply current retention</ClusterButton><span className="muted">{eligibleTotal > 0 ? `${eligibleTotal} record${eligibleTotal === 1 ? "" : "s"} eligible in the current dry run.` : "Nothing is currently eligible."}</span></div>
    </section>

    <section className="settings-card-v092">
      <div className="settings-card-head-v092"><h3>Recent retention runs</h3><span>{runs.length}</span></div>
      <div className="retention-run-list-v365">
        {runs.length ? runs.map((run) => <div key={run.id}><strong>{run.status}</strong><span>{run.trigger} · {prettyDate(run.completedAt || run.createdAt)}</span><small>{Number(run.result?.totalDeleted || 0)} deleted · {run.id}</small></div>) : <p className="muted">No retention runs recorded yet.</p>}
      </div>
    </section>
  </div>;
}
