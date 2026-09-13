// Development-only stdio wrapper. It never edits Codex's installed app or config.
import { spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shouldWrap } from '../src/additive-cli.mjs';
import { createAdditiveRuntime } from '../src/additive-runtime.mjs';

const help = `Muse additive routing prototype (not a desktop installer)

MUSE_ADDITIVE_CODEX_BIN=/absolute/path/to/real/codex node dist/muse-additive.mjs app-server

Supports local stdio only. Other CLI commands pass through to the real Codex.
OpenAI settings remain owned by Codex; Muse uses the bridge's existing auth mode.
MUSE_ADDITIVE_STATE_DIR optionally selects a private routing-state directory.
Desktop discovery/refresh and GUI compatibility are not verified. See docs/additive-models.md.
`;
try {
  const args = process.argv.slice(2);
  if (!args.length || args[0] === '--help') { console.log(help); }
  else {
    const executable = process.env.MUSE_ADDITIVE_CODEX_BIN;
    if (!executable?.startsWith('/')) throw new Error('Set MUSE_ADDITIVE_CODEX_BIN to the absolute path of the real Codex executable.');
    if (await realpath(executable) === await realpath(fileURLToPath(import.meta.url))) throw new Error('The real Codex path cannot point back to the adapter.');
    if (!shouldWrap(args)) {
      const child = spawn(executable, args, { stdio: 'inherit' });
      child.on('error', () => { console.error('Unable to launch the real Codex executable.'); process.exitCode = 1; });
      child.on('exit', code => { process.exitCode = code ?? 1; });
      for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
    } else {
      const runtime = await createAdditiveRuntime({ executable, args,
        stateRoot: process.env.MUSE_ADDITIVE_STATE_DIR || join(homedir(), '.local/share/muse-bridge/additive'),
        emit: message => process.stdout.write(JSON.stringify(message) + '\n'),
      });
      let buffer = '', stopping = false;
      const stop = async () => { if (stopping) return; stopping = true; process.stdin.pause(); await runtime.stop(); };
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', data => {
        buffer += data;
        if (buffer.length > 32 * 1024 * 1024) { void stop(); return; }
        let i;
        while ((i = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
          if (!line.trim()) continue;
          try { void runtime.router.receive(JSON.parse(line)); }
          catch { process.stdout.write(JSON.stringify({ id: null, error: { code: -32700, message: 'Invalid JSON frame' } }) + '\n'); }
        }
      });
      process.stdin.once('end', () => void stop());
      for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => void stop());
    }
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
