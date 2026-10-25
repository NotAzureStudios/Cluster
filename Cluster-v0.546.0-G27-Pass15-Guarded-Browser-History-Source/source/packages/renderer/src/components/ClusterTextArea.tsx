import { forwardRef, type TextareaHTMLAttributes } from "react";

export const ClusterTextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function ClusterTextArea({ className = "", ...props }, ref) {
  return <textarea {...props} ref={ref} className={`cluster-text-area-v495 ${className}`.trim()} />;
});
