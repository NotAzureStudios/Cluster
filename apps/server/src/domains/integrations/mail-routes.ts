import { z } from "zod";
import type { FastifyInstance } from "fastify";
import { normalizeLoginEmail } from "@cluster/shared";
import {
  MailNotConfiguredError,
  MailSendError,
  describeMailConfiguration,
  resetMailTransport,
  sendStudioMail,
  verifyMailConfiguration,
} from "../../core/mail-transport.js";
import type { SettingPayload } from "../../app/server-composition-types.js";

/**
 * Setting up outbound mail, and proving it works before anything depends on it.
 *
 * An app password that silently fails is the worst outcome here: verification
 * links would vanish and nobody would know until somebody could not sign in.
 * So these routes connect and authenticate on demand, and report the mail
 * server's own refusal in full rather than a generic failure.
 */
export function registerMailRoutes(input: {
  app: FastifyInstance;
  authorization: any;
  readSettings: (force?: boolean) => Promise<SettingPayload>;
  logActivity: (entry: any) => Promise<void>;
}) {
  /** Configuration as it stands, never including the password. */
  input.app.get("/api/admin/mail/status", async (request: any, reply: any) => {
    if (!(await input.authorization.requireTool(request, reply, "integrations", "view"))) return;
    reply.header("Cache-Control", "no-store");
    const settings = await input.readSettings(true);
    return {
      ok: true,
      mail: describeMailConfiguration(settings),
      // Surfaced so the setup screen can explain the Google Workspace case
      // without the administrator having to already know it.
      guidance: "Google Workspace needs smtp.gmail.com on port 587, the full mailbox address as the username, and an app password from an account with 2-step verification turned on. The account password will not authenticate.",
    };
  });

  /** Connects and authenticates without sending anything. */
  input.app.post("/api/admin/mail/verify", async (request: any, reply: any) => {
    const actor = await input.authorization.requireTool(request, reply, "integrations", "manage");
    if (!actor) return;
    reply.header("Cache-Control", "no-store");
    const settings = await input.readSettings(true);
    // Settings may have changed since the last send; never verify a stale pool.
    resetMailTransport();
    try {
      const verified = await verifyMailConfiguration(settings);
      await input.logActivity({
        userId: actor.id, type: "mail_configuration_verified", entityType: "integration", entityId: "communication.email",
        title: "Outbound mail credentials verified", metadata: { host: verified.host, port: verified.port, secure: verified.secure },
      });
      return { ...verified, ok: true as const };
    } catch (error) {
      return mailFailure(reply, error);
    }
  });

  /**
   * Sends one real message. Synchronous on purpose: the administrator is
   * watching, and a queued send would hide the reason behind a job record.
   */
  input.app.post("/api/admin/mail/test", async (request: any, reply: any) => {
    const actor = await input.authorization.requireTool(request, reply, "integrations", "manage");
    if (!actor) return;
    reply.header("Cache-Control", "no-store");
    const body = z.object({ to: z.string().trim().max(320).optional() }).parse(request.body || {});
    // Default to the administrator's own address: a test nobody reads proves
    // only that the server accepted the message, not that it arrived.
    const requested = body.to || actor.email || "";
    const to = normalizeLoginEmail(requested);
    if (!to) {
      reply.code(400);
      return { ok: false, code: "MAIL_TEST_NO_RECIPIENT", error: actor.email ? "Enter a valid address to send the test to." : "Add an email address to your profile, or enter one to send the test to." };
    }

    const settings = await input.readSettings(true);
    const sentAt = new Date();
    try {
      const result = await sendStudioMail(settings, {
        to,
        subject: "Cluster mail is working",
        text: [
          "This is a test message from Cluster.",
          "",
          `Sent ${sentAt.toISOString()} by ${actor.username || actor.id}.`,
          "",
          "If you are reading this, outbound mail is configured correctly and Cluster can send verification links, recovery requests and digests.",
        ].join("\n"),
      });
      await input.logActivity({
        userId: actor.id, type: "mail_test_sent", entityType: "integration", entityId: "communication.email",
        title: "Test email sent", metadata: { messageId: result.messageId, accepted: result.accepted.length },
      });
      return { ok: true, to, messageId: result.messageId, accepted: result.accepted, rejected: result.rejected };
    } catch (error) {
      return mailFailure(reply, error);
    }
  });

  /**
   * Mail failures are configuration problems the administrator can fix, so the
   * mail server's own words reach them. `retryable` tells the client whether
   * trying again could plausibly help.
   */
  function mailFailure(reply: any, error: unknown) {
    if (error instanceof MailNotConfiguredError) {
      reply.code(409);
      return { ok: false, code: error.code, error: error.message, retryable: false };
    }
    if (error instanceof MailSendError) {
      // 502: Cluster is fine, the upstream mail server refused.
      reply.code(error.permanent ? 422 : 502);
      return { ok: false, code: error.code, error: error.message, retryable: !error.permanent };
    }
    reply.code(502);
    return { ok: false, code: "MAIL_SEND_FAILED", error: error instanceof Error ? error.message.slice(0, 500) : "Sending mail failed.", retryable: true };
  }
}
