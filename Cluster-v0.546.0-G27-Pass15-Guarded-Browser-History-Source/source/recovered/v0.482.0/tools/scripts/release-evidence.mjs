import { spawnPortableSync } from "./command-invocation.mjs";
import { writeGateEvidence } from "./release-evidence-lib.mjs";

const argv = process.argv.slice(2);
const mode = argv.shift();
function take(name) {
  const prefix = `--${name}=`;
  const index = argv.findIndex((item) => item.startsWith(prefix));
  if (index >= 0) return argv.splice(index, 1)[0].slice(prefix.length);
  const separate = argv.indexOf(`--${name}`);
  if (separate >= 0) {
    argv.splice(separate, 1);
    return argv.splice(separate, 1)[0];
  }
  return "";
}
const gate = take("gate");
if (!gate) throw new Error("--gate is required.");

if (mode === "record") {
  const status = take("status") || "passed";
  const detail = take("detail") || null;
  const record = await writeGateEvidence({ gate, status, detail });
  console.log(`Recorded release evidence gate ${record.gate}: ${record.status}.`);
  process.exit(0);
}

if (mode !== "run") throw new Error("Usage: release-evidence.mjs run --gate=<name> -- <command> [args...] OR record --gate=<name> --status=not-applicable.");
const separator = argv.indexOf("--");
const commandArgs = separator >= 0 ? argv.slice(separator + 1) : argv;
if (!commandArgs.length) throw new Error("A command is required after --.");
const [command, ...args] = commandArgs;
const started = Date.now();
const result = spawnPortableSync(command, args, { cwd: process.cwd(), env: process.env, stdio: "inherit", windowsHide: false });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with ${result.status ?? "unknown"}; no passing release evidence was written.`);
const record = await writeGateEvidence({ gate, command: [command, ...args], durationMs: Date.now() - started });
console.log(`Recorded release evidence gate ${record.gate}: passed.`);
