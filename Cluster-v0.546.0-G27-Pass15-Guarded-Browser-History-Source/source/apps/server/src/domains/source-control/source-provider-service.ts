import { createHttpError } from "../../core/http-errors.js";
import { decryptSecuritySecret, encryptSecuritySecret } from "../../core/setting-crypto.js";
import { clusterSecretFingerprint } from "../../core/crypto-service.js";
import { safeUrl } from "../../core/security.js";

export type SourceProviderId = "source.gitea" | "source.forgejo" | "source.github" | "source.gitlab";

export type SourceProviderRequestOptions = { method?: string; body?: unknown; headers?: Record<string, string> };

type FetchWithTimeout = (url: string, init?: RequestInit, timeoutMs?: number, policy?: Record<string, unknown>) => Promise<Response>;

type ProviderServiceInput = {
  prisma: any;
  fetchWithTimeout: FetchWithTimeout;
  logger?: { warn?: (payload: unknown, message?: string) => void };
};

type ConnectionConfig = {
  baseUrl?: string;
  apiBaseUrl?: string;
  allowPrivateNetwork?: boolean;
};

type NormalizedIssue = {
  id: string;
  number: number | null;
  title: string;
  body: string;
  state: string;
  url: string | null;
  labels: string[];
  assignee: string | null;
  updatedAt: string | null;
};

const ACTIVE_SOURCE_PROVIDERS = new Set<SourceProviderId>(["source.gitea", "source.forgejo", "source.github", "source.gitlab"]);
const TOKEN_KEY = "accessToken";

function cleanText(value: unknown, maximum = 2_000) {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, maximum);
}

function optionalText(value: unknown, maximum = 2_000) {
  const text = cleanText(value, maximum);
  return text || null;
}

function safeDate(value: unknown) {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date : null;
}

function parseObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function sourceProviderId(value: unknown): SourceProviderId {
  const id = cleanText(value, 80) as SourceProviderId;
  if (!ACTIVE_SOURCE_PROVIDERS.has(id)) throw createHttpError("SOURCE_PROVIDER_UNAVAILABLE", "Source-control provider is not supported by this Cluster build.", 409);
  return id;
}

function defaultProviderConfig(providerId: SourceProviderId): ConnectionConfig {
  if (providerId === "source.github") return { baseUrl: "https://github.com", apiBaseUrl: "https://api.github.com", allowPrivateNetwork: false };
  if (providerId === "source.gitlab") return { baseUrl: "https://gitlab.com", apiBaseUrl: "https://gitlab.com/api/v4", allowPrivateNetwork: false };
  return { baseUrl: "", apiBaseUrl: "", allowPrivateNetwork: false };
}

function connectionConfig(connection: any): ConnectionConfig {
  const providerId = sourceProviderId(connection?.providerId);
  const defaults = defaultProviderConfig(providerId);
  const stored = parseObject(connection?.configuration);
  return {
    baseUrl: optionalText(stored.baseUrl, 2_048) || defaults.baseUrl,
    apiBaseUrl: optionalText(stored.apiBaseUrl, 2_048) || defaults.apiBaseUrl,
    allowPrivateNetwork: Boolean(stored.allowPrivateNetwork),
  };
}

function normalizeConfiguredUrl(value: string | null | undefined, label: string, fallback = "") {
  const raw = cleanText(value, 2_048);
  if (!raw) return fallback;
  return safeUrl(raw, label, ["http:", "https:"]).replace(/\/$/, "");
}

function providerConfigForWrite(providerId: SourceProviderId, input: ConnectionConfig) {
  const defaults = defaultProviderConfig(providerId);
  const baseUrl = normalizeConfiguredUrl(input.baseUrl, "Source Control server URL", defaults.baseUrl || "");
  let apiBaseUrl = normalizeConfiguredUrl(input.apiBaseUrl, "Source Control API URL", defaults.apiBaseUrl || "");
  if (!apiBaseUrl && baseUrl) {
    if (providerId === "source.gitea" || providerId === "source.forgejo") apiBaseUrl = `${baseUrl}/api/v1`;
    else if (providerId === "source.gitlab") apiBaseUrl = `${baseUrl}/api/v4`;
  }
  if (!apiBaseUrl) throw createHttpError("SOURCE_PROVIDER_URL_REQUIRED", "Configure the Source Control server URL before using this connection.", 400);
  return { baseUrl, apiBaseUrl, allowPrivateNetwork: Boolean(input.allowPrivateNetwork) };
}

function authHeaders(providerId: SourceProviderId, token: string | null) {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (!token) return headers;
  if (providerId === "source.github") {
    headers.Authorization = `Bearer ${token}`;
    headers["X-GitHub-Api-Version"] = "2022-11-28";
    headers.Accept = "application/vnd.github+json";
  } else if (providerId === "source.gitlab") {
    headers["PRIVATE-TOKEN"] = token;
  } else {
    headers.Authorization = `token ${token}`;
  }
  return headers;
}

function repositorySlug(repository: any) {
  const explicit = cleanText(repository?.slug, 500).replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
  if (explicit.includes("/")) return explicit;
  for (const candidate of [repository?.remoteUrl, repository?.cloneUrl]) {
    if (!candidate) continue;
    try {
      const url = new URL(String(candidate));
      const path = url.pathname.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
      if (path.includes("/")) return path;
    } catch {}
  }
  throw createHttpError("SOURCE_REPOSITORY_COORDINATES", "Repository owner and name could not be resolved.", 409);
}

function repositoryApiPath(slug: string) {
  const parts = slug.split("/").filter(Boolean);
  if (parts.length < 2) throw createHttpError("SOURCE_REPOSITORY_COORDINATES", "Repository owner and name could not be resolved.", 409);
  const repo = parts.pop()!;
  const owner = parts.join("/");
  return `${owner.split("/").map(encodeURIComponent).join("/")}/${encodeURIComponent(repo)}`;
}

function normalizeBranch(providerId: SourceProviderId, row: any, defaultBranch: string) {
  const name = cleanText(row?.name, 200);
  if (!name) return null;
  const headRevision = optionalText(row?.commit?.sha || row?.commit?.id || row?.sha || row?.target?.hash, 160);
  return {
    name,
    headRevision,
    upstreamName: optionalText(row?.upstream || row?.tracking || row?.upstream_name, 240),
    isDefault: name === defaultBranch,
    protected: Boolean(row?.protected || row?.is_protected),
  };
}

function normalizeCommit(providerId: SourceProviderId, row: any, branchName: string) {
  const revision = cleanText(row?.sha || row?.id || row?.commit?.sha, 160);
  if (!revision) return null;
  const commit = row?.commit || row || {};
  const author = commit.author || row?.author || {};
  const committer = commit.committer || row?.committer || {};
  const message = cleanText(commit.message || row?.message || row?.title || "Commit", 8_000) || "Commit";
  const additions = Number.isFinite(Number(row?.stats?.additions)) ? Number(row.stats.additions) : null;
  const deletions = Number.isFinite(Number(row?.stats?.deletions)) ? Number(row.stats.deletions) : null;
  const filesChanged = Array.isArray(row?.files) ? row.files.length : null;
  const parentRows = Array.isArray(row?.parents) ? row.parents : Array.isArray(row?.parent_ids) ? row.parent_ids : [];
  const parentRevisions = parentRows.map((parent: any) => cleanText(typeof parent === "string" ? parent : parent?.sha || parent?.id, 160)).filter(Boolean);
  return {
    revision,
    shortRevision: cleanText(row?.short_id, 32) || revision.slice(0, 12),
    message,
    authorName: optionalText(author?.name || row?.author_name || row?.author?.full_name || row?.author?.login || row?.author?.username, 240),
    authorEmail: optionalText(author?.email || row?.author_email, 320),
    authoredAt: safeDate(author?.date || row?.authored_date || row?.created),
    committedAt: safeDate(committer?.date || row?.committed_date || author?.date || row?.created_at || row?.created),
    webUrl: optionalText(row?.html_url || row?.web_url || row?.url, 2_048),
    additions,
    deletions,
    filesChanged,
    parentRevisions,
    branchNames: branchName ? [branchName] : [],
    metadata: { verification: row?.verification || null, providerId },
  };
}

function normalizeIssue(providerId: SourceProviderId, row: any): NormalizedIssue {
  const rawId = row?.iid ?? row?.number ?? row?.id;
  const number = Number.isFinite(Number(row?.iid ?? row?.number)) ? Number(row.iid ?? row.number) : null;
  const labels = Array.isArray(row?.labels)
    ? row.labels.map((label: any) => cleanText(typeof label === "string" ? label : label?.name, 160)).filter(Boolean)
    : [];
  const assignee = row?.assignee || (Array.isArray(row?.assignees) ? row.assignees[0] : null);
  return {
    id: cleanText(rawId, 240),
    number,
    title: cleanText(row?.title, 500),
    body: cleanText(row?.body ?? row?.description, 16_000),
    state: cleanText(row?.state, 80).toLowerCase() || "open",
    url: optionalText(row?.html_url || row?.web_url || row?.url, 2_048),
    labels,
    assignee: optionalText(assignee?.login || assignee?.username || assignee?.name, 240),
    updatedAt: optionalText(row?.updated_at || row?.updatedAt, 100),
  };
}

function normalizeChange(row: any) {
  const path = cleanText(row?.filename || row?.new_path || row?.path, 2_000);
  if (!path) return null;
  const previousPath = optionalText(row?.previous_filename || row?.old_path, 2_000);
  const status = cleanText(row?.status, 80).toLowerCase();
  const changeType = row?.new_file || status === "added" ? "added"
    : row?.deleted_file || status === "removed" ? "deleted"
      : row?.renamed_file || status === "renamed" ? "renamed" : "modified";
  return {
    path,
    previousPath: previousPath && previousPath !== path ? previousPath : null,
    changeType,
    additions: Number.isFinite(Number(row?.additions)) ? Number(row.additions) : 0,
    deletions: Number.isFinite(Number(row?.deletions)) ? Number(row.deletions) : 0,
    binary: Boolean(row?.binary || row?.too_large),
  };
}

export function createSourceProviderService(input: ProviderServiceInput) {
  function assertActiveConnection(connection: any) {
    if (!connection || connection.archived === true || connection.status === "disabled") {
      throw createHttpError("SOURCE_CONNECTION_UNAVAILABLE", "Source Control connection is unavailable.", 409);
    }
    sourceProviderId(connection.providerId);
    return connection;
  }

  async function loadConnection(connectionId: string) {
    const connection = await input.prisma.integrationConnection.findFirst({ where: { id: connectionId, category: "source-control", archived: false, status: { not: "disabled" } } });
    if (!connection) throw createHttpError("SOURCE_CONNECTION_NOT_FOUND", "Source Control connection not found or is disabled.", 404);
    return assertActiveConnection(connection);
  }

  async function tokenFor(connectionOrId: any): Promise<string | null> {
    const connection = typeof connectionOrId === "string" ? await loadConnection(connectionOrId) : assertActiveConnection(connectionOrId);
    if (!connection?.id) return null;
    const row = await input.prisma.integrationConnectionSecret.findUnique({ where: { connectionId_key: { connectionId: connection.id, key: TOKEN_KEY } } });
    if (!row?.encryptedValue) return null;
    return decryptSecuritySecret(`integration:${connection.id}:${TOKEN_KEY}`, row.encryptedValue) || null;
  }

  async function setToken(connectionId: string, token: string | null) {
    if (!token) {
      await input.prisma.integrationConnectionSecret.deleteMany({ where: { connectionId, key: TOKEN_KEY } });
      return false;
    }
    const encryptedValue = encryptSecuritySecret(`integration:${connectionId}:${TOKEN_KEY}`, token);
    const fingerprint = clusterSecretFingerprint(token, `integration:${connectionId}:${TOKEN_KEY}`);
    await input.prisma.integrationConnectionSecret.upsert({
      where: { connectionId_key: { connectionId, key: TOKEN_KEY } },
      create: { connectionId, key: TOKEN_KEY, encryptedValue, fingerprint },
      update: { encryptedValue, fingerprint },
    });
    return true;
  }

  async function configureConnection(params: {
    workspaceId: string;
    connectionId?: string | null;
    providerId: SourceProviderId;
    displayName: string;
    baseUrl?: string | null;
    apiBaseUrl?: string | null;
    allowPrivateNetwork?: boolean;
    token?: string | null;
    clearToken?: boolean;
    capabilities: readonly string[];
  }) {
    const providerId = sourceProviderId(params.providerId);
    const configuration = providerConfigForWrite(providerId, { baseUrl: params.baseUrl || undefined, apiBaseUrl: params.apiBaseUrl || undefined, allowPrivateNetwork: params.allowPrivateNetwork });
    const existing = params.connectionId
      ? await input.prisma.integrationConnection.findFirst({ where: { id: params.connectionId, workspaceId: params.workspaceId, category: "source-control", archived: false } })
      : null;
    if (params.connectionId && !existing) throw createHttpError("SOURCE_CONNECTION_NOT_FOUND", "Source Control connection not found.", 404);
    const data = {
      providerId,
      category: "source-control",
      displayName: cleanText(params.displayName, 120) || "Source Control",
      status: "configured",
      configuration: JSON.stringify(configuration),
      secretRefs: JSON.stringify({ accessToken: "connection-secret:accessToken" }),
      capabilities: JSON.stringify([...params.capabilities]),
      healthState: "unknown",
      healthMessage: null,
      lastCheckedAt: null,
    };
    const connection = existing
      ? await input.prisma.integrationConnection.update({ where: { id: existing.id }, data })
      : await input.prisma.integrationConnection.create({ data: { workspaceId: params.workspaceId, ...data } });
    if (params.clearToken) await setToken(connection.id, null);
    else if (params.token?.trim()) await setToken(connection.id, params.token.trim());
    return connection;
  }

  async function serializeConfiguration(connection: any) {
    const config = connectionConfig(connection);
    const tokenSecret = await input.prisma.integrationConnectionSecret.findUnique({ where: { connectionId_key: { connectionId: connection.id, key: TOKEN_KEY } }, select: { id: true, fingerprint: true } });
    return { baseUrl: config.baseUrl || "", apiBaseUrl: config.apiBaseUrl || "", allowPrivateNetwork: Boolean(config.allowPrivateNetwork), tokenConfigured: Boolean(tokenSecret), tokenFingerprint: tokenSecret?.fingerprint || null };
  }

  async function request(connectionOrId: any, path: string, options: SourceProviderRequestOptions = {}) {
    const connection = typeof connectionOrId === "string" ? await loadConnection(connectionOrId) : assertActiveConnection(connectionOrId);
    const providerId = sourceProviderId(connection.providerId);
    const config = connectionConfig(connection);
    const apiBaseUrl = normalizeConfiguredUrl(config.apiBaseUrl, "Source Control API URL", defaultProviderConfig(providerId).apiBaseUrl || "");
    if (!apiBaseUrl) throw createHttpError("SOURCE_PROVIDER_URL_REQUIRED", "Configure the Source Control server URL before using this connection.", 409);
    const token = await tokenFor(connection);
    const headers = { ...authHeaders(providerId, token), ...(options.body === undefined ? {} : { "Content-Type": "application/json" }), ...(options.headers || {}) };
    const url = path.startsWith("http://") || path.startsWith("https://") ? path : `${apiBaseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const response = await input.fetchWithTimeout(url, {
      method: options.method || "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }, undefined, {
      purpose: `Source Control ${providerId}`,
      allowPrivateNetwork: Boolean(config.allowPrivateNetwork),
      allowHttpPrivateNetwork: Boolean(config.allowPrivateNetwork),
      maxResponseBytes: 32 * 1024 * 1024,
    });
    if (!response.ok) throw createHttpError("SOURCE_PROVIDER_REQUEST_FAILED", `Source Control provider returned HTTP ${response.status}.`, response.status >= 500 ? 502 : 409);
    if (response.status === 204) return null;
    const text = await response.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch { return text; }
  }

  async function testConnection(connectionOrId: any) {
    const connection = typeof connectionOrId === "string" ? await loadConnection(connectionOrId) : assertActiveConnection(connectionOrId);
    const providerId = sourceProviderId(connection.providerId);
    const path = providerId === "source.github" ? "/user" : providerId === "source.gitlab" ? "/user" : "/version";
    try {
      const result = await request(connection, path);
      await input.prisma.integrationConnection.update({ where: { id: connection.id }, data: { healthState: "healthy", healthMessage: "Source Control connection verified.", lastCheckedAt: new Date() } });
      return { ok: true, providerId, result };
    } catch (error) {
      const message = error instanceof Error ? cleanText(error.message, 500) : "Source Control connection check failed.";
      await input.prisma.integrationConnection.update({ where: { id: connection.id }, data: { healthState: "failed", healthMessage: message, lastCheckedAt: new Date() } }).catch(() => undefined);
      throw error;
    }
  }

  async function repositorySnapshot(repository: any) {
    const connection = repository.connection ? assertActiveConnection(repository.connection) : (repository.connectionId ? await loadConnection(repository.connectionId) : null);
    if (!connection) throw createHttpError("SOURCE_CONNECTION_REQUIRED", "Repository does not have a Source Control connection.", 409);
    const providerId = sourceProviderId(connection.providerId);
    const slug = repositorySlug(repository);
    let repoInfo: any;
    if (providerId === "source.gitlab") repoInfo = await request(connection, `/projects/${encodeURIComponent(slug)}`);
    else repoInfo = await request(connection, `/repos/${repositoryApiPath(slug)}`);
    const providerRepositoryId = cleanText(repoInfo?.id ?? repository.providerRepositoryId ?? slug, 240);
    const defaultBranch = cleanText(repoInfo?.default_branch || repository.defaultBranch || "main", 200) || "main";
    const remoteUrl = optionalText(repoInfo?.html_url || repoInfo?.web_url || repoInfo?.website || repository.remoteUrl, 2_048);
    const cloneUrl = optionalText(repoInfo?.clone_url || repoInfo?.http_url_to_repo || repository.cloneUrl || remoteUrl, 2_048);

    let branchesRaw: any;
    let commitsRaw: any;
    if (providerId === "source.gitlab") {
      branchesRaw = await request(connection, `/projects/${encodeURIComponent(providerRepositoryId)}/repository/branches?per_page=100`);
      commitsRaw = await request(connection, `/projects/${encodeURIComponent(providerRepositoryId)}/repository/commits?ref_name=${encodeURIComponent(defaultBranch)}&per_page=50`);
    } else if (providerId === "source.github") {
      branchesRaw = await request(connection, `/repos/${repositoryApiPath(slug)}/branches?per_page=100`);
      commitsRaw = await request(connection, `/repos/${repositoryApiPath(slug)}/commits?sha=${encodeURIComponent(defaultBranch)}&per_page=50`);
    } else {
      branchesRaw = await request(connection, `/repos/${repositoryApiPath(slug)}/branches?limit=100`);
      commitsRaw = await request(connection, `/repos/${repositoryApiPath(slug)}/commits?sha=${encodeURIComponent(defaultBranch)}&limit=50`);
    }
    const branches = (Array.isArray(branchesRaw) ? branchesRaw : []).map((row) => normalizeBranch(providerId, row, defaultBranch)).filter(Boolean);
    const commits = (Array.isArray(commitsRaw) ? commitsRaw : []).map((row) => normalizeCommit(providerId, row, defaultBranch)).filter(Boolean);
    return { providerId, connection, slug, providerRepositoryId, repoInfo, defaultBranch, remoteUrl, cloneUrl, branches, commits };
  }

  async function commitChanges(repository: any, revision: string) {
    const connection = repository.connection ? assertActiveConnection(repository.connection) : (repository.connectionId ? await loadConnection(repository.connectionId) : null);
    if (!connection) return [];
    const providerId = sourceProviderId(connection.providerId);
    const slug = repositorySlug(repository);
    if (providerId === "source.gitlab") {
      const projectId = cleanText(repository.providerRepositoryId || slug, 240);
      const rows = await request(connection, `/projects/${encodeURIComponent(projectId)}/repository/commits/${encodeURIComponent(revision)}/diff?per_page=100`);
      return (Array.isArray(rows) ? rows : []).map(normalizeChange).filter(Boolean);
    }
    if (providerId === "source.github") {
      const row = await request(connection, `/repos/${repositoryApiPath(slug)}/commits/${encodeURIComponent(revision)}`);
      return (Array.isArray(row?.files) ? row.files : []).map(normalizeChange).filter(Boolean);
    }
    const diff = await request(connection, `/repos/${repositoryApiPath(slug)}/git/commits/${encodeURIComponent(revision)}.diff`, { headers: { Accept: "text/plain" } });
    if (typeof diff !== "string") return [];
    const changes: any[] = [];
    let current: any = null;
    const push = () => { if (current?.path) changes.push(current); current = null; };
    for (const line of diff.split(/\r?\n/)) {
      const match = line.match(/^diff --git a\/(.+) b\/(.+)$/);
      if (match) { push(); current = { path: match[2], previousPath: match[1] === match[2] ? null : match[1], changeType: "modified", additions: 0, deletions: 0, binary: false }; continue; }
      if (!current) continue;
      if (line.startsWith("new file mode ")) current.changeType = "added";
      else if (line.startsWith("deleted file mode ")) current.changeType = "deleted";
      else if (line.startsWith("rename from ")) { current.changeType = "renamed"; current.previousPath = line.slice(12).trim(); }
      else if (line.startsWith("rename to ")) current.path = line.slice(10).trim();
      else if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) current.binary = true;
      else if (line.startsWith("+") && !line.startsWith("+++")) current.additions += 1;
      else if (line.startsWith("-") && !line.startsWith("---")) current.deletions += 1;
    }
    push();
    return changes.slice(0, 2_000);
  }

  async function listIssues(repository: any, state = "all") {
    const connection = repository.connection ? assertActiveConnection(repository.connection) : (repository.connectionId ? await loadConnection(repository.connectionId) : null);
    if (!connection) throw createHttpError("SOURCE_CONNECTION_REQUIRED", "Repository does not have a Source Control connection.", 409);
    const providerId = sourceProviderId(connection.providerId);
    const slug = repositorySlug(repository);
    let rows: any[] = [];
    if (providerId === "source.gitlab") {
      const projectId = cleanText(repository.providerRepositoryId || slug, 240);
      const queryState = state === "closed" ? "closed" : state === "open" ? "opened" : "all";
      rows = await request(connection, `/projects/${encodeURIComponent(projectId)}/issues?state=${encodeURIComponent(queryState)}&per_page=100`);
    } else if (providerId === "source.github") {
      rows = await request(connection, `/repos/${repositoryApiPath(slug)}/issues?state=${encodeURIComponent(state === "all" ? "all" : state)}&per_page=100`);
      rows = (Array.isArray(rows) ? rows : []).filter((row: any) => !row?.pull_request);
    } else {
      rows = await request(connection, `/repos/${repositoryApiPath(slug)}/issues?state=${encodeURIComponent(state)}&limit=100`);
      rows = (Array.isArray(rows) ? rows : []).filter((row: any) => !row?.pull_request);
    }
    return (Array.isArray(rows) ? rows : []).map((row) => normalizeIssue(providerId, row)).filter((row) => row.id);
  }

  async function getIssue(repository: any, issueId: string | number) {
    const connection = repository.connection ? assertActiveConnection(repository.connection) : (repository.connectionId ? await loadConnection(repository.connectionId) : null);
    if (!connection) throw createHttpError("SOURCE_CONNECTION_REQUIRED", "Repository does not have a Source Control connection.", 409);
    const providerId = sourceProviderId(connection.providerId);
    const slug = repositorySlug(repository);
    const id = cleanText(issueId, 80);
    let row: any;
    if (providerId === "source.gitlab") row = await request(connection, `/projects/${encodeURIComponent(cleanText(repository.providerRepositoryId || slug, 240))}/issues/${encodeURIComponent(id)}`);
    else row = await request(connection, `/repos/${repositoryApiPath(slug)}/issues/${encodeURIComponent(id)}`);
    return normalizeIssue(providerId, row);
  }

  async function createIssue(repository: any, payload: { title: string; body?: string | null }) {
    const connection = repository.connection ? assertActiveConnection(repository.connection) : (repository.connectionId ? await loadConnection(repository.connectionId) : null);
    if (!connection) throw createHttpError("SOURCE_CONNECTION_REQUIRED", "Repository does not have a Source Control connection.", 409);
    const providerId = sourceProviderId(connection.providerId);
    const slug = repositorySlug(repository);
    const requestBody = providerId === "source.gitlab" ? { title: payload.title, description: payload.body || "" } : { title: payload.title, body: payload.body || "" };
    const path = providerId === "source.gitlab"
      ? `/projects/${encodeURIComponent(cleanText(repository.providerRepositoryId || slug, 240))}/issues`
      : `/repos/${repositoryApiPath(slug)}/issues`;
    return normalizeIssue(providerId, await request(connection, path, { method: "POST", body: requestBody }));
  }

  async function setIssueState(repository: any, issueId: string | number, state: "open" | "closed") {
    const connection = repository.connection ? assertActiveConnection(repository.connection) : (repository.connectionId ? await loadConnection(repository.connectionId) : null);
    if (!connection) throw createHttpError("SOURCE_CONNECTION_REQUIRED", "Repository does not have a Source Control connection.", 409);
    const providerId = sourceProviderId(connection.providerId);
    const slug = repositorySlug(repository);
    const id = cleanText(issueId, 80);
    if (providerId === "source.gitlab") {
      const stateEvent = state === "closed" ? "close" : "reopen";
      const row = await request(connection, `/projects/${encodeURIComponent(cleanText(repository.providerRepositoryId || slug, 240))}/issues/${encodeURIComponent(id)}`, { method: "PUT", body: { state_event: stateEvent } });
      return normalizeIssue(providerId, row);
    }
    const row = await request(connection, `/repos/${repositoryApiPath(slug)}/issues/${encodeURIComponent(id)}`, { method: "PATCH", body: { state } });
    return normalizeIssue(providerId, row);
  }

  async function commentIssue(repository: any, issueId: string | number, body: string) {
    const connection = repository.connection ? assertActiveConnection(repository.connection) : (repository.connectionId ? await loadConnection(repository.connectionId) : null);
    if (!connection) throw createHttpError("SOURCE_CONNECTION_REQUIRED", "Repository does not have a Source Control connection.", 409);
    const providerId = sourceProviderId(connection.providerId);
    const slug = repositorySlug(repository);
    const id = cleanText(issueId, 80);
    const path = providerId === "source.gitlab"
      ? `/projects/${encodeURIComponent(cleanText(repository.providerRepositoryId || slug, 240))}/issues/${encodeURIComponent(id)}/notes`
      : `/repos/${repositoryApiPath(slug)}/issues/${encodeURIComponent(id)}/comments`;
    const requestBody = providerId === "source.gitlab" ? { body } : { body };
    await request(connection, path, { method: "POST", body: requestBody });
    return { ok: true };
  }

  return {
    activeProviderIds: [...ACTIVE_SOURCE_PROVIDERS],
    configureConnection,
    serializeConfiguration,
    tokenFor,
    testConnection,
    repositorySnapshot,
    commitChanges,
    listIssues,
    getIssue,
    createIssue,
    setIssueState,
    commentIssue,
  };
}

export type SourceProviderService = ReturnType<typeof createSourceProviderService>;
