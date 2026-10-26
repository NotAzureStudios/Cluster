import { forwardRef, type InputHTMLAttributes, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { resolveClusterInteractionState, type ClusterInteractionState } from "./interaction-state";
import { ClusterTextArea } from "./ClusterTextArea";
import { ClusterTextInput } from "./ClusterTextInput";

type NativeStateProps = {
  state?: ClusterInteractionState;
  invalid?: boolean;
};

export const ClusterInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & NativeStateProps>(function ClusterInput({
  className = "", state = "default", invalid = false, disabled, "aria-invalid": ariaInvalid, type = "text", ...props
}, ref) {
  const resolvedState = resolveClusterInteractionState({ state: invalid ? "error" : state, disabled: Boolean(disabled) });
  const primitiveType = type === "checkbox" || type === "radio" || type === "range" || type === "color";
  const sharedProps = {
    ...props,
    ref,
    type,
    disabled,
    "aria-invalid": ariaInvalid ?? (invalid || undefined),
    "data-cluster-state": resolvedState,
    "data-motion-purpose": "state",
    className: `cluster-native-control-v495 cluster-input-v495 ${primitiveType ? "cluster-input-primitive-v532" : ""} ${className}`.trim(),
  };
  // Boolean/range/color controls must never inherit text-field geometry. Rendering them through
  // ClusterTextInput gave checkboxes the same width/min-height classes as text boxes, which is
  // how the component preview ended up with those ridiculous vertical blue strips.
  return primitiveType ? <input {...sharedProps} /> : <ClusterTextInput {...sharedProps} />;
});

export const ClusterNativeSelect = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & NativeStateProps>(function ClusterNativeSelect({
  className = "", state = "default", invalid = false, disabled, "aria-invalid": ariaInvalid, children, ...props
}, ref) {
  const resolvedState = resolveClusterInteractionState({ state: invalid ? "error" : state, disabled: Boolean(disabled) });
  return <select {...props} ref={ref} disabled={disabled} aria-invalid={ariaInvalid ?? (invalid || undefined)} data-cluster-state={resolvedState} data-motion-purpose="state"
    className={`cluster-native-control-v495 cluster-native-select-v495 ${className}`.trim()}>{children}</select>;
});

export const ClusterTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & NativeStateProps>(function ClusterTextarea({
  className = "", state = "default", invalid = false, disabled, "aria-invalid": ariaInvalid, ...props
}, ref) {
  const resolvedState = resolveClusterInteractionState({ state: invalid ? "error" : state, disabled: Boolean(disabled) });
  return <ClusterTextArea {...props} ref={ref} disabled={disabled} aria-invalid={ariaInvalid ?? (invalid || undefined)} data-cluster-state={resolvedState} data-motion-purpose="state"
    className={`cluster-native-control-v495 cluster-textarea-v495 ${className}`.trim()} />;
});
