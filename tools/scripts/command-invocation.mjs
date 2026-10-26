import { spawn, spawnSync } from "node:child_process";

function quoteWindowsCommandArgument(value) {
  const text = String(value);
  if (!text) return '""';
  if (!/[\s"&|<>^()%!]/.test(text)) return text;
  return `"${text.replace(/(["^&|<>])/g, "^$1").replace(/%/g, "%%")}"`;
}

export function resolveCommandInvocation(command, args = [], options = {}) {
  const platform = options.platform || process.platform;
  const environment = options.env || process.env;
  if (platform !== "win32") return { command, args, windowsVerbatimArguments: false };

  const normalized = String(command).toLowerCase();
  const scriptCommand = normalized === "npm" ? "npm.cmd" : normalized === "npx" ? "npx.cmd" : command;
  if (!/\.(?:cmd|bat)$/i.test(scriptCommand)) {
    return { command: scriptCommand, args, windowsVerbatimArguments: false };
  }

  const shell = environment.ComSpec || environment.COMSPEC || "cmd.exe";
  const commandLine = `call ${[scriptCommand, ...args].map(quoteWindowsCommandArgument).join(" ")}`;
  return {
    command: shell,
    args: ["/d", "/s", "/c", commandLine],
    windowsVerbatimArguments: false,
  };
}

export function spawnPortable(command, args = [], options = {}) {
  const invocation = resolveCommandInvocation(command, args, { platform: options.platform, env: options.env });
  const { platform: _platform, ...spawnOptions } = options;
  return spawn(invocation.command, invocation.args, {
    ...spawnOptions,
    shell: false,
    windowsVerbatimArguments: invocation.windowsVerbatimArguments,
  });
}

export function spawnPortableSync(command, args = [], options = {}) {
  const invocation = resolveCommandInvocation(command, args, { platform: options.platform, env: options.env });
  const { platform: _platform, ...spawnOptions } = options;
  return spawnSync(invocation.command, invocation.args, {
    ...spawnOptions,
    shell: false,
    windowsVerbatimArguments: invocation.windowsVerbatimArguments,
  });
}
