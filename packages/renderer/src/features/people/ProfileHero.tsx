import { useState, type ReactNode } from "react";
import { api, API_URL } from "../../core/api";
import { PresenceAvatar } from "../../components/PresenceAvatar";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterIcon } from "../../components/ClusterIcon";
import { ClusterModal } from "../../components/ClusterModal";
import { ColorField } from "../../components/ColorField";
import { presenceState } from "./people-utils";
import { DepartmentIdentityMark, type DepartmentIdentity } from "../../components/DepartmentIdentityMark";
import type { User } from "../application/application-models";
import "./profile-hero.css";

type ProfilePerson = User & { createdAt?: string; title?: string | null; workLocation?: string | null; timezone?: string | null; hideLocation?: boolean };
type Stat = { label: string; value: number; onClick?: () => void };

const media = (url?: string | null) => !url ? "" : /^(?:https?:|data:|blob:)/i.test(url) ? url : `${API_URL.replace(/\/$/, "")}${url}`;
const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; } };
const localTime = (zone?: string | null) => { try { return zone ? new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZone: zone }) : ""; } catch { return ""; } };

/** The top of a profile: banner, avatar, name, bio, a line of facts and
 *  counts. Your own profile gets Edit profile. */
export function ProfileHero({ person, isSelf, subtitle, departmentIdentity, stats, actions, leading, onSaved }: {
  person: ProfilePerson; isSelf: boolean; subtitle?: ReactNode; departmentIdentity?: DepartmentIdentity | null; stats: Stat[]; actions?: ReactNode; leading?: ReactNode; onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const accent = person.personalAccentColor || "var(--accent)";
  const name = person.preferredName || person.displayName || person.username;
  const links = [...(person.profileWebsite ? [{ label: "", url: person.profileWebsite }] : []), ...(person.profileLinks || [])];
  const time = person.profileShowTimezone !== false ? localTime(person.timezone) : "";
  return <header className="ph" style={{ ["--ph-accent" as string]: accent }}>
    <div className="ph__banner">{person.profileBanner ? <img src={media(person.profileBanner)} alt="" /> : null}{leading ? <div className="ph__leading">{leading}</div> : null}</div>
    <div className="ph__row">
      <PresenceAvatar className="ph__avatar" userId={person.id} imageUrl={person.avatarUrl} label={name} fallback={name.slice(0, 1).toUpperCase()} state={presenceState(person as any) as any} accentColor={person.personalAccentColor || undefined} />
      <div className="ph__actions">
        {isSelf ? <ClusterButton size="compact" variant="secondary" onClick={() => setEditing(true)}>Edit profile</ClusterButton> : null}
        {actions}
      </div>
    </div>
    <div className="ph__body">
      <h2>{name}{person.pronouns ? <span className="ph__pronouns">{person.pronouns}</span> : null}</h2>
      <p className="ph__handle">@{person.username}{subtitle ? <> · {subtitle}</> : null}{departmentIdentity ? <> · <DepartmentIdentityMark department={departmentIdentity} label size={14} /></> : null}</p>
      {person.profileBio ? <p className="ph__bio">{person.profileBio}</p> : isSelf ? <button type="button" className="ph__bio ph__bio--empty" onClick={() => setEditing(true)}>Add a bio</button> : null}
      <ul className="ph__meta">
        {person.workLocation && !person.hideLocation ? <li><ClusterIcon name="globe" />{person.workLocation}</li> : null}
        {time ? <li title={person.timezone || undefined}><ClusterIcon name="clock" />{time} local</li> : null}
        {links.map((link) => <li key={link.url}><ClusterIcon name="link" /><a href={link.url} target="_blank" rel="noreferrer">{link.label || host(link.url)}</a></li>)}
        {person.joinedAt || person.createdAt ? <li><ClusterIcon name="calendar" />Joined {new Date(String(person.joinedAt || person.createdAt)).toLocaleDateString([], { month: "long", year: "numeric" })}</li> : null}
      </ul>
      {stats.length ? <div className="ph__stats">{stats.map((stat) => <button key={stat.label} type="button" disabled={!stat.onClick} onClick={stat.onClick}><strong>{stat.value}</strong> {stat.value === 1 ? stat.label.replace(/s$/, "") : stat.label}</button>)}</div> : null}
    </div>
    {editing ? <EditProfile person={person} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); onSaved(); }} /> : null}
  </header>;
}

const readDataUrl = (file: File) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result || "")); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); });
const upload = async (path: string, file: File) => api(path, { method: "POST", body: JSON.stringify({ originalName: file.name, mimeType: file.type || "image/png", sizeBytes: file.size, dataUrl: await readDataUrl(file) }) });

function EditProfile({ person, onClose, onSaved }: { person: ProfilePerson; onClose: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState({
    displayName: person.displayName || "", pronouns: person.pronouns || "", profileBio: person.profileBio || "",
    workLocation: person.workLocation || "", profileWebsite: person.profileWebsite || "",
    personalAccentColor: person.personalAccentColor || "#57c1ff",
    profileLinks: [...(person.profileLinks || []), { label: "", url: "" }].slice(0, 4),
  });
  const [banner, setBanner] = useState<{ file: File | null; preview: string; cleared: boolean }>({ file: null, preview: media(person.profileBanner), cleared: false });
  const [avatar, setAvatar] = useState<{ file: File | null; preview: string }>({ file: null, preview: media(person.avatarUrl) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (patch: Partial<typeof draft>) => setDraft((current) => ({ ...current, ...patch }));
  const setLink = (index: number, patch: Partial<{ label: string; url: string }>) => set({ profileLinks: draft.profileLinks.map((link, at) => at === index ? { ...link, ...patch } : link) });
  const pick = (accept: string, onFile: (file: File) => void) => { const input = Object.assign(document.createElement("input"), { type: "file", accept }); input.onchange = () => { const file = input.files?.[0]; if (file) onFile(file); }; input.click(); };

  async function save() {
    setBusy(true); setError("");
    try {
      const website = draft.profileWebsite.trim();
      await api("/api/me/profile", { method: "PATCH", body: JSON.stringify({
        displayName: draft.displayName.trim() || null, pronouns: draft.pronouns.trim() || null, profileBio: draft.profileBio,
        workLocation: draft.workLocation.trim() || null, personalAccentColor: draft.personalAccentColor,
        profileWebsite: website && !/^https?:\/\//i.test(website) ? `https://${website}` : website,
        profileLinks: draft.profileLinks.filter((link) => link.url.trim()).map((link) => ({ label: link.label.trim(), url: /^https?:\/\//i.test(link.url.trim()) ? link.url.trim() : `https://${link.url.trim()}` })),
      }) });
      if (banner.file) await upload("/api/me/banner", banner.file);
      else if (banner.cleared) await api("/api/me/banner", { method: "DELETE" });
      if (avatar.file) await upload("/api/me/avatar", avatar.file);
      onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Your profile wasn't saved."); }
    finally { setBusy(false); }
  }

  return <ClusterModal open onClose={() => { if (!busy) onClose(); }} className="modal panel ph-edit" ariaLabel="Edit profile">
    <header className="ph-edit__head"><h2>Edit profile</h2><ClusterButton size="compact" variant="primary" busy={busy} onClick={() => void save()}>Save</ClusterButton></header>
    <div className="ph-edit__media" style={{ ["--ph-accent" as string]: draft.personalAccentColor }}>
      <div className="ph__banner">{banner.preview ? <img src={banner.preview} alt="" /> : null}
        <div className="ph-edit__over">
          <button type="button" title="Change banner" onClick={() => pick("image/*", (file) => setBanner({ file, preview: URL.createObjectURL(file), cleared: false }))}><ClusterIcon name="image" /></button>
          {banner.preview ? <button type="button" title="Remove banner" onClick={() => setBanner({ file: null, preview: "", cleared: true })}><ClusterIcon name="close" /></button> : null}
        </div>
      </div>
      <button type="button" className="ph-edit__avatar" title="Change photo" onClick={() => pick("image/*", (file) => setAvatar({ file, preview: URL.createObjectURL(file) }))}>
        {avatar.preview ? <img src={avatar.preview} alt="" /> : <span>{(draft.displayName || person.username).slice(0, 1).toUpperCase()}</span>}
        <i><ClusterIcon name="image" /></i>
      </button>
    </div>
    <div className="ph-edit__fields">
      <label><span>Name</span><input value={draft.displayName} maxLength={80} onChange={(event) => set({ displayName: event.target.value })} /></label>
      <label><span>Pronouns</span><input value={draft.pronouns} maxLength={80} placeholder="they/them" onChange={(event) => set({ pronouns: event.target.value })} /></label>
      <label className="ph-edit__wide"><span>Bio <small>{draft.profileBio.length}/600</small></span><textarea value={draft.profileBio} maxLength={600} rows={3} onChange={(event) => set({ profileBio: event.target.value })} /></label>
      <label><span>Location</span><input value={draft.workLocation} maxLength={160} onChange={(event) => set({ workLocation: event.target.value })} /></label>
      <label><span>Website</span><input value={draft.profileWebsite} maxLength={320} placeholder="yoursite.com" onChange={(event) => set({ profileWebsite: event.target.value })} /></label>
      <div className="ph-edit__wide"><span className="ph-edit__label">Links</span>
        {draft.profileLinks.map((link, index) => <div key={index} className="ph-edit__link">
          <input value={link.label} maxLength={40} placeholder="Label" aria-label={`Link ${index + 1} label`} onChange={(event) => setLink(index, { label: event.target.value })} />
          <input value={link.url} maxLength={320} placeholder="https://" aria-label={`Link ${index + 1} URL`} onChange={(event) => setLink(index, { url: event.target.value })} />
        </div>)}
        {draft.profileLinks.length < 4 ? <ClusterButton size="compact" variant="quiet" onClick={() => set({ profileLinks: [...draft.profileLinks, { label: "", url: "" }] })}><ClusterIcon name="plus" />Add link</ClusterButton> : null}
      </div>
      <div className="ph-edit__wide"><ColorField label="Accent" value={draft.personalAccentColor} onChange={(value) => set({ personalAccentColor: value })} /></div>
    </div>
    {error ? <p className="ph-edit__error" role="alert">{error}</p> : null}
  </ClusterModal>;
}
