import { createSocket, type RemoteInfo, type Socket } from "node:dgram";

const DISCOVERY_PORT = 34941;
const DISCOVERY_PROTOCOL = "cluster-discovery-v1";
const MAX_DATAGRAM_BYTES = 768;
const MIN_REPLY_INTERVAL_MS = 750;
const MAX_TRACKED_PEERS = 256;
const NONCE_PATTERN = /^[A-Za-z0-9_-]{12,96}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type DiscoverySettings = {
  setupComplete?: boolean;
  serverInstanceId?: string;
  serverDisplayName?: string;
  publicApiUrl?: string;
  lanDiscoveryEnabled?: boolean;
};

type DiscoveryLogger = {
  info?: (payload: unknown, message?: string) => void;
  warn?: (payload: unknown, message?: string) => void;
};

type ServerLocalDiscoveryOptions = {
  readSettings: () => Promise<DiscoverySettings>;
  listenPort: number;
  logger?: DiscoveryLogger;
};

function cleanLabel(value: unknown, fallback: string) {
  const text = String(value || "").trim().replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 120);
  return text || fallback;
}

function cleanPublicApiUrl(value: unknown) {
  const text = String(value || "").trim();
  if (!text || text.length > 500) return "";
  try {
    const url = new URL(text);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return "";
    url.pathname = "/";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

export function createServerLocalDiscovery({ readSettings, listenPort, logger }: ServerLocalDiscoveryOptions) {
  let socket: Socket | null = null;
  let enabled = false;
  const recentReplies = new Map<string, number>();

  function stop() {
    enabled = false;
    recentReplies.clear();
    const active = socket;
    socket = null;
    if (active) {
      try { active.close(); } catch { /* already closed */ }
    }
  }

  function replyAllowed(address: string, now: number) {
    const previous = recentReplies.get(address) || 0;
    if (now - previous < MIN_REPLY_INTERVAL_MS) return false;
    recentReplies.set(address, now);
    if (recentReplies.size > MAX_TRACKED_PEERS) {
      const oldest = [...recentReplies.entries()].sort((a, b) => a[1] - b[1]).slice(0, recentReplies.size - MAX_TRACKED_PEERS);
      for (const [key] of oldest) recentReplies.delete(key);
    }
    return true;
  }

  async function handleMessage(message: Buffer, remote: RemoteInfo) {
    if (!enabled || !socket || message.length < 2 || message.length > MAX_DATAGRAM_BYTES) return;
    let probe: { protocol?: unknown; kind?: unknown; nonce?: unknown };
    try { probe = JSON.parse(message.toString("utf8")); } catch { return; }
    const nonce = String(probe.nonce || "");
    if (probe.protocol !== DISCOVERY_PROTOCOL || probe.kind !== "probe" || !NONCE_PATTERN.test(nonce)) return;
    const now = Date.now();
    if (!replyAllowed(remote.address, now)) return;

    const settings = await readSettings().catch(() => null);
    if (!settings?.setupComplete || settings.lanDiscoveryEnabled === false) return;
    const serverInstanceId = String(settings.serverInstanceId || "").trim().toLowerCase();
    if (!UUID_PATTERN.test(serverInstanceId)) return;
    const publicApiUrl = cleanPublicApiUrl(settings.publicApiUrl);
    const response = Buffer.from(JSON.stringify({
      protocol: DISCOVERY_PROTOCOL,
      kind: "server",
      nonce,
      serverInstanceId,
      serverDisplayName: cleanLabel(settings.serverDisplayName, "Cluster Server"),
      apiUrl: publicApiUrl || undefined,
      apiPort: Number.isInteger(listenPort) && listenPort > 0 && listenPort <= 65535 ? listenPort : 3000,
      scheme: publicApiUrl.startsWith("https://") ? "https" : "http",
    }), "utf8");
    if (response.length > MAX_DATAGRAM_BYTES || !socket) return;
    socket.send(response, remote.port, remote.address, (error) => {
      if (error) logger?.warn?.({ error: error.message, address: remote.address }, "Cluster LAN discovery reply failed");
    });
  }

  async function start() {
    if (socket) return;
    const settings = await readSettings().catch(() => null);
    if (settings?.lanDiscoveryEnabled === false) {
      logger?.info?.({ port: DISCOVERY_PORT }, "Cluster LAN discovery disabled");
      return;
    }
    const next = createSocket({ type: "udp4", reuseAddr: true });
    socket = next;
    next.on("message", (message, remote) => { void handleMessage(message, remote); });
    next.on("error", (error) => {
      logger?.warn?.({ error: error.message, port: DISCOVERY_PORT }, "Cluster LAN discovery unavailable");
      stop();
    });
    await new Promise<void>((resolve) => {
      next.once("listening", () => {
        enabled = true;
        logger?.info?.({ port: DISCOVERY_PORT }, "Cluster LAN discovery ready");
        resolve();
      });
      next.once("error", () => resolve());
      try { next.bind(DISCOVERY_PORT, "0.0.0.0"); } catch { resolve(); }
    });
  }

  return { start, stop, port: DISCOVERY_PORT, protocol: DISCOVERY_PROTOCOL };
}
