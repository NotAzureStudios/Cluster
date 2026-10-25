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

import { mountClusterRenderer } from "@cluster/renderer";

const root = document.getElementById("root");
if (!root) throw new Error("Cluster renderer root is missing.");

mountClusterRenderer(root);
