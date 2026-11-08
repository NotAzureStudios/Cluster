import { useEffect, useId, useRef, useState } from "react";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterCopyButton } from "../../components/ClusterCopyButton";
import { ClusterInput } from "../../components/ClusterNativeControls";
import { useUnsavedChangesGuard } from "../../components/useUnsavedChangesGuard";
import "./account-invitation-handoff.css";

/** Activation link is shown one time and is held only in owner-scoped memory.
 * No local storage, logs, browser clipboard writes without operator action. */
export function AccountInvitationHandoff({
  username, activationLink, expiresAt, onDismiss,
}: {
  username: string;
  activationLink: string;
  expiresAt: string;
  onDismiss: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const titleId = useId();
  const descriptionId = useId();
  useUnsavedChangesGuard({
    dirty: true, title: "Leave one-time activation link?",
    message: "This invitation link cannot be retrieved after closing. Copy it before leaving.",
  });
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, []);

  return <dialog ref={ref} className="people-invitation-handoff-v11" aria-labelledby={titleId}
    aria-describedby={descriptionId} onCancel={(event) => event.preventDefault()}
    onClose={onDismiss}>
    <p className="eyebrow">Invitation ready</p>
    <h2 id={titleId}>Share activation privately</h2>
    <p id={descriptionId}>Account <strong>@{username}</strong> is awaiting password setup. The previous temporary password has been invalidated.</p>
    <div className="people-invitation-handoff-details-v11">
      <span>Activation link</span>
      <code>One-time secure link · copy below</code>
      <small>Expires {new Date(expiresAt).toLocaleString()}</small>
    </div>
    <p className="people-invitation-handoff-note-v11">The member opens the link, sets a password, and then signs in normally. MFA and studio onboarding still apply. Never share this link in a public channel.</p>
    <label className="people-invitation-handoff-ack-v11">
      <ClusterInput type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
      <span>I securely copied or shared this invitation link.</span>
    </label>
    <div className="people-invitation-handoff-actions-v11">
      <ClusterCopyButton text={activationLink} variant="primary" copiedLabel="Invitation link copied">Copy activation link</ClusterCopyButton>
      <ClusterButton type="button" variant="secondary" disabled={!acknowledged} onClick={() => ref.current?.close()}>Finish handoff</ClusterButton>
    </div>
  </dialog>;
}
