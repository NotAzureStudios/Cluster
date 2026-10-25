import process from "node:process";
import { relayDiscordInteraction } from "./cluster-client.mjs";

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
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

async function respondToInteraction(interaction, responsePayload) {
  if (!interaction?.id || !interaction?.token || !responsePayload) return;
  const response = await fetch(`https://discord.com/api/v10/interactions/${encodeURIComponent(interaction.id)}/${encodeURIComponent(interaction.token)}/callback`, {
    method: "POST",
    headers: { "content-type": "application/json", "user-agent": "ClusterDiscordGatewayRelay/0.505.0" },
    body: JSON.stringify(responsePayload),
  });
  if (!response.ok) console.error(`Discord interaction response failed: ${response.status} ${(await response.text()).slice(0, 500)}`);
}

async function handleInteraction(interaction) {
  try {
    const response = await relayDiscordInteraction(interaction);
    await respondToInteraction(interaction, response);
  } catch (error) {
    console.error("Cluster rejected or failed a Discord interaction:", error instanceof Error ? error.message : error);
    await respondToInteraction(interaction, {
      type: 4,
      data: { content: "Cluster could not process this Discord action. Check the Cluster integration status.", flags: 64, allowed_mentions: { parse: [] } },
    }).catch(() => undefined);
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
      console.log(`Discord Gateway relay ready${sessionId ? ` (session ${sessionId.slice(0, 8)}…)` : ""}.`);
      return;
    }
    if (packet.t === "RESUMED") {
      reconnectAttempt = 0;
      console.log("Discord Gateway relay session resumed.");
      return;
    }
    if (packet.t === "INTERACTION_CREATE") await handleInteraction(packet.d);
  });
  socket.addEventListener("close", () => {
    if (currentSocket === socket) currentSocket = null;
    clearHeartbeat();
    scheduleReconnect();
  });
  socket.addEventListener("error", (event) => console.error("Discord Gateway transport error", event?.message || event));
}

function shutdown() {
  shuttingDown = true;
  clearHeartbeat();
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (currentSocket && currentSocket.readyState <= WebSocket.OPEN) currentSocket.close(1000, "Cluster relay shutting down");
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
connect();
