import { createServerSourceControlRuntime } from "./server-source-control-runtime.js";
import { createServerDiscordRuntime } from "./server-discord-runtime.js";

export function createServerProductionIntegrationRuntime(input: any) {
  const sourceControlRuntime = createServerSourceControlRuntime(input);
  const discordRuntime = createServerDiscordRuntime({ ...input, sourceControl: sourceControlRuntime.sourceControl });
  return { ...sourceControlRuntime, ...discordRuntime };
}
