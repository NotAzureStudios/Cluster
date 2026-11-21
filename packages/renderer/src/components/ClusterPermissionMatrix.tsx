import { useState } from "react";
import { ClusterIcon } from "./ClusterIcon";
import "./cluster-permission-matrix.css";

/** A presentation-only permission matrix. Role/department policy and allowed
 * transitions remain owned by the caller and verified by the server.
 *
 * One line per tool: a level control where the lit segment is the effective
 * level. Inherited levels are lit softly; overrides are lit in the accent and
 * get a reset button. Clicking the inherited level, or reset, returns the
 * tool to inherit. Styled by cluster-permission-matrix.css (pm-*) only. */
export type ClusterPermissionMatrixGroup<Key extends string> = {
  id: string;
  label: string;
  description?: string;
  rows: readonly { key: Key; label: string; description?: string }[];
};

export type ClusterPermissionMatrixChoice<Level extends string> = {
  value: Level;
  label: string;
  description?: string;
};

export function ClusterPermissionMatrix<Key extends string, Level extends string>({
  label,
  groups,
  choices,
  value,
  inherited,
  onChange,
  readOnly = false,
  inheritValue,
  fallbackEffective,
}: {
  label: string;
  groups: readonly ClusterPermissionMatrixGroup<Key>[];
  choices: readonly ClusterPermissionMatrixChoice<Level>[];
  value?: Readonly<Partial<Record<Key, Level>>>;
  inherited: Readonly<Partial<Record<Key, Level>>>;
  onChange: (key: Key, level: Level) => void;
  readOnly?: boolean;
  inheritValue: Level;
  fallbackEffective: Level;
}) {
  const [search, setSearch] = useState("");
  const [overridesOnly, setOverridesOnly] = useState(false);
  const levels = choices.filter((choice) => choice.value !== inheritValue);
  const term = search.trim().toLocaleLowerCase();
  const isOverride = (key: Key) => value?.[key] !== undefined && value?.[key] !== inheritValue;
  const visibleGroups = groups.map((group) => ({
    ...group,
    rows: group.rows.filter((row) => {
      if (overridesOnly && !isOverride(row.key)) return false;
      if (!term) return true;
      return (group.label + " " + row.label + " " + row.key + " " + (row.description || "")).toLocaleLowerCase().includes(term);
    }),
  })).filter((group) => group.rows.length > 0);
  const overrideCount = groups.reduce((count, group) => count + group.rows.filter((row) => isOverride(row.key)).length, 0);

  return <div className="pm" role="group" aria-label={label}>
    <div className="pm-bar">
      <label className="pm-search">
        <ClusterIcon name="search" aria-hidden="true" />
        <input type="search" value={search} placeholder="Find a tool" aria-label="Find a tool" autoComplete="off" onChange={(event) => setSearch(event.target.value)} />
      </label>
      <button type="button" className="pm-chip" aria-pressed={overridesOnly} disabled={!overrideCount && !overridesOnly} onClick={() => setOverridesOnly((current) => !current)}>
        Overrides<b>{overrideCount}</b>
      </button>
      {readOnly ? <span className="pm-readonly"><ClusterIcon name="lock" aria-hidden="true" />Read only</span> : null}
      <span className="pm-legend" aria-hidden="true"><i data-kind="inherited" />Inherited<i data-kind="override" />Override</span>
    </div>
    {!visibleGroups.length ? <p className="pm-empty">No tools match.</p> : null}
    <div className="pm-table">
      {visibleGroups.map((group) => <section key={group.id} className="pm-group" aria-label={group.label}>
        <h4 title={group.description}>{group.label}</h4>
        {group.rows.map((row) => {
          const selected = value?.[row.key] ?? inheritValue;
          const baseline = inherited[row.key] ?? fallbackEffective;
          const overridden = selected !== inheritValue;
          const effective = overridden ? selected : baseline;
          const baselineLabel = levels.find((level) => level.value === baseline)?.label || baseline;
          return <div key={row.key} className="pm-row" data-override={overridden || undefined}>
            <span className="pm-tool" title={row.description}>{row.label}</span>
            <span className="pm-levels" role="radiogroup" aria-label={`${row.label} access`}>
              {levels.map((level) => {
                const lit = effective === level.value;
                return <button key={level.value} type="button" role="radio" aria-checked={lit}
                  data-lit={lit ? (overridden ? "override" : "inherited") : undefined}
                  data-baseline={baseline === level.value || undefined}
                  disabled={readOnly}
                  title={level.value === baseline ? `${level.label} — inherited` : level.label}
                  onClick={() => onChange(row.key, level.value === baseline ? inheritValue : level.value)}>
                  {level.label}
                </button>;
              })}
            </span>
            <span className="pm-reset">
              {overridden && !readOnly ? <button type="button" title={`Back to inherited (${baselineLabel})`} aria-label={`Reset ${row.label} to inherited ${baselineLabel}`} onClick={() => onChange(row.key, inheritValue)}><ClusterIcon name="refresh" aria-hidden="true" /></button> : null}
            </span>
          </div>;
        })}
      </section>)}
    </div>
  </div>;
}
