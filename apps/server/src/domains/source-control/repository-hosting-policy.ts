// Source repository configuration is authoritative on the server, not only
// in the admin form. A remote repo without a connection is linked, not synced.
export type RepositoryHostingInput = {
  hostingMode: "cluster" | "remote";
  connectionId?: string | null;
  remoteUrl?: string | null;
  cloneUrl?: string | null;
  providerRepositoryId?: string | null;
};

export function validateRepositoryHosting(input: RepositoryHostingInput): string | null {
  const connectionId = input.connectionId?.trim() || "";
  const remoteUrl = input.remoteUrl?.trim() || "";
  const cloneUrl = input.cloneUrl?.trim() || "";
  const providerRepositoryId = input.providerRepositoryId?.trim() || "";
  if (input.hostingMode === "cluster") {
    if (connectionId || remoteUrl || cloneUrl || providerRepositoryId) {
      return "Cluster-hosted repositories cannot include an external provider or remote. Select remote hosting to connect one.";
    }
    return null;
  }
  // Without a provider connection a remote repository is a link: it needs a URL.
  if (!connectionId && !remoteUrl && !cloneUrl) return "Provide the repository's remote Git URL, or choose a provider connection.";
  if (!remoteUrl && !cloneUrl && !providerRepositoryId) {
    return "Provide a remote Git URL or a provider repository identifier before adding a connected repository.";
  }
  for (const candidate of [remoteUrl, cloneUrl]) {
    if (!candidate) continue;
    let parsed: URL;
    try { parsed = new URL(candidate); } catch { return "Remote Git URL must be a valid URL."; }
    if (!["https:", "http:", "ssh:"].includes(parsed.protocol)) return "Remote Git URL must use HTTPS, HTTP, or SSH.";
    if ((parsed.username && parsed.protocol !== "ssh:") || parsed.password || parsed.search || parsed.hash) {
      return "Remote URLs cannot contain credentials, query strings, or fragments. Store authentication in the provider connection.";
    }
  }
  return null;
}
