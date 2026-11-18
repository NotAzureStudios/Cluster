// Behaviour checks for the outbound mail transport: what counts as configured,
// how a pasted app password is normalised, and which SMTP failures are worth
// retrying. The wire protocol itself is nodemailer's; what is tested here is
// every decision Cluster makes around it.
import assert from "node:assert/strict";
import { tsImport } from "tsx/esm/api";

let passed = 0;
async function check(name, run) {
  await run();
  passed += 1;
  console.log(`PASS ${name}`);
}

const mail = await tsImport("../../apps/server/src/core/mail-transport.ts", import.meta.url);
const { resolveMailConfiguration, describeMailConfiguration, MailSendError, MailNotConfiguredError } = mail;

const workspace = {
  mailHost: "smtp.gmail.com",
  mailPort: 587,
  mailUsername: "no-reply@azurestudios.dev",
  mailPassword: "abcdefghijklmnop",
};

await check("a Google app password pasted with its spaces still authenticates", () => {
  // Google displays app passwords as four groups of four. SMTP AUTH sends the
  // value verbatim, so unstripped spaces turn a correct password into a 535.
  const spaced = resolveMailConfiguration({ ...workspace, mailPassword: "abcd efgh ijkl mnop" });
  assert.equal(spaced.configured, true);
  assert.equal(spaced.configuration.password, "abcdefghijklmnop");
  // Newlines and tabs arrive the same way out of a password manager.
  const messy = resolveMailConfiguration({ ...workspace, mailPassword: " abcd\tefgh\nijkl mnop " });
  assert.equal(messy.configuration.password, "abcdefghijklmnop");
});

await check("the port decides the TLS mode, and 587 is the default", () => {
  assert.equal(resolveMailConfiguration({ ...workspace, mailPort: 465 }).configuration.secure, true);
  assert.equal(resolveMailConfiguration({ ...workspace, mailPort: 587 }).configuration.secure, false);
  assert.equal(resolveMailConfiguration({ ...workspace, mailPort: 25 }).configuration.secure, false);
  for (const bad of [undefined, null, "", "smtp", 0, -1, 70000, 1.5]) {
    const resolved = resolveMailConfiguration({ ...workspace, mailPort: bad });
    assert.equal(resolved.configuration.port, 587, `port ${String(bad)} should fall back to 587`);
    assert.equal(resolved.configuration.secure, false);
  }
});

await check("the sender defaults to the authenticated mailbox", () => {
  // Google refuses a From that is not the account or a verified alias with
  // "Mail from must equal authenticated user", and the message never leaves.
  const defaulted = resolveMailConfiguration(workspace);
  assert.equal(defaulted.configuration.fromAddress, "no-reply@azurestudios.dev");
  assert.equal(defaulted.configuration.fromName, "Cluster");
  const explicit = resolveMailConfiguration({ ...workspace, mailFromAddress: "studio@azurestudios.dev", mailFromName: "Azure Studios" });
  assert.equal(explicit.configuration.fromAddress, "studio@azurestudios.dev");
  assert.equal(explicit.configuration.fromName, "Azure Studios");
  // A blank override is not an override.
  assert.equal(resolveMailConfiguration({ ...workspace, mailFromAddress: "   " }).configuration.fromAddress, "no-reply@azurestudios.dev");
});

await check("an incomplete setup says what is missing, not just that it failed", () => {
  const noHost = resolveMailConfiguration({ ...workspace, mailHost: "" });
  assert.equal(noHost.configured, false);
  assert.match(noHost.reason, /SMTP host/);
  const nothing = resolveMailConfiguration({});
  assert.equal(nothing.configured, false);
  for (const expected of [/SMTP host/, /username/, /password/]) assert.match(nothing.reason, expected);
  // Whitespace is not configuration.
  assert.equal(resolveMailConfiguration({ ...workspace, mailUsername: "   " }).configured, false);
});

await check("turning mail off reads as off, not as broken", () => {
  const disabled = resolveMailConfiguration({ ...workspace, mailEnabled: false });
  assert.equal(disabled.configured, false);
  assert.match(disabled.reason, /turned off/);
  // Anything other than an explicit false leaves mail on.
  for (const value of [undefined, null, true]) {
    assert.equal(resolveMailConfiguration({ ...workspace, mailEnabled: value }).configured, true, String(value));
  }
});

await check("the password never leaves the server", () => {
  const described = describeMailConfiguration(workspace);
  assert.equal(described.configured, true);
  assert.equal(described.host, "smtp.gmail.com");
  const serialized = JSON.stringify(described);
  assert.ok(!serialized.includes("abcdefghijklmnop"), "a described configuration must not carry the password");
  assert.ok(!("password" in described), "no password field at all");
  // The unconfigured shape carries a reason and nothing else.
  const missing = describeMailConfiguration({});
  assert.equal(missing.configured, false);
  assert.ok(missing.reason && !("host" in missing));
});

await check("a rejected password is terminal; an unreachable server is not", () => {
  // The queue dead-letters on terminalJobFailure, so this is what stops a bad
  // app password being presented five times until Google locks the account.
  const auth = new MailSendError("rejected", { code: "MAIL_AUTH_REJECTED", permanent: true });
  assert.equal(auth.permanent, true);
  assert.equal(auth.terminalJobFailure, true);

  const unreachable = new MailSendError("down", { code: "MAIL_UNREACHABLE", permanent: false });
  assert.equal(unreachable.permanent, false);
  assert.equal(unreachable.terminalJobFailure, false, "a transient failure must stay retryable");

  // Nothing can configure mail on a retry either.
  assert.equal(new MailNotConfiguredError("nope").terminalJobFailure, true);
});

await check("a send can never outlive a job lease, and never crosses the wire unencrypted", async () => {
  // How each SMTP failure is classified is proved for real against a live
  // server in cluster-mail-delivery-tests.mjs. What that cannot observe is
  // the transport's own limits, which is what is asserted here.
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../../apps/server/src/core/mail-transport.ts", import.meta.url), "utf8");

  // STARTTLS is required, not opportunistic: mail must not fall back to plain
  // text because a server simply failed to offer encryption.
  assert.match(source, /requireTLS: !configuration\.secure/);

  // Job leases are 60s. Every network phase has to be bounded well inside it,
  // or a dead mail server holds a worker slot until the lease expires.
  const timeouts = ["connectionTimeout", "greetingTimeout", "socketTimeout"];
  for (const timeout of timeouts) {
    const match = source.match(new RegExp(`${timeout}: ([0-9_]+)`));
    assert.ok(match, `${timeout} must be set so a send cannot hang a worker`);
    const value = Number(match[1].replace(/_/g, ""));
    assert.ok(value > 0 && value < 60_000, `${timeout} is ${value}ms, which must stay under the 60s lease`);
  }
});

await check("the mail password is encrypted at rest and never echoed back", async () => {
  const { readFileSync } = await import("node:fs");
  const crypto = readFileSync(new URL("../../apps/server/src/core/setting-crypto.ts", import.meta.url), "utf8");
  const sensitive = crypto.slice(crypto.indexOf("SENSITIVE_SETTING_KEYS"), crypto.indexOf("BOOT_SECRET_SETTING_KEYS"));
  assert.match(sensitive, /"mailPassword"/, "mailPassword must be in SENSITIVE_SETTING_KEYS so it is encrypted at rest");

  const registry = readFileSync(new URL("../../apps/server/src/domains/integrations/integration-provider-registry.ts", import.meta.url), "utf8");
  const provider = registry.slice(registry.indexOf('id: "communication.email"'));
  const manifest = provider.slice(0, provider.indexOf("})"));
  assert.match(manifest, /implementation: "active"/, "the email provider is no longer a reserved contract");
  assert.match(manifest, /secretSettingKeys: \["mailPassword"\]/, "the password must be declared a secret setting");
});

await check("mail is reachable from the interface, not just from the API", async () => {
  // This project's recurring failure is a finished server feature with no
  // screen. Mail must not join that list, so the settings fields and the three
  // endpoints are asserted to exist in the renderer.
  const { readFileSync } = await import("node:fs");
  const page = readFileSync(new URL("../../packages/renderer/src/features/settings/ServerConfigPage.tsx", import.meta.url), "utf8");

  for (const key of ["mailEnabled", "mailHost", "mailPort", "mailUsername", "mailPassword", "mailFromAddress", "mailFromName"]) {
    assert.match(page, new RegExp(`key: "${key}"`), `${key} must be editable in Server Configuration`);
  }
  // The password field must never be a plain text input.
  const passwordField = page.slice(page.indexOf('key: "mailPassword"'));
  assert.match(passwordField.slice(0, 300), /type: "password"/, "the mail password must use the password field type");

  for (const route of ["/api/admin/mail/status", "/api/admin/mail/verify", "/api/admin/mail/test"]) {
    assert.ok(page.includes(route), `${route} must have a caller in the renderer`);
  }
});

console.log(`${passed}/10 mail transport checks passed`);
