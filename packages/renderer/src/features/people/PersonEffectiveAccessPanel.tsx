import { useEffect, useRef, useState } from "react";
import { api } from "../../core/api";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterSelect } from "../../components/ClusterSelect";
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
  return <section className="pp-card" aria-label="Check access">
    <header><h3>Check access</h3><span>Live decision for tool access; projects and folders can restrict further</span></header>
    <div className="pp-check">
      <ClusterSelect ariaLabel="Tool" value={tool} onChange={setTool} options={TOOL_PERMISSION_OPTIONS.map(entry => ({ value: entry.key, label: entry.label }))} />
      <ClusterSelect ariaLabel="Action" value={action} onChange={value => setAction(value as typeof action)} options={[{ value: "view", label: "View" }, { value: "contribute", label: "Edit" }, { value: "manage", label: "Manage" }]} />
      <ClusterButton variant="secondary" size="compact" type="button" busy={busy} onClick={() => void inspect()}>Check</ClusterButton>
    </div>
    {error && <p role="alert" className="pp-feedback error">{error}</p>}
    {decision && <div className={`pp-decision ${decision.allowed ? "allowed" : "denied"}`} role="status">
      <strong>{decision.allowed ? "Allowed" : "Denied"}</strong><span>{decision.reason}</span>
      {decision.contributors.length ? <ul>{decision.contributors.map((entry, index) => <li key={`${entry.source}:${index}`}><b>{entry.source.replace(/[-_]/g, " ")} · {entry.effect}</b> {entry.detail}</li>)}</ul> : null}
    </div>}
  </section>;
}
