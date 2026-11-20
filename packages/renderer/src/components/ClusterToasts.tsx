import { useEffect, useRef, useState } from "react";
import { ClusterButton } from "./ClusterButton";
import { ClusterIcon, type ClusterIconName } from "./ClusterIcon";
import { runtimeStyle } from "../core/runtime-style";
import { dismissToast, subscribeToasts, type ClusterToast } from "../core/toasts";
import "./cluster-toasts.css";

const TONE_ICON: Record<ClusterToast["tone"], ClusterIconName> = { info: "bell", success: "check", warning: "warning", danger: "warning" };

/* The toast stack: bottom right, newest at the bottom. Three are
   visible; the rest wait. Timers pause on hover, on focus and while the
   window is hidden, so nothing expires unseen. */
export function ClusterToasts() {
  const [items, setItems] = useState<ClusterToast[]>([]);
  useEffect(() => subscribeToasts(setItems), []);
  const visible = items.slice(0, 3).reverse();
  return <section className="ct-stack" aria-label="Notifications" aria-live="polite">
    {items.length > visible.length ? <span className="ct-more">+{items.length - visible.length} more</span> : null}
    {visible.map((toast) => <ToastCard key={toast.id} toast={toast} />)}
  </section>;
}

function ToastCard({ toast }: { toast: ClusterToast }) {
  const [paused, setPaused] = useState(false);
  const remaining = useRef(toast.duration || 0);
  const startedAt = useRef(0);
  const [hidden, setHidden] = useState(() => typeof document !== "undefined" && document.visibilityState === "hidden");
  useEffect(() => {
    const onVisibility = () => setHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);
  const running = Boolean(toast.duration) && !paused && !hidden;
  useEffect(() => {
    if (!running) return;
    startedAt.current = Date.now();
    const timer = window.setTimeout(() => dismissToast(toast.id), remaining.current);
    return () => { window.clearTimeout(timer); remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt.current)); };
  }, [running, toast.id]);
  const body = <>
    <span className="ct-icon" aria-hidden="true"><ClusterIcon name={toast.icon || TONE_ICON[toast.tone]} /></span>
    <span className="ct-copy">
      {toast.label ? <small>{toast.label}</small> : null}
      <strong>{toast.title}</strong>
      {toast.message ? <span>{toast.message}</span> : null}
    </span>
  </>;
  return <article className="ct" data-tone={toast.tone} role={toast.tone === "danger" ? "alert" : "status"}
    onPointerEnter={() => setPaused(true)} onPointerLeave={() => setPaused(false)}
    onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
    {toast.onOpen
      ? <ClusterButton unstyled type="button" className="ct-body" onClick={() => { toast.onOpen?.(); dismissToast(toast.id); }}>{body}</ClusterButton>
      : <div className="ct-body">{body}</div>}
    {toast.action ? <ClusterButton size="compact" variant="secondary" className="ct-action" onClick={() => { toast.action?.onSelect(); dismissToast(toast.id); }}>{toast.action.label}</ClusterButton> : null}
    <ClusterButton unstyled type="button" className="ct-close" aria-label="Dismiss" onClick={() => dismissToast(toast.id)}><ClusterIcon name="close" /></ClusterButton>
    {toast.duration ? <i className="ct-timer" data-running={running || undefined} style={runtimeStyle({ "--ct-duration": `${toast.duration}ms` })} aria-hidden="true" /> : null}
  </article>;
}
