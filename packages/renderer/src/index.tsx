import { initializePerformanceMonitoring, recordReactRender } from "./core/performance";
import { initializeRendererCapabilities } from "./core/render-capabilities";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AppErrorBoundary } from "./components/AppErrorBoundary";
import { PrivacyConsentManager } from "./features/legal/PrivacyConsentManager";
import { BehavioralAnalyticsManager } from "./components/BehavioralAnalyticsManager";
import { installGlobalClientIncidentHandlers } from "./core/client-incidents";
import "./styles.css";

export type ClusterRendererHost = "web" | "desktop";
export type ClusterRendererMountOptions = { host?: ClusterRendererHost };

let runtimeInitialized = false;

function initializeRendererRuntime(host: ClusterRendererHost) {
  if (runtimeInitialized) return;
  runtimeInitialized = true;
  document.documentElement.dataset.rendererHost = host;
  document.documentElement.dataset.runtime = host;
  if (host === "web") document.documentElement.dataset.platform = "web";
  initializeRendererCapabilities(host);
  initializePerformanceMonitoring();
  installGlobalClientIncidentHandlers();
  if (host === "desktop") {
    void import("./core/desktop").then((desktop) => {
      desktop.installNativeCapabilityTransport();
      desktop.initializeDesktopRuntime();
      desktop.installDesktopDeepLinkRouting();
    }).catch(() => undefined);
  }
}

function rendererHostFromEnvironment(): ClusterRendererHost {
  if (typeof window === "undefined") return "web";
  if (new URLSearchParams(window.location.search).get("clusterDesktop") === "1") return "desktop";
  return window.clusterDesktop ? "desktop" : "web";
}

export function mountClusterRenderer(element: HTMLElement, options: ClusterRendererMountOptions = {}) {
  const host = options.host || rendererHostFromEnvironment();
  initializeRendererRuntime(host);
  const root = ReactDOM.createRoot(element);
  root.render(
    <React.StrictMode>
      <AppErrorBoundary>
        <React.Profiler id="ClusterApp" onRender={recordReactRender}>
          <App />
          <PrivacyConsentManager />
          <BehavioralAnalyticsManager />
        </React.Profiler>
      </AppErrorBoundary>
    </React.StrictMode>,
  );
  return () => root.unmount();
}

export { App };
