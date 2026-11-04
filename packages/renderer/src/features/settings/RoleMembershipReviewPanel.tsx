import { ClusterButton } from "../../components/ClusterButton";
import "./role-membership-review.css";

export type RoleMemberSnapshot = {
  roleId: string;
  ownerId: string;
  items: Array<{ id: string; displayName?: string | null; username?: string | null; archived?: boolean }>;
  hasMore: boolean;
};

export function RoleMembershipReviewPanel({
  roleId, snapshot, loading, error, onRefresh,
}: {
  roleId: string;
  snapshot: RoleMemberSnapshot | null;
  loading: boolean;
  error: string;
  onRefresh: () => void;
}) {
  // A snapshot belongs to one role and one authenticated editor; the caller
  // additionally enforces owner identity before passing it to this component.
  const visible = snapshot?.roleId === roleId ? snapshot : null;
  return (
    <section className="studio-role-membership-review-v11" aria-label="Role assignment review">
      <header>
        <div>
          <strong>Assigned members</strong>
          <span>Check current workspace assignments before changing role availability.</span>
        </div>
        <ClusterButton type="button" size="compact" variant="secondary" disabled={loading}
          onClick={onRefresh}>{loading ? "Checking…" : visible ? "Refresh members" : "Review members"}</ClusterButton>
      </header>
      <p className="studio-role-membership-note-v11">
        Read-only, on-demand review. Changes to role membership are made in People Management.
        Removing or disabling a role still requires a separate fresh server validation when saving Studio Settings.
      </p>
      {error ? <p role="alert" className="studio-role-membership-error-v11">{error}</p> : null}
      {visible && !loading ? (
        <div role="status" aria-live="polite">
          {visible.items.length ? (
            <ul>
              {visible.items.map((member) => (
                <li key={member.id}>
                  <span><strong>{member.displayName?.trim() || member.username?.trim() || "Workspace member"}</strong>
                    {member.username ? <small>@{member.username}</small> : null}</span>
                  {member.archived ? <span className="studio-role-membership-archived-v11">Archived</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="studio-role-membership-empty-v11">No matching members in this workspace at the time of this check.</p>
          )}
          <p className="studio-role-membership-footer-v11">
            {visible.hasMore ? "Showing the first 25 members; additional assignments exist." : `Showing ${visible.items.length} assigned member${visible.items.length === 1 ? "" : "s"} from this workspace.`}
          </p>
        </div>
      ) : null}
    </section>
  );
}
