import { readFile, writeFile, mkdir, lstat, realpath, rename, unlink } from 'node:fs/promises';
import { dirname, join, resolve, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { parseArgs, isDeepStrictEqual } from 'node:util';
import { execFileSync } from 'node:child_process';
import { parseDocument, isMap } from 'yaml';
import { parseTree, getNodeValue, modify, applyEdits } from 'jsonc-parser';

export const serverName = 'muse_code_bridge';
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
async function info(path) { try { return await lstat(path); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }

function jsonDocument(text) {
  const errors = [];
  const tree = parseTree(text || '{}', errors, { allowTrailingComma: true });
  if (errors.length || tree?.type !== 'object') throw new Error('Invalid JSON/JSONC configuration; no settings changed.');
  function unique(node) {
    if (node.type === 'object') {
      const keys = node.children.map(p => p.children[0].value);
      if (new Set(keys).size !== keys.length) throw new Error('Duplicate configuration keys; resolve them before installing.');
    }
    for (const child of node.children || []) unique(child);
  }
  unique(tree);
  return getNodeValue(tree);
}

function checkExisting(existing, desired) {
  if (existing === undefined) return false;
  // jsonc-parser creates null-prototype objects; compare their JSON values.
  if (isDeepStrictEqual(JSON.parse(JSON.stringify(existing)), desired)) return true;
  throw new Error(`A different ${serverName} entry already exists. Preserve or remove that entry before installing; it was not overwritten.`);
}

// Only the named MCP entry changes. Model, auth, permissions, and other servers remain intact.
export function transformConfig({ host, text, command, muse, opencodeMajor = 1 }) {
  if (host === 'hermes') {
    // Hermes uses PyYAML's YAML 1.1 scalar rules. Keep that interpretation on rewrite.
    const doc = parseDocument(text, { version: '1.1', prettyErrors: false });
    if (doc.errors.length || doc.warnings.length || (doc.contents !== null && !isMap(doc.contents))) throw new Error('Invalid or unsupported YAML configuration; no settings changed.');
    const data = doc.toJS() || {};
    if (data.mcp_servers !== undefined && !doc.has('mcp_servers')) throw new Error('An inherited mcp_servers map needs manual configuration.');
    if (data.mcp_servers !== undefined && !object(data.mcp_servers)) throw new Error('mcp_servers must be a mapping.');
    const servers = doc.get('mcp_servers', true);
    if (servers && (!isMap(servers) || servers.anchor || servers.items.some(p => p.key?.source === '<<'))) throw new Error('An aliased or merged mcp_servers map needs manual configuration.');
    const desired = { command: command[0], args: command.slice(1), env: { MUSE_BRIDGE_EXECUTABLE: muse }, timeout: 60 };
    if (checkExisting(data.mcp_servers?.[serverName], desired)) return text;
    // Create ordinary YAML maps; automatic intermediate maps use !!omap in 1.1.
    if (doc.contents === null) doc.contents = doc.createNode({});
    if (!doc.has('mcp_servers')) doc.set('mcp_servers', doc.createNode({}));
    doc.setIn(['mcp_servers', serverName], desired);
    return doc.toString({ lineWidth: 0 });
  }
  if (host !== 'opencode' || ![1, 2].includes(opencodeMajor)) throw new Error('Unsupported host or OpenCode version.');
  const data = jsonDocument(text);
  if (data.mcp !== undefined && !object(data.mcp)) throw new Error('mcp must be an object.');
  const v2 = opencodeMajor === 2;
  if (!v2 && data.mcp?.servers !== undefined) throw new Error('Configuration uses the OpenCode 2 layout; select --opencode-version 2.');
  if (v2 && data.mcp && Object.keys(data.mcp).some(k => !['servers', 'timeout'].includes(k))) throw new Error('Configuration uses the OpenCode 1 layout. Migrate it with OpenCode before installing for version 2.');
  if (v2 && data.mcp?.servers !== undefined && !object(data.mcp.servers)) throw new Error('mcp.servers must be an object.');
  const desired = { type: 'local', command, environment: { MUSE_BRIDGE_EXECUTABLE: muse }, ...(v2 ? { disabled: false, codemode: false } : { enabled: true }) };
  const path = v2 ? ['mcp', 'servers', serverName] : ['mcp', serverName];
  if (checkExisting(v2 ? data.mcp?.servers?.[serverName] : data.mcp?.[serverName], desired)) return text;
  const input = text || '{}\n';
  return applyEdits(input, modify(input, path, desired, { formattingOptions: { insertSpaces: true, tabSize: 2, eol: input.includes('\r\n') ? '\r\n' : '\n' } }));
}

export async function configPath(host, env = process.env) {
  if (host === 'hermes') return resolve(env.MUSE_BRIDGE_HERMES_CONFIG || join(env.HERMES_HOME || join(homedir(), '.hermes'), 'config.yaml'));
  if (env.MUSE_BRIDGE_OPENCODE_CONFIG || env.OPENCODE_CONFIG) return resolve(env.MUSE_BRIDGE_OPENCODE_CONFIG || env.OPENCODE_CONFIG);
  const dir = join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'opencode');
  const paths = [join(dir, 'opencode.json'), join(dir, 'opencode.jsonc')];
  const existing = [];
  for (const path of paths) if (await info(path)) existing.push(path);
  if (existing.length > 1) throw new Error('Both OpenCode config files exist. Set MUSE_BRIDGE_OPENCODE_CONFIG to the intended file.');
  return existing[0] || paths[0];
}

export async function configure({ host, repo, node, muse, check = false, opencodeVersion = 'auto', env = process.env }) {
  if (!['hermes', 'opencode'].includes(host)) throw new Error('Host must be hermes or opencode.');
  const file = await configPath(host, env);
  const entry = await info(file);
  // Follow the user's symlink without replacing it; reject non-files.
  const target = entry?.isSymbolicLink() ? await realpath(file) : file;
  if (entry && !(await lstat(target)).isFile()) throw new Error('The config destination is not a regular file.');
  const text = entry ? await readFile(target, 'utf8') : '';
  const command = [await realpath(node), join(await realpath(repo), 'dist/muse-server.mjs')];
  await lstat(command[1]);
  muse = await realpath(muse);
  let opencodeMajor = Number(opencodeVersion);
  if (host === 'opencode' && opencodeVersion === 'auto') {
    try {
      const v = execFileSync(env.MUSE_BRIDGE_OPENCODE_BIN || 'opencode', ['--version'], { encoding: 'utf8', timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] });
      opencodeMajor = Number(v.match(/\b(\d+)\.\d+\.\d+/)?.[1]);
    } catch {
      const config = jsonDocument(text);
      if (config.mcp?.servers) opencodeMajor = 2;
      else if (config.mcp && Object.keys(config.mcp).length) opencodeMajor = 1;
      else throw new Error('Could not detect OpenCode version. Set --opencode-version 1 or 2 (for the beta), or put the OpenCode CLI on PATH.');
    }
  }
  const next = transformConfig({ host, text, command, muse, opencodeMajor });
  if (check) { console.log(`Checked ${host}: ${file}. No settings changed.`); return { file, changed: false }; }
  if (next === text) { console.log(`${host} is already configured: ${file}`); return { file, changed: false }; }
  await mkdir(dirname(target), { recursive: true, mode: 0o700 });
  const lock = target + '.muse-code-bridge.lock';
  const handle = await import('node:fs/promises').then(fs => fs.open(lock, 'wx', 0o600));
  const temp = target + '.muse-code-bridge-' + randomUUID();
  let backup;
  try {
    const current = await info(target);
    if (Boolean(current) !== Boolean(entry) || (current && await readFile(target, 'utf8') !== text)) throw new Error('Configuration changed during installation. Rerun setup.');
    if (entry) {
      backup = target + '.muse-code-bridge-backup-' + randomUUID();
      await writeFile(backup, text, { flag: 'wx', mode: 0o600 });
    }
    await writeFile(temp, next, { flag: 'wx', mode: 0o600 });
    await rename(temp, target);
  } finally {
    await unlink(temp).catch(e => { if (e.code !== 'ENOENT') throw e; });
    await handle.close();
    await unlink(lock);
  }
  console.log(`Configured ${host}: ${file}${backup ? `\nBackup: ${backup}` : ''}`);
  return { file, changed: true, backup };
}

const entryFile = process.argv[1] && await realpath(process.argv[1]).catch(() => null);
if (entryFile && import.meta.url === pathToFileURL(entryFile).href) {
  try {
    const { values } = parseArgs({ options: {
      host: { type: 'string' }, repo: { type: 'string' }, node: { type: 'string' }, muse: { type: 'string' }, check: { type: 'boolean', default: false }, 'opencode-version': { type: 'string', default: 'auto' },
    } });
    for (const key of ['repo', 'node', 'muse']) if (!isAbsolute(values[key] || '')) throw new Error(`${key} must be an absolute path.`);
    await configure({ ...values, opencodeVersion: values['opencode-version'] });
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
