import process from "node:process";
import { CLUSTER_DISCORD_COMMANDS } from "./commands.mjs";

const printOnly = process.argv.includes("--print");
if (printOnly) {
  process.stdout.write(`${JSON.stringify(CLUSTER_DISCORD_COMMANDS, null, 2)}\n`);
  process.exit(0);
}

const applicationId = String(process.env.CLUSTER_DISCORD_APPLICATION_ID || "").trim();
const botToken = String(process.env.CLUSTER_DISCORD_BOT_TOKEN || "").trim();
const guildId = String(process.env.CLUSTER_DISCORD_TEST_GUILD_ID || "").trim();
if (!applicationId || !botToken) {
  throw new Error("CLUSTER_DISCORD_APPLICATION_ID and CLUSTER_DISCORD_BOT_TOKEN are required.");
}

const route = guildId
  ? `https://discord.com/api/v10/applications/${encodeURIComponent(applicationId)}/guilds/${encodeURIComponent(guildId)}/commands`
  : `https://discord.com/api/v10/applications/${encodeURIComponent(applicationId)}/commands`;

const response = await fetch(route, {
  method: "PUT",
  headers: {
    authorization: `Bot ${botToken}`,
    "content-type": "application/json",
    "user-agent": "ClusterDiscordBot/1.0.2",
  },
  body: JSON.stringify(CLUSTER_DISCORD_COMMANDS),
});
if (!response.ok) throw new Error(`Discord command registration failed (${response.status}): ${(await response.text()).slice(0, 1_500)}`);
const result = await response.json();
console.log(`Registered ${Array.isArray(result) ? result.length : 0} Cluster Discord commands${guildId ? ` for guild ${guildId}` : " globally"}.`);
