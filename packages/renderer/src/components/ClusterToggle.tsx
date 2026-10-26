import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import "./cluster-toggle.css";

export type ClusterToggleProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "role" | "aria-checked"> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
};

export const ClusterToggle = forwardRef<HTMLButtonElement, ClusterToggleProps>(function ClusterToggle({
  checked, onCheckedChange, label, description, disabled, className = "", ...props
}, ref) {
  return <button {...props} ref={ref} type="button" role="switch" aria-checked={checked} disabled={disabled}
    data-checked={checked ? "true" : "false"} className={`cluster-toggle-v533 ${className}`.trim()}
    onClick={() => onCheckedChange(!checked)}>
    {(label || description) ? <span className="cluster-toggle-copy-v533">{label ? <strong>{label}</strong> : null}{description ? <small>{description}</small> : null}</span> : null}
    <span className="cluster-toggle-track-v533" aria-hidden="true"><span /></span>
  </button>;
});
