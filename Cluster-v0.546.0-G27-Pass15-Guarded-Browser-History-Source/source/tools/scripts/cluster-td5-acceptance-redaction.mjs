/**
 * Credential-safe output for the TD5 disposable runtime gate.
 * Stream token matching preserves possible partial secrets across write boundaries,
 * including outputs that omit newlines or split a URL across multiple chunks.
 */
import { StringDecoder } from 'node:string_decoder';

export function databaseOutputSecrets(env = {}) {
  const tokens = new Set();
  const add = value => {
    if (typeof value === 'string' && value) tokens.add(value);
  };
  for (const key of ['TD5_CERT_DATABASE_URL', 'DATABASE_URL', 'DIRECT_DATABASE_URL', 'TD1_CERT_DATABASE_URL', 'TD2_CERT_DATABASE_URL']) {
    const value = env[key];
    if (!value || typeof value !== 'string') continue;
    add(value);
    try {
      const parsed = new URL(value);
      for (const part of [parsed.username, parsed.password]) {
        if (!part) continue;
        add(part);
        try { add(decodeURIComponent(part)); } catch { /* encoded token stays masked */ }
      }
      for (const [, part] of parsed.searchParams) {
        // Query values may include tokens, TLS private keys and passwords.
        add(part);
        add(encodeURIComponent(part));
      }
    } catch { /* Still mask the complete invalid URL. */ }
  }
  return [...tokens].sort((a, b) => b.length - a.length);
}

export function redactSensitiveText(value, secrets) {
  let output = String(value);
  for (const secret of secrets) if (secret) output = output.replaceAll(secret, '[REDACTED]');
  return output;
}

export function createAcceptanceOutputRedactor(write, secrets) {
  if (typeof write !== 'function') throw new TypeError('Output sink required');
  const tokens = [...new Set(secrets.filter(Boolean))].sort((a, b) => b.length - a.length);
  const decoder = new StringDecoder('utf8');
  let pending = '';
  let closed = false;
  const emit = final => {
    let out = '';
    while (pending) {
      const matched = tokens.find(token => pending.startsWith(token));
      const incompleteToken = tokens.some(token => token.length > pending.length && token.startsWith(pending));
      if (!final && incompleteToken) {
        // A shorter credential can be the prefix of a longer one. Hold
        // everything until enough bytes arrive to distinguish them.
        break;
      }
      if (final && incompleteToken) {
        // A crashed or timed-out child may have printed ONLY a secret prefix,
        // including a complete short token plus a partial longer token.
        // Flushing that prefix raw would reveal credential fragments.
        out += '[REDACTED]';
        pending = '';
      } else if (matched) {
        out += '[REDACTED]';
        pending = pending.slice(matched.length);
      } else if (!final && tokens.some(token => token.startsWith(pending))) {
        // Do not flush bytes that could complete a secret in the next chunk.
        break;
      } else if (final && tokens.some(token => token.startsWith(pending))) {
        // The subprocess ended in the middle of a secret. Treat a dangling
        // prefix as sensitive instead of reconstructing it in the log.
        out += '[REDACTED]';
        pending = '';
      } else {
        out += pending[0];
        pending = pending.slice(1);
      }
    }
    if (out) write(out);
  };
  return {
    write(chunk) {
      // Child streams may emit a buffered chunk after a timeout or interrupt.
      // Ignore late output rather than throwing from an unhandled data callback.
      if (closed) return;
      pending += typeof chunk === 'string' ? chunk : decoder.write(chunk);
      emit(false);
    },
    end() {
      if (closed) return;
      pending += decoder.end();
      closed = true;
      emit(true);
    },
  };
}
