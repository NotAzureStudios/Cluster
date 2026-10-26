import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { API_URL, queryApi } from "../core/api";
import { runtimeStyle } from "../core/runtime-style";
import { personStatusSummary } from "../features/people/person-summary";
import { openClusterWorkNavigation } from "../features/workflow/work-navigation";
import { ClusterIcon } from "./ClusterIcon";
import { ClusterButton } from "./ClusterButton";
import { ClusterCopyButton } from "./ClusterCopyButton";

type AvatarUpdateDetail = { userId?: string; avatarUrl?: string | null };
type ProfilePeek = {
  id: string;
  username: string;
  displayName?: string | null;
  preferredName?: string | null;
  title?: string | null;
  department?: string | null;
  teamName?: string | null;
  avatarUrl?: string | null;
  status?: string | null;
  statusMessage?: string | null;
  timezone?: string | null;
  profileBio?: string | null;
  profileWebsite?: string | null;
  profileDiscordUsername?: string | null;
  discordUsername?: string | null;
  email?: string | null;
  phoneNumber?: string | null;
  skills?: string[];
  profilePreferredContact?: string | null;
};

function resolveAvatarUrl(value?: string | null) {
  const input = String(value || "").trim();
  if (!input) return "";
  if (/^(?:https?:|data:|blob:)/i.test(input)) return input;
  if (input.startsWith("/")) return `${API_URL.replace(/\/$/, "")}${input}`;
  return `${API_URL.replace(/\/$/, "")}/${input.replace(/^\/+/, "")}`;
}

function profilePeekName(profile: ProfilePeek) {
  return profile.preferredName || profile.displayName || profile.username;
}

function ProfilePeekCard({ profile, x, y, onClose }: { profile: ProfilePeek; x: number; y: number; onClose: () => void }) {
  const cardRef = useRef<HTMLElement>(null);
  useEffect(() => { cardRef.current?.focus({ preventScroll: true }); }, []);
  const [position, setPosition] = useState({ left: 10, top: 10, maxHeight: 320 });
  const personStatus = personStatusSummary(profile);
  const localTime = personStatus.localTimeLabel;
  const discord = profile.profileDiscordUsername || profile.discordUsername || "";
  const website = (() => {
    const raw = String(profile.profileWebsite || "").trim();
    if (!raw) return "";
    try {
      const parsed = new URL(raw);
      return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : "";
    } catch {
      return "";
    }
  })();
  useLayoutEffect(() => {
    const update = () => {
      const viewport = window.visualViewport;
      const viewportLeft = viewport?.offsetLeft || 0;
      const viewportTop = viewport?.offsetTop || 0;
      const viewportWidth = viewport?.width || window.innerWidth;
      const viewportHeight = viewport?.height || window.innerHeight;
      const gap = 10;
      const card = cardRef.current;
      const width = Math.min(card?.offsetWidth || 330, Math.max(0, viewportWidth - gap * 2));
      const height = card?.offsetHeight || 320;
      const preferredLeft = viewportWidth <= 720 ? viewportLeft + gap : x + 12;
      const preferredTop = y + 12;
      const left = Math.max(viewportLeft + gap, Math.min(preferredLeft, viewportLeft + viewportWidth - width - gap));
      const availableBelow = viewportTop + viewportHeight - preferredTop - gap;
      const availableAbove = y - viewportTop - gap;
      const flipAbove = availableBelow < Math.min(height, 280) && availableAbove > availableBelow;
      const top = flipAbove
        ? Math.max(viewportTop + gap, y - Math.min(height, availableAbove) - 12)
        : Math.max(viewportTop + gap, Math.min(preferredTop, viewportTop + viewportHeight - Math.min(height, viewportHeight - gap * 2) - gap));
      setPosition({ left, top, maxHeight: Math.max(160, viewportHeight - gap * 2) });
    };
    update();
    const viewport = window.visualViewport;
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
    };
  }, [x, y]);
  return createPortal(
    <div className="profile-peek-layer-v473" onMouseDown={onClose}>
      <section ref={cardRef} className="profile-peek-card-v473 panel" style={runtimeStyle({ left: position.left, top: position.top, maxHeight: position.maxHeight })} onMouseDown={(event) => event.stopPropagation()} tabIndex={-1} role="dialog" aria-modal="false" aria-label={`${profilePeekName(profile)} quick profile`}>
        <header>
          <div>
            <strong>{profilePeekName(profile)}</strong>
            <span>@{profile.username}{profile.title ? ` · ${profile.title}` : ""}</span>
          </div>
          <ClusterButton unstyled type="button" className="profile-peek-close-v473" onClick={onClose} aria-label="Close quick profile"><ClusterIcon name="close" /></ClusterButton>
        </header>
        <div className="profile-peek-status-v473">
          <span data-status={personStatus.presence}>{personStatus.availabilityLabel}</span>
          {localTime && <small>{localTime}</small>}
        </div>
        {profile.statusMessage && <p className="profile-peek-message-v473">{profile.statusMessage}</p>}
        {profile.profileBio && <p className="profile-peek-bio-v473">{profile.profileBio}</p>}
        {!!profile.skills?.length && <div className="profile-peek-skills-v473">{profile.skills.slice(0, 5).map((skill) => <span key={skill}>{skill}</span>)}</div>}
        <div className="profile-peek-actions-v473">
          {profile.email && <a href={`mailto:${profile.email}`}>Email</a>}
          {profile.phoneNumber && <a href={`tel:${profile.phoneNumber}`}>Call</a>}
          {discord && <ClusterCopyButton unstyled text={discord} copiedLabel="Discord copied" failedLabel="Discord username could not be copied">Discord</ClusterCopyButton>}
          {website && <a href={website} target="_blank" rel="noreferrer">Website</a>}
          <ClusterButton unstyled type="button" className="primary" onClick={() => { openClusterWorkNavigation({ screen: "people", inspectScope: "person", inspectId: profile.id }); onClose(); }}>View profile</ClusterButton>
        </div>
      </section>
    </div>,
    document.body,
  );
}

export function PresenceAvatar({ userId, imageUrl, label, fallback, state = "offline", title, className = "", accentColor, children, profilePeek = false }: { userId?: string | null; imageUrl?: string | null; label: string; fallback: string; state?: string; title?: string; className?: string; accentColor?: string | null; children?: ReactNode; profilePeek?: boolean }) {
  const initialUrl = useMemo(() => resolveAvatarUrl(imageUrl), [imageUrl]);
  const [resolvedUrl, setResolvedUrl] = useState(initialUrl);
  const [failed, setFailed] = useState(false);
  const [peek, setPeek] = useState<{ profile: ProfilePeek; x: number; y: number } | null>(null);
  const peekTriggerRef = useRef<HTMLButtonElement | null>(null);
  const peekRequestRef = useRef(0);
  const peekPendingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; peekRequestRef.current += 1; };
  }, []);
  const closePeek = () => {
    peekRequestRef.current += 1;
    peekPendingRef.current = false;
    setPeek(null);
    peekTriggerRef.current?.focus({ preventScroll: true });
  };

  useEffect(() => { setResolvedUrl(initialUrl); setFailed(false); }, [initialUrl]);
  useEffect(() => {
    function refresh(event: Event) {
      const detail = (event as CustomEvent<AvatarUpdateDetail>).detail;
      if (!detail || !("avatarUrl" in detail) || (detail.userId && userId && detail.userId !== userId)) return;
      if (detail.userId && !userId) return;
      const next = resolveAvatarUrl(detail.avatarUrl);
      setResolvedUrl(next ? `${next}${next.includes("?") ? "&" : "?"}v=${Date.now()}` : "");
      setFailed(false);
    }
    window.addEventListener("cluster-avatar-updated", refresh);
    return () => window.removeEventListener("cluster-avatar-updated", refresh);
  }, [userId]);
  useEffect(() => {
    if (!peek) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); closePeek(); } };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [peek]);

  async function openProfilePeek(event: ReactMouseEvent<HTMLElement>) {
    if (!userId) return;
    event.stopPropagation();
    event.preventDefault();
    if (peekPendingRef.current) return;
    peekPendingRef.current = true;
    const requestId = ++peekRequestRef.current;
    try {
      const profile = await queryApi<ProfilePeek>(`/api/users/${encodeURIComponent(userId)}/profile`, { staleMs: 30_000, maxAgeMs: 5 * 60_000, tags: ["users", "profile"] });
      if (mountedRef.current && peekRequestRef.current === requestId) setPeek({ profile, x: event.clientX, y: event.clientY });
    } catch {
      // Profile access errors should not break the parent interaction surface.
    } finally {
      if (peekRequestRef.current === requestId) peekPendingRef.current = false;
    }
  }

  const presence = String(state || "offline").toLowerCase();
  const avatarContents = <>
    {resolvedUrl && !failed
      ? <img src={resolvedUrl} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} />
      : <span className="cluster-presence-avatar-fallback-v227" aria-hidden="true">{fallback}</span>}
    <span className={`cluster-presence-indicator-v227 ${presence}`} role="img" aria-label={title || `${label} is ${presence}`} />
    {children}
  </>;
  return <>
    {profilePeek && userId ? (
      <ClusterButton ref={peekTriggerRef} unstyled type="button" className={`cluster-presence-avatar-v227 profile-peek-trigger-v473 ${className}`.trim()} title={`${title || label} · Open quick profile`} data-presence={presence} onClick={openProfilePeek} style={runtimeStyle({ "--user-avatar-accent": accentColor || "var(--studio-primary, #57c1ff)" })} aria-label={`Open ${label} quick profile`}>{avatarContents}</ClusterButton>
    ) : (
      <span className={`cluster-presence-avatar-v227 ${className}`.trim()} title={title} data-presence={presence} style={runtimeStyle({ "--user-avatar-accent": accentColor || "var(--studio-primary, #57c1ff)" })}>{avatarContents}</span>
    )}
    {peek && <ProfilePeekCard profile={peek.profile} x={peek.x} y={peek.y} onClose={closePeek} />}
  </>;
}
