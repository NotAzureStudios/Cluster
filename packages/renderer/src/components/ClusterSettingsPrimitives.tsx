import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { displaySettingsReviewValue, nextSettingsChoiceIndex, type SettingsReviewValue } from "./cluster-settings-interactions";
import "./cluster-settings-primitives.css";

/** A single settings entry; domain owners supply correctly labeled controls and mutations. */
export function ClusterSettingsRow({
  label, description, controlId, status, help, children, className = "",
}: {
  label: ReactNode;
  description?: ReactNode;
  controlId?: string;
  status?: ReactNode;
  help?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return <div className={("cluster-settings-row-v11 " + className).trim()}>
    <div className="cluster-settings-row-copy-v11">
      <div className="cluster-settings-row-heading-v11">
        {controlId ? <label htmlFor={controlId}>{label}</label> : <strong>{label}</strong>}
        {status ? <span className="cluster-settings-row-status-v11">{status}</span> : null}
        {help ? <ClusterSettingsHelp label={typeof label === "string" ? label : "setting"}>{help}</ClusterSettingsHelp> : null}
      </div>
      {description ? <small>{description}</small> : null}
    </div>
    <div className="cluster-settings-row-control-v11">{children}</div>
  </div>;
}

export function ClusterSettingsSection({
  title, summary, actions, children, className = "", id,
}: {
  title: ReactNode;
  summary?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return <section id={id} className={("cluster-settings-section-v11 " + className).trim()}>
    <header className="cluster-settings-section-head-v11">
      <div><h3>{title}</h3>{summary ? <p>{summary}</p> : null}</div>
      {actions ? <div className="cluster-settings-section-actions-v11">{actions}</div> : null}
    </header>
    <div className="cluster-settings-section-content-v11">{children}</div>
  </section>;
}

export function ClusterSettingsHelp({ label, children }: { label: string; children: ReactNode }) {
  return <details className="cluster-settings-help-v11">
    <summary aria-label={"Help for " + label} title={"Help for " + label}><span aria-hidden="true">?</span></summary>
    <div className="cluster-settings-help-content-v11" role="note">{children}</div>
  </details>;
}

export type ClusterSettingsChoice<T extends string> = {
  value: T;
  label: ReactNode;
  description?: ReactNode;
  preview?: ReactNode;
  disabled?: boolean;
};

export function ClusterSettingsChoiceGroup<T extends string>({
  label, value, options, onChange, disabled = false, density = "cards", className = "",
}: {
  label: string;
  value: T;
  options: readonly ClusterSettingsChoice<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  density?: "cards" | "compact";
  className?: string;
}) {
  const ids = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = options.findIndex((option) => option.value === value && !option.disabled);
  const focusIndex = selectedIndex >= 0 ? selectedIndex : options.findIndex((option) => !option.disabled);

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (disabled) return;
    const next = nextSettingsChoiceIndex(options, index, event.key);
    if (next < 0) return;
    event.preventDefault();
    refs.current[next]?.focus();
    if (options[next].value !== value) onChange(options[next].value);
  }

  return <div className={("cluster-settings-choices-v11 " + className).trim()}
    data-density={density} role="radiogroup" aria-label={label} aria-disabled={disabled || undefined}>
    {options.map((option, index) => {
      const selected = option.value === value;
      const unavailable = disabled || Boolean(option.disabled);
      return <button
        key={option.value} ref={(element) => { refs.current[index] = element; }} type="button" role="radio"
        aria-checked={selected} aria-describedby={option.description ? ids + "-" + index : undefined}
        tabIndex={!unavailable && index === focusIndex ? 0 : -1}
        disabled={unavailable} data-selected={selected ? "true" : "false"}
        className="cluster-settings-choice-v11"
        onKeyDown={(event) => handleKeyDown(event, index)}
        onClick={() => { if (!unavailable && !selected) onChange(option.value); }}
      >
        {option.preview ? <span className="cluster-settings-choice-preview-v11" aria-hidden="true">{option.preview}</span> : null}
        <span className="cluster-settings-choice-label-v11">{option.label}</span>
        {option.description ? <small id={ids + "-" + index}>{option.description}</small> : null}
      </button>;
    })}
  </div>;
}

export type ClusterSettingsChange = {
  id: string;
  label: string;
  before?: SettingsReviewValue;
  after?: SettingsReviewValue;
  /** Security-sensitive domains should omit the values entirely. */
  sensitive?: boolean;
  impact?: "none" | "restart" | "protected" | "exposure";
};

export function ClusterSettingsChangeReview({
  changes, label = "Review pending changes", className = "",
}: {
  changes: readonly ClusterSettingsChange[];
  label?: string;
  className?: string;
}) {
  if (!changes.length) return null;
  const restarts = changes.filter((change) => change.impact === "restart").length;
  const protectedChanges = changes.filter((change) => change.impact === "protected" || change.impact === "exposure").length;
  return <details className={("cluster-settings-change-review-v11 " + className).trim()}>
    <summary><span>{label} <b>{changes.length}</b></span>
      <span className="cluster-settings-change-review-impact-v11">
        {restarts ? restarts + " restart" : null}{restarts && protectedChanges ? " · " : null}
        {protectedChanges ? protectedChanges + " protected" : null}
      </span>
    </summary>
    <ul>
      {changes.map((change) => <li key={change.id}>
        <span>{change.label}</span>
        <span className="cluster-settings-change-review-values-v11">
          {change.before !== undefined || change.after !== undefined
            ? displaySettingsReviewValue(change.before, Boolean(change.sensitive)) + " → " + displaySettingsReviewValue(change.after, Boolean(change.sensitive))
            : "Changed"}
          {change.impact === "restart" ? <small>Restart required</small> : null}
          {change.impact === "exposure" ? <small>Exposure review required</small> : null}
          {change.impact === "protected" ? <small>Protected save</small> : null}
        </span>
      </li>)}
    </ul>
    <p>Review the affected settings before saving. This summary is not a validation or authorization result.</p>
  </details>;
}
