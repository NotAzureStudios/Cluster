import { lazy, useEffect, useState } from "react";
import { LazyFeatureBoundary } from "./components/FeatureBoundary";
import { SecurityPinHost } from "./components/SecurityPinHost";
import { ReauthenticationHost } from "./components/ReauthenticationHost";
import { AccessibilityManager } from "./components/AccessibilityManager";
import { ClusterDialogHost } from "./components/ClusterDialogHost";
import { ClusterToasts } from "./components/ClusterToasts";
import { loadPortalContext, portalDecision, type PortalContext } from "./features/portal/portal-context";

const ClusterApplication = lazy(
  () => import("./features/application/ClusterApplication"),
);
const PortalApp = lazy(() => import("./features/portal/PortalApp"));

/** Studio members get Cluster. Contractors, clients and guests, and anyone on
 *  a portal address, get the external portal. */
function useShell() {
  const sharePage = window.location.pathname.startsWith("/share/");
  const [shell, setShell] = useState<{ kind: "loading" | "studio" } | { kind: "portal"; context: PortalContext }>({ kind: sharePage ? "studio" : "loading" });
  useEffect(() => {
    if (sharePage) return;
    let live = true;
    loadPortalContext().then((context) => {
      if (!live) return;
      const decision = portalDecision(context);
      if (decision.kind === "redirect") window.location.replace(decision.url);
      else setShell(decision.kind === "portal" ? { kind: "portal", context } : { kind: "studio" });
    }).catch(() => { if (live) setShell({ kind: "studio" }); });
    return () => { live = false; };
  }, []);
  return shell;
}

export default function App() {
  const shell = useShell();
  if (shell.kind === "loading") return null;
  return (
    <>
      <a className="skip-link-v204" href="#cluster-main-content" onClick={() => {
        requestAnimationFrame(() => document.getElementById("cluster-main-content")?.focus());
      }}>Skip to main content</a>
      <AccessibilityManager />
      <LazyFeatureBoundary label={shell.kind === "portal" ? "Portal" : "Cluster workspace"}>
        {shell.kind === "portal" ? <PortalApp initialContext={shell.context} /> : <ClusterApplication />}
      </LazyFeatureBoundary>
      <SecurityPinHost />
      <ReauthenticationHost />
      <ClusterDialogHost />
      <ClusterToasts />
    </>
  );
}
