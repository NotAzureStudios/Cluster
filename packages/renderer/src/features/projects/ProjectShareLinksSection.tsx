import { CLUSTER_EXTERNAL_PORTAL_SECTIONS, CLUSTER_EXTERNAL_PORTAL_SECTION_LABELS } from "@cluster/shared";
import { ClusterNativeSelect } from "../../components/ClusterNativeControls";
import { ClusterIcon } from "../../components/ClusterIcon";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterButton } from "../../components/ClusterButton";
import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { levelLabel } from "../../core/format";
import type { ExternalPortalAccessLevel, ProjectShareLink } from "../application/application-models";

export interface ProjectShareLinkForm {
  accessLevel: ExternalPortalAccessLevel;
  allowedSections: string[];
  expiresAt: string;
  maxUses: string;
}

export function ProjectShareLinksSection({
  isManager,
  busyCreate,
  busyForLink,
  actionsBusy,
  shareLinks,
  shareForm,
  setShareForm,
  newShareUrl,
  portalAccessLabel,
  toggleShareSection,
  createShareLink,
  patchShareLink,
  copyShareUrl,
}: {
  isManager: boolean;
  busyCreate: boolean;
  busyForLink: (id: string) => boolean;
  actionsBusy: boolean;
  shareLinks: ProjectShareLink[];
  shareForm: ProjectShareLinkForm;
  setShareForm: Dispatch<SetStateAction<ProjectShareLinkForm>>;
  newShareUrl: string;
  portalAccessLabel: (level: ExternalPortalAccessLevel) => string;
  toggleShareSection: (sectionName: string) => void;
  createShareLink: () => void;
  patchShareLink: (id: string, patch: Partial<ProjectShareLink>) => void;
  copyShareUrl: () => void;
}) {
  const [creating, setCreating] = useState(false);
  useEffect(() => { if (newShareUrl) setCreating(false); }, [newShareUrl]);
  if (!isManager) return null;
  const active = shareLinks.filter((link) => link.status === "active").length;
  return (
    <section className="pa-card" aria-label="Share links">
      <header className="pa-card__head">
        <h3>Share links</h3>
        <span className="pa-count">{active} active</span>
        <ClusterButton type="button" size="compact" variant={creating ? "quiet" : "secondary"} onClick={() => setCreating((open) => !open)}><ClusterIcon name={creating ? "close" : "plus"} />{creating ? "Cancel" : "New link"}</ClusterButton>
      </header>
      {creating ? <div className="pa-add pa-add--link">
        <label className="pa-field"><span>Level</span><ClusterNativeSelect value={shareForm.accessLevel} aria-label="Link access" onChange={(event) => setShareForm((prev) => ({ ...prev, accessLevel: event.target.value as ExternalPortalAccessLevel }))}>
          <option value="viewer">Viewer</option>
          <option value="commenter">Commenter</option>
          <option value="reviewer">Reviewer</option>
        </ClusterNativeSelect></label>
        <label className="pa-field"><span>Expires</span><ClusterTextInput type="date" aria-label="Expires" value={shareForm.expiresAt} onChange={(event) => setShareForm((prev) => ({ ...prev, expiresAt: event.target.value }))} /></label>
        <label className="pa-field"><span>Max opens</span><ClusterTextInput type="number" min="1" aria-label="Maximum opens" value={shareForm.maxUses} onChange={(event) => setShareForm((prev) => ({ ...prev, maxUses: event.target.value }))} placeholder="Unlimited" /></label>
        <div className="pa-field pa-add__sections"><span>Shows</span><span className="pa-chips" role="group" aria-label="Sections the link shows">
          {CLUSTER_EXTERNAL_PORTAL_SECTIONS.map((sectionName) => {
            const on = shareForm.allowedSections.includes(sectionName);
            return <button type="button" key={sectionName} className="pa-chip" aria-pressed={on} onClick={() => toggleShareSection(sectionName)}>{on ? <ClusterIcon name="check" aria-hidden="true" /> : null}{CLUSTER_EXTERNAL_PORTAL_SECTION_LABELS[sectionName]}</button>;
          })}
        </span></div>
        <div className="pa-add__actions">
          <ClusterButton type="button" size="compact" variant="primary" onClick={() => { createShareLink(); }} busy={busyCreate} busyLabel="Creating…" disabled={actionsBusy || !shareForm.allowedSections.length}>Create link</ClusterButton>
        </div>
      </div> : null}
      {newShareUrl ? <div className="pa-once">
        <ClusterIcon name="link" aria-hidden="true" />
        <ClusterTextInput aria-label="New share link URL" readOnly value={newShareUrl} onFocus={(event) => event.currentTarget.select()} />
        <ClusterButton type="button" size="compact" variant="primary" onClick={copyShareUrl}>Copy</ClusterButton>
        <small>Shown once</small>
      </div> : null}
      {shareLinks.length ? <ul className="pa-rules">
        {shareLinks.map((link) => <li key={link.id} data-state={link.status} title={link.allowedSections.map(levelLabel).join(" · ") || "No sections"}>
          <span className="pa-rule__effect"><ClusterIcon name="link" aria-hidden="true" />{portalAccessLabel(link.accessLevel)}</span>
          <span className="pa-rule__who"><b>{link.tokenPreview}</b><small>{link.allowedSections.length} section{link.allowedSections.length === 1 ? "" : "s"} · {link.useCount}{link.maxUses ? `/${link.maxUses}` : ""} opens</small></span>
          <span />
          <span className="pa-rule__when">{link.status === "revoked" ? "Revoked" : link.expiresAt ? `${link.status === "expired" ? "Expired" : "Until"} ${new Date(link.expiresAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : "No expiry"}</span>
          <span className="pa-rule__actions">
            {link.status === "active" ? <ClusterButton type="button" size="compact" variant="quiet" busy={busyForLink(link.id)} disabled={actionsBusy} onClick={() => patchShareLink(link.id, { expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(), status: "active" })}>Extend 30d</ClusterButton> : null}
            {link.status !== "revoked" ? <ClusterButton type="button" size="compact" variant="quiet" busy={busyForLink(link.id)} disabled={actionsBusy} onClick={() => patchShareLink(link.id, { status: "revoked" })}>Revoke</ClusterButton> : null}
          </span>
        </li>)}
      </ul> : creating ? null : <p className="pa-empty">No links. Create one to give someone outside the studio temporary access.</p>}
    </section>
  );
}
