import { readFile, writeFile, mkdir, readdir, lstat, rename, rm, open, realpath } from 'node:fs/promises';
import { join, resolve, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual, parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

export const catalog = {
  muse: 'Consult Muse; shared session protocol for the other skills.',
  'muse-implement': 'Muse implements and tests; the host scopes and verifies.',
  'muse-review': 'Muse critiques; the host verifies findings and owns any fixes.',
};
const names = Object.keys(catalog);
const manifestName = '.muse-code-bridge-skills.json';
const digest = data => createHash('sha256').update(data).digest('hex');
async function info(path) { try { return await lstat(path); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }

export function selectSkills(value = 'all') {
  if (value === 'all') return names;
  if (value === 'none') return [];
  if (value === 'core') return ['muse'];
  const selected = value.split(',').map(s => s.startsWith('muse-') ? s : 'muse-' + s);
  if (!selected.length || selected.some(s => !['muse-implement', 'muse-review'].includes(s))) {
    throw new Error('--skills must be all, core, none, or a comma-separated list of implement,review.');
  }
  return names.filter(name => name === 'muse' || selected.includes(name));
}

export function skillsPath(host, env = process.env) {
  if (host === 'hermes') return resolve(env.MUSE_BRIDGE_HERMES_SKILLS_DIR || join(env.HERMES_HOME || join(homedir(), '.hermes'), 'skills'));
  if (host === 'opencode') return resolve(env.MUSE_BRIDGE_OPENCODE_SKILLS_DIR || join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'opencode/skills'));
  throw new Error('Skill directory installation supports hermes and opencode. Codex bundles all skills in its plugin.');
}

// Refuse links and special files inside a managed skill. Hash every file so a
// user edit or extra reference cannot be silently erased by an update/removal.
async function tree(path, prefix = '') {
  const entry = await info(path);
  if (!entry) return null;
  if (!entry.isDirectory()) throw new Error(`Skill path is not a regular directory: ${path}`);
  const files = Object.create(null);
  for (const item of (await readdir(path, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const key = prefix + item.name;
    if (item.isDirectory()) Object.assign(files, await tree(join(path, item.name), key + '/'));
    else if (item.isFile()) files[key] = await readFile(join(path, item.name));
    else throw new Error(`Skill contains a link or special file: ${join(path, item.name)}`);
  }
  return files;
}
const hashes = files => files && Object.fromEntries(Object.entries(files).map(([key, data]) => [key, digest(data)]));

async function readManifest(root) {
  const path = join(root, manifestName);
  const entry = await info(path);
  if (!entry) return null;
  if (!entry.isFile()) throw new Error('The skill install manifest is not a regular file.');
  let data;
  try { data = JSON.parse(await readFile(path, 'utf8')); } catch { throw new Error('Invalid skill install manifest; no skills changed.'); }
  if (data?.version !== 1 || !Array.isArray(data.selected) || data.selected.some(n => !names.includes(n)) ||
      !data.files || typeof data.files !== 'object' || Array.isArray(data.files) ||
      !isDeepStrictEqual(Object.keys(data.files).sort(), [...new Set(data.selected)].sort()) ||
      (data.selected.length && !data.selected.includes('muse')) ||
      Object.values(data.files).some(files => !files || typeof files !== 'object' || Array.isArray(files) ||
        Object.values(files).some(hash => typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)))) {
    throw new Error('Invalid skill install manifest; no skills changed.');
  }
  return data;
}

async function plan({ root, repo, selection }) {
  const previous = await readManifest(root);
  const selected = selection === undefined ? (previous?.selected || names) : selectSkills(selection);
  const desired = {};
  for (const name of selected) {
    desired[name] = await tree(join(repo, 'dist/skills', name));
    if (!desired[name]?.['SKILL.md']) throw new Error(`Missing bundled skill: ${name}. Rebuild or download the complete repository.`);
  }
  const next = { version: 1, selected, files: Object.fromEntries(selected.map(name => [name, hashes(desired[name])])) };
  const changes = [];
  for (const name of names.filter(n => selected.includes(n) || previous?.selected.includes(n))) {
    const current = await tree(join(root, name));
    const currentHashes = hashes(current);
    if (current && (!previous?.files[name] || !isDeepStrictEqual(currentHashes, previous.files[name]))) {
      throw new Error(`Preserving existing or locally edited skill ${join(root, name)}. Move it aside or reconcile it before updating.`);
    }
    if (!isDeepStrictEqual(currentHashes, next.files[name] || null)) changes.push({ name, files: desired[name] || null, current });
  }
  return { next, previous, changes };
}

export async function configureSkills({ host, repo, selection, check = false, env = process.env }) {
  if (host === 'codex') {
    if (selection !== undefined && selection !== 'all') throw new Error('Codex installs the complete skill collection with its plugin; --skills selection applies to Hermes/OpenCode.');
    for (const name of names) if (!await info(join(repo, 'plugins/muse-codex-bridge/skills', name, 'SKILL.md'))) throw new Error(`Missing Codex skill: ${name}`);
    return { host, selected: names, bundled: true, changed: false };
  }
  const root = skillsPath(host, env);
  const preview = await plan({ root, repo, selection });
  if (check) return { host, root, selected: preview.next.selected, changed: false };
  if (!preview.changes.length && isDeepStrictEqual(preview.previous, preview.next)) return { host, root, selected: preview.next.selected, changed: false };
  await mkdir(root, { recursive: true, mode: 0o700 });
  const lockPath = join(root, '.muse-code-bridge-skills.lock');
  const lock = await open(lockPath, 'wx', 0o600);
  const staging = join(root, '.muse-code-bridge-' + randomUUID());
  const applied = [];
  try {
    // Recheck after taking the lock, before touching any skill.
    const { next, changes } = await plan({ root, repo, selection });
    await mkdir(staging, { mode: 0o700 });
    for (const change of changes) {
      if (!change.files) continue;
      const target = join(staging, change.name);
      for (const [file, data] of Object.entries(change.files)) {
        const path = join(target, file);
        await mkdir(join(path, '..'), { recursive: true, mode: 0o700 });
        await writeFile(path, data, { mode: 0o600 });
      }
    }
    for (const change of changes) {
      if (!isDeepStrictEqual(hashes(await tree(join(root, change.name))), hashes(change.current))) throw new Error('Skills changed during installation; rerun setup.');
      const backup = join(staging, change.name + '.previous');
      if (change.current) await rename(join(root, change.name), backup);
      applied.push({ ...change, backup });
      if (change.files) await rename(join(staging, change.name), join(root, change.name));
    }
    await writeFile(join(staging, 'manifest.json'), JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
    await rename(join(staging, 'manifest.json'), join(root, manifestName));
    return { host, root, selected: next.selected, changed: true };
  } catch (error) {
    for (const change of applied.reverse()) {
      if (change.files) await rm(join(root, change.name), { recursive: true, force: true });
      if (change.current) await rename(change.backup, join(root, change.name));
    }
    throw error;
  } finally {
    await rm(staging, { recursive: true, force: true });
    await lock.close();
    await rm(lockPath);
  }
}

const entryFile = process.argv[1] && await realpath(process.argv[1]).catch(() => null);
if (entryFile && import.meta.url === pathToFileURL(entryFile).href) {
  try {
    const { values } = parseArgs({ options: {
      host: { type: 'string' }, repo: { type: 'string' }, skills: { type: 'string' },
      check: { type: 'boolean', default: false }, list: { type: 'boolean', default: false },
    } });
    if (values.list) for (const [name, description] of Object.entries(catalog)) console.log(`${name}: ${description}`);
    else {
      if (!isAbsolute(values.repo || '')) throw new Error('repo must be an absolute path.');
      const result = await configureSkills({ ...values, selection: values.skills });
      console.log(`${values.check ? 'Checked' : 'Installed'} ${result.host} skills: ${result.selected.join(', ') || 'none'}${result.root ? ' at ' + result.root : ' (bundled in the plugin)'}.`);
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
