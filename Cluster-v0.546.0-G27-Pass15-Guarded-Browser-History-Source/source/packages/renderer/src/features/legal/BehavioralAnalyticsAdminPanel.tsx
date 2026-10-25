import { useEffect, useState } from "react";
import { api } from "../../core/api";
import { ClusterTextArea } from "../../components/ClusterTextArea";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterInput } from "../../components/ClusterNativeControls";

type AnalyticsProvider = { id: string; name: string; purpose: string; enabled: boolean; configuredEnabled: boolean; collectScreenViews: boolean; collectFeatureActions: boolean; reviewed: boolean; reviewedAt: string | null; retentionDays: number; dataCategories: string[] };
type AnalyticsResponse = { ok: true; provider: AnalyticsProvider; aggregate: { windowDays: number; events: number; consentingUsersObserved: number; byEvent: Array<{ eventName: string; count: number }>; topSurfaces: Array<{ surface: string; count: number }>; rawUserDrilldownAvailable: false } };

export function BehavioralAnalyticsAdminPanel() {
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [draft, setDraft] = useState({ name: "", purpose: "", collectScreenViews: true });
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  async function load() {
    try {
      const next = await api<AnalyticsResponse>("/api/admin/legal/analytics");
      setData(next); setDraft({ name: next.provider.name, purpose: next.provider.purpose, collectScreenViews: next.provider.collectScreenViews }); setMessage("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Analytics configuration unavailable."); }
  }
  useEffect(() => { void load(); }, []);
  async function update(input: Record<string, unknown>) {
    setSaving(true);
    try {
      const response = await api<{ ok: true; provider: AnalyticsProvider; reviewInvalidated?: boolean }>("/api/admin/legal/analytics/provider", { method: "PATCH", body: JSON.stringify(input) });
      setMessage(response.reviewInvalidated ? "Material changes saved. Review was invalidated and analytics remains disabled until reviewed again." : "Analytics configuration saved.");
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Analytics configuration could not be saved."); } finally { setSaving(false); }
  }
  const provider = data?.provider;
  return <div className="settings-section-v092 studio-settings-section-v272"><div className="settings-panel-head-v092 studio-section-intro-v272"><div><p className="eyebrow">Behavioral analytics</p><h2>Consent-gated usage analytics</h2><p className="muted">First-party analytics is disabled by default. Cluster records only coarse screen/event identifiers after both administrator review and explicit user analytics consent. Search text, project IDs, file names, URLs, message content, and arbitrary properties are not accepted by the event API.</p></div>{provider ? <span className="settings-status-chip-v272">{provider.enabled ? "Enabled" : provider.reviewed ? "Reviewed · disabled" : "Not reviewed"}</span> : null}</div>
  {provider ? <><div className="settings-card-grid-v092"><div className="settings-card-v092"><div className="settings-card-head-v092"><h3>30-day events</h3><span>{data?.aggregate.events ?? 0}</span></div><p className="muted">Across {data?.aggregate.consentingUsersObserved ?? 0} consenting account{data?.aggregate.consentingUsersObserved === 1 ? "" : "s"}. No per-user analytics drilldown is exposed.</p></div><div className="settings-card-v092"><div className="settings-card-head-v092"><h3>Retention</h3><span>{provider.retentionDays} days</span></div><p className="muted">Managed by the Behavioral analytics retention category in Data Retention.</p></div></div>
  <div className="settings-card-v092 span-2"><div className="settings-card-head-v092"><h3>Provider configuration</h3><span>Self-hosted first-party</span></div><div className="form-grid two-col"><label className="field"><span>Name</span><ClusterTextInput value={draft.name} onChange={(e) => setDraft((c) => ({ ...c, name: e.target.value }))} /></label><label className="field span-2"><span>Purpose</span><ClusterTextArea rows={3} value={draft.purpose} onChange={(e) => setDraft((c) => ({ ...c, purpose: e.target.value }))} /></label><label className="check-row span-2"><ClusterInput type="checkbox" checked={draft.collectScreenViews} onChange={(e) => setDraft((c) => ({ ...c, collectScreenViews: e.target.checked }))} /><span>Collect coarse screen-view events after consent</span></label></div><div className="settings-inline-note-v272"><strong>Data categories</strong><span>{provider.dataCategories.join(" · ")}</span></div><div className="button-row"><ClusterButton type="button" className="" disabled={saving} onClick={() => void update({ ...draft, enabled: false })} variant="secondary">Save draft</ClusterButton>{provider.enabled ? <ClusterButton type="button" disabled={saving} onClick={() => void update({ enabled: false })} variant="secondary">Disable collection</ClusterButton> : null}<ClusterButton type="button" className="" disabled={saving} onClick={() => void update({ ...draft, reviewed: true, enabled: true })} variant="primary">Review & enable</ClusterButton></div></div>
  <div className="settings-card-v092 span-2"><div className="settings-card-head-v092"><h3>Aggregate screen adoption</h3><span>Last {data?.aggregate.windowDays || 30} days</span></div>{data?.aggregate.topSurfaces.length ? <div className="privacy-consent-inventory-v363">{data.aggregate.topSurfaces.map((row) => <section key={row.surface}><strong>{row.surface}</strong><div><span>{row.count} views</span></div></section>)}</div> : <p className="muted">No consented screen-view events have been recorded.</p>}</div></> : null}
  {message ? <div className="settings-inline-note-v272"><span>{message}</span></div> : null}</div>;
}
