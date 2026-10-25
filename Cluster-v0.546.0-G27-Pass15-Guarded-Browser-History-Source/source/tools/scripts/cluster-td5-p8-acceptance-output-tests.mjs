import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Writable } from 'node:stream';
import {
  databaseOutputSecrets, createAcceptanceOutputRedactor, redactSensitiveText,
} from './cluster-td5-acceptance-redaction.mjs';
import { runBoundedAcceptanceStep } from './cluster-td5-acceptance-process.mjs';

const credentials = 'postgresql://build-user:my-super-secret@127.0.0.1:5432/cluster_td5_cert_p8?sslpassword=tls-private-token';
const secrets = databaseOutputSecrets({ TD5_CERT_DATABASE_URL: credentials });

function capture() {
  let result = '';
  const sink = new Writable({ write(chunk, _encoding, done) { result += chunk.toString('utf8'); done(); } });
  return { sink, result: () => result };
}

test('redaction inventory covers URL, identity, password and TLS query secrets', () => {
  for (const secret of [credentials, 'build-user', 'my-super-secret', 'tls-private-token']) {
    assert(secrets.includes(secret), `missing secret: ${secret}`);
  }
  assert(!redactSensitiveText(`message ${credentials} password=my-super-secret`, secrets).includes('my-super-secret'));
});

test('token redaction holds incomplete URL across arbitrary write boundaries', () => {
  const messages = [];
  const filter = createAcceptanceOutputRedactor(value => messages.push(value), secrets);
  for (let i = 0; i < credentials.length; i++) filter.write(credentials.slice(i, i + 1));
  filter.end();
  assert.equal(messages.join(''), '[REDACTED]');
});

test('short and long secrets sharing prefixes cannot expose a suffix', () => {
  const pieces = [];
  const filter = createAcceptanceOutputRedactor(value => pieces.push(value), ['secret', 'secret123']);
  filter.write('token=secret');
  filter.write('123.');
  filter.end();
  assert.equal(pieces.join(''), 'token=[REDACTED].');
});

test('unterminated stream masks a possible partial secret at close', () => {
  const pieces = [];
  const filter = createAcceptanceOutputRedactor(value => pieces.push(value), ['danger']);
  filter.write('prefix dang');
  filter.end();
  filter.end();
  assert.equal(pieces.join(''), 'prefix [REDACTED]');
});

test('actual child stdout and stderr are masked before writing to acceptance logs', async () => {
  const output = capture();
  const errors = capture();
  const code = `process.stdout.write('database='+${JSON.stringify(credentials.slice(0, 25))});
    setTimeout(()=>{process.stdout.write(${JSON.stringify(credentials.slice(25))}+'\\n');
    process.stderr.write('password='+${JSON.stringify('my-super-')});
    setTimeout(()=>{process.stderr.write('secret\\n');process.exit(3)},15)},15)`;
  const result = await runBoundedAcceptanceStep({ name: 'Masked child', command: process.execPath, args: ['-e', code],
    timeoutMs: 3000, stdio: 'pipe', redactions: secrets, output: output.sink, errorOutput: errors.sink });
  assert.equal(result, 3);
  assert.equal(output.result(), 'database=[REDACTED]\\n'.replace('\\n', '\n'));
  assert.equal(errors.result(), 'password=[REDACTED]\\n'.replace('\\n', '\n'));
  for (const unsafe of [credentials, 'build-user', 'my-super-secret', 'tls-private-token']) {
    assert(![output.result(), errors.result()].join().includes(unsafe));
  }
});

test('redacted output remains bounded when the subprocess reaches a deadline', async () => {
  const output = capture();
  await assert.rejects(runBoundedAcceptanceStep({ name: 'Timeout safety', command: process.execPath,
    args: ['-e', `process.stdout.write(${JSON.stringify(credentials)});setInterval(()=>{},100)`],
    timeoutMs: 180, stdio: 'pipe', redactions: secrets, output: output.sink, errorOutput: capture().sink }), /deadline/);
  assert(!output.result().includes(credentials));
});

test('pipe mode requires a declared redaction set', () => {
  assert.throws(() => runBoundedAcceptanceStep({ name: 'Unsafe pipe', command: process.execPath, args: [],
    timeoutMs: 50, stdio: 'pipe' }), /Invalid bounded/);
});

test('late bytes after process interruption cannot raise an unhandled stream error', () => {
  const parts = [];
  const filter = createAcceptanceOutputRedactor(value => parts.push(value), secrets);
  filter.write('safe ');
  filter.end();
  filter.write(credentials);
  assert.equal(parts.join(''), 'safe ');
});

test('decoded and URL-escaped password representations are both protected', () => {
  const hidden = databaseOutputSecrets({ DATABASE_URL: 'postgresql://who:p%40ssword@localhost/cluster_td5_cert_safe' });
  const rendered = redactSensitiveText('password=p@ssword; url=p%40ssword', hidden);
  assert(!rendered.includes('p@ssword'));
  assert(!rendered.includes('p%40ssword'));
});

test('multi-byte UTF-8 text survives split chunks around a redacted credential', () => {
  const parts = [];
  const filter = createAcceptanceOutputRedactor(value => parts.push(value), ['secret']);
  const buffer = Buffer.from('✔ secret ✔', 'utf8');
  for (const byte of buffer) filter.write(Buffer.from([byte]));
  filter.end();
  assert.equal(parts.join(''), '✔ [REDACTED] ✔');
});
