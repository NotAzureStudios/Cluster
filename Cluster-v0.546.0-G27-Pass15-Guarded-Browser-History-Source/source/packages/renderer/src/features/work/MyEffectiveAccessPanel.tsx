import { useRef, useState } from "react";
import { api } from "../../core/api";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterNativeSelect } from "../../components/ClusterNativeControls";

// This reuses the canonical server authorization engine. It never simulates
// permissions locally, requests another person's profile, or fetches in the
// background. Target/source ACLs remain independent of tool-level access.
const SELF_TOOLS = [
  { key: "mywork", label: "My Work" },
  { key: "people", label: "People" },
  { key: "packets", label: "Packets" },
  { key: "library", label: "Library" },
  { key: "calendar", label: "Calendar" },
] as const;

type Decision = {
  allowed: boolean;
  reason: string;
  code: string;
  contributors: Array<{ source: string; effect: string; detail: string }>;
  evaluatedAt: string;
};

export function MyEffectiveAccessPanel() {
  const [tool, setTool] = useState<(typeof SELF_TOOLS)[number]["key"]>("mywork");
  const [decision, setDecision] = useState<Decision | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const requestId = useRef(0);

  async function explain() {
    const sequence = ++requestId.current;
    setBusy(true); setDecision(null); setError("");
    try {
      const result = await api<{ ok: boolean; tool?: Decision }>(`/api/access/explain?tool=${encodeURIComponent(tool)}&action=view`);
      if (sequence !== requestId.current) return;
      if (!result.ok || !result.tool) throw new Error("No current permission decision was returned.");
      setDecision(result.tool);
    } catch (reason) {
      if (sequence === requestId.current) setError(reason instanceof Error ? reason.message : "Access could not be explained.");
    } finally { if (sequence === requestId.current) setBusy(false); }
  }
  return <section className="mywork-panel-v253" aria-label="My effective access">
    <header><div><h2>Why can I access this?</h2><span>Live permissions for your own account</span></div></header>
    <p className="muted">Check your current tool permission. Project, file, and record permissions may impose additional restrictions.</p>
    <div className="button-row">
      <label className="field"><span>Tool</span><ClusterNativeSelect value={tool} onChange={(event) => {
        ++requestId.current; setTool(event.target.value as typeof tool); setDecision(null); setError(""); setBusy(false);
      }}>{SELF_TOOLS.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</ClusterNativeSelect></label>
      <ClusterButton type="button" variant="secondary" disabled={busy} onClick={() => void explain()}>{busy ? "Checking…" : "Explain access"}</ClusterButton>
    </div>
    {error && <div className="error-box" role="alert">{error}</div>}
    {decision && <div className="settings-card-v092" role="status">
      <strong>{decision.allowed ? "Allowed" : "Not allowed"} · {decision.reason}</strong>
      <small>Evaluated {new Date(decision.evaluatedAt).toLocaleString()}</small>
      {decision.contributors.map((entry, index) => <div key={`${entry.source}:${index}`}><strong>{entry.source.replace(/[-_]/g, " ")} · {entry.effect}</strong><span>{entry.detail}</span></div>)}
      {!decision.contributors.length && <span>The authorization engine reported no additional contributing rules.</span>}
    </div>}
  </section>;
}
