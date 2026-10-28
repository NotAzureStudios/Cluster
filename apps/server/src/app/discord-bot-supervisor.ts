import { randomBytes, timingSafeEqual } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SettingPayload } from "./server-composition-types.js";

export type DiscordBotStatus = { state: "stopped" | "starting" | "connected" | "reconnecting" | "error"; managed: boolean; pid: number | null; since: string | null; message: string | null };

/** Supervises a bundled, outbound-only Discord Gateway worker. No token is persisted here. */
export function createDiscordBotSupervisor(input: {
  readSettings: (force?: boolean) => Promise<SettingPayload>;
  readManaged: () => Promise<boolean>;
  localUrl: string;
  log: { info: (obj: unknown, msg: string) => void; warn: (obj: unknown, msg: string) => void };
}) {
  let child: ChildProcess | null = null;
  let relayKey: string | null = null;
  let wanted = false;
  let closing = false;
  let retry: ReturnType<typeof setTimeout> | null = null;
  let failures = 0;
  let state: DiscordBotStatus["state"] = "stopped";
  let since: string | null = null;
  let message: string | null = null;
  let lastGatewayReport = 0;
  const GATEWAY_STATUS_STALE_MS = 45_000;
  const location = path.dirname(fileURLToPath(import.meta.url));
  const entryCandidates = [
    path.resolve(process.cwd(), "integrations/discord-bot/src/index.mjs"),
    path.resolve(location, "../../../../integrations/discord-bot/src/index.mjs"),
    path.resolve(location, "../../../integrations/discord-bot/src/index.mjs"),
  ];
  const entry = () => entryCandidates.find(existsSync);
  const clearRetry = () => { if (retry) clearTimeout(retry); retry = null; };
  function status(): DiscordBotStatus {
    const stale = state === "connected" && (!lastGatewayReport || Date.now() - lastGatewayReport > GATEWAY_STATUS_STALE_MS);
    return { state: stale ? "reconnecting" : state, managed: wanted, pid: child?.pid || null, since,
      message: stale ? "Discord Gateway stopped reporting health; reconnecting or unavailable." : message };
  }
  // The worker reports READY/RESUMED and periodic liveness through an authenticated
  // loopback endpoint. stdout is not evidence that a Gateway session is still alive.
  function reportGatewayState(next: "connected" | "reconnecting" | "error") {
    if (!child || !wanted || closing) return;
    lastGatewayReport = Date.now();
    state = next;
    if (next === "connected") { failures = 0; message = null; }
    else if (next === "reconnecting") message = "Waiting for Discord Gateway session.";
    else message = "Discord Gateway reported an error.";
  }
  function stopProcess() {
    clearRetry(); relayKey = null; lastGatewayReport = 0;
    const running = child; child = null;
    if (running && !running.killed) running.kill();
    state = "stopped"; since = null; message = null;
  }
  async function launch() {
    if (!wanted || closing || child) return status();
    const settings = await input.readSettings(true);
    const botToken = String(settings.discordBotToken || "").trim();
    const applicationId = String(settings.discordApplicationId || "").trim();
    const primaryGuild = String(settings.discordGuildId || "").trim();
    const script = entry();
    if (!botToken || !/^\d{8,24}$/.test(applicationId) || !/^\d{8,24}$/.test(primaryGuild) || !script) {
      state = "error";
      message = !script ? "The bundled Discord bot is missing from the server installation." : "Configure bot token, application ID, and an approved primary server ID.";
      return status();
    }
    relayKey = randomBytes(48).toString("hex");
    const spawned = spawn(process.execPath, [script], {
      cwd: path.dirname(script), windowsHide: true,
      env: { ...process.env, CLUSTER_DISCORD_BOT_TOKEN: botToken, CLUSTER_DISCORD_RELAY_TOKEN: relayKey, CLUSTER_SERVER_URL: input.localUrl },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child = spawned; state = "starting"; since = new Date().toISOString(); message = null; lastGatewayReport = 0;
    // Only fixed status labels are recorded. Never log raw output, which might contain tokens.
    spawned.stdout?.on("data", (buffer: Buffer) => {
      if (spawned !== child) return;
      // Drain output without reading tokens or treating log messages as health signals.
      void buffer;
    });
    spawned.stderr?.on("data", () => { if (spawned === child) message = "Discord relay reported an error; see connection health."; });
    spawned.on("error", () => { if (spawned === child) message = "The Discord relay process could not start."; });
    spawned.on("exit", (code: number | null) => {
      if (spawned !== child) return;
      child = null; relayKey = null;
      if (!wanted || closing) { state = "stopped"; return; }
      state = "reconnecting";
      message = `Discord relay exited (${Number.isInteger(code) ? `code ${code}` : "signal"}).`;
      const delay = Math.min(300_000, 2_000 * (2 ** Math.min(failures++, 7)));
      retry = setTimeout(() => { retry = null; void launch().catch(() => { state = "error"; message = "Unable to restart the Discord relay."; }); }, delay);
      (retry as unknown as { unref?: () => void }).unref?.();
    });
    return status();
  }
  async function setManaged(enabled: boolean) {
    wanted = enabled;
    stopProcess();
    if (enabled) return launch();
    return status();
  }
  async function restore() {
    try { return setManaged(await input.readManaged()); }
    catch { state = "error"; message = "Could not restore Discord bot configuration."; return status(); }
  }
  function authorizedRelayToken(token: string) { return !!relayKey && token.length === relayKey.length && timingSafeEqual(Buffer.from(token), Buffer.from(relayKey)); }
  function close() { closing = true; wanted = false; stopProcess(); }
  return { status, setManaged, restore, authorizedRelayToken, reportGatewayState, close };
}
