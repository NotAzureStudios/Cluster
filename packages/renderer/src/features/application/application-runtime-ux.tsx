import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterOperationalStatus } from "../../components/ClusterOperationalStatus";
import { ClusterIcon } from "../../components/ClusterIcon";
import type { ClusterOperationalStatusModel } from "../../components/operational-status";
import { RequestErrorState } from "../../components/RequestState";
import { api, setApiQueryData } from "../../core/api";
import { ADAPTIVE_MEDIA } from "../../core/adaptive-layout";
import type { ServerConfigSection, Settings, SettingsSection, SetupStatus, User } from "./application-models";
import type { AuthConfig } from "../auth/AuthScreens";

const ACCOUNT_SETTINGS_SECTIONS = new Set<SettingsSection>(["profile", "appearance", "performance", "navigation", "privacy", "pin", "shortcuts", "accessibility", "notifications", "desktop", "forms", "licenses", "git"]);
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


/* Two kinds of server state, shown two ways.
   Blocking states stop work or need a decision — you cannot reach the server,
   this client must update, changes conflict, or the server is in maintenance
   or recovery — so they keep a strip across the page with its action.
   Informational states describe how things are without asking anything of
   you, so they sit as a chip in the title bar, with the detail on hover.
   Read-only used to take a 66px banner on every page for as long as it
   lasted. */
const BLOCKING_STATES = new Set(["reconnecting", "server_unreachable", "conflict", "incompatible", "maintenance", "recovery"]);
const CHIP_STATES = new Set(["offline", "read_only", "degraded", "draining"]);

export function NavigationOperationalStatus({ model, onReviewSync, onRetry }: { model: ClusterOperationalStatusModel; onReviewSync: () => void; onRetry: () => void }) {
  if (!BLOCKING_STATES.has(model.state)) return null;
  const actions = ["conflict", "incompatible"].includes(model.state)
    ? <ClusterButton variant="secondary" size="compact" onClick={onReviewSync}>Review</ClusterButton>
    : ["reconnecting", "server_unreachable"].includes(model.state)
      ? <ClusterButton variant="secondary" size="compact" busy={model.state === "reconnecting"} busyLabel="Reconnecting…" onClick={onRetry}>Retry</ClusterButton>
      : null;
  return <ClusterOperationalStatus model={model} className="cl-status-strip" actions={actions} />;
}

/* Server status, bottom of the sidebar: shown for informational states and
   whenever something is affected. One icon per cause (transfers, speed,
   maintenance, services); hover lists them. */
export function ServerStatusPill({ model }: { model: ClusterOperationalStatusModel }) {
  const causes = model.causes || [];
  if (!CHIP_STATES.has(model.state) && !causes.length) return null;
  const detail = [causes.length ? "" : model.pendingCount ? `${model.detail} ${model.pendingCount} pending.` : model.detail, ...causes.map((cause) => cause.label)].filter(Boolean).join("\n");
  const tone = CHIP_STATES.has(model.state) ? model.interactionState : "warning";
  return <span className="cl-sb-status" data-cluster-state={tone} role="status" title={detail} aria-label={`${model.label}. ${detail}`}>
    <span className="cl-sb-status__dot" aria-hidden="true" />
    <span className="cl-sb-status__label">{CHIP_STATES.has(model.state) ? model.label : causes[0]?.label}</span>
    {causes.length ? <span className="cl-sb-status__causes" aria-hidden="true">{causes.slice(0, 4).map((cause) => <ClusterIcon key={cause.key} name={cause.icon} />)}</span> : null}
  </span>;
}

export function publicShareToken() {
  return typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("share") : null;
}
