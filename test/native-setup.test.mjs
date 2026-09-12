import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { main, installationSettings } from '../scripts/native.mjs';

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
    run: action => main([action, '--root', root, '--codex-config', configPath]),
  };
}

test('enabling again preserves the original recovery copy and unrelated config edits', async t => {
  const s = await setup(t);
  await s.run('enable');
  const recovery = await readFile(s.stateFile, 'utf8');
  const edited = (await readFile(s.configPath, 'utf8')).replace('multi_agent = true', 'multi_agent = false');
  await writeFile(s.configPath, edited);
  await s.run('enable');
  assert.equal(await readFile(s.stateFile, 'utf8'), recovery);
  assert.equal(await readFile(s.configPath, 'utf8'), edited);
  await s.run('disable');
  const restored = await readFile(s.configPath, 'utf8');
  assert.match(restored, /model = "astra"/);
  assert.match(restored, /model_reasoning_effort = "xhigh"/);
  assert.match(restored, /multi_agent = false/);
  await assert.rejects(access(s.stateFile));
});

test('a non-ready service never enables the provider or reports successful status', async t => {
  const s = await setup(t);
  s.ready(false);
  await assert.rejects(s.run('enable'), /Start the local Muse provider/);
  await assert.rejects(s.run('status'), /health check/);
  assert.equal(await readFile(s.configPath, 'utf8'), s.original);
  await assert.rejects(access(s.stateFile));
  await assert.rejects(access(`${s.configPath}.muse-native.lock`));
});

test('rerun refuses mismatched service settings and manually changed managed blocks', async t => {
  const s = await setup(t);
  await s.run('enable');
  const recovery = await readFile(s.stateFile, 'utf8');
  const enabled = await readFile(s.configPath, 'utf8');
  await writeFile(s.privateFile, JSON.stringify({ ...s.config, models: ['muse-b'] }));
  await assert.rejects(s.run('enable'), /service settings changed/);
  assert.equal(await readFile(s.configPath, 'utf8'), enabled);
  await writeFile(s.privateFile, JSON.stringify(s.config));
  const edited = enabled.replace('model = "muse-a"', 'model = "manual-choice"');
  await writeFile(s.configPath, edited);
  await assert.rejects(s.run('enable'), /Managed Muse settings changed/);
  assert.equal(await readFile(s.configPath, 'utf8'), edited);
  assert.equal(await readFile(s.stateFile, 'utf8'), recovery);
});
