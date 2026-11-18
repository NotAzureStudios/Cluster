import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterOperationalStatus } from "../../components/ClusterOperationalStatus";
import type { ClusterOperationalStatusModel } from "../../components/operational-status";
import { RequestErrorState } from "../../components/RequestState";
import { api, setApiQueryData } from "../../core/api";
import { ADAPTIVE_MEDIA } from "../../core/adaptive-layout";
import type { ServerConfigSection, Settings, SettingsSection, SetupStatus, User } from "./application-models";
import type { AuthConfig } from "../auth/AuthScreens";

const ACCOUNT_SETTINGS_SECTIONS = new Set<SettingsSection>(["profile", "appearance", "performance", "home", "navigation", "privacy", "pin", "shortcuts", "accessibility", "notifications", "desktop", "forms", "licenses"]);
const SERVER_CONFIG_SECTIONS = new Set<ServerConfigSection>(["overview", "performance", "network", "domains", "security", "storage", "backups", "maintenance", "integrations", "sessions", "advanced"]);

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

export type ClusterStartup = {
  setupStatus: SetupStatus | null;
  user: User | null;
  /** Present only when nobody is signed in: what the sign-in screen needs. */
  authConfig: AuthConfig | null;
  /** Present only when nobody is signed in: whether to offer the Apply link. */
  applicationsOpen: boolean;
  error: unknown;
};

/**
 * One request for everything the first frame needs.
 *
 * This used to be three in series — `/api/setup/status`, then `/api/me` once
 * that answered, then `/api/settings` once a user object existed — so nothing
 * could paint until the third returned. `/api/bootstrap` answers all of it at
 * once, and the studio settings it carries are written into the query cache
 * under `/api/settings`, so the shell's existing settings path finds them
 * already there and issues no request of its own.
 */
export async function loadClusterStartup(): Promise<ClusterStartup> {
  try {
    const boot = await api<{
      setup: SetupStatus;
      user: User | null;
      settings: Settings | null;
      auth: AuthConfig | null;
      applicationsOpen: boolean;
    }>("/api/bootstrap");
    if (boot.settings) {
      // Seeded after the response, so the account scope the transport just
      // bound from this payload is the scope the entry is written under.
      setApiQueryData("/api/settings", boot.settings, { staleMs: 30_000, tags: ["settings"] });
    }
    return {
      setupStatus: boot.setup,
      user: boot.user,
      authConfig: boot.auth,
      applicationsOpen: Boolean(boot.applicationsOpen),
      error: null,
    };
  } catch (error) {
    return {
      setupStatus: null,
      user: null,
      authConfig: null,
      applicationsOpen: false,
      error: error || new Error("Cluster could not reach the server to start up."),
    };
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
