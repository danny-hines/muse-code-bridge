import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const repository = resolve(import.meta.dirname, '..');

async function setup(t, overrides = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'muse install test '));
  const log = join(dir, 'calls.jsonl');
  const fakeMuse = join(dir, 'muse');
  const fakeCodex = join(dir, 'codex');
  await writeFile(log, '');
  await writeFile(fakeMuse, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.INSTALL_TEST_LOG, JSON.stringify({ cli:'muse', args, hasApiKey:!!process.env.META_API_KEY })+'\\n');
if (args[0] === '--version') console.log(process.env.INSTALL_TEST_MUSE_VERSION || 'Muse Code 1.0.3');
`, { mode: 0o755 });
  await writeFile(fakeCodex, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.INSTALL_TEST_LOG, JSON.stringify({ cli:'codex', args })+'\\n');
if (args.includes('--help')) process.exit(0);
if (args[0] === 'plugin' && args[1] === 'list') console.log(process.env.INSTALL_TEST_INSTALLED || '{"installed":[]}');
if (process.env.INSTALL_TEST_FAIL_ADD && args[1] === 'marketplace' && args[2] === 'add') process.exit(9);
`, { mode: 0o755 });
  const env = { ...process.env, MUSE_BRIDGE_NODE_BIN: process.execPath, MUSE_BRIDGE_CODEX_BIN: fakeCodex, MUSE_BRIDGE_EXECUTABLE: fakeMuse, INSTALL_TEST_LOG: log, ...overrides };
  t.after(() => rm(dir, { recursive: true, force: true }));
  return {
    dir, env,
    run: (...args) => exec('/bin/sh', [join(repository, 'install.sh'), ...args], { env }),
    calls: async () => (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean).map(l => JSON.parse(l)),
  };
}

test('installer --check is read-only and never logs in', async t => {
  const s = await setup(t);
  const result = await s.run('--check');
  assert.match(result.stdout, /No settings changed/);
  assert.ok((await s.calls()).every(call => call.args.includes('--help') || call.args[0] === '--version' || call.args[1] === 'list'));
});

test('installer registers the checkout before installing the namespaced plugin', async t => {
  const s = await setup(t);
  await s.run();
  const mutations = (await s.calls()).filter(c => c.cli === 'codex' && !c.args.includes('--help') && c.args[1] !== 'list');
  assert.deepEqual(mutations.map(c => c.args), [
    ['plugin', 'marketplace', 'add', repository],
    ['plugin', 'add', 'muse-codex-bridge@muse-code-bridge'],
  ]);
});

test('installer refuses duplicate installations before mutating settings', async t => {
  const s = await setup(t, { INSTALL_TEST_INSTALLED: JSON.stringify({ installed: [{ name: 'muse-bridge', marketplaceName: 'personal' }] }) });
  await assert.rejects(s.run(), error => /already installed from personal/.test(error.stderr));
  assert.equal((await s.calls()).filter(c => c.cli === 'codex' && c.args.includes('add') && !c.args.includes('--help')).length, 0);
});

test('installer can update its own marketplace without a duplicate warning', async t => {
  const s = await setup(t, { INSTALL_TEST_INSTALLED: JSON.stringify({ installed: [{ name: 'muse-codex-bridge', marketplaceName: 'muse-code-bridge' }] }) });
  assert.match((await s.run()).stdout, /Muse Code Bridge installed/);
});

test('optional login removes overriding API key only from the login child', async t => {
  const s = await setup(t, { META_API_KEY: 'test-only' });
  await s.run('--login');
  const calls = await s.calls();
  assert.equal(calls.find(c => c.cli === 'muse' && c.args[0] === 'login').hasApiKey, false);
  assert.equal(s.env.META_API_KEY, 'test-only');
});

test('unsupported Muse versions fail before registration', async t => {
  const s = await setup(t, { INSTALL_TEST_MUSE_VERSION: 'Muse Code 1.0.2' });
  await assert.rejects(s.run(), error => /1.0.3 or newer/.test(error.stderr));
  assert.ok(!(await s.calls()).some(c => c.cli === 'codex'));
});

test('failed marketplace registration never proceeds to plugin installation', async t => {
  const s = await setup(t, { INSTALL_TEST_FAIL_ADD: '1' });
  await assert.rejects(s.run());
  assert.ok(!(await s.calls()).some(c => c.cli === 'codex' && c.args[1] === 'add'));
});

test('installation works from a checkout path containing spaces', async t => {
  const s = await setup(t);
  const checkout = join(s.dir, 'repo with spaces');
  await cp(join(repository, 'plugins'), join(checkout, 'plugins'), { recursive: true });
  await cp(join(repository, 'integrations'), join(checkout, 'integrations'), { recursive: true });
  await cp(join(repository, '.agents'), join(checkout, '.agents'), { recursive: true });
  await cp(join(repository, 'install.sh'), join(checkout, 'install.sh'));
  await exec('/bin/sh', [join(checkout, 'install.sh')], { env: s.env });
  assert.ok((await s.calls()).some(c => c.args[2] === 'add' && c.args[3] === checkout));
});
