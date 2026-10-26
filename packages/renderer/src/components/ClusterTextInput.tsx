import { forwardRef, type InputHTMLAttributes } from "react";

export const ClusterTextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function ClusterTextInput({ className = "", type = "text", ...props }, ref) {
  return <input {...props} ref={ref} type={type} className={`cluster-text-input-v491 ${className}`.trim()} />;
});
