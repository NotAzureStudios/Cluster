import { useEffect, useState } from "react";
import { ClusterButton, ClusterIconButton } from "../../components/ClusterButton";
import { ClusterIcon } from "../../components/ClusterIcon";
import { ClusterTextInput } from "../../components/ClusterTextInput";
import { ClusterSegmentedControl } from "../../components/ClusterSegmentedControl";
import { confirmCluster } from "../../components/cluster-dialog-service";
import { api, formatApiError, queryApi } from "../../core/api";
import { copyClusterText } from "../../core/clipboard";
import "./git-access.css";

/* Account → Git access. Personal tokens for cloning and pushing
   Cluster-hosted repositories (and Git LFS) from any Git client. The
   token is the password; it is shown once. Styled by git-access.css (ga-*). */

type GitToken = { id: string; name: string; prefix: string | null; createdAt: string; expiresAt: string | null; lastUsedAt: string | null };
type GitAccess = { baseUrl: string; username: string | null; tokens: GitToken[] };

const day = (value: string) => new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/** Clone URL for a Cluster-hosted repository, or null until known. */
export function useGitCloneUrl(repository: { slug?: string | null; id: string; hostingMode?: string | null; connection?: unknown } | null | undefined) {
  const [base, setBase] = useState<string | null>(null);
  const hosted = Boolean(repository && !repository.connection && (repository.hostingMode ?? "cluster") === "cluster");
  useEffect(() => {
    if (!hosted) return;
    let live = true;
    void queryApi<GitAccess>("/api/source-control/git-access", { staleMs: 60_000, tags: ["git-access"] }).then((result) => { if (live) setBase(result.baseUrl); }).catch(() => undefined);
    return () => { live = false; };
  }, [hosted]);
  return hosted && base && repository ? `${base}/${repository.slug || repository.id}.git` : null;
}

export function GitAccessPanel() {
  const [access, setAccess] = useState<GitAccess | null>(null);
  const [name, setName] = useState("");
  const [expiry, setExpiry] = useState<"90" | "365" | "never">("365");
  const [created, setCreated] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try { setAccess(await api<GitAccess>("/api/source-control/git-access")); }
    catch (error) { setStatus(formatApiError(error)); }
  }
  useEffect(() => { void load(); }, []);

  async function create() {
    setBusy(true);
    try {
      const result = await api<{ token: string }>("/api/source-control/git-access/tokens", { method: "POST", body: JSON.stringify({ name: name.trim(), expiresInDays: expiry === "never" ? null : Number(expiry) }) });
      setCreated(result.token);
      setName("");
      setStatus("");
      await load();
    } catch (error) { setStatus(formatApiError(error)); }
    finally { setBusy(false); }
  }

  async function revoke(token: GitToken) {
    if (!await confirmCluster({ title: `Revoke ${token.name}?`, message: "Git clients using it will stop working.", confirmLabel: "Revoke", tone: "danger" })) return;
    try {
      await api(`/api/source-control/git-access/tokens/${token.id}`, { method: "DELETE", body: "{}" });
      await load();
    } catch (error) { setStatus(formatApiError(error)); }
  }

  const copy = (text: string, label: string) => void copyClusterText(text).then((ok) => setStatus(ok ? `${label} copied.` : "Clipboard unavailable."));

  return <section className="ga" aria-label="Git access">
    <div className="ga-card">
      <dl className="ga-facts">
        <div><dt>Server</dt><dd><code>{access?.baseUrl || "…"}</code>{access ? <ClusterIconButton size="compact" label="Copy server address" onClick={() => copy(access.baseUrl, "Address")}><ClusterIcon name="link" /></ClusterIconButton> : null}</dd></div>
        <div><dt>Username</dt><dd><code>{access?.username || "…"}</code></dd></div>
        <div><dt>Password</dt><dd>A token below</dd></div>
      </dl>
      <p className="ga-hint">Clone with <code>{access ? `${access.baseUrl}/<repository>.git` : "…"}</code>. Git LFS and file locking use the same sign-in.</p>
    </div>

    {created ? <div className="ga-once" role="status">
      <ClusterIcon name="lock" aria-hidden="true" />
      <code>{created}</code>
      <ClusterButton size="compact" variant="primary" onClick={() => copy(created, "Token")}>Copy</ClusterButton>
      <small>Shown once</small>
      <ClusterIconButton size="compact" label="Dismiss" onClick={() => setCreated(null)}><ClusterIcon name="close" /></ClusterIconButton>
    </div> : null}

    <div className="ga-card">
      <div className="ga-new">
        <label className="ga-field ga-field--grow"><span>New token</span><ClusterTextInput value={name} onChange={(event) => setName(event.target.value)} placeholder="Work PC" onKeyDown={(event) => { if (event.key === "Enter" && name.trim()) void create(); }} /></label>
        <div className="ga-field"><span>Expires</span><ClusterSegmentedControl value={expiry} onChange={setExpiry} label="Token expiry" options={[{ value: "90", label: "90 days" }, { value: "365", label: "1 year" }, { value: "never", label: "Never" }]} /></div>
        <ClusterButton size="compact" variant="primary" busy={busy} busyLabel="Creating…" disabled={busy || !name.trim()} onClick={() => void create()}>Create</ClusterButton>
      </div>
      {access?.tokens.length ? <ul className="ga-tokens">
        {access.tokens.map((token) => <li key={token.id}>
          <span className="ga-tokens__name"><b>{token.name}</b><code>{token.prefix}…</code></span>
          <small>{token.lastUsedAt ? `Used ${day(token.lastUsedAt)}` : "Never used"}</small>
          <small>{token.expiresAt ? `Expires ${day(token.expiresAt)}` : "No expiry"}</small>
          <ClusterIconButton size="compact" label={`Revoke ${token.name}`} onClick={() => void revoke(token)}><ClusterIcon name="trash" /></ClusterIconButton>
        </li>)}
      </ul> : access ? <p className="ga-hint">No tokens yet.</p> : null}
    </div>
    {status ? <p className="ga-status" role="status">{status}</p> : null}
  </section>;
}
