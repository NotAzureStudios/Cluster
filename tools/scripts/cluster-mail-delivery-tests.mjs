// An end-to-end send against a real SMTP server.
//
// Cluster cannot be pointed at Google from CI, so this stands up a local SMTP
// server with a throwaway certificate and drives a genuine session through it:
// greeting, EHLO, STARTTLS, AUTH, MAIL FROM, RCPT TO, DATA. It asserts what
// actually reaches the wire — including that a space-separated app password is
// normalised before AUTH, which is the failure mode a unit test cannot see.
//
// Requires openssl and re-executes itself with NODE_EXTRA_CA_CERTS so the
// throwaway certificate is trusted without the transport ever relaxing TLS.
import assert from "node:assert/strict";
import net from "node:net";
import tls from "node:tls";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const certDirectory = mkdtempSync(path.join(tmpdir(), "cluster-mail-test-"));
const certFile = path.join(certDirectory, "cert.pem");
const keyFile = path.join(certDirectory, "key.pem");

function makeCertificate() {
  execFileSync("openssl", [
    "req", "-x509", "-newkey", "rsa:2048", "-nodes",
    "-keyout", keyFile, "-out", certFile,
    "-subj", "/CN=localhost", "-days", "2",
    "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1",
  ], { stdio: "ignore" });
}

try {
  execFileSync("openssl", ["version"], { stdio: "ignore" });
} catch {
  console.log("SKIP mail delivery checks: openssl is not available");
  rmSync(certDirectory, { recursive: true, force: true });
  process.exit(0);
}

makeCertificate();

// Node decides its trust store at startup, so trusting the throwaway
// certificate means handing it to a fresh process.
if (process.env.CLUSTER_MAIL_TEST_CHILD !== "1") {
  const { status } = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    stdio: "inherit",
    env: { ...process.env, CLUSTER_MAIL_TEST_CHILD: "1", NODE_EXTRA_CA_CERTS: certFile, CLUSTER_MAIL_TEST_CERT_DIR: certDirectory },
  });
  rmSync(certDirectory, { recursive: true, force: true });
  process.exit(status ?? 1);
}

const childCertDirectory = process.env.CLUSTER_MAIL_TEST_CERT_DIR || certDirectory;
const credentials = {
  cert: readFileSync(path.join(childCertDirectory, "cert.pem")),
  key: readFileSync(path.join(childCertDirectory, "key.pem")),
};

/**
 * The smallest SMTP server that can hold a correct ESMTP conversation, so the
 * transport is exercised rather than mocked. Records what it was told.
 */
function startSmtpServer({ rejectAuth = false, rejectRecipient = false } = {}) {
  const session = { auth: null, mailFrom: null, rcptTo: [], data: "", starttls: false, ehlo: [] };
  const server = net.createServer((socket) => {
    let buffer = "";
    let inData = false;
    let current = socket;

    const write = (line) => current.write(`${line}\r\n`);

    const handle = (line) => {
      const upper = line.toUpperCase();
      if (inData) {
        if (line === ".") {
          inData = false;
          write("250 2.0.0 Ok: queued as TESTMESSAGE");
          return;
        }
        // Undo dot-stuffing exactly as a real server does.
        session.data += `${line.startsWith("..") ? line.slice(1) : line}\n`;
        return;
      }
      if (upper.startsWith("EHLO") || upper.startsWith("HELO")) {
        session.ehlo.push(line);
        if (session.starttls) write("250-localhost\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME");
        else write("250-localhost\r\n250-STARTTLS\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME");
        return;
      }
      if (upper === "STARTTLS") {
        write("220 2.0.0 Ready to start TLS");
        const secure = new tls.TLSSocket(socket, { isServer: true, cert: credentials.cert, key: credentials.key });
        session.starttls = true;
        current = secure;
        secure.setEncoding("utf8");
        secure.on("data", onData);
        secure.on("error", () => {});
        return;
      }
      if (upper.startsWith("AUTH PLAIN")) {
        const encoded = line.slice("AUTH PLAIN".length).trim();
        const [, user, pass] = Buffer.from(encoded, "base64").toString("utf8").split("\0");
        session.auth = { user, pass };
        if (rejectAuth) write("535 5.7.8 Username and Password not accepted");
        else write("235 2.7.0 Accepted");
        return;
      }
      if (upper.startsWith("MAIL FROM")) {
        session.mailFrom = line.slice(line.indexOf("<") + 1, line.indexOf(">"));
        write("250 2.1.0 Ok");
        return;
      }
      if (upper.startsWith("RCPT TO")) {
        const address = line.slice(line.indexOf("<") + 1, line.indexOf(">"));
        session.rcptTo.push(address);
        if (rejectRecipient) write("550 5.1.1 No such user here");
        else write("250 2.1.5 Ok");
        return;
      }
      if (upper === "DATA") {
        inData = true;
        write("354 End data with <CR><LF>.<CR><LF>");
        return;
      }
      if (upper === "QUIT") {
        write("221 2.0.0 Bye");
        current.end();
        return;
      }
      write("250 2.0.0 Ok");
    };

    function onData(chunk) {
      buffer += chunk;
      let index = buffer.indexOf("\r\n");
      while (index !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        handle(line);
        index = buffer.indexOf("\r\n");
      }
    }

    socket.setEncoding("utf8");
    socket.on("data", (chunk) => { if (!session.starttls) onData(chunk); });
    socket.on("error", () => {});
    write("220 localhost ESMTP Cluster test");
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, session, port: server.address().port }));
  });
}

const { tsImport } = await import("tsx/esm/api");
const { sendStudioMail, resetMailTransport, verifyMailConfiguration, MailSendError } =
  await tsImport("../../apps/server/src/core/mail-transport.ts", import.meta.url);

let passed = 0;
async function check(name, run) {
  resetMailTransport();
  await run();
  passed += 1;
  console.log(`PASS ${name}`);
}

function settingsFor(port, overrides = {}) {
  return {
    mailHost: "localhost",
    mailPort: port,
    mailUsername: "no-reply@azurestudios.dev",
    mailPassword: "abcd efgh ijkl mnop",
    mailFromName: "Azure Studios",
    ...overrides,
  };
}

await check("a message really traverses SMTP, over STARTTLS, with the password normalised", async () => {
  const { server, session, port } = await startSmtpServer();
  try {
    const result = await sendStudioMail(settingsFor(port), {
      to: "brady@azurestudios.dev",
      subject: "Cluster mail is working",
      text: "Line one.\nLine two.",
    });

    assert.ok(session.starttls, "the session must be upgraded to TLS before credentials are sent");
    assert.equal(session.ehlo.length, 2, "EHLO is repeated after STARTTLS, as ESMTP requires");
    // The spaces Google shows in an app password must not reach the wire.
    assert.deepEqual(session.auth, { user: "no-reply@azurestudios.dev", pass: "abcdefghijklmnop" });
    assert.equal(session.mailFrom, "no-reply@azurestudios.dev", "the envelope sender defaults to the authenticated mailbox");
    assert.deepEqual(session.rcptTo, ["brady@azurestudios.dev"]);
    assert.match(session.data, /^From: Azure Studios <no-reply@azurestudios\.dev>$/m);
    assert.match(session.data, /^To: brady@azurestudios\.dev$/m);
    assert.match(session.data, /^Subject: Cluster mail is working$/m);
    assert.match(session.data, /Line one\./);
    assert.match(session.data, /Line two\./);
    assert.deepEqual(result.accepted, ["brady@azurestudios.dev"]);
    assert.ok(result.messageId, "a sent message carries an id");
  } finally {
    server.close();
  }
});

await check("verify authenticates without sending a message", async () => {
  const { server, session, port } = await startSmtpServer();
  try {
    const verified = await verifyMailConfiguration(settingsFor(port));
    assert.equal(verified.ok, true);
    assert.equal(verified.secure, false, "587-style ports report STARTTLS rather than implicit TLS");
    assert.ok(session.auth, "verify must actually authenticate");
    assert.equal(session.data, "", "verify must not deliver anything");
    assert.deepEqual(session.rcptTo, []);
  } finally {
    server.close();
  }
});

await check("a 535 is reported as a credential fault and never retried", async () => {
  const { server, port } = await startSmtpServer({ rejectAuth: true });
  try {
    await assert.rejects(
      () => sendStudioMail(settingsFor(port), { to: "brady@azurestudios.dev", subject: "s", text: "t" }),
      (error) => {
        assert.ok(error instanceof MailSendError);
        assert.equal(error.code, "MAIL_AUTH_REJECTED");
        assert.equal(error.permanent, true);
        assert.equal(error.terminalJobFailure, true, "the queue must dead-letter this instead of retrying");
        assert.match(error.message, /app password/, "the message has to name the actual fix");
        return true;
      },
    );
  } finally {
    server.close();
  }
});

await check("a refused recipient is permanent, not a retry loop", async () => {
  const { server, port } = await startSmtpServer({ rejectRecipient: true });
  try {
    await assert.rejects(
      () => sendStudioMail(settingsFor(port), { to: "nobody@azurestudios.dev", subject: "s", text: "t" }),
      (error) => {
        assert.ok(error instanceof MailSendError);
        assert.equal(error.permanent, true, "a 550 cannot succeed on a retry");
        assert.equal(error.terminalJobFailure, true);
        return true;
      },
    );
  } finally {
    server.close();
  }
});

await check("a mail server that is not listening is retryable", async () => {
  // Claim a port, then free it, so nothing is listening on a port we know.
  const { server, port } = await startSmtpServer();
  await new Promise((resolve) => server.close(resolve));
  await assert.rejects(
    () => sendStudioMail(settingsFor(port), { to: "brady@azurestudios.dev", subject: "s", text: "t" }),
    (error) => {
      assert.ok(error instanceof MailSendError, `expected MailSendError, got ${error?.name}`);
      assert.equal(error.permanent, false, "an unreachable server is worth another attempt");
      assert.equal(error.terminalJobFailure, false);
      return true;
    },
  );
});

await check("an explicit sender and reply-to reach the headers", async () => {
  const { server, session, port } = await startSmtpServer();
  try {
    await sendStudioMail(settingsFor(port, { mailFromAddress: "studio@azurestudios.dev" }), {
      to: "brady@azurestudios.dev",
      subject: "Reply handling",
      text: "body",
      replyTo: "people@azurestudios.dev",
    });
    assert.equal(session.mailFrom, "studio@azurestudios.dev");
    assert.match(session.data, /^Reply-To: people@azurestudios\.dev$/m);
  } finally {
    server.close();
  }
});

resetMailTransport();
console.log(`${passed}/6 mail delivery checks passed`);
