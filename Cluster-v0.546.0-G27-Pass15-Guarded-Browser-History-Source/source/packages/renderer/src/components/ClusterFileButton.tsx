import { useRef, type ChangeEvent, type InputHTMLAttributes, type ReactNode } from "react";
import { ClusterButton, type ClusterButtonSize, type ClusterButtonVariant } from "./ClusterButton";
import { ClusterIcon, type ClusterIconName } from "./ClusterIcon";

type ClusterFileButtonProps = {
  label: string;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  busy?: boolean;
  busyLabel?: string;
  icon?: ClusterIconName;
  variant?: ClusterButtonVariant;
  size?: ClusterButtonSize;
  className?: string;
  inputClassName?: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void | Promise<void>;
  children?: ReactNode;
  inputProps?: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "accept" | "multiple" | "disabled" | "onChange" | "className">;
};

/**
 * Shared upload trigger. Native file inputs remain available to the browser, but never own the
 * visible control chrome. This keeps upload controls consistent across themes and platforms.
 */
export function ClusterFileButton({
  label,
  accept,
  multiple = false,
  disabled = false,
  busy = false,
  busyLabel,
  icon = "upload",
  variant = "secondary",
  size = "default",
  className = "",
  inputClassName = "",
  onChange,
  children,
  inputProps,
}: ClusterFileButtonProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  return <span className={`cluster-file-button-v475 ${className}`.trim()}>
    <ClusterButton
      variant={variant}
      size={size}
      disabled={disabled}
      busy={busy}
      busyLabel={busyLabel}
      onClick={() => {
        if (!inputRef.current) return;
        inputRef.current.value = "";
        inputRef.current.click();
      }}
      aria-label={label}
    >
      <ClusterIcon name={icon} aria-hidden="true" />
      <span>{children || label}</span>
    </ClusterButton>
    <input
      {...inputProps}
      ref={inputRef}
      className={`cluster-file-input-v475 ${inputClassName}`.trim()}
      type="file"
      hidden
      accept={accept}
      multiple={multiple}
      disabled={disabled || busy}
      tabIndex={-1}
      aria-hidden="true"
      onChange={(event) => { void onChange(event); }}
    />
  </span>;
}
