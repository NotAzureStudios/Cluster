import { useEffect, useMemo, useRef, useState } from "react";
import type { StudioAudience } from "@cluster/shared";
import { queryApi } from "../../core/api";
import { ClusterIcon } from "../../components/ClusterIcon";

type Kind = "team" | "department" | "project" | "role" | "user";
type Option = { id: string; label: string; detail?: string };
export type AudienceCatalog = Record<"teams" | "departments" | "projects" | "roles" | "users", Option[]>;
const KINDS: Array<[Kind, keyof AudienceCatalog, string]> = [["team", "teams", "Team"], ["department", "departments", "Department"], ["project", "projects", "Project"], ["role", "roles", "Role"], ["user", "users", "Person"]];

export function useAudienceCatalog(enabled = true) {
  const [catalog, setCatalog] = useState<AudienceCatalog | null>(null);
  useEffect(() => { if (!enabled) return; let live = true; void queryApi<AudienceCatalog>("/api/studio-audience/options", { staleMs: 30_000, maxAgeMs: 5 * 60_000, tags: ["people", "studio-audience"] }).then((value) => { if (live) setCatalog(value); }).catch(() => undefined); return () => { live = false; }; }, [enabled]);
  return catalog;
}

/** "Everyone" or a short list of who it went to, for message headers. */
export function describeAudience(audience: StudioAudience | null | undefined, catalog: AudienceCatalog | null) {
  if (!audience || audience.mode === "all" || !audience.targets.length) return "Everyone";
  const name = (kind: string, id: string) => {
    const key = KINDS.find(([entry]) => entry === kind)?.[1];
    return (key && catalog?.[key].find((option) => option.id === id)?.label) || kind;
  };
  const names = audience.targets.map((target) => name(target.kind, String(target.id || "")));
  const list = names.length > 3 ? `${names.slice(0, 3).join(", ")} +${names.length - 3}` : names.join(", ");
  return audience.mode === "exclude" ? `Everyone except ${list}` : list;
}

/** Recipients: Everyone by default; type to add teams, departments,
 *  projects, roles or people. */
export function AudienceField({ value, onChange, catalog }: { value: StudioAudience; onChange: (value: StudioAudience) => void; catalog: AudienceCatalog | null }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const close = (event: MouseEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  const chosen = new Set(value.targets.map((target) => `${target.kind}:${target.id}`));
  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rows: Array<Option & { kind: Kind; kindLabel: string }> = [];
    for (const [kind, key, kindLabel] of KINDS) for (const option of catalog?.[key] || []) {
      if (chosen.has(`${kind}:${option.id}`)) continue;
      if (needle && !`${option.label} ${option.detail || ""}`.toLowerCase().includes(needle)) continue;
      rows.push({ ...option, kind, kindLabel });
    }
    return rows.slice(0, 40);
  }, [catalog, query, value]);
  const add = (kind: Kind, id: string) => { onChange({ mode: "include", targets: [...value.targets, { kind, id }] }); setQuery(""); setCursor(0); };
  const remove = (index: number) => { const targets = value.targets.filter((_, at) => at !== index); onChange(targets.length ? { mode: "include", targets } : { mode: "all", targets: [] }); };

  return <div className="chat__to" ref={box}>
    <span className="chat__to-label">To</span>
    {value.targets.length ? value.targets.map((target, index) => <button key={`${target.kind}:${target.id}`} type="button" className="chat__chip" data-kind={target.kind} title="Remove" onClick={() => remove(index)}>
      {describeAudience({ mode: "include", targets: [target] }, catalog)}<ClusterIcon name="close" />
    </button>) : <span className="chat__chip chat__chip--all">Everyone</span>}
    <input value={query} placeholder={value.targets.length ? "Add more" : "Add a team, department, project or person"} aria-label="Add recipients"
      onFocus={() => setOpen(true)} onChange={(event) => { setQuery(event.target.value); setOpen(true); setCursor(0); }}
      onKeyDown={(event) => {
        if (event.key === "ArrowDown") { event.preventDefault(); setCursor((at) => Math.min(at + 1, matches.length - 1)); }
        else if (event.key === "ArrowUp") { event.preventDefault(); setCursor((at) => Math.max(at - 1, 0)); }
        else if (event.key === "Enter" && open && matches[cursor]) { event.preventDefault(); add(matches[cursor].kind, matches[cursor].id); }
        else if (event.key === "Backspace" && !query && value.targets.length) remove(value.targets.length - 1);
        else if (event.key === "Escape") setOpen(false);
      }} />
    {open && matches.length ? <ul className="chat__to-menu" role="listbox">
      {matches.map((option, index) => <li key={`${option.kind}:${option.id}`} role="option" aria-selected={index === cursor}
        onMouseEnter={() => setCursor(index)} onMouseDown={(event) => { event.preventDefault(); add(option.kind, option.id); }}>
        <span>{option.label}</span>{option.detail ? <small>{option.detail}</small> : null}<em>{option.kindLabel}</em>
      </li>)}
    </ul> : null}
  </div>;
}
