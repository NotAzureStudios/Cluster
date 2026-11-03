import process from "node:process";
import { relayDiscordInteraction, reportClusterGatewayHealth } from "./cluster-client.mjs";

const token = String(process.env.CLUSTER_DISCORD_BOT_TOKEN || "").trim();
const relayToken = String(process.env.CLUSTER_DISCORD_RELAY_TOKEN || "").trim();
if (!token) throw new Error("CLUSTER_DISCORD_BOT_TOKEN is required.");
if (relayToken.length < 32) throw new Error("CLUSTER_DISCORD_RELAY_TOKEN must be at least 32 characters.");

const defaultGatewayUrl = "wss://gateway.discord.gg/?v=10&encoding=json";
let sequence = null;
let sessionId = null;
let resumeGatewayUrl = null;
let heartbeatTimer = null;
let heartbeatAcked = true;
let reconnectTimer = null;
let reconnectAttempt = 0;
let currentSocket = null;
let shuttingDown = false;
let gatewayReady = false;
function publishGatewayHealth(state) {
  // No credentials or Discord message content are persisted in health reports.
  void reportClusterGatewayHealth(state).catch(() => undefined);
}
const healthTimer = setInterval(() => {
  if (gatewayReady && currentSocket?.readyState === WebSocket.OPEN) publishGatewayHealth("connected");
}, 15_000);
healthTimer.unref?.();

function gatewayUrl() {
  const base = String(resumeGatewayUrl || defaultGatewayUrl).replace(/\/+$/, "");
  return base.includes("?") ? base : `${base}/?v=10&encoding=json`;
}

function send(socket, payload) {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
}

function clearHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

function reconnectDelayMs() {
  const ceiling = Math.min(60_000, 1_000 * (2 ** Math.min(reconnectAttempt, 6)));
  reconnectAttempt += 1;
  return Math.max(500, Math.round(ceiling * (0.75 + Math.random() * 0.5)));
}

function scheduleReconnect() {
  if (shuttingDown || reconnectTimer) return;
  const delay = reconnectDelayMs();
  console.warn(`Discord Gateway disconnected; reconnecting in ${delay} ms.`);
  publishGatewayHealth("reconnecting");
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

async function respondToInteraction(interaction, responsePayload) {
  if (!interaction?.id || !interaction?.token || !responsePayload) return;
  const response = await fetch(`https://discord.com/api/v10/interactions/${encodeURIComponent(interaction.id)}/${encodeURIComponent(interaction.token)}/callback`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "ClusterDiscordGatewayRelay/1.0.4" },
    body: JSON.stringify(responsePayload),
  });
  if (!response.ok) console.error(`Discord interaction response failed: ${response.status} ${(await response.text()).slice(0, 500)}`);
}

async function editDeferredInteraction(interaction, responsePayload) {
  const url = `https://discord.com/api/v10/webhooks/${encodeURIComponent(interaction.application_id)}/${encodeURIComponent(interaction.token)}/messages/@original`;
  const content = responsePayload?.data || { content: "Cluster processed the command.", allowed_mentions: { parse: [] } };
  const result = await fetch(url, {
    method: "PATCH",
    headers: { "content-type": "application/json", "user-agent": "ClusterDiscordGatewayRelay/1.0.4" },
    body: JSON.stringify({ ...content, flags: undefined }),
  });
  if (!result.ok) console.error(`Discord deferred reply failed: ${result.status}`);
}

async function handleInteraction(interaction) {
  let acknowledged = false;
  let deferred = false;
  let deferral = Promise.resolve();
  // Discord requires an initial ACK within three seconds; Cluster's durable
  // authorization/receipt pipeline may legitimately take longer than that.
  const timer = interaction?.type === 1 ? null : setTimeout(() => {
    if (acknowledged) return;
    acknowledged = true;
    deferred = true;
    deferral = respondToInteraction(interaction, {
      type: 5,
      data: { flags: 64 },
    });
  }, 1_500);
  try {
    const response = await relayDiscordInteraction(interaction);
    if (timer) clearTimeout(timer);
    if (deferred) {
      await deferral;
      await editDeferredInteraction(interaction, response);
    } else {
      acknowledged = true;
      await respondToInteraction(interaction, response);
    }
  } catch (error) {
    if (timer) clearTimeout(timer);
    console.error("Cluster rejected or failed a Discord interaction:", error instanceof Error ? error.message : "Request failed");
    const detail = error instanceof Error ? error.message : "";
    const message = detail.includes("DISCORD_GUILD_MISMATCH") || detail.includes("not connected to a Cluster studio")
      ? "This Discord server has not been approved by a Cluster administrator."
      : detail.includes("DISCORD_IDENTITY_NOT_LINKED") || detail.includes("Link your Discord identity")
      ? "Link your Discord account from your Cluster profile to use this action."
      : "Cluster could not process this action. Check the connection and your Cluster access.";
    const failure = { type: 4, data: { content: message, flags: 64, allowed_mentions: { parse: [] } } };
    if (deferred) {
      await deferral.catch(() => undefined);
      await editDeferredInteraction(interaction, failure).catch(() => undefined);
    } else if (!acknowledged) {
      acknowledged = true;
      await respondToInteraction(interaction, failure).catch(() => undefined);
    }
  }
}

function beginHeartbeat(socket, interval) {
  clearHeartbeat();
  heartbeatAcked = true;
  const heartbeat = () => {
    if (!heartbeatAcked) {
      console.warn("Discord Gateway heartbeat was not acknowledged; reconnecting.");
      socket.close(4000, "heartbeat timeout");
      return;
    }
    heartbeatAcked = false;
    send(socket, { op: 1, d: sequence });
  };
  const firstDelay = Math.max(250, Math.floor(interval * Math.random()));
  setTimeout(() => {
    if (socket !== currentSocket || socket.readyState !== WebSocket.OPEN) return;
    heartbeat();
    heartbeatTimer = setInterval(heartbeat, interval);
  }, firstDelay);
}

function identifyOrResume(socket) {
  if (sessionId && sequence !== null) {
    send(socket, { op: 6, d: { token, session_id: sessionId, seq: sequence } });
    return;
  }
  send(socket, {
    op: 2,
    d: {
      token,
      intents: 0,
      properties: { os: process.platform, browser: "cluster", device: "cluster-discord-relay" },
    },
  });
}

function connect() {
  if (shuttingDown) return;
  const socket = new WebSocket(gatewayUrl());
  currentSocket = socket;
  socket.addEventListener("open", () => console.log("Connected to Discord Gateway relay transport."));
  socket.addEventListener("message", async (event) => {
    let packet;
    try { packet = JSON.parse(String(event.data)); } catch { return; }
    if (typeof packet.s === "number") sequence = packet.s;
    switch (packet.op) {
      case 10: {
        const interval = Math.max(1_000, Number(packet.d?.heartbeat_interval || 45_000));
        beginHeartbeat(socket, interval);
        identifyOrResume(socket);
        return;
      }
      case 11:
        heartbeatAcked = true;
        return;
      case 1:
        send(socket, { op: 1, d: sequence });
        return;
      case 7:
        socket.close(4001, "server requested reconnect");
        return;
      case 9:
        if (!packet.d) {
          sessionId = null;
          sequence = null;
          resumeGatewayUrl = null;
        }
        socket.close(4002, "invalid session");
        return;
      default:
        break;
    }
    if (packet.t === "READY") {
      sessionId = packet.d?.session_id || null;
      resumeGatewayUrl = packet.d?.resume_gateway_url || null;
      reconnectAttempt = 0;
      gatewayReady = true;
      publishGatewayHealth("connected");
      console.log(`Discord Gateway relay ready${sessionId ? ` (session ${sessionId.slice(0, 8)}…)` : ""}.`);
      return;
    }
    if (packet.t === "RESUMED") {
      reconnectAttempt = 0;
      gatewayReady = true;
      publishGatewayHealth("connected");
      console.log("Discord Gateway relay session resumed.");
      return;
    }
    if (packet.t === "INTERACTION_CREATE") await handleInteraction(packet.d);
  });
  socket.addEventListener("close", () => {
    gatewayReady = false;
    if (currentSocket === socket) currentSocket = null;
    clearHeartbeat();
    scheduleReconnect();
  });
  socket.addEventListener("error", () => {
    gatewayReady = false;
    publishGatewayHealth("reconnecting");
    console.error("Discord Gateway transport error (see bot status).");
  });
}

function shutdown() {
  shuttingDown = true;
  gatewayReady = false;
  clearInterval(healthTimer);
  clearHeartbeat();
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (currentSocket && currentSocket.readyState <= WebSocket.OPEN) currentSocket.close(1000, "Cluster relay shutting down");
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
connect();
