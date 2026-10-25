import { spawnSync } from "node:child_process";
import path from "node:path";
import { windowsReleaseSigningTargets, exists } from "./windows-signing-lib.mjs";
import { writeGateEvidence } from "./release-evidence-lib.mjs";

if (process.platform !== "win32") throw new Error("Authenticode release verification must run on Windows.");
const root = process.cwd();
const expectedThumbprint = String(process.env.CLUSTER_WINDOWS_SIGNING_THUMBPRINT || "").replace(/\s+/g, "").toUpperCase();
const targets = await windowsReleaseSigningTargets(root);
const required = targets.filter((file) => file.toLowerCase().endsWith(".exe"));
if (required.length < 6) throw new Error(`Expected signed server, helper, desktop, and installer executables; found ${required.length}.`);
const verified = [];
for (const file of required) {
  if (!(await exists(file))) throw new Error(`Authenticode target is missing: ${file}`);
  const escaped = file.replace(/'/g, "''");
  const script = `$s=Get-AuthenticodeSignature -LiteralPath '${escaped}'; [pscustomobject]@{Status=[string]$s.Status; Thumbprint=[string]$s.SignerCertificate.Thumbprint; Subject=[string]$s.SignerCertificate.Subject} | ConvertTo-Json -Compress`;
  const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8", windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Authenticode inspection failed for ${file}.`);
  const signature = JSON.parse(String(result.stdout || "{}").trim() || "{}");
  if (signature.Status !== "Valid") throw new Error(`Authenticode signature is not valid for ${file}: ${signature.Status || "unknown"}.`);
  const thumbprint = String(signature.Thumbprint || "").replace(/\s+/g, "").toUpperCase();
  if (!thumbprint) throw new Error(`Authenticode signer certificate is missing for ${file}.`);
  if (expectedThumbprint && thumbprint !== expectedThumbprint) throw new Error(`Authenticode signer thumbprint mismatch for ${file}.`);
  verified.push({ path: path.relative(root, file).replaceAll("\\", "/"), thumbprint, subject: String(signature.Subject || "").slice(0, 512) });
}
await writeGateEvidence({ gate: "windows-signatures", extra: { signatures: verified } });
console.log(`Verified ${verified.length} Authenticode-signed Cluster Windows release files.`);
