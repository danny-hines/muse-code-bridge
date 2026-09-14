import { spawn, execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { constants } from 'node:fs';

// Run by the small companion .app. No launchctl, login item, shell profile,
// native bundle modification, or saved Codex provider configuration is needed.
let launchDir;
try {
  const config = JSON.parse(await readFile(process.argv[2], 'utf8'));
  if (process.platform !== 'darwin') throw new Error('This shortcut requires macOS.');
  for (const file of [config.nodeBin, config.entrypoint, config.museBin, config.codexBin, config.appBin]) await access(file, constants.R_OK);
  const version = execFileSync(config.codexBin, ['--version'], { encoding: 'utf8', timeout: 10000 }).trim();
  if (version !== config.nativeVersion) throw new Error('ChatGPT was updated. Use the normal ChatGPT icon until the Muse shortcut has been checked and reinstalled for this version.');
  if (process.argv.includes('--check')) {
    console.log('Shortcut files and native version passed. No app was launched.');
  } else {
    const processes = execFileSync('/bin/ps', ['-axo', 'comm='], { encoding: 'utf8' }).split('\n').map(line => line.trim());
    if (processes.includes(config.appBin)) throw new Error('ChatGPT is already running. Fully quit it with Cmd+Q, then open ChatGPT + Muse.');
    launchDir = await mkdtemp(join(tmpdir(), 'muse-shared-launch-'));
    const shim = join(launchDir, 'codex');
    await writeFile(shim, '#!/bin/bash\nexec "$MUSE_SHARED_NODE_BIN" "$MUSE_SHARED_ENTRYPOINT" "$@"\n', { mode: 0o700 });
    const env = { ...process.env, ...config.environment,
      MUSE_BRIDGE_ROOT: config.bridgeRoot, MUSE_BRIDGE_EXECUTABLE: config.museBin,
      MUSE_SHARED_CODEX_BIN: config.codexBin, MUSE_SHARED_NODE_BIN: config.nodeBin, MUSE_SHARED_ENTRYPOINT: config.entrypoint,
      CODEX_CLI_PATH: shim, CODEX_APP_SERVER_FORCE_CLI: '1',
      PATH: `${join(config.bridgeRoot, 'runtime/bin')}:${process.env.PATH || '/usr/bin:/bin'}:/opt/homebrew/bin:/usr/local/bin`,
    };
    // Never inherit the old local-only adapter's Remote disable flag.
    delete env.CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED;
    const child = spawn(config.appBin, [], { env, stdio: 'ignore' });
    const result = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); });
    if (result.code && result.code !== 0) throw new Error('ChatGPT exited unexpectedly. Fully quit and open its normal icon to return to the standard runtime.');
  }
} catch (error) {
  const message = error.code ? 'The Muse shortcut is missing a required file. Reinstall it, or open the normal ChatGPT icon.' : error.message;
  if (process.argv.includes('--check')) { console.error(message); process.exitCode = 1; }
  else {
    // Passing an argv value avoids AppleScript/shell interpolation of paths.
    const script = 'on run argv\ndisplay alert "ChatGPT + Muse" message (item 1 of argv) as warning\nend run';
    try { execFileSync('/usr/bin/osascript', ['-e', script, message], { stdio: 'ignore' }); } catch {}
    process.exitCode = 1;
  }
} finally { if (launchDir) await rm(launchDir, { recursive: true, force: true }); }
