import { CLUSTER_EXTERNAL_PORTAL_SECTIONS, CLUSTER_EXTERNAL_PORTAL_SECTION_LABELS } from "@cluster/shared";
import { ClusterNativeSelect, ClusterInput } from "../../components/ClusterNativeControls";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterEmptyState } from "../../components/ClusterEmptyState";
import { ClusterDisclosureGroup } from "../../components/ClusterDisclosureGroup";
import { useId, type Dispatch, type SetStateAction } from "react";
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
  const id = useId();
  if (!isManager) return null;
  return (
    <ClusterDisclosureGroup className="project-access-share-v197" contentClassName="project-access-share-body-v197"
      defaultOpen title="Restricted share links" headerTrailing={`${shareLinks.filter((link) => link.status === "active").length} active`}>
        <div className="share-link-builder-v197">
          <div className="field">
            <label htmlFor={`${id}-level`}>Access level</label>
            <ClusterNativeSelect
              id={`${id}-level`}
              value={shareForm.accessLevel}
              onChange={(event) => setShareForm((prev) => ({ ...prev, accessLevel: event.target.value as ExternalPortalAccessLevel }))}
            >
              <option value="viewer">Viewer</option>
              <option value="commenter">Commenter</option>
              <option value="reviewer">Reviewer</option>
            </ClusterNativeSelect>
          </div>
          <div className="field">
            <label htmlFor={`${id}-expires`}>Expires</label>
            <ClusterTextInput id={`${id}-expires`} type="date" value={shareForm.expiresAt} onChange={(event) => setShareForm((prev) => ({ ...prev, expiresAt: event.target.value }))} />
          </div>
          <div className="field">
            <label htmlFor={`${id}-opens`}>Maximum opens</label>
            <ClusterTextInput
              id={`${id}-opens`}
              type="number"
              min="1"
              value={shareForm.maxUses}
              onChange={(event) => setShareForm((prev) => ({ ...prev, maxUses: event.target.value }))}
              placeholder="Unlimited"
            />
          </div>
          <div className="share-section-options-v197">
            {CLUSTER_EXTERNAL_PORTAL_SECTIONS.map((sectionName) => (
              <label className="tool-check compact" key={sectionName}>
                <ClusterInput type="checkbox" checked={shareForm.allowedSections.includes(sectionName)} onChange={() => toggleShareSection(sectionName)} /> {CLUSTER_EXTERNAL_PORTAL_SECTION_LABELS[sectionName]}
              </label>
            ))}
          </div>
          <ClusterButton type="button" className="" onClick={createShareLink} busy={busyCreate} busyLabel="Creating…" disabled={actionsBusy || !shareForm.allowedSections.length} variant="secondary">
            Create share link
          </ClusterButton>
        </div>
        {newShareUrl && (
          <div className="share-url-once-v197">
            <div>
              <strong>Copy this URL now</strong>
              <span>The full token is only returned once.</span>
            </div>
            <ClusterTextInput aria-label="New restricted share link URL" readOnly value={newShareUrl} onFocus={(event) => event.currentTarget.select()} />
            <ClusterButton type="button" className="" onClick={copyShareUrl} variant="secondary">Copy</ClusterButton>
          </div>
        )}
        <div className="share-link-list-v197">
          {shareLinks.length ? shareLinks.map((link) => (
            <article key={link.id} className={link.status}>
              <div>
                <strong>{portalAccessLabel(link.accessLevel)} · {link.tokenPreview}</strong>
                <span>{link.allowedSections.map(levelLabel).join(" · ") || "No sections"}</span>
                <em>
                  {link.expiresAt ? `${link.status === "expired" ? "Expired" : "Expires"} ${new Date(link.expiresAt).toLocaleDateString()}` : "No expiry"} · {link.useCount}
                  {link.maxUses ? `/${link.maxUses}` : ""} opens
                </em>
              </div>
              <div className="button-row compact">
                {link.status === "active" && (
                  <ClusterButton type="button" className="" busy={busyForLink(link.id)} disabled={actionsBusy} onClick={() => patchShareLink(link.id, { expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(), status: "active" })} variant="quiet" size="compact">
                    Extend 30d
                  </ClusterButton>
                )}
                <ClusterButton type="button" className="" disabled={actionsBusy || link.status === "revoked"} busy={busyForLink(link.id)} onClick={() => patchShareLink(link.id, { status: "revoked" })} variant="danger" size="compact">
                  Revoke
                </ClusterButton>
              </div>
            </article>
          )) : (
            <ClusterEmptyState compact kind="first-use" title="No share links" description="Create a link when temporary external project access is required." />
          )}
        </div>
    </ClusterDisclosureGroup>
  );
}
