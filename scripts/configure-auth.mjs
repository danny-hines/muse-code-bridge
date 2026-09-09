import { mkdir, writeFile, readFile, rename, unlink, lstat, open } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { connectionPath, readConfig, resolveConnection, validateConfig } from '../src/auth.mjs';

async function main() {
  let mode, keyFile, check = false, login = false, printMode = false;
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--check') check = true;
    else if (arg === '--print-mode') printMode = true;
    else if (arg === '--login') login = true;
    else if (arg === '--auth' || arg === '--api-key-file') {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a value.`);
      if (arg === '--auth') mode = value;
      else keyFile = resolve(value);
    } else throw new Error('Unknown authentication option.');
  }
  if (keyFile && mode !== 'api-key') throw new Error('--api-key-file requires --auth api-key.');
  const file = connectionPath();
  const existing = readConfig(); // Refuse to replace malformed or unrelated settings.
  const config = mode ? validateConfig({ version: 1, mode, ...(keyFile ? { api_key_file: keyFile } : {}) }) : existing;
  if (login && config.mode === 'api-key') throw new Error('--login cannot be used in API mode. Use --auth account to switch back.');
  resolveConnection(config); // Validate the credential locally without making a request.
  if (printMode) { console.log(config.mode); return; }
  console.log(`Muse authentication: ${config.mode === 'account' ? 'Muse-managed account credentials' : 'explicit pay-as-you-go API key'}.`);
  if (check || !mode || JSON.stringify(config) === JSON.stringify(existing)) return;
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const lockPath = file + '.lock';
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch { throw new Error('Connection settings are locked by another setup.'); }
  const temp = file + '.' + randomUUID() + '.tmp';
  try {
    let previous;
    try {
      const info = await lstat(file);
      if (!info.isFile()) throw new Error('Connection settings must be a regular file.');
      previous = await readFile(file, 'utf8');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (JSON.stringify(readConfig()) !== JSON.stringify(existing)) throw new Error('Connection settings changed during setup. Rerun the command.');
    if (previous !== undefined) await writeFile(file + '.backup.' + randomUUID(), previous, { flag: 'wx', mode: 0o600 });
    await writeFile(temp, JSON.stringify(config, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    await rename(temp, file);
    console.log('Saved the authentication choice. Restart every host using this bridge for it to take effect.');
  } finally {
    await unlink(temp).catch(() => {});
    await lock.close();
    await unlink(lockPath);
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
