import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { main, installationSettings } from '../scripts/native.mjs';
import { enableConfig } from '../src/native-config.mjs';

test('native updates preserve custom port and model order when the upstream default changes', () => {
  const previous = { port: 49001, models: ['muse-b', 'muse-a'] };
  assert.deepEqual(installationSettings(previous, {}, ['muse-new', 'muse-a', 'muse-b'], true), previous);
  assert.deepEqual(installationSettings(null, {}, ['muse-a', 'muse-b'], false), { port: 47831, models: ['muse-a', 'muse-b'] });
  assert.throws(() => installationSettings(previous, { port: '49002' }, ['muse-a', 'muse-b'], true), /Disable/);
  assert.throws(() => installationSettings(previous, { model: 'muse-a' }, ['muse-a', 'muse-b'], true), /Disable/);
  assert.throws(() => installationSettings(previous, {}, ['muse-a'], true), /unavailable/);
  assert.throws(() => installationSettings(previous, { port: '0' }, ['muse-a', 'muse-b'], false), /Invalid local port/);
});

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'muse native setup '));
  const configPath = join(root, 'config.toml');
  const privateFile = join(root, 'provider.json');
  const stateFile = join(root, 'codex-restore.json');
  const original = '# Original config\nmodel = "astra"\nmodel_reasoning_effort = "xhigh"\n[features]\nmulti_agent = true\n';
  const config = { token: 'fixture-token', models: ['muse-a'] };
  let ready = true;
  const server = createServer((req, res) => {
    assert.equal(req.headers.authorization, `Bearer ${config.token}`);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ready }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  config.port = server.address().port;
  await writeFile(privateFile, JSON.stringify(config), { mode: 0o600 });
  await writeFile(configPath, original, { mode: 0o600 });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  });
  return { root, original, config, configPath, privateFile, stateFile,
    ready: value => { ready = value; },
    run: (action, ...flags) => main([action, ...flags, '--root', root, '--codex-config', configPath]),
  };
}

// Reproduce legacy installations without exposing an activation command to users.
async function legacyInstallation(s) {
  const result = enableConfig(s.original, {
    model: s.config.models[0], port: s.config.port, token: s.config.token,
    catalogPath: join(s.root, 'models.json'),
  });
  await writeFile(s.configPath, result.text);
  await writeFile(s.stateFile, JSON.stringify({ ...result.restore, configPath: s.configPath }));
  return result.text;
}

test('legacy recovery preserves unrelated edits without requiring a working service or provider settings', async t => {
  const s = await setup(t);
  const enabled = await legacyInstallation(s);
  await writeFile(s.configPath, enabled.replace('multi_agent = true', 'multi_agent = false'));
  await rm(s.privateFile);
  s.ready(false);
  await s.run('disable');
  const restored = await readFile(s.configPath, 'utf8');
  assert.match(restored, /model = "astra"/);
  assert.match(restored, /model_reasoning_effort = "xhigh"/);
  assert.match(restored, /multi_agent = false/);
  await assert.rejects(access(s.stateFile));
  await assert.rejects(access(`${s.configPath}.muse-native.lock`));
});

test('legacy recovery restores untouched configuration exactly', async t => {
  const s = await setup(t);
  await legacyInstallation(s);
  await s.run('disable');
  assert.equal(await readFile(s.configPath, 'utf8'), s.original);
});

test('a non-ready service never reports successful status', async t => {
  const s = await setup(t);
  s.ready(false);
  await assert.rejects(s.run('status'), /health check/);
  assert.equal(await readFile(s.configPath, 'utf8'), s.original);
  await assert.rejects(access(s.stateFile));
});

test('legacy recovery refuses manually changed managed settings or a mismatched config path', async t => {
  const s = await setup(t);
  const enabled = await legacyInstallation(s);
  const recovery = await readFile(s.stateFile, 'utf8');
  const edited = enabled.replace('model = "muse-a"', 'model = "manual-choice"');
  await writeFile(s.configPath, edited);
  await assert.rejects(s.run('disable'), /Managed Muse settings changed/);
  assert.equal(await readFile(s.configPath, 'utf8'), edited);
  assert.equal(await readFile(s.stateFile, 'utf8'), recovery);
  await writeFile(s.configPath, enabled);
  const mismatched = JSON.stringify({ ...JSON.parse(recovery), configPath: join(s.root, 'other.toml') });
  await writeFile(s.stateFile, mismatched);
  await assert.rejects(s.run('disable'), /different Codex configuration/);
  assert.equal(await readFile(s.configPath, 'utf8'), enabled);
  assert.equal(await readFile(s.stateFile, 'utf8'), mismatched);
  await assert.rejects(access(`${s.configPath}.muse-native.lock`));
});

test('all legacy enable commands refuse before reading provider files or changing configuration', async t => {
  const s = await setup(t);
  await rm(s.privateFile);
  for (const flags of [[], ['--replace-provider']]) {
    await assert.rejects(s.run('enable', ...flags), /activation has been withdrawn/);
    assert.equal(await readFile(s.configPath, 'utf8'), s.original);
    await assert.rejects(access(s.stateFile));
    await assert.rejects(access(`${s.configPath}.muse-native.lock`));
  }
});
