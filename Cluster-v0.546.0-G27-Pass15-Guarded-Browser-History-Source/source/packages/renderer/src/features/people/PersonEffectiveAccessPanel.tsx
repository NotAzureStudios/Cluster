import { useEffect, useRef, useState } from "react";
import { api } from "../../core/api";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterNativeSelect } from "../../components/ClusterNativeControls";
import { TOOL_PERMISSION_OPTIONS } from "../../core/permissions";

type Decision = { allowed: boolean; reason: string; code: string; contributors: Array<{ source: string; effect: string; detail: string }>; evaluatedAt: string };

// On-demand, canonical API decision, never inferred from profile tool overrides.
// Inspecting someone else is authorized AGAIN by the server on every request.
export function PersonEffectiveAccessPanel({ personId, selfId }: { personId: string; selfId: string }) {
  const [tool, setTool] = useState("people");
  const [action, setAction] = useState<"view" | "contribute" | "manage">("view");
  const [decision, setDecision] = useState<Decision | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  // Invalidate in-flight responses when the person, permission level, or tool changes.
  useEffect(() => { ++sequence.current; setDecision(null); setError(""); setBusy(false); }, [personId, tool, action]);
  useEffect(() => () => { ++sequence.current; }, []);
  async function inspect() {
    const id = ++sequence.current;
    setBusy(true); setDecision(null); setError("");
    try {
      const params = new URLSearchParams({ userId: personId, tool, action });
      const result = await api<{ ok: boolean; tool?: Decision }>(`/api/access/explain?${params}`);
      if (id !== sequence.current) return;
      if (!result.ok || !result.tool) throw Error("The authorization server returned no decision.");
      setDecision(result.tool);
    } catch (cause) { if (id === sequence.current) setError(cause instanceof Error ? cause.message : "Could not explain access."); }
    finally { if (id === sequence.current) setBusy(false); }
  }
  return <section className="people-section-v244" aria-label="Effective permission explanation">
    <header className="people-section-heading-v417"><div><h3>Effective access explanation</h3><span>Live server decision for {personId === selfId ? "your account" : "this person's account"}</span></div></header>
    <p className="muted">Tool-level authorization only. Project memberships, records and Library permissions may impose additional restrictions.</p>
    <div className="button-row compact">
      <label className="field"><span>Tool</span><ClusterNativeSelect value={tool} onChange={event => setTool(event.target.value)}>{TOOL_PERMISSION_OPTIONS.map(entry => <option key={entry.key} value={entry.key}>{entry.label}</option>)}</ClusterNativeSelect></label>
      <label className="field"><span>Action</span><ClusterNativeSelect value={action} onChange={event => setAction(event.target.value as typeof action)}><option value="view">View</option><option value="contribute">Edit</option><option value="manage">Manage</option></ClusterNativeSelect></label>
      <ClusterButton variant="secondary" type="button" disabled={busy} onClick={() => void inspect()}>{busy ? "Checking…" : "Explain access"}</ClusterButton>
    </div>
    {error && <div role="alert" className="error-box">{error}</div>}
    {decision && <div className="settings-card-v092" role="status"><strong>{decision.allowed ? "Allowed" : "Denied"} · {decision.reason}</strong><small>Evaluated {new Date(decision.evaluatedAt).toLocaleString()}</small>{decision.contributors.map((entry, index) => <div key={`${entry.source}:${index}`}><strong>{entry.source.replace(/[-_]/g, " ")} · {entry.effect}</strong><span>{entry.detail}</span></div>)}</div>}
  </section>;
}
