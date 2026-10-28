import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { api } from "../../core/api";
import { setNativeKioskMode } from "../../core/desktop";
import { ClusterIcon } from "../../components/ClusterIcon";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterModal } from "../../components/ClusterModal";
import { CLUSTER_KIOSK_ADMIN_EXIT_REQUEST_EVENT } from "./use-native-kiosk-session";
import "./signed-out-kiosk.css";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterPinEntry } from "../../components/ClusterPinEntry";

type PublicHealth = {
  ok?: boolean;
  ready?: boolean;
  draining?: boolean;
  state?: string;
  version?: string;
  generatedAt?: string;
};

type KioskOfflineBehavior = "last-known" | "status" | "message";
type PublicKioskProfile = {
  id: string;
  name: string;
  title: string;
  message: string;
  showServerStatus: boolean;
  offlineBehavior: KioskOfflineBehavior;
  offlineMessage: string;
  managedExitRequired: boolean;
  automation?: { autoStart: boolean; scheduleEnabled: boolean; scheduleDays: string[]; scheduleStart: string; scheduleEnd: string };
  cards: Array<{ id: string; title: string; body: string; tone: "neutral" | "info" | "success" | "warning" }>;
};
type PublicKioskContent = { ok: boolean; profile: PublicKioskProfile };

function kioskCacheKey(profileId: string) {
  const origin = typeof window === "undefined" ? "cluster" : window.location.origin;
  return `cluster:kiosk-public:v1:${origin}:${profileId || "default"}`;
}
function readCachedProfile(profileId: string): PublicKioskProfile | null {
  try {
    const raw = localStorage.getItem(kioskCacheKey(profileId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at?: number; profile?: PublicKioskProfile };
    if (!parsed?.profile?.id || !parsed.at || Date.now() - parsed.at > 7 * 24 * 60 * 60 * 1000) return null;
    return parsed.profile;
  } catch { return null; }
}
function writeCachedProfile(profileId: string, profile: PublicKioskProfile) {
  try { localStorage.setItem(kioskCacheKey(profileId || profile.id), JSON.stringify({ at: Date.now(), profile })); } catch { /* presentation cache is optional */ }
}

export function SignedOutKioskPage({ exitShortcut = "Ctrl+Shift+F10" }: { exitShortcut?: string }) {
  const requestedProfile = useMemo(() => typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("clusterKioskProfile") || "", []);
  const [content, setContent] = useState<PublicKioskProfile | null>(() => readCachedProfile(requestedProfile));
  const [contentAvailable, setContentAvailable] = useState<boolean | null>(null);
  const [health, setHealth] = useState<PublicHealth | null>(null);
  const [reachable, setReachable] = useState<boolean | null>(null);
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);
  const [adminExitOpen, setAdminExitOpen] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [credentialType, setCredentialType] = useState<"password" | "pin">("password");
  const [credential, setCredential] = useState("");
  const pinInputRef = useRef<HTMLInputElement>(null);
  const [exitError, setExitError] = useState("");
  const [exitBusy, setExitBusy] = useState(false);

  useEffect(() => {
    if (adminExitOpen && credentialType === "pin") pinInputRef.current?.focus();
  }, [adminExitOpen, credentialType]);

  const applyOfflineFallback = useCallback(() => {
    const cached = content || readCachedProfile(requestedProfile);
    if (cached?.offlineBehavior === "last-known") setContent(cached);
    else if (cached?.offlineBehavior === "message") setContent({ ...cached, message: cached.offlineMessage, cards: [], showServerStatus: false });
    else if (cached?.offlineBehavior === "status") setContent({ ...cached, message: cached.offlineMessage, cards: [], showServerStatus: true });
  }, [content, requestedProfile]);

  const refresh = useCallback(async () => {
    if (!navigator.onLine) {
      setReachable(false);
      applyOfflineFallback();
      setLastCheckedAt(new Date());
      return;
    }
    try {
      const suffix = requestedProfile ? `?profile=${encodeURIComponent(requestedProfile)}` : "";
      const publicContent = await api<PublicKioskContent>(`/api/kiosk/public${suffix}`, { skipCacheInvalidation: true });
      setContent(publicContent.profile);
      writeCachedProfile(requestedProfile, publicContent.profile);
      setContentAvailable(true);
      if (publicContent.profile.showServerStatus) {
        const next = await api<PublicHealth>("/health", { skipCacheInvalidation: true });
        setHealth(next);
        setReachable(Boolean(next?.ok));
      } else {
        setHealth(null);
        setReachable(true);
      }
    } catch {
      setContentAvailable(false);
      applyOfflineFallback();
      try {
        const next = await api<PublicHealth>("/health", { skipCacheInvalidation: true });
        setHealth(next);
        setReachable(Boolean(next?.ok));
      } catch {
        setReachable(false);
      }
    } finally {
      setLastCheckedAt(new Date());
    }
  }, [requestedProfile, applyOfflineFallback]);

  useEffect(() => {
    let timer = 0;
    const schedule = () => {
      if (timer) window.clearTimeout(timer);
      if (document.visibilityState !== "visible") return;
      timer = window.setTimeout(async () => { timer = 0; await refresh(); schedule(); }, 15_000);
    };
    const onVisibility = () => { if (document.visibilityState === "visible") void refresh(); schedule(); };
    const onOnline = () => void refresh();
    const onOffline = () => { setReachable(false); applyOfflineFallback(); setLastCheckedAt(new Date()); };
    void refresh();
    schedule();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      if (timer) window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [refresh, applyOfflineFallback]);

  useEffect(() => {
    const open = () => { setAdminExitOpen(true); setExitError(""); };
    window.addEventListener(CLUSTER_KIOSK_ADMIN_EXIT_REQUEST_EVENT, open);
    return () => window.removeEventListener(CLUSTER_KIOSK_ADMIN_EXIT_REQUEST_EVENT, open);
  }, []);

  async function submitAdminExit(event: FormEvent) {
    event.preventDefault();
    if (!content?.id || !identifier.trim() || !credential) return;
    setExitBusy(true);
    setExitError("");
    try {
      await api("/api/kiosk/admin-exit", {
        method: "POST",
        body: JSON.stringify({ profileId: content.id, identifier: identifier.trim(), credentialType, credential }),
        skipCacheInvalidation: true,
      });
      await setNativeKioskMode(false, "signed-out");
    } catch {
      setExitError("Administrator verification failed. Check the credentials and try again.");
      setCredential("");
    } finally {
      setExitBusy(false);
    }
  }

  const operational = reachable === false ? "Offline" : health?.draining ? "Maintenance" : health?.ready ? "Ready" : reachable ? "Online" : "Checking";
  const detail = content?.message || (contentAvailable === false
    ? "This display has no published guest content. An administrator can publish a signed-out kiosk profile from Studio Settings."
    : "Loading the published kiosk profile.");

  return (
    <main className="signed-out-kiosk-v495" aria-label="Signed-out Cluster kiosk">
      <section className="signed-out-kiosk-card-v495">
        <div className="signed-out-kiosk-mark-v495" aria-hidden="true"><ClusterIcon name="home" /></div>
        <div className="signed-out-kiosk-copy-v495">
          <p className="eyebrow">{content?.name || "Public kiosk"}</p>
          <h1>{content?.title || "Cluster"}</h1>
          <p>{detail}</p>
        </div>
        {(content?.showServerStatus !== false) && (
          <div className="signed-out-kiosk-status-v495" data-state={health?.ready && reachable !== false ? "ready" : reachable === false ? "offline" : "pending"}>
            <span aria-hidden="true" />
            <div><strong>{operational}</strong><small>{health?.version ? `Server ${health.version}` : "Public status"}</small></div>
          </div>
        )}
        {content?.cards?.length ? (
          <div className="signed-out-kiosk-public-grid-v495" aria-label="Published kiosk information">
            {content.cards.map((card) => <article key={card.id} data-tone={card.tone}><strong>{card.title}</strong><p>{card.body}</p></article>)}
          </div>
        ) : null}
        <footer>
          <span>No account is signed in on this display.</span>
          <span>{lastCheckedAt ? `Checked ${lastCheckedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Checking server"}</span>
          <span>Managed exit: Ctrl+Shift+F10 · Emergency: {exitShortcut}</span>
        </footer>
      </section>
      <ClusterModal open={adminExitOpen} onClose={() => setAdminExitOpen(false)} busy={exitBusy} backdropClassName="signed-out-kiosk-exit-backdrop-v495" className="" ariaLabel="Exit signed-out kiosk">
          <form className="signed-out-kiosk-exit-dialog-v495" onSubmit={submitAdminExit}>
            <div><h2>Exit kiosk</h2></div>
            <label>Username or email<ClusterTextInput autoFocus autoComplete="username" value={identifier} onChange={(event) => setIdentifier(event.target.value)} /></label>
            <div className="signed-out-kiosk-credential-toggle-v495" role="group" aria-label="Credential type">
              <ClusterButton unstyled type="button" aria-pressed={credentialType === "password"} onClick={() => { setCredentialType("password"); setCredential(""); }}>Password</ClusterButton>
              <ClusterButton unstyled type="button" aria-pressed={credentialType === "pin"} onClick={() => { setCredentialType("pin"); setCredential(""); }}>Security PIN</ClusterButton>
            </div>
            {credentialType === "pin" ? <ClusterPinEntry value={credential} onChange={setCredential} disabled={exitBusy} label="Administrator PIN" inputRef={pinInputRef} /> : <label>Password<ClusterTextInput type="password" autoComplete="current-password" value={credential} onChange={(event) => setCredential(event.target.value)} /></label>}
            {exitError && <p className="signed-out-kiosk-exit-error-v495" role="alert">{exitError}</p>}
            <div className="signed-out-kiosk-exit-actions-v495"><ClusterButton type="button" variant="secondary" onClick={() => setAdminExitOpen(false)} disabled={exitBusy}>Cancel</ClusterButton><ClusterButton type="submit" disabled={exitBusy || !identifier.trim() || (credentialType === "pin" ? !/^\d{4,8}$/.test(credential) : !credential)}>{exitBusy ? "Verifying…" : "Exit kiosk"}</ClusterButton></div>
          </form>
      </ClusterModal>
    </main>
  );
}
