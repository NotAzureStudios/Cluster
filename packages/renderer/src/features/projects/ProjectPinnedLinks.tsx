import { useState } from "react";
import { api } from "../../core/api";
import { ClusterIcon } from "../../components/ClusterIcon";
import { ClusterIconButton } from "../../components/ClusterButton";
import { LibraryIcon } from "../../components/LibraryIcon";
import { promptCluster } from "../../components/cluster-dialog-service";
import type { Project } from "../application/application-models";

type PinnedLink = { label: string; url: string };

// Known hosts get their brand mark and a ready-made name.
const KNOWN_HOSTS: Array<[RegExp, string, string]> = [
  [/(^|\.)github\.com$/, "github", "GitHub"],
  [/(^|\.)gitlab\.com$/, "gitlab", "GitLab"],
  [/(^|\.)(discord\.com|discord\.gg)$/, "discord", "Discord"],
  [/(^|\.)(youtube\.com|youtu\.be)$/, "youtube", "YouTube"],
  [/(^|\.)(steampowered\.com|steamcommunity\.com)$/, "steam", "Steam"],
  [/(^|\.)itch\.io$/, "itchdotio", "itch.io"],
  [/(^|\.)epicgames\.com$/, "epicgames", "Epic Games"],
  [/(^|\.)fortnite\.com$/, "epicgames", "Fortnite"],
  [/(^|\.)twitch\.tv$/, "twitch", "Twitch"],
  [/(^|\.)(x\.com|twitter\.com)$/, "x", "X"],
  [/(^|\.)reddit\.com$/, "reddit", "Reddit"],
  [/(^|\.)notion\.(so|site)$/, "notion", "Notion"],
  [/(^|\.)figma\.com$/, "figma", "Figma"],
  [/(^|\.)trello\.com$/, "trello", "Trello"],
  [/^docs\.google\.com$/, "googledocs", "Google Docs"],
  [/^drive\.google\.com$/, "googledrive", "Google Drive"],
  [/(^|\.)artstation\.com$/, "artstation", "ArtStation"],
  [/(^|\.)sketchfab\.com$/, "sketchfab", "Sketchfab"],
];

function hostOf(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; }
}
function knownHost(url: string) {
  const host = hostOf(url);
  return KNOWN_HOSTS.find(([pattern]) => pattern.test(host));
}

export function ProjectPinnedLinks({ project, canEdit, onSaved }: { project: Project; canEdit: boolean; onSaved: () => Promise<void> | void }) {
  const links: PinnedLink[] = project.pinnedLinks || [];
  const [busy, setBusy] = useState(false);
  if (!links.length && !canEdit) return null;

  async function save(next: PinnedLink[]) {
    setBusy(true);
    try {
      await api(`/api/projects/${project.id}`, { method: "PATCH", body: JSON.stringify({ pinnedLinks: next }) });
      await onSaved();
    } finally { setBusy(false); }
  }

  async function add() {
    const raw = await promptCluster({ title: "Pin a link", message: "Repo, Discord channel, store page, doc… anything the team opens often.", label: "URL", placeholder: "https://" });
    if (!raw?.trim()) return;
    const url = /^https?:\/\//i.test(raw.trim()) ? raw.trim() : `https://${raw.trim()}`;
    if (!hostOf(url)) return;
    const label = await promptCluster({ title: "Name the link", message: url, label: "Name", initialValue: knownHost(url)?.[2] || hostOf(url) });
    if (!label?.trim()) return;
    await save([...links, { label: label.trim().slice(0, 60), url }].slice(0, 12));
  }

  return <ul className="pj-links" aria-label="Pinned links">
    {links.map((link, index) => {
      const known = knownHost(link.url);
      return <li key={`${link.url}-${index}`}>
        <a href={link.url} target="_blank" rel="noreferrer" title={link.url}>
          {known ? <LibraryIcon set="simple-icons" name={known[1]} /> : <ClusterIcon name="link" />}
          <span>{link.label}</span>
        </a>
        {canEdit ? <button type="button" className="pj-links__remove" aria-label={`Unpin ${link.label}`} disabled={busy} onClick={() => void save(links.filter((_, position) => position !== index))}><ClusterIcon name="close" /></button> : null}
      </li>;
    })}
    {canEdit && links.length < 12 ? <li><ClusterIconButton size="compact" className="pj-links__add" label="Pin a link" disabled={busy} onClick={() => void add()}><ClusterIcon name="plus" /></ClusterIconButton></li> : null}
  </ul>;
}
