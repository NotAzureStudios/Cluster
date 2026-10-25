import { forwardRef, useEffect, useImperativeHandle, useRef, type InputHTMLAttributes } from "react";
import { ClusterInput } from "./ClusterNativeControls";

export type ClusterSelectionControlProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  kind?: "checkbox" | "radio";
  indeterminate?: boolean;
};

export const ClusterSelectionControl = forwardRef<HTMLInputElement, ClusterSelectionControlProps>(function ClusterSelectionControl({ kind = "checkbox", indeterminate = false, className = "", ...props }, forwardedRef) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  useImperativeHandle(forwardedRef, () => inputRef.current as HTMLInputElement, []);
  useEffect(() => { if (inputRef.current && kind === "checkbox") inputRef.current.indeterminate = indeterminate; }, [indeterminate, kind]);
  return <ClusterInput {...props} ref={inputRef} type={kind} className={`cluster-selection-control-v536 ${className}`.trim()} data-indeterminate={indeterminate || undefined} />;
});
