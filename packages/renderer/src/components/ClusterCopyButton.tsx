import { useEffect, useRef, useState, type ReactNode } from "react";
import { copyClusterText } from "../core/clipboard";
import { ClusterButton, type ClusterButtonSize, type ClusterButtonVariant } from "./ClusterButton";
import "./cluster-copy-button.css";

/**
 * A copy action must report the *actual* clipboard result. Never echo the
 * copied content into status, analytics, errors, or diagnostics: the text can
 * be a one-time secret, recovery code, or private resource link.
 */
export function ClusterCopyButton({
  text,
  children = "Copy",
  copiedLabel = "Copied",
  failedLabel = "Couldn't copy. Select the value and copy it manually.",
  variant = "secondary",
  size = "default",
  unstyled = false,
  className = "",
  disabled = false,
}: {
  text: string;
  children?: ReactNode;
  copiedLabel?: string;
  failedLabel?: string;
  variant?: ClusterButtonVariant;
  size?: ClusterButtonSize;
  unstyled?: boolean;
  className?: string;
  disabled?: boolean;
}) {
  const lock = useRef(false);
  const generation = useRef(0);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<"idle" | "copied" | "failed">("idle");

  // A newly displayed one-time credential must never inherit the previous
  // credential's "Copied" status (even if a prior request finishes late).
  useEffect(() => {
    generation.current += 1;
    lock.current = false;
    setPending(false);
    setFeedback("idle");
    return () => { generation.current += 1; };
  }, [text]);

  const copy = () => {
    if (lock.current || disabled || !text) return;
    lock.current = true; // synchronous: protects rapid clicks before React commits
    const request = ++generation.current;
    setPending(true);
    setFeedback("idle");
    // Start on the actual user gesture, without a timer or effect.
    void copyClusterText(text).then((success) => {
      if (request === generation.current) setFeedback(success ? "copied" : "failed");
    }).catch(() => {
      if (request === generation.current) setFeedback("failed");
    }).finally(() => {
      if (request === generation.current) {
        lock.current = false;
        setPending(false);
      }
    });
  };

  return <span className={`cluster-copy-control-v546 ${className}`.trim()}>
    <ClusterButton type="button" variant={variant} size={size} unstyled={unstyled}
      disabled={disabled || !text} busy={pending} busyLabel="Copying…" onClick={copy}>
      {children}
    </ClusterButton>
    {feedback !== "idle" && <span className={`cluster-copy-feedback-v546 ${feedback}`}
      role={feedback === "failed" ? "alert" : "status"}>
      {feedback === "copied" ? copiedLabel : failedLabel}
    </span>}
  </span>;
}
