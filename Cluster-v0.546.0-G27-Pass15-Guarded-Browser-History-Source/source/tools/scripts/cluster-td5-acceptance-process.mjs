/**
 * Bounded subprocess execution for disposable TD5 acceptance runs.
 * A hung build/migration must not leave an unbounded process tree behind.
 * Only verified executable/argument arrays are accepted, never a shell string.
 */
import { spawn, spawnSync } from 'node:child_process';

export const DEFAULT_ACCEPTANCE_OUTPUT_LIMIT = 16 * 1024 * 1024;
import { createAcceptanceOutputRedactor } from './cluster-td5-acceptance-redaction.mjs';

function stopTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    // Windows child.kill() only signals the direct PID, not its npm children.
    const result = spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true, timeout: 10000, stdio: 'ignore', shell: false,
    });
    if (result.error || result.status !== 0) { try { child.kill('SIGKILL'); } catch {} }
  } else {
    try { process.kill(-child.pid, 'SIGKILL'); }
    catch { try { child.kill('SIGKILL'); } catch {} }
  }
}

export function runBoundedAcceptanceStep({ name, command, args, cwd, env, timeoutMs, stdio = 'pipe', redactions = [],
  output = process.stdout, errorOutput = process.stderr, maxOutputBytes = DEFAULT_ACCEPTANCE_OUTPUT_LIMIT }) {
  if (!name || !command || !Array.isArray(args) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 ||
    !Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > 128 * 1024 * 1024 ||
    !['pipe', 'ignore'].includes(stdio) ||
    (stdio === 'pipe' && (!Array.isArray(redactions) || !redactions.length))) {
    throw new Error('Invalid bounded acceptance step configuration.');
  }
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, args, {
        cwd, env, stdio, windowsHide: true,
        detached: process.platform !== 'win32',
        shell: process.platform === 'win32' && /\.cmd$/i.test(command),
      });
    } catch { reject(new Error(`${name} could not be started.`)); return; }
    const stdoutRedactor = stdio === 'pipe' ? createAcceptanceOutputRedactor(s => output.write(s), redactions) : null;
    const stderrRedactor = stdio === 'pipe' ? createAcceptanceOutputRedactor(s => errorOutput.write(s), redactions) : null;
    let receivedBytes = 0;
    let settled = false;
    const acceptChunk = (redactor, chunk) => {
      if (settled) return;
      receivedBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk);
      if (receivedBytes > maxOutputBytes) {
        stopTree(child);
        done(new Error(`${name} exceeded its combined output budget; subprocess tree terminated.`));
        return;
      }
      try { redactor.write(chunk); }
      catch {
        stopTree(child);
        done(new Error(`${name} output processing failed; subprocess tree terminated.`));
      }
    };
    if (stdoutRedactor) child.stdout.on('data', chunk => acceptChunk(stdoutRedactor, chunk));
    if (stderrRedactor) child.stderr.on('data', chunk => acceptChunk(stderrRedactor, chunk));
    let timedOut = false;
    const done = (error, code) => {
      if (settled) return;
      settled = true;
      let flushFailed = false;
      try { stdoutRedactor?.end(); } catch { flushFailed = true; }
      try { stderrRedactor?.end(); } catch { flushFailed = true; }
      clearTimeout(timer);
      process.off('SIGINT', interrupted);
      process.off('SIGTERM', interrupted);
      if (error || flushFailed) reject(error || new Error(`${name} output processing failed.`));
      else resolve(code);
    };
    const interrupted = () => {
      stopTree(child);
      done(new Error(`${name} interrupted; subprocess tree terminated.`));
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stopTree(child);
      done(new Error(`${name} exceeded its bounded execution deadline; subprocess tree terminated.`));
    }, timeoutMs);
    timer.unref?.();
    process.on('SIGINT', interrupted);
    process.on('SIGTERM', interrupted);
    child.once('error', () => done(new Error(`${name} could not start its subprocess.`)));
    child.once('close', (code, signal) => {
      if (!timedOut) done(null, code ?? (signal ? 1 : 1));
    });
  });
}
