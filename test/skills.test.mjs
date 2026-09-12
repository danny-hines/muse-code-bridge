import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, mkdir, readFile, writeFile, rm, readdir, symlink, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { configureSkills, skillsPath, selectSkills } from '../scripts/configure-skills.mjs';

const repository = resolve(import.meta.dirname, '..');
async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'muse skills test '));
  const repo = join(dir, 'repo');
  await cp(join(repository, 'dist/skills'), join(repo, 'dist/skills'), { recursive: true });
  const root = join(dir, 'profile/skills');
  const env = { MUSE_BRIDGE_HERMES_SKILLS_DIR: root, MUSE_BRIDGE_OPENCODE_SKILLS_DIR: root };
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, repo, root, run: options => configureSkills({ host: 'hermes', repo, env, ...options }) };
}

test('skill preflight is read-only; a selected workflow installs its shared dependency', async t => {
  const s = await setup(t);
  await s.run({ selection: 'implement', check: true });
  await assert.rejects(access(s.root), { code: 'ENOENT' });
  const result = await s.run({ selection: 'implement' });
  assert.deepEqual(result.selected, ['muse', 'muse-implement']);
  assert.equal(await readFile(join(s.root, 'muse-implement/SKILL.md'), 'utf8'), await readFile(join(s.repo, 'dist/skills/muse-implement/SKILL.md'), 'utf8'));
  await access(join(s.root, 'muse-implement/../muse/SKILL.md'));
  await assert.rejects(access(join(s.root, 'muse-review')), { code: 'ENOENT' });
});

test('skill updates preserve selections, update unmodified files, and repeat as no-ops', async t => {
  const s = await setup(t);
  await s.run({ selection: 'review' });
  const source = join(s.repo, 'dist/skills/muse-review/SKILL.md');
  await writeFile(source, (await readFile(source)) + '\nNew upstream guidance.\n');
  assert.equal((await s.run({})).changed, true);
  assert.equal(await readFile(join(s.root, 'muse-review/SKILL.md'), 'utf8'), await readFile(source, 'utf8'));
  await assert.rejects(access(join(s.root, 'muse-implement')), { code: 'ENOENT' });
  assert.equal((await s.run({})).changed, false);
});

test('local edits and extra files block the entire skill update or removal', async t => {
  const s = await setup(t);
  await s.run({});
  const original = await readFile(join(s.root, 'muse/SKILL.md'), 'utf8');
  await writeFile(join(s.repo, 'dist/skills/muse/SKILL.md'), original + '\nUpstream change.\n');
  await writeFile(join(s.root, 'muse-review/__proto__'), 'personal notes');
  await assert.rejects(s.run({}), /Preserving existing or locally edited/);
  await assert.rejects(s.run({ selection: 'none' }), /Preserving existing or locally edited/);
  assert.equal(await readFile(join(s.root, 'muse/SKILL.md'), 'utf8'), original);
  assert.equal(await readFile(join(s.root, 'muse-review/__proto__'), 'utf8'), 'personal notes');
});

test('skill removal touches only owned files and persists the empty selection', async t => {
  const s = await setup(t);
  await s.run({});
  await mkdir(join(s.root, 'my-skill'));
  await writeFile(join(s.root, 'my-skill/SKILL.md'), 'my skill');
  await s.run({ selection: 'none' });
  assert.deepEqual((await readdir(s.root)).sort(), ['.muse-code-bridge-skills.json', 'my-skill']);
  assert.deepEqual((await s.run({})).selected, []);
  assert.equal(await readFile(join(s.root, 'my-skill/SKILL.md'), 'utf8'), 'my skill');
});

test('unmanaged skills, symlink skills, and corrupt manifests are preserved', async t => {
  const s = await setup(t);
  await mkdir(s.root, { recursive: true });
  await symlink(join(s.repo, 'dist/skills/muse'), join(s.root, 'muse'));
  await assert.rejects(s.run({}), /not a regular directory/);
  await rm(join(s.root, 'muse'));
  await cp(join(s.repo, 'dist/skills/muse'), join(s.root, 'muse'), { recursive: true });
  await assert.rejects(s.run({}), /Preserving existing/);
  await writeFile(join(s.root, '.muse-code-bridge-skills.json'), '{');
  await assert.rejects(s.run({}), /Invalid skill install manifest/);
  await access(join(s.root, 'muse/SKILL.md'));
});

test('an existing lock prevents writes; missing owned skills can be repaired', async t => {
  const s = await setup(t);
  await s.run({ selection: 'core' });
  await writeFile(join(s.root, '.muse-code-bridge-skills.lock'), 'busy');
  await assert.rejects(s.run({ selection: 'all' }), { code: 'EEXIST' });
  await assert.rejects(access(join(s.root, 'muse-implement')), { code: 'ENOENT' });
  await rm(join(s.root, '.muse-code-bridge-skills.lock'));
  await rm(join(s.root, 'muse'), { recursive: true });
  assert.equal((await s.run({})).changed, true);
  await access(join(s.root, 'muse/SKILL.md'));
});

test('host skill locations respect profile/config roots and explicit overrides', () => {
  assert.equal(skillsPath('hermes', { HERMES_HOME: '/profiles/coder' }), '/profiles/coder/skills');
  assert.equal(skillsPath('opencode', { XDG_CONFIG_HOME: '/config' }), '/config/opencode/skills');
  assert.equal(skillsPath('opencode', { XDG_CONFIG_HOME: '/config', MUSE_BRIDGE_OPENCODE_SKILLS_DIR: '/custom' }), '/custom');
  assert.throws(() => selectSkills('../escape'), /--skills/);
});

test('Codex validates the complete bundled collection without modifying it', async () => {
  assert.deepEqual((await configureSkills({ host: 'codex', repo: repository })).selected, ['muse', 'muse-implement', 'muse-review']);
  await assert.rejects(configureSkills({ host: 'codex', repo: repository, selection: 'review' }), /complete skill collection/);
});
