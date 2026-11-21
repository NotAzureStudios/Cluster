import { useEffect, useRef, useState } from "react";
import type { User } from "../application/application-models";
import { ClusterButton, ClusterIconButton } from "../../components/ClusterButton";
import { ClusterIcon } from "../../components/ClusterIcon";
import { ClusterNativeSelect } from "../../components/ClusterNativeControls";
import { ClusterOverlayDrawer } from "../../components/ClusterWorkspacePanel";
import { SettingsWorkspaceShell } from "../../components/SettingsWorkspaceShell";
import { queryApi } from "../../core/api";
import { formatRelativeTime } from "../../core/format";
import { AccountCredentialHandoff } from "../people/AccountCredentialHandoff";
import { PeopleAccountProvisioningWizard } from "../people/PeopleAccountProvisioningWizard";
import { useAccountProvisioning } from "../people/use-account-provisioning";
import "./admin-users.css";

/* Admin → Users. Every account in one dense list; the status views
   (All, Needs setup, Restricted, …) nest under Users in the Admin nav.
   A row opens the person's full profile, where access and security
   actions live. "Add person" opens the provisioning wizard beside the
   list. Account creation itself lives in useAccountProvisioning. */

type StatusView = "all" | "setup" | "restricted" | "expiring" | "expired" | "archived";
type TypeFilter = "all" | "employee" | "contractor" | "client" | "guest";
type Account = {
  id: string;
  username: string;
  displayName: string;
  email: string | null;
  accountType: string;
  accountState: string;
  workspaceRole: string;
  department: string | null;
  jobTitle: string | null;
  manager: { id: string; displayName: string } | null;
  accessExpiresAt: string | null;
  lastSeenAt: string | null;
  updatedAt: string;
  archived: boolean;
  avatarUrl?: string | null;
};
type AccountPage = { items: Account[]; total: number; hasMore: boolean; nextCursor: string | null };
type RoleCatalog = { roles: Array<{ id: string; label: string }> };

const VIEWS: Array<{ id: StatusView; label: string }> = [
  { id: "all", label: "All people" },
  { id: "setup", label: "Needs setup" },
  { id: "restricted", label: "Restricted" },
  { id: "expiring", label: "Expiring soon" },
  { id: "expired", label: "Expired" },
  { id: "archived", label: "Archived" },
];

function stateOf(account: Account): { label: string; tone: "good" | "warning" | "danger" | "neutral" } {
  if (account.archived) return { label: "Archived", tone: "neutral" };
  if (account.accessExpiresAt && new Date(account.accessExpiresAt).getTime() <= Date.now()) return { label: "Expired", tone: "danger" };
  const state = account.accountState.toUpperCase();
  if (state === "ACTIVE") return { label: "Active", tone: "good" };
  if (["SUSPENDED", "DISABLED", "LOCKED"].includes(state)) return { label: state === "LOCKED" ? "Locked" : state === "DISABLED" ? "Disabled" : "Suspended", tone: "danger" };
  const setup: Record<string, string> = { PASSWORD_CHANGE_REQUIRED: "First sign-in", PASSWORD_RESET_REQUIRED: "Password reset", MFA_ENROLLMENT_REQUIRED: "MFA setup", DISCORD_LINK_REQUIRED: "Discord link" };
  return { label: setup[state] || state.replaceAll("_", " ").toLowerCase(), tone: "warning" };
}

export function AdminUsersPage({ currentUser, onOpenPerson, startCreating = false }: {
  currentUser: User;
  onOpenPerson: (id: string) => void;
  startCreating?: boolean;
}) {
  const [view, setView] = useState<StatusView>("all");
  const [search, setSearch] = useState("");
  const [settledSearch, setSettledSearch] = useState("");
  const [accountType, setAccountType] = useState<TypeFilter>("all");
  const [role, setRole] = useState("");
  const [roles, setRoles] = useState<RoleCatalog["roles"]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [status, setStatus] = useState("");
  const generation = useRef(0);
  const paging = useRef(false);

  const provisioning = useAccountProvisioning({
    enabled: Boolean(currentUser.isAdmin),
    currentUserId: currentUser.id,
    onStatus: setStatus,
    onCreated: async () => { setReloadKey((value) => value + 1); },
  });
  useEffect(() => { if (startCreating) void provisioning.setOpen(true); }, [startCreating]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const timer = window.setTimeout(() => setSettledSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    void queryApi<RoleCatalog>("/api/admin/users/assignable-roles", { staleMs: 60_000, tags: ["roles", "users", "people"] })
      .then((result) => { if (!cancelled) setRoles(result.roles || []); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  const params = new URLSearchParams({ limit: "50", search: settledSearch, status: view, accountType, role }).toString();
  useEffect(() => {
    const current = ++generation.current;
    paging.current = false;
    setLoading(true);
    setError("");
    void queryApi<AccountPage>(`/api/admin/users/management?${params}`, { force: true, staleMs: 0, persist: false, tags: ["users", "people", "roles", "directory"] })
      .then((page) => {
        if (current !== generation.current) return;
        setAccounts(page.items || []);
        setTotal(page.total ?? (page.items || []).length);
        setNextCursor(page.hasMore ? page.nextCursor : null);
      })
      .catch((cause) => { if (current === generation.current) setError(cause instanceof Error ? cause.message : "Unable to load accounts."); })
      .finally(() => { if (current === generation.current) setLoading(false); });
    return () => { generation.current += 1; };
  }, [params, reloadKey]);

  async function loadMore() {
    if (!nextCursor || loading || paging.current) return;
    paging.current = true;
    const requestGeneration = generation.current;
    setLoadingMore(true);
    try {
      const page = await queryApi<AccountPage>(`/api/admin/users/management?${params}&cursor=${encodeURIComponent(nextCursor)}`, { force: true, staleMs: 0, persist: false, tags: ["users", "people", "roles", "directory"] });
      if (requestGeneration !== generation.current) return;
      setAccounts((current) => { const ids = new Set(current.map((item) => item.id)); return [...current, ...page.items.filter((item) => !ids.has(item.id))]; });
      setTotal(page.total);
      setNextCursor(page.hasMore ? page.nextCursor : null);
    } catch (cause) {
      if (requestGeneration === generation.current) setError(cause instanceof Error ? cause.message : "Could not load more accounts.");
    } finally {
      if (requestGeneration === generation.current) { paging.current = false; setLoadingMore(false); }
    }
  }

  const filtersActive = Boolean(search || accountType !== "all" || role);
  const roleLabel = (id: string) => roles.find((item) => item.id === id)?.label || id.replaceAll("_", " ");

  return <SettingsWorkspaceShell
    className="au"
    title="Users"
    navLabel="User views"
    activeId={view}
    onChange={(id) => setView(id as StatusView)}
    items={VIEWS.map((item) => ({ id: item.id, label: item.label, icon: item.id === "all" ? "users" : item.id === "setup" ? "spark" : item.id === "restricted" ? "lock" : item.id === "archived" ? "archive" : "clock" }))}
    status={status}
    actions={<>
      <ClusterIconButton size="compact" label="Refresh" onClick={() => setReloadKey((value) => value + 1)}><ClusterIcon name="refresh" /></ClusterIconButton>
      <ClusterButton variant="primary" size="compact" onClick={() => void provisioning.setOpen(true)}><ClusterIcon name="plus" /> Add person</ClusterButton>
    </>}>
    <div className="au-bar">
      <label className="au-search">
        <ClusterIcon name="search" />
        <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, username or email" aria-label="Search accounts" />
      </label>
      <ClusterNativeSelect aria-label="Account type" value={accountType} onChange={(event) => setAccountType(event.target.value as TypeFilter)}>
        <option value="all">All types</option><option value="employee">Employees</option><option value="contractor">Contractors</option><option value="client">Clients</option><option value="guest">Guests</option>
      </ClusterNativeSelect>
      <ClusterNativeSelect aria-label="Workspace role" value={role} onChange={(event) => setRole(event.target.value)}>
        <option value="">All roles</option>
        {roles.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
      </ClusterNativeSelect>
      {filtersActive ? <ClusterButton variant="quiet" size="compact" onClick={() => { setSearch(""); setAccountType("all"); setRole(""); }}>Clear</ClusterButton> : null}
      <span className="au-count" role="status">{total == null ? "" : `${total} ${total === 1 ? "person" : "people"}`}</span>
    </div>

    {provisioning.issuedCredential ? <AccountCredentialHandoff username={provisioning.issuedCredential.username} temporaryPassword={provisioning.issuedCredential.temporaryPassword} onDismiss={provisioning.dismissCredential} /> : null}
    {provisioning.onboardingFollowup ? <div className="au-followup" role="alert">
      <span><strong>Account created, onboarding pending</strong>{provisioning.onboardingFollowup.message}</span>
      <ClusterButton variant="secondary" size="compact" disabled={provisioning.onboardingRetryBusy} onClick={() => void provisioning.retryOnboarding()}>{provisioning.onboardingRetryBusy ? "Retrying…" : "Retry onboarding"}</ClusterButton>
    </div> : null}
    {error ? <div className="au-error" role="alert">{error}<ClusterButton variant="secondary" size="compact" onClick={() => setReloadKey((value) => value + 1)}>Retry</ClusterButton></div> : null}

    <div className="au-list" role="table" aria-label="Accounts" aria-busy={loading}>
      <div className="au-row au-row--head" role="row">
        <span role="columnheader">Person</span><span role="columnheader">Role</span><span role="columnheader">Status</span><span role="columnheader">Team</span><span role="columnheader">Last seen</span><span role="columnheader" aria-label="Actions" />
      </div>
      {accounts.map((account) => {
        const state = stateOf(account);
        const initial = (account.displayName || account.username).slice(0, 1).toUpperCase();
        return <div key={account.id} className="au-row" role="row" data-archived={account.archived || undefined}>
          <ClusterButton unstyled type="button" className="au-person" role="cell" onClick={() => onOpenPerson(account.id)}>
            {account.avatarUrl ? <img src={account.avatarUrl} alt="" loading="lazy" decoding="async" /> : <span className="au-avatar" aria-hidden="true">{initial}</span>}
            <span className="au-person__copy"><strong>{account.displayName || account.username}</strong><small>@{account.username}{account.email ? ` · ${account.email}` : ""}</small></span>
          </ClusterButton>
          <span role="cell" className="au-role"><b>{roleLabel(account.workspaceRole)}</b>{account.accountType !== "employee" ? <em>{account.accountType}</em> : null}</span>
          <span role="cell" className="au-state" data-tone={state.tone}><i aria-hidden="true" />{state.label}{account.accessExpiresAt && !account.archived && state.tone !== "danger" ? <small title={`Access ends ${new Date(account.accessExpiresAt).toLocaleDateString()}`}><ClusterIcon name="clock" /></small> : null}</span>
          <span role="cell" className="au-team">{account.department || <em>Unassigned</em>}{account.jobTitle ? <small>{account.jobTitle}</small> : null}</span>
          <span role="cell" className="au-seen">{account.lastSeenAt ? formatRelativeTime(account.lastSeenAt) : "Never"}</span>
          <span role="cell" className="au-actions">
            <ClusterIconButton size="compact" label={`Open ${account.displayName || account.username}`} onClick={() => onOpenPerson(account.id)}><ClusterIcon name="chevron-right" /></ClusterIconButton>
          </span>
        </div>;
      })}
      {loading && !accounts.length ? Array.from({ length: 6 }, (_, index) => <div key={index} className="au-row au-row--skeleton" aria-hidden="true"><span /><span /><span /><span /><span /><span /></div>) : null}
      {!loading && !accounts.length && !error ? <div className="au-empty">{filtersActive || view !== "all" ? "No one matches." : "No accounts yet."}{filtersActive ? <ClusterButton variant="quiet" size="compact" onClick={() => { setSearch(""); setAccountType("all"); setRole(""); }}>Clear filters</ClusterButton> : null}</div> : null}
    </div>
    {nextCursor ? <div className="au-more"><ClusterButton variant="secondary" size="compact" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Loading…" : `Show more (${accounts.length} of ${total ?? "?"})`}</ClusterButton></div> : null}

    <ClusterOverlayDrawer open={provisioning.open} label="Add person" onClose={() => void provisioning.setOpen(false)} className="au-drawer-host" backdropClassName="au-drawer-scrim" panelClassName="au-drawer" closeOnBackdrop={false}>
      <header className="au-drawer__head"><h2>Add person</h2><ClusterIconButton size="compact" label="Close" onClick={() => void provisioning.setOpen(false)}><ClusterIcon name="close" /></ClusterIconButton></header>
      <PeopleAccountProvisioningWizard
        draft={provisioning.draft}
        onPatch={provisioning.patch}
        roleCatalog={provisioning.roleCatalog}
        rolesLoading={provisioning.rolesLoading}
        rolesError={provisioning.rolesError}
        creating={provisioning.busy}
        actionError={provisioning.error}
        onCreate={provisioning.create}
        onCancel={() => void provisioning.setOpen(false)}
      />
    </ClusterOverlayDrawer>
  </SettingsWorkspaceShell>;
}
