import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { shouldWrap } from '../src/additive-cli.mjs';
import { createSharedRuntime } from '../src/shared-runtime.mjs';

try {
  const executable = process.env.MUSE_SHARED_CODEX_BIN;
  if (!executable?.startsWith('/')) throw new Error('Use the ChatGPT + Muse shortcut to start the shared runtime.');
  if (await realpath(executable) === await realpath(fileURLToPath(import.meta.url))) throw new Error('Invalid native executable path.');
  const args = process.argv.slice(2);
  if (!shouldWrap(args)) {
    const child = spawn(executable, args, { stdio: 'inherit' });
    child.once('error', () => { console.error('Unable to start the native executable.'); process.exitCode = 1; });
    child.once('exit', code => { process.exitCode = code ?? 1; });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
  } else {
    const runtime = await createSharedRuntime({ executable, args,
      stateRoot: join(process.env.MUSE_BRIDGE_ROOT || join(homedir(), '.local/share/muse-bridge'), 'shared'),
      emit: message => process.stdout.write(JSON.stringify(message) + '\n'),
    });
    let buffer = '', stopping = false;
    const stop = async () => { if (stopping) return; stopping = true; process.stdin.pause(); await runtime.stop(); };
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', data => {
      buffer += data;
      if (Buffer.byteLength(buffer) > 32 * 1024 * 1024) { void stop(); return; }
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
        if (!line.trim()) continue;
        try { void runtime.receive(JSON.parse(line)).catch(() => stop()); }
        catch { void stop(); }
      }
    });
    process.stdin.once('end', () => void stop());
    runtime.peer.once('closed', () => { process.stdin.destroy(); });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void stop());
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
