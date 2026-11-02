function applyInitialTheme() {
  const themeKey = "cluster-theme-mode";
  let preferenceAllowed = false;
  try {
    const consent = JSON.parse(window.localStorage.getItem("cluster-privacy-consent-v1") || "null");
    preferenceAllowed = consent?.schemaVersion === 1 && consent?.noticeVersion === "1.0" && consent?.decided === true && consent?.preferences === true;
  } catch {}
  let mode = preferenceAllowed ? window.localStorage.getItem(themeKey) : null;
  if (mode !== "dark" && mode !== "light" && mode !== "system") mode = "light";
  const resolved = mode === "system"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : mode;
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.themeMode = mode;
  document.documentElement.style.colorScheme = resolved;
}

applyInitialTheme();

// Web is a deployment surface, not a local installer. Mark the surface for
// responsive shell styling and telemetry without treating it as an auth rule.
// Portal permissions and route isolation remain server-authoritative.
const webPath = window.location.pathname.replace(/\\/g, "/");
const portalSurface = webPath === "/portal" || webPath.startsWith("/portal/");
document.documentElement.dataset.clusterPlatform = "web";
document.documentElement.dataset.clusterSurface = portalSurface ? "portal" : "workspace";

import { mountClusterRenderer } from "@cluster/renderer";

const root = document.getElementById("root");
if (!root) throw new Error("Cluster renderer root is missing.");

mountClusterRenderer(root);
