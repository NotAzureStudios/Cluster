import process from "node:process";

const clusterBaseUrl = String(process.env.CLUSTER_SERVER_URL || "http://127.0.0.1:3000").replace(/\/+$/, "");
const relayToken = String(process.env.CLUSTER_DISCORD_RELAY_TOKEN || "").trim();

function requireRelayToken() {
  if (relayToken.length < 32) throw new Error("CLUSTER_DISCORD_RELAY_TOKEN must be at least 32 characters.");
}

async function clusterFetch(path, init = {}) {
  requireRelayToken();
  const headers = new Headers(init.headers || {});
  headers.set("accept", "application/json");
  headers.set("authorization", `Bearer ${relayToken}`);
  const response = await fetch(`${clusterBaseUrl}${path}`, { ...init, headers });
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    const message = body && typeof body === "object" ? body.error?.message || body.error || body.message : body;
    throw new Error(`Cluster Discord relay failed (${response.status})${message ? `: ${String(message).slice(0, 500)}` : ""}`);
  }
  return body;
}

export async function relayDiscordInteraction(interaction) {
  const result = await clusterFetch("/api/integrations/discord/gateway-relay", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(interaction),
  });
  if (!result?.ok || !result.response) throw new Error("Cluster Discord relay returned an invalid response envelope.");
  return result.response;
}

export async function getClusterRelayStatus() {
  try {
    requireRelayToken();
    return { ok: true, clusterBaseUrl };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// Authenticated worker liveness is separate from the public interaction endpoint.
export async function reportClusterGatewayHealth(state) {
  if (!["connected", "reconnecting", "error"].includes(state)) return;
  await clusterFetch("/api/integrations/discord/gateway-health", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ state }), signal: AbortSignal.timeout(5_000),
  });
}
