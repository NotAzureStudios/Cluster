import nodemailer, { type Transporter } from "nodemailer";

/**
 * The studio's outbound mail transport.
 *
 * Cluster had no mail of any kind: the `communication.email` provider was a
 * declared contract with nothing behind it, so email verification, password
 * recovery and digests had no way to reach anyone. This module is that
 * transport, over plain SMTP, which is what a self-hosted studio can actually
 * operate — Google Workspace, Fastmail, a relay on the same box.
 *
 * Two rules shape everything here:
 *
 * 1. **A send never hangs a worker.** Job leases are 60 seconds, so every
 *    network phase has an explicit timeout well inside that.
 * 2. **A permanent failure never retries.** A rejected password does not
 *    become five more rejected passwords; Google locks accounts that keep
 *    presenting bad credentials. `MailSendError.permanent` tells the queue
 *    which kind it got.
 */

export type MailSettingsInput = {
  mailEnabled?: unknown;
  mailHost?: unknown;
  mailPort?: unknown;
  mailUsername?: unknown;
  mailPassword?: unknown;
  mailFromAddress?: unknown;
  mailFromName?: unknown;
};

export type MailMessage = {
  to: string;
  subject: string;
  /** Plain text is required: every message must be readable without HTML. */
  text: string;
  html?: string;
  replyTo?: string;
};

export type MailConfiguration = {
  host: string;
  port: number;
  /** Implicit TLS on 465; STARTTLS, required, on everything else. */
  secure: boolean;
  username: string;
  password: string;
  fromAddress: string;
  fromName: string;
};

/**
 * Why mail cannot be sent, in words an administrator can act on.
 *
 * `terminalJobFailure` is the background queue's existing contract for "do not
 * retry this": the queue dead-letters such a job on the first attempt instead
 * of backing off. Mail carries it on the errors that cannot improve by waiting,
 * which is what keeps a wrong app password from being presented five times.
 */
export class MailNotConfiguredError extends Error {
  readonly code = "MAIL_NOT_CONFIGURED";
  readonly terminalJobFailure = true;
  constructor(message: string) {
    super(message);
    this.name = "MailNotConfiguredError";
  }
}

export class MailSendError extends Error {
  readonly code: string;
  /** True when retrying cannot succeed: credentials, or a rejected address. */
  readonly permanent: boolean;
  readonly terminalJobFailure: boolean;
  constructor(message: string, options: { code: string; permanent: boolean; cause?: unknown }) {
    super(message, { cause: options.cause });
    this.name = "MailSendError";
    this.code = options.code;
    this.permanent = options.permanent;
    this.terminalJobFailure = options.permanent;
  }
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Google shows an app password as four groups of four — "abcd efgh ijkl mnop"
 * — and people paste it exactly that way. SMTP AUTH sends it verbatim, so the
 * spaces turn a correct password into a 535. Strip whitespace; a password with
 * meaningful spaces is not something any provider issues.
 */
function normalizePassword(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/g, "") : "";
}

export function resolveMailConfiguration(settings: MailSettingsInput):
  { configured: true; configuration: MailConfiguration } | { configured: false; reason: string } {
  if (settings.mailEnabled === false) {
    return { configured: false, reason: "Outbound mail is turned off in studio settings." };
  }
  const host = text(settings.mailHost);
  const username = text(settings.mailUsername);
  const password = normalizePassword(settings.mailPassword);
  const missing = [
    host ? "" : "an SMTP host",
    username ? "" : "a username",
    password ? "" : "a password",
  ].filter(Boolean);
  if (missing.length) {
    return { configured: false, reason: `Outbound mail needs ${missing.join(", ")}. Set it up in Integrations → Email.` };
  }

  const portValue = Number(settings.mailPort);
  const port = Number.isInteger(portValue) && portValue > 0 && portValue <= 65535 ? portValue : 587;

  // The envelope sender has to be the authenticated mailbox or one of its
  // verified aliases, or Google answers "Mail from must equal authenticated
  // user" and the message never leaves. Defaulting to the username is the
  // choice that always works.
  const fromAddress = text(settings.mailFromAddress) || username;

  return {
    configured: true,
    configuration: {
      host,
      port,
      secure: port === 465,
      username,
      password,
      fromAddress,
      fromName: text(settings.mailFromName) || "Cluster",
    },
  };
}

/** Identity of a configuration, for reusing one connection pool across sends. */
function fingerprint(configuration: MailConfiguration): string {
  // The password is part of the identity but never part of a readable string.
  const { host, port, secure, username, fromAddress, fromName, password } = configuration;
  let hash = 0;
  for (let index = 0; index < password.length; index += 1) {
    hash = (hash * 31 + password.charCodeAt(index)) | 0;
  }
  return [host, port, secure, username, fromAddress, fromName, hash].join("\u0000");
}

let cached: { key: string; transporter: Transporter } | null = null;

function transporterFor(configuration: MailConfiguration): Transporter {
  const key = fingerprint(configuration);
  if (cached && cached.key === key) return cached.transporter;
  cached?.transporter.close();
  const transporter = nodemailer.createTransport({
    host: configuration.host,
    port: configuration.port,
    secure: configuration.secure,
    requireTLS: !configuration.secure, // STARTTLS is mandatory, never opportunistic.
    auth: { user: configuration.username, pass: configuration.password },
    pool: true,
    maxConnections: 2,
    maxMessages: 50,
    // Every phase bounded well inside the 60s job lease.
    connectionTimeout: 12_000,
    greetingTimeout: 8_000,
    socketTimeout: 20_000,
  });
  cached = { key, transporter };
  return transporter;
}

/** Drops the pooled connection, so the next send re-reads settings. */
export function resetMailTransport(): void {
  cached?.transporter.close();
  cached = null;
}

/**
 * SMTP failures split into "the password is wrong" and "the network blinked".
 * Only the second kind is worth another attempt.
 */
function classify(error: unknown): MailSendError {
  const source = error as { code?: unknown; responseCode?: unknown; response?: unknown; message?: unknown } | null;
  const code = typeof source?.code === "string" ? source.code : "";
  const responseCode = Number(source?.responseCode);
  const detail = typeof source?.response === "string" && source.response ? source.response : String(source?.message || "SMTP send failed.");

  // 5xx is a permanent refusal by the server; 4xx is "try later".
  const permanentResponse = Number.isInteger(responseCode) && responseCode >= 500 && responseCode < 600;

  if (code === "EAUTH" || responseCode === 535 || responseCode === 534) {
    return new MailSendError(
      "The mail server rejected the username or password. For Google Workspace this must be an app password, not the account password, and the account needs 2-step verification turned on.",
      { code: "MAIL_AUTH_REJECTED", permanent: true, cause: error },
    );
  }
  if (code === "EENVELOPE" || permanentResponse) {
    return new MailSendError(`The mail server refused the message: ${detail}`, { code: "MAIL_REJECTED", permanent: true, cause: error });
  }
  if (code === "ETIMEDOUT" || code === "ECONNECTION" || code === "ESOCKET" || code === "ECONNRESET") {
    return new MailSendError(`Could not reach the mail server: ${detail}`, { code: "MAIL_UNREACHABLE", permanent: false, cause: error });
  }
  return new MailSendError(detail, { code: "MAIL_SEND_FAILED", permanent: false, cause: error });
}

export type MailSendResult = { messageId: string; accepted: string[]; rejected: string[] };

export async function sendStudioMail(settings: MailSettingsInput, message: MailMessage): Promise<MailSendResult> {
  const resolved = resolveMailConfiguration(settings);
  if (!resolved.configured) throw new MailNotConfiguredError(resolved.reason);
  const { configuration } = resolved;

  try {
    const sent = await transporterFor(configuration).sendMail({
      from: { name: configuration.fromName, address: configuration.fromAddress },
      to: message.to,
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
    });
    // nodemailer reports these as addresses; normalise defensively because an
    // empty accepted list is how a silent non-delivery would show up.
    const addresses = (list: unknown): string[] => (Array.isArray(list) ? list.map((entry) => String(entry)).filter(Boolean) : []);
    const accepted = addresses(sent.accepted);
    const rejected = addresses(sent.rejected);
    if (!accepted.length) {
      throw new MailSendError("The mail server accepted the connection but no recipient.", { code: "MAIL_NO_RECIPIENT", permanent: true });
    }
    return { messageId: sent.messageId || "", accepted, rejected };
  } catch (error) {
    if (error instanceof MailSendError) throw error;
    // A send that fails may have left a poisoned pooled connection behind.
    resetMailTransport();
    throw classify(error);
  }
}

/**
 * Connects and authenticates without sending anything, for the setup screen.
 * This is the only way to tell an administrator their app password works
 * before a real message depends on it.
 */
export async function verifyMailConfiguration(settings: MailSettingsInput): Promise<{ ok: true; host: string; port: number; secure: boolean; fromAddress: string }> {
  const resolved = resolveMailConfiguration(settings);
  if (!resolved.configured) throw new MailNotConfiguredError(resolved.reason);
  const { configuration } = resolved;
  try {
    await transporterFor(configuration).verify();
  } catch (error) {
    resetMailTransport();
    throw classify(error);
  }
  return { ok: true, host: configuration.host, port: configuration.port, secure: configuration.secure, fromAddress: configuration.fromAddress };
}

/** Safe to log and safe to return to a client: no password, ever. */
export function describeMailConfiguration(settings: MailSettingsInput): {
  configured: boolean;
  reason?: string;
  host?: string;
  port?: number;
  secure?: boolean;
  username?: string;
  fromAddress?: string;
  fromName?: string;
} {
  const resolved = resolveMailConfiguration(settings);
  if (!resolved.configured) return { configured: false, reason: resolved.reason };
  const { host, port, secure, username, fromAddress, fromName } = resolved.configuration;
  return { configured: true, host, port, secure, username, fromAddress, fromName };
}
