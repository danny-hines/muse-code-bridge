import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findMuse, museEnvironment } from './msp.mjs';
import { NativeError, makePrompt } from './native-protocol.mjs';
import { MuseDecisionReader } from './muse-decision.mjs';

export async function runMuse(request, { signal, connection, executable = findMuse(), timeoutMs = 120_000, decisionAtModelBoundary = false } = {}) {
  const prompt = makePrompt(request);
  const workspace = await mkdtemp(join(tmpdir(), 'muse-provider-'));
  try {
    const file = join(workspace, 'request.txt');
    await writeFile(file, prompt, { mode: 0o600 });
    return await new Promise((resolve, reject) => {
      signal?.throwIfAborted();
      const child = spawn(executable, ['exec', '--json', '--no-session-log', '--max-model-steps', '1',
        '--disable-shell', '--disable-write', '--disable-web-tools', '--no-foreign-personal-context',
        '--model', request.model, '--reasoning-effort', request.effort, '--workspace', workspace, '--prompt-file', file],
      { cwd: workspace, env: museEnvironment(process.env, connection), stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
      let buffer = '', terminal, failure, bytes = 0, killTimer, decision;
      const decisions = decisionAtModelBoundary ? new MuseDecisionReader(request) : null;
      const stop = error => {
        failure ||= error;
        try { process.platform === 'win32' ? child.kill('SIGTERM') : process.kill(-child.pid, 'SIGTERM'); } catch {}
        killTimer ||= setTimeout(() => { try { process.platform === 'win32' ? child.kill('SIGKILL') : process.kill(-child.pid, 'SIGKILL'); } catch {} }, 1500);
        killTimer.unref();
      };
      const abort = () => stop(new NativeError('Request cancelled.', 499));
      signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(() => stop(new NativeError('Muse generation timed out. No automatic retry was submitted.', 504)), timeoutMs);
      child.stderr.on('data', () => {}); // Auth and private runtime diagnostics stay out of HTTP responses/logs.
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', data => {
        bytes += Buffer.byteLength(data);
        if (bytes > 16 * 1024 * 1024) { stop(new NativeError('Muse output exceeded the adapter limit.', 502)); return; }
        buffer += data;
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
          try {
            const event = JSON.parse(line);
            if (event.payload_type?.startsWith('run.terminal.')) terminal = event.payload;
            if (!decision && decisions) {
              const complete = decisions.consume(event);
              if (complete) { decision = complete; stop(); }
            }
          } catch { stop(new NativeError('Muse emitted invalid JSONL.', 502)); }
        }
      });
      child.on('error', () => { failure = new NativeError('Could not launch the official Muse CLI.', 502); });
      child.on('close', code => {
        clearTimeout(timer); clearTimeout(killTimer); signal?.removeEventListener('abort', abort);
        if (failure) reject(failure);
        else if (decision) resolve(decision);
        else if (code !== 0 || terminal?.terminal !== 'completed' || typeof terminal.text !== 'string') reject(new NativeError(`Muse generation did not complete (${terminal?.terminal || 'process failure'}). No partial result was executed.`, 502));
        else resolve(terminal.text);
      });
    });
  } finally { await rm(workspace, { recursive: true, force: true }); }
}
