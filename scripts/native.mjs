import { mkdir, readFile, writeFile, rename, lstat, unlink } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { MuseHost, findMuse } from '../src/msp.mjs';
import { makeCatalog } from '../src/native-catalog.mjs';
import { disableConfig } from '../src/native-config.mjs';

const help = `Experimental Muse provider for Codex\n\nnode dist/muse-native.mjs install [--model ID] [--port 47831]\nnode dist/muse-native.mjs disable\nnode dist/muse-native.mjs status\n\nInstall prepares the catalog and starts a localhost service on macOS.\nGlobal activation is withdrawn. This is a standalone protocol prototype, not a desktop model-picker integration.\nDisable restores the previous selection for legacy installations.\nRestart the desktop app after disable. Existing MCP skills remain installed.\nOn other systems, run the printed server command in a terminal or service manager.\n`;
const xml = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
async function exists(file) { try { return await lstat(file); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
async function readJson(file) { try { return JSON.parse(await readFile(file, 'utf8')); } catch { throw new Error('Cannot read native provider settings or recovery data. No credentials were displayed.'); } }
async function atomic(file, text) {
  const stat = await exists(file);
  if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw new Error('Refusing to replace a symlink or non-file.');
  const temp = `${file}.${randomUUID()}.tmp`;
  try { await writeFile(temp, text, { mode: 0o600, flag: 'wx' }); await rename(temp, file); }
  finally { await unlink(temp).catch(() => {}); }
}

export function installationSettings(previous, values, discovered, enabled) {
  const port = Number(values.port ?? previous?.port ?? 47831);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local port.');
  const models = values.model ? [values.model] : previous?.models ?? discovered;
  if (!Array.isArray(models) || !models.length || models.some(m => !discovered.includes(m))) throw new Error('A selected model is unavailable in the official Muse catalog. Disable the provider before selecting a different model with --model.');
  if (enabled && (!previous || previous.port !== port || JSON.stringify(previous.models) !== JSON.stringify(models))) throw new Error('Disable the current provider before changing its port or models.');
  return { port, models };
}

export async function main(argv = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { model: { type: 'string' }, port: { type: 'string' }, help: { type: 'boolean' }, root: { type: 'string' }, 'codex-config': { type: 'string' }, 'replace-provider': { type: 'boolean' } } });
  const action = positionals[0];
  if (values.help || !action) { console.log(help); return; }
  if (action === 'enable') throw new Error('Global native activation has been withdrawn because it replaces the existing model options. Use the separate experimental macOS launcher for both catalogs; see docs/setup.md. Disable remains available for recovery. No settings changed.');
  const root = resolve(values.root || join(process.env.MUSE_BRIDGE_ROOT || join(homedir(), '.local/share/muse-bridge'), 'native'));
  const configPath = resolve(values['codex-config'] || join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'config.toml'));
  const privateFile = join(root, 'provider.json'), catalogPath = join(root, 'models.json'), stateFile = join(root, 'codex-restore.json');
  if (action === 'install') {
    const previous = await exists(privateFile) ? await readJson(privateFile) : null;
    const host = new MuseHost(); let catalog;
    try { await host.start(); catalog = await host.request('model/list', {}); } finally { host.close(); }
    const discovered = [...catalog.models].sort((a, b) => Number(b.isDefault) - Number(a.isDefault)).map(m => m.modelId);
    const { port, models } = installationSettings(previous, values, discovered, Boolean(await exists(stateFile)));
    await mkdir(root, { recursive: true, mode: 0o700 });
    const config = { port, token: previous?.token || randomBytes(32).toString('hex'), models };
    await atomic(privateFile, JSON.stringify(config) + '\n');
    await atomic(catalogPath, JSON.stringify(makeCatalog(models), null, 2) + '\n');
    const sourceDir = dirname(fileURLToPath(import.meta.url));
    const source = join(sourceDir, 'muse-native-server.mjs');
    await atomic(join(root, 'server.mjs'), await readFile(source, 'utf8'));
    if (process.platform === 'darwin') {
      const label = 'com.muse-code-bridge.native';
      const plist = join(homedir(), 'Library/LaunchAgents', `${label}.plist`);
      await mkdir(dirname(plist), { recursive: true });
      const args = [process.execPath, join(root, 'server.mjs'), '--config', privateFile];
      const env = { ...process.env, MUSE_BRIDGE_EXECUTABLE: findMuse() };
      const environment = ['MUSE_BRIDGE_EXECUTABLE', 'MUSE_BRIDGE_CONNECTION_FILE', 'MUSE_BRIDGE_ROOT', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME'].filter(k => env[k]);
      await atomic(plist, `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array>${args.map(a => `<string>${xml(a)}</string>`).join('')}</array><key>EnvironmentVariables</key><dict>${environment.map(k => `<key>${k}</key><string>${xml(env[k])}</string>`).join('')}</dict><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer><key>StandardErrorPath</key><string>${xml(join(root, 'service.log'))}</string><key>StandardOutPath</key><string>${xml(join(root, 'service.log'))}</string></dict></plist>`);
      const domain = `gui/${process.getuid()}`;
      try { execFileSync('launchctl', ['bootout', `${domain}/${label}`], { stdio: 'ignore' }); } catch {}
      // launchd may acknowledge bootout before its old job has fully exited.
      let started = false;
      for (let attempt = 0; attempt < 20 && !started; attempt++) {
        try { execFileSync('launchctl', ['bootstrap', domain, plist], { stdio: 'pipe' }); started = true; }
        catch { await new Promise(resolve => setTimeout(resolve, 150)); }
      }
      if (!started) throw new Error('Could not start the Muse LaunchAgent. Its files are prepared; rerun install after the previous service exits.');
      let ready = false;
      for (let attempt = 0; attempt < 30 && !ready; attempt++) {
        try {
          const result = await fetch(`http://127.0.0.1:${port}/health`, { headers: { Authorization: `Bearer ${config.token}` }, signal: AbortSignal.timeout(500) });
          ready = result.ok && (await result.json()).ready === true;
        } catch {}
        if (!ready) await new Promise(resolve => setTimeout(resolve, 150));
      }
      if (!ready) throw new Error('The LaunchAgent started but its local health check failed. Codex settings have not been enabled.');
      console.log('Installed the experimental Muse provider and its macOS login service.');
    } else console.log(`Start the provider with: node ${JSON.stringify(join(root, 'server.mjs'))} --config ${JSON.stringify(privateFile)}`);
    console.log('Models: ' + models.join(', '));
    console.log('Current Codex model settings were preserved. For the combined model picker, use the separate experimental macOS launcher in docs/setup.md.');
    console.log('This standalone protocol prototype cannot be activated as a desktop model-picker integration.');
    return;
  }
  if (action === 'status') {
    const config = await readJson(privateFile);
    const result = await fetch(`http://127.0.0.1:${config.port}/health`, { headers: { Authorization: `Bearer ${config.token}` }, signal: AbortSignal.timeout(3000) });
    const health = result.ok ? await result.json() : null;
    if (health?.ready !== true) throw new Error('The local provider did not pass its health check.');
    console.log(JSON.stringify(health, null, 2)); return;
  }
  if (action !== 'disable') throw new Error('Unknown native command. Use --help.');
  await mkdir(dirname(configPath), { recursive: true });
  const lock = `${configPath}.muse-native.lock`;
  const handle = await import('node:fs/promises').then(fs => fs.open(lock, 'wx', 0o600));
  try {
    const text = await exists(configPath) ? await readFile(configPath, 'utf8') : '';
    const restore = await readJson(stateFile);
    if (restore.configPath !== configPath) throw new Error('The restore record belongs to a different Codex configuration.');
    await atomic(configPath, disableConfig(text, restore));
    await unlink(stateFile);
    console.log('Restored the previous Codex model/provider selection. Fully quit and reopen the desktop app.');
  } finally { await handle.close(); await unlink(lock); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
