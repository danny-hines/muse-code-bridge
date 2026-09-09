// Keep a stable marketplace path and preserve any user edits during reruns.
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, writeFile, mkdir, rename, symlink, readlink, rm } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';

const [operation, root, source, sha, node, muse, codex] = process.argv.slice(2);
if (!['check', 'install'].includes(operation) || !isAbsolute(root || '') || !isAbsolute(source || '') || !/^[a-f0-9]{40}$/.test(sha || '')) throw new Error('Invalid bootstrap arguments.');
const target = join(root, 'repo');
const marker = '.muse-bridge-source.json';
const identity = 'danny-hines/muse-code-bridge';

async function exists(path) { try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
async function inventory(path, prefix = '') {
  const result = {};
  for (const name of (await readdir(path)).sort()) {
    if (!prefix && name === marker) continue;
    const relative = prefix + name;
    const file = join(path, name);
    const info = await lstat(file);
    if (info.isSymbolicLink()) throw new Error(`Unexpected symlink in managed source: ${relative}`);
    if (info.isDirectory()) Object.assign(result, await inventory(file, relative + '/'));
    else if (info.isFile()) result[relative] = createHash('sha256').update(await readFile(file)).digest('hex');
    else throw new Error(`Unexpected file type: ${relative}`);
  }
  return result;
}

const pkg = JSON.parse(await readFile(join(source, 'plugins/muse-codex-bridge/.codex-plugin/plugin.json'), 'utf8'));
if (pkg.name !== 'muse-codex-bridge') throw new Error('Downloaded plugin has an unexpected identity.');
let old;
if (await exists(target)) {
  if (!(await lstat(target)).isDirectory()) throw new Error('The bootstrap destination must be a real directory.');
  try { old = JSON.parse(await readFile(join(target, marker), 'utf8')); }
  catch { throw new Error(`Refusing to replace an existing unmanaged directory: ${target}`); }
  if (![identity, 'danny-hines/muse-bridge'].includes(old.repository) || JSON.stringify(old.files) !== JSON.stringify(await inventory(target))) {
    throw new Error(`Your source files have changed. Preserve those edits before rerunning setup: ${target}`);
  }
}
const files = await inventory(source);
const bin = join(root, 'runtime/bin');
const linksFile = join(root, 'runtime/links.json');
let ownedLinks = {};
try { ownedLinks = JSON.parse(await readFile(linksFile, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
for (const name of ['node', 'muse', 'codex']) {
  const path = join(bin, name);
  const entry = await exists(path);
  if (entry && (!entry.isSymbolicLink() || !ownedLinks[name] || await readlink(path) !== ownedLinks[name])) {
    throw new Error(`Refusing to replace an unmanaged runtime entry: ${path}`);
  }
}
if (operation === 'install') {
  const binaries = { node, muse, ...(codex ? { codex } : {}) };
  for (const [name, path] of Object.entries(binaries)) {
    if (!isAbsolute(path || '') || path === join(bin, name)) throw new Error(`Invalid ${name} executable path.`);
  }
  await writeFile(join(source, marker), JSON.stringify({ repository: identity, commit: sha, files }, null, 2) + '\n');
  const backup = target + '.previous';
  if (await exists(backup)) throw new Error(`A previous source backup exists. Inspect it before continuing: ${backup}`);
  const hasTarget = Boolean(await exists(target));
  if (hasTarget) await rename(target, backup);
  try { await rename(source, target); }
  catch (error) { if (hasTarget) await rename(backup, target); throw error; }
  await mkdir(bin, { recursive: true });
  for (const [name, path] of Object.entries(binaries)) {
    const temporary = join(bin, name + '.new');
    if (await exists(temporary)) throw new Error(`Unexpected temporary link: ${temporary}`);
    await symlink(path, temporary);
    await rename(temporary, join(bin, name));
  }
  await writeFile(linksFile, JSON.stringify({ ...ownedLinks, ...binaries }, null, 2) + '\n', { mode: 0o600 });
  if (hasTarget) await rm(backup, { recursive: true });
  console.log('Managed source and runtime paths are ready.');
} else {
  console.log('Source destination checked.');
}
