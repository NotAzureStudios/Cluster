import { useEffect, useId, useRef } from "react";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterCopyButton } from "../../components/ClusterCopyButton";
import { formatAccountFirstSignInGuide } from "./account-first-sign-in-guide";
import "./account-credential-handoff.css";

/** A deliberate one-time handoff. Credentials are held in account-scoped React
 * state only, never in local storage, a URL, a notification or analytics. */
export function AccountCredentialHandoff({
  username, temporaryPassword, onDismiss,
}: {
  username: string;
  temporaryPassword: string;
  onDismiss: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const signInUrl = typeof window === "undefined" ? "" :
    ["http:", "https:"].includes(window.location.protocol) ? window.location.origin + "/" : "";
  const instructions = formatAccountFirstSignInGuide({ username, temporaryPassword, signInUrl });

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    return () => { if (dialog.open) dialog.close(); };
  }, []);

  return <dialog ref={dialogRef} className="people-credential-handoff-v11"
    aria-labelledby={titleId} aria-describedby={descriptionId}
    onCancel={(event) => event.preventDefault()}
    onClose={onDismiss}>
    <div className="people-credential-handoff-head-v11">
      <span className="eyebrow">Account provisioned</span>
      <h2 id={titleId}>Finish the account handoff</h2>
      <p id={descriptionId}>The account is created. Give the new member the temporary password privately. They can sign in and set their own password without an administrator changing it again.</p>
    </div>
    <div className="people-credential-handoff-details-v11">
      <div><span>Username</span><strong>{username}</strong></div>
      <div><span>Temporary password</span><code>{temporaryPassword}</code></div>
    </div>
    <ol className="people-credential-handoff-steps-v11">
      <li>Copy the sign-in instructions and share them privately.</li>
      <li>The member signs in with their username and temporary password.</li>
      <li>Cluster requires them to set a permanent password, then complete their first-login setup and any required MFA.</li>
    </ol>
    <p className="people-credential-handoff-warning-v11" role="note">This temporary password is shown only for this handoff. After closing, use the governed password reset action if it was not saved. Do not send it in a public Discord channel.</p>
    <div className="people-credential-handoff-actions-v11">
      <ClusterCopyButton text={instructions} variant="primary" copiedLabel="Instructions copied">Copy sign-in instructions</ClusterCopyButton>
      <ClusterCopyButton text={temporaryPassword} variant="secondary" copiedLabel="Password copied">Copy password</ClusterCopyButton>
      <ClusterButton type="button" variant="quiet" onClick={() => dialogRef.current?.close()}>Done</ClusterButton>
    </div>
  </dialog>;
}
