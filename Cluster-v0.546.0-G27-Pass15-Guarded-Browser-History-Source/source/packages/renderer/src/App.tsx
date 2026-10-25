import { lazy } from "react";
import { LazyFeatureBoundary } from "./components/FeatureBoundary";
import { SecurityPinHost } from "./components/SecurityPinHost";
import { ReauthenticationHost } from "./components/ReauthenticationHost";
import { AccessibilityManager } from "./components/AccessibilityManager";
import { ClusterDialogHost } from "./components/ClusterDialogHost";

const ClusterApplication = lazy(
  () => import("./features/application/ClusterApplication"),
);

export default function App() {
  return (
    <>
      <a className="skip-link-v204" href="#cluster-main-content" onClick={() => {
        requestAnimationFrame(() => document.getElementById("cluster-main-content")?.focus());
      }}>Skip to main content</a>
      <AccessibilityManager />
      <LazyFeatureBoundary label="Cluster workspace">
        <ClusterApplication />
      </LazyFeatureBoundary>
      <SecurityPinHost />
      <ReauthenticationHost />
      <ClusterDialogHost />
    </>
  );
}
