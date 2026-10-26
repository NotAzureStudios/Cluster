import { useEffect } from "react";
import { api } from "../core/api";
import { analyticsAllowed, PRIVACY_CONSENT_CHANGED_EVENT } from "../core/privacy-consent";
import { isAppScreen, type AppScreen } from "../core/navigation";

let lastSurface = "";
let appOpenSent = false;

function currentSurface(): AppScreen {
  const candidate = decodeURIComponent(window.location.hash.replace(/^#/, ""));
  return isAppScreen(candidate) ? candidate : "dashboard";
}
function clientKind() { return window.clusterDesktop ? "desktop" : "web"; }

async function send(eventName: "app_open" | "screen_view", surface: AppScreen) {
  if (!analyticsAllowed()) return;
  try {
    const me = await api<{ user: { id?: string } | null }>("/api/me");
    if (!me.user?.id || !analyticsAllowed()) return;
    await api("/api/analytics/events", { method: "POST", body: JSON.stringify({ eventName, surface, client: clientKind(), occurredAt: new Date().toISOString() }) });
  } catch {
    // Analytics is optional. Network, consent, or provider failures must never affect Cluster use.
  }
}

export function BehavioralAnalyticsManager() {
  useEffect(() => {
    const record = () => {
      if (!analyticsAllowed()) { lastSurface = ""; return; }
      const surface = currentSurface();
      if (!appOpenSent) { appOpenSent = true; void send("app_open", surface); }
      if (surface === lastSurface) return;
      lastSurface = surface;
      void send("screen_view", surface);
    };
    const consentChanged = () => { if (!analyticsAllowed()) { lastSurface = ""; return; } record(); };
    record();
    window.addEventListener("hashchange", record);
    window.addEventListener("popstate", record);
    window.addEventListener("cluster:identity-changed", record);
    window.addEventListener(PRIVACY_CONSENT_CHANGED_EVENT, consentChanged);
    return () => {
      window.removeEventListener("hashchange", record);
      window.removeEventListener("popstate", record);
      window.removeEventListener("cluster:identity-changed", record);
      window.removeEventListener(PRIVACY_CONSENT_CHANGED_EVENT, consentChanged);
    };
  }, []);
  return null;
}
