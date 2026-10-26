import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterOperationalStatus } from "../../components/ClusterOperationalStatus";
import type { ClusterOperationalStatusModel } from "../../components/operational-status";
import { RequestErrorState } from "../../components/RequestState";
import { api, queryApi } from "../../core/api";
import { ADAPTIVE_MEDIA } from "../../core/adaptive-layout";
import type { ServerConfigSection, SettingsSection, SetupStatus, User } from "./application-models";

const ACCOUNT_SETTINGS_SECTIONS = new Set<SettingsSection>(["profile", "appearance", "home", "navigation", "privacy", "pin", "shortcuts", "accessibility", "notifications", "desktop", "forms", "licenses"]);
const SERVER_CONFIG_SECTIONS = new Set<ServerConfigSection>(["overview", "network", "security", "storage", "backups", "integrations", "sessions", "advanced"]);

export type NavigationRecoveryNotice = {
  title: string;
  message: string;
  tone?: "info" | "warning" | "success";
};

export function normalizeAccountSettingsSection(value?: string | null): SettingsSection {
  return ACCOUNT_SETTINGS_SECTIONS.has(value as SettingsSection) ? value as SettingsSection : "privacy";
}

export function normalizeServerConfigSection(value?: string | null): ServerConfigSection {
  return SERVER_CONFIG_SECTIONS.has(value as ServerConfigSection) ? value as ServerConfigSection : "overview";
}

export function usePersistentNavigationSidebarClose(setMobileSidebarOpen: Dispatch<SetStateAction<boolean>>) {
  useEffect(() => {
    const persistentNavigation = window.matchMedia(ADAPTIVE_MEDIA.persistentNavigation);
    const syncNavigationMode = () => {
      if (persistentNavigation.matches) setMobileSidebarOpen(false);
    };
    syncNavigationMode();
    persistentNavigation.addEventListener("change", syncNavigationMode);
    return () => persistentNavigation.removeEventListener("change", syncNavigationMode);
  }, [setMobileSidebarOpen]);
}

export function ClusterBootError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <main className="page cluster-boot-error-v9n3">
      <RequestErrorState error={error} title="Cluster server unavailable" retryLabel="Retry startup" onRetry={onRetry} />
    </main>
  );
}

export function useSettingsSectionNavigation(initialRoute: string, initialSection?: string | null) {
  const [settingsInitialSection, setSettingsInitialSection] = useState<SettingsSection>(() => initialRoute === "settings" ? normalizeAccountSettingsSection(initialSection) : "privacy");
  const [serverConfigInitialSection, setServerConfigInitialSection] = useState<ServerConfigSection>(() => initialRoute === "serverConfig" ? normalizeServerConfigSection(initialSection) : "overview");
  return { settingsInitialSection, setSettingsInitialSection, serverConfigInitialSection, setServerConfigInitialSection };
}

export async function loadClusterStartup() {
  try {
    const setupStatus = await queryApi<SetupStatus>("/api/setup/status", { staleMs: 0, force: true });
    if (!setupStatus.setupComplete) return { setupStatus, user: null, error: null };
    try {
      const me = await api<{ user: User | null }>("/api/me");
      return { setupStatus, user: me.user, error: null };
    } catch (error) {
      return { setupStatus, user: null, error };
    }
  } catch (error) {
    return { setupStatus: null, user: null, error: error || new Error("Cluster could not determine first-run setup state.") };
  }
}

export function initialNavigationRecoveryNotice(source: string): NavigationRecoveryNotice | null {
  return source === "invalid" ? {
    title: "That Cluster link could not be opened",
    message: "The address is not a valid Cluster route. Home was opened instead.",
    tone: "warning",
  } : null;
}


const GLOBAL_OPERATIONAL_BANNER_STATES = new Set(["offline", "reconnecting", "server_unreachable", "conflict", "incompatible", "read_only", "degraded", "maintenance", "recovery", "draining"]);

export function NavigationOperationalStatus({ model, onReviewSync, onRetry }: { model: ClusterOperationalStatusModel; onReviewSync: () => void; onRetry: () => void }) {
  if (!GLOBAL_OPERATIONAL_BANNER_STATES.has(model.state)) return null;
  const actions = ["conflict", "incompatible"].includes(model.state)
    ? <ClusterButton variant="secondary" size="compact" onClick={onReviewSync}>Review sync</ClusterButton>
    : ["offline", "reconnecting", "server_unreachable"].includes(model.state)
      ? <ClusterButton variant="secondary" size="compact" busy={model.state === "reconnecting"} busyLabel="Reconnecting…" onClick={onRetry}>Retry connection</ClusterButton>
      : null;
  return <ClusterOperationalStatus model={model} className="navigation-operational-status-v433" actions={actions} />;
}

export function publicShareToken() {
  return typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("share") : null;
}
