import { useEffect, useMemo, useState } from "react";
import type { StudioAudience } from "@cluster/shared";
import { queryApi } from "../../core/api";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterInput, ClusterNativeSelect } from "../../components/ClusterNativeControls";

type TargetKind = Exclude<StudioAudience["targets"][number]["kind"], "studio">;
type Option = { id: string; label: string; detail?: string };
type Catalog = { departments: Option[]; teams: Option[]; roles: Option[]; projects: Option[]; users: Option[] };
const EMPTY: Catalog = { departments: [], teams: [], roles: [], projects: [], users: [] };
const labels: Record<TargetKind, string> = { department: "Department", team: "Team", role: "Role", project: "Project", user: "Person" };
const catalogKey: Record<TargetKind, keyof Catalog> = { department: "departments", team: "teams", role: "roles", project: "projects", user: "users" };

export function StudioAudiencePicker({ value, onChange, disabled = false, compact = false }: { value: StudioAudience; onChange: (value: StudioAudience) => void; disabled?: boolean; compact?: boolean }) {
  const [catalog, setCatalog] = useState<Catalog>(EMPTY);
  const [kind, setKind] = useState<TargetKind>("department");
  const [targetId, setTargetId] = useState("");
  const [manual, setManual] = useState("");
  useEffect(() => { let live = true; void queryApi<Catalog>("/api/studio-audience/options", { staleMs: 30_000, maxAgeMs: 5 * 60_000, tags: ["people", "studio-audience"] }).then((result) => { if (live) setCatalog(result); }).catch(() => {}); return () => { live = false; }; }, []);
  const options = catalog[catalogKey[kind]] || [];
  const optionLabel = useMemo(() => { const map = new Map<string, string>(); for (const type of Object.keys(catalogKey) as TargetKind[]) for (const option of catalog[catalogKey[type]]) map.set(`${type}:${option.id}`, option.label); return map; }, [catalog]);
  function addTarget() {
    const id = (targetId || manual).trim();
    if (!id) return;
    if (value.targets.some((item) => item.kind === kind && item.id === id)) return;
    onChange({ ...value, mode: value.mode === "all" ? "include" : value.mode, targets: [...value.targets, { kind, id }] });
    setTargetId(""); setManual("");
  }
  function setMode(mode: StudioAudience["mode"]) { onChange(mode === "all" ? { mode, targets: [] } : { ...value, mode }); }
  return <div className={compact ? "settings-card-v092" : "studio-explanation-v272"}>
    <div className="button-row">
      <ClusterNativeSelect value={value.mode} disabled={disabled} onChange={(event) => setMode(event.target.value as StudioAudience["mode"])} aria-label="Audience mode"><option value="all">Whole studio</option><option value="include">Only selected</option><option value="exclude">Everyone except selected</option></ClusterNativeSelect>
      {value.mode !== "all" && <><ClusterNativeSelect value={kind} disabled={disabled} onChange={(event) => { setKind(event.target.value as TargetKind); setTargetId(""); setManual(""); }} aria-label="Audience target type">{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</ClusterNativeSelect>{options.length ? <ClusterNativeSelect value={targetId} disabled={disabled} onChange={(event) => setTargetId(event.target.value)} aria-label={`Choose ${labels[kind]}`}><option value="">Choose {labels[kind].toLowerCase()}…</option>{options.map((option) => <option key={option.id} value={option.id}>{option.label}{option.detail ? ` · ${option.detail}` : ""}</option>)}</ClusterNativeSelect> : <ClusterInput value={manual} disabled={disabled} onChange={(event) => setManual(event.target.value)} placeholder={`${labels[kind]} identifier`} />} <ClusterButton type="button" size="compact" variant="secondary" disabled={disabled || !(targetId || manual).trim()} onClick={addTarget}>Add</ClusterButton></>}
    </div>
    {value.mode !== "all" && <div className="button-row">{value.targets.map((target, index) => <ClusterButton type="button" size="compact" variant="quiet" key={`${target.kind}:${target.id}:${index}`} disabled={disabled} onClick={() => onChange({ ...value, targets: value.targets.filter((_, itemIndex) => itemIndex !== index) })}>{labels[target.kind as TargetKind] || target.kind}: {optionLabel.get(`${target.kind}:${target.id}`) || target.id} ×</ClusterButton>)}{!value.targets.length && <span className="muted">Choose at least one audience target.</span>}</div>}
  </div>;
}
