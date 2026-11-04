import { useId } from "react";
import "./cluster-permission-matrix.css";

/** A presentation-only permission matrix. Role/department policy and allowed
 * transitions remain owned by the caller and verified by the server. */
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
  const id = useId();
  return <div className="cluster-permission-matrix-v11" aria-label={label}>
    <div className="cluster-permission-matrix-intro-v11">
      <span>Choose a level per tool. Inherit keeps the existing baseline. Changes are reviewed and saved through the surrounding workspace.</span>
      {readOnly ? <strong>Read only</strong> : null}
    </div>
    {groups.map((group) => {
      const overrides = group.rows.filter((row) => value?.[row.key] !== undefined).length;
      const groupId = id + "-" + group.id;
      return <section key={group.id} className="cluster-permission-matrix-group-v11" aria-labelledby={groupId + "-title"}>
        <header className="cluster-permission-matrix-group-header-v11">
          <div>
            <h4 id={groupId + "-title"}>{group.label}</h4>
            {group.description ? <p>{group.description}</p> : null}
          </div>
          <span className="cluster-permission-matrix-overrides-v11">{overrides} / {group.rows.length} overrides</span>
        </header>
        <div className="cluster-permission-matrix-scroll-v11" role="region" tabIndex={0}
          aria-label={group.label + " permission choices. Scroll horizontally if necessary."}>
          <table>
            <thead><tr>
              <th scope="col">Tool</th>
              {choices.map((choice) => <th scope="col" key={choice.value} title={choice.description || choice.label}>{choice.label}</th>)}
              <th scope="col">Effective</th>
            </tr></thead>
            <tbody>
              {group.rows.map((row) => {
                const selected = value?.[row.key] ?? inheritValue;
                const baseline = inherited[row.key] ?? fallbackEffective;
                const effective = selected === inheritValue ? baseline : selected;
                const rowId = groupId + "-" + row.key;
                const effectiveDescription = selected === inheritValue ? "Inherited " + baseline : "Explicit " + effective;
                return <tr key={row.key} data-override={selected === inheritValue ? "inherited" : "explicit"}>
                  <th scope="row">
                    <span className="cluster-permission-matrix-tool-v11">{row.label}</span>
                    <span className="cluster-permission-matrix-sr-only-v11" id={rowId + "-description"}>
                      {row.description || row.label}. Baseline: {baseline}. {effectiveDescription}.
                    </span>
                  </th>
                  {choices.map((choice) => <td key={choice.value}>
                    <label className="cluster-permission-matrix-cell-v11">
                      <input type="radio" name={rowId} value={choice.value}
                        aria-label={row.label + ": " + choice.label}
                        aria-describedby={rowId + "-description"}
                        checked={selected === choice.value}
                        disabled={readOnly}
                        onChange={(event) => { if (event.target.checked && !readOnly) onChange(row.key, choice.value); }}
                      />
                    </label>
                  </td>)}
                  <td className="cluster-permission-matrix-effective-v11">
                    <strong>{effective}</strong>
                    <small>{selected === inheritValue ? "Inherited" : "Override"}</small>
                  </td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
      </section>;
    })}
  </div>;
}
