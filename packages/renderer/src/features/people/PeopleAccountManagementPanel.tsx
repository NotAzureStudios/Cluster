import { useEffect, useRef, useState } from "react";
import { ClusterButton } from "../../components/ClusterButton";
import { ClusterNativeSelect } from "../../components/ClusterNativeControls";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { queryApi } from "../../core/api";

type AccountStateFilter = "all" | "setup" | "restricted" | "expiring" | "expired" | "archived";
type AccountTypeFilter = "all" | "employee" | "contractor" | "client" | "guest";
type AccountView = "overview" | "edit" | "access";

type AccountSummary = {
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
};
type AccountPage = {
  items: AccountSummary[];
  total: number;
  hasMore: boolean;
  nextCursor: string | null;
};
type RoleCatalog = { roles: Array<{ id: string; label: string }> };

const formatDate = (value: string | null) => value
  ? new Date(value).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" })
  : "No expiry";
const accountStateLabel = (account: AccountSummary) => {
  if (account.archived) return "Archived";
  const state = account.accountState.toUpperCase();
  const labels: Record<string, string> = {
    ACTIVE: "Active",
    PASSWORD_CHANGE_REQUIRED: "First sign-in",
    PASSWORD_RESET_REQUIRED: "Password reset",
    MFA_ENROLLMENT_REQUIRED: "MFA setup",
    DISCORD_LINK_REQUIRED: "Discord link",
    SUSPENDED: "Suspended",
    DISABLED: "Disabled",
    LOCKED: "Locked",
  };
  if (account.accessExpiresAt && new Date(account.accessExpiresAt).getTime() <= Date.now()) return "Expired";
  return labels[state] || state.replaceAll("_", " ").toLowerCase();
};

export function PeopleAccountManagementPanel({
  refreshVersion,
  active,
  onOpenAccount,
  accountCreationOpen,
  onToggleCreateAccount,
}: {
  refreshVersion: number;
  active: boolean;
  onOpenAccount: (id: string, view: AccountView) => void;
  accountCreationOpen: boolean;
  onToggleCreateAccount: () => void;
}) {
  const [search, setSearch] = useState("");
  const [settledSearch, setSettledSearch] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setSettledSearch(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  const [status, setStatus] = useState<AccountStateFilter>("all");
  const [accountType, setAccountType] = useState<AccountTypeFilter>("all");
  const [role, setRole] = useState("");
  const [roles, setRoles] = useState<RoleCatalog["roles"]>([]);
  const [roleLoading, setRoleLoading] = useState(true);
  const [roleError, setRoleError] = useState("");
  const roleCatalogLoadedRef = useRef(false);
  const [accounts, setAccounts] = useState<AccountSummary[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const generation = useRef(0);
  const paging = useRef(false);

  const params = new URLSearchParams({
    limit: "50",
    search: settledSearch,
    status,
    accountType,
    role,
  });
  const paramsKey = params.toString();

  useEffect(() => {
    if (!active || roleCatalogLoadedRef.current) return;
    let cancelled = false;
    setRoleLoading(true);
    setRoleError("");
    void queryApi<RoleCatalog>("/api/admin/users/assignable-roles", {
      staleMs: 60_000, tags: ["roles", "users", "people"],
    }).then((result) => {
      if (!cancelled) { setRoles(result.roles); roleCatalogLoadedRef.current = true; }
    }).catch((cause) => {
      if (!cancelled) setRoleError(cause instanceof Error ? cause.message : "Could not load workspace roles.");
    }).finally(() => { if (!cancelled) setRoleLoading(false); });
    return () => { cancelled = true; };
  }, [active]);

  useEffect(() => {
    if (!active) { generation.current += 1; paging.current = false; setLoading(false); setLoadingMore(false); return; }
    const current = ++generation.current;
    paging.current = false;
    setAccounts([]);
    setTotal(null);
    setNextCursor(null);
    setLoading(true);
    setLoadingMore(false);
    setError("");
    void queryApi<AccountPage>(`/api/admin/users/management?${paramsKey}`, {
      force: true, staleMs: 0, persist: false, tags: ["users", "people", "roles", "directory"],
    }).then((page) => {
      if (current !== generation.current) return;
      setAccounts(page.items);
      setTotal(page.total);
      setNextCursor(page.hasMore ? page.nextCursor : null);
    }).catch((cause) => {
      if (current === generation.current) setError(cause instanceof Error ? cause.message : "Unable to load accounts.");
    }).finally(() => {
      if (current === generation.current) setLoading(false);
    });
    return () => { generation.current += 1; };
  }, [paramsKey, refreshVersion, reloadKey, active]);

  async function loadMore() {
    if (!active || !nextCursor || loading || paging.current) return;
    paging.current = true;
    const requestGeneration = generation.current;
    setLoadingMore(true);
    setError("");
    try {
      const page = await queryApi<AccountPage>(`/api/admin/users/management?${paramsKey}&cursor=${encodeURIComponent(nextCursor)}`, {
        force: true, staleMs: 0, persist: false, tags: ["users", "people", "roles", "directory"],
      });
      if (requestGeneration !== generation.current) return;
      setAccounts((current) => {
        const ids = new Set(current.map((account) => account.id));
        return [...current, ...page.items.filter((account) => !ids.has(account.id))];
      });
      setTotal(page.total);
      setNextCursor(page.hasMore ? page.nextCursor : null);
    } catch (cause) {
      if (requestGeneration === generation.current) setError(cause instanceof Error ? cause.message : "Could not load more accounts.");
    } finally {
      if (requestGeneration === generation.current) { paging.current = false; setLoadingMore(false); }
    }
  }

  function clearFilters() {
    setSearch("");
    setStatus("all");
    setAccountType("all");
    setRole("");
  }
  const filtersActive = Boolean(search || status !== "all" || accountType !== "all" || role);
  return <section className="people-account-management-v11 panel" aria-label="User account management">
    <header className="people-account-management-head-v11">
      <div>
        <h2>Account management</h2>
        <span>Identity, access state and account administration</span>
      </div>
      <div className="people-account-management-head-actions-v11">
        <span role="status">{total == null ? "Loading accounts…" : `${total} matching account${total === 1 ? "" : "s"}`}</span>
        <ClusterButton type="button" variant="secondary" size="compact" onClick={() => setReloadKey((value) => value + 1)}>Refresh</ClusterButton>
        <ClusterButton type="button" variant="primary" size="compact" onClick={onToggleCreateAccount}>{accountCreationOpen ? "Close account form" : "Create account"}</ClusterButton>
      </div>
    </header>
    <div className="people-account-management-filters-v11">
      <label className="field people-account-search-v11">
        <span>Search accounts</span>
        <ClusterTextInput value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, username, or email" aria-label="Search user accounts" />
      </label>
      <label className="field">
        <span>Account status</span>
        <ClusterNativeSelect value={status} onChange={(event) => setStatus(event.target.value as AccountStateFilter)}>
          <option value="all">Current accounts</option>
          <option value="setup">Setup / recovery</option>
          <option value="restricted">Suspended / disabled</option>
          <option value="expiring">Expiring within 30 days</option>
          <option value="expired">Expired</option>
          <option value="archived">Archived</option>
        </ClusterNativeSelect>
      </label>
      <label className="field">
        <span>Identity type</span>
        <ClusterNativeSelect value={accountType} onChange={(event) => setAccountType(event.target.value as AccountTypeFilter)}>
          <option value="all">All types</option>
          <option value="employee">Employee</option>
          <option value="contractor">Contractor</option>
          <option value="client">Client</option>
          <option value="guest">Guest</option>
        </ClusterNativeSelect>
      </label>
      <label className="field">
        <span>Workspace role</span>
        <ClusterNativeSelect value={role} disabled={roleLoading || Boolean(roleError)} onChange={(event) => setRole(event.target.value)}>
          <option value="">All roles</option>
          {roles.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </ClusterNativeSelect>
        {roleLoading && <small role="status">Loading roles…</small>}
        {roleError && <small role="alert">Role filter unavailable: {roleError}</small>}
      </label>
      {filtersActive && <ClusterButton type="button" size="compact" variant="quiet" onClick={clearFilters}>Clear filters</ClusterButton>}
    </div>
    {error && <div className="people-account-management-error-v11" role="alert">{error} <ClusterButton type="button" size="compact" variant="secondary" onClick={() => setReloadKey((value) => value + 1)}>Retry</ClusterButton></div>}
    <div className="people-account-management-table-wrap-v11">
      <table className="people-account-management-table-v11" aria-label="Workspace accounts">
        <thead><tr><th>Person</th><th>Identity & role</th><th>Account status</th><th>Organization</th><th>Access expiry</th><th>Last seen</th><th>Manage</th></tr></thead>
        <tbody>
          {accounts.map((account) => <tr key={account.id}>
            <td><strong>{account.displayName}</strong><small>@{account.username}{account.email ? ` · ${account.email}` : ""}</small></td>
            <td><strong>{account.accountType}</strong><small>{roles.find((item) => item.id === account.workspaceRole)?.label || account.workspaceRole}</small></td>
            <td><span className={`people-account-state-v11${account.archived || ["SUSPENDED","DISABLED","LOCKED"].includes(account.accountState) ? " restricted" : ""}`}>{accountStateLabel(account)}</span></td>
            <td><strong>{account.department || "Unassigned"}</strong><small>{account.jobTitle || (account.manager ? `Reports to ${account.manager.displayName}` : "No job title")}</small></td>
            <td>{formatDate(account.accessExpiresAt)}</td>
            <td>{account.lastSeenAt ? formatDate(account.lastSeenAt) : "Never"}</td>
            <td><div className="people-account-row-actions-v11">
              <ClusterButton size="compact" variant="quiet" onClick={() => onOpenAccount(account.id, "overview")}>Profile</ClusterButton>
              {!account.archived && <ClusterButton size="compact" variant="secondary" onClick={() => onOpenAccount(account.id, "edit")}>Edit</ClusterButton>}
              <ClusterButton size="compact" variant="quiet" onClick={() => onOpenAccount(account.id, "access")}>Access</ClusterButton>
            </div></td>
          </tr>)}
          {!loading && !accounts.length && !error && <tr><td colSpan={7} className="people-account-empty-v11">{filtersActive ? "No accounts match these filters." : "No current accounts found."} {filtersActive && <ClusterButton type="button" variant="quiet" size="compact" onClick={clearFilters}>Clear filters</ClusterButton>}</td></tr>}
        </tbody>
      </table>
      {loading && <div className="people-account-loading-v11" role="status">Loading account records…</div>}
    </div>
    <footer className="people-account-management-footer-v11">
      <span>{total == null ? "Account counts unavailable" : `Showing ${accounts.length} of ${total} matching accounts`}</span>
      {nextCursor && <ClusterButton type="button" variant="secondary" size="compact" disabled={loading || loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Loading…" : "Load 50 more"}</ClusterButton>}
    </footer>
  </section>;
}
