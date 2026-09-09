import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, stat, symlink, readlink, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { parse as yaml } from 'yaml';
import { parse as jsonc } from 'jsonc-parser';
import { transformConfig, configure, configPath, serverName } from '../scripts/configure-host.mjs';

const repo = resolve(import.meta.dirname, '..');
const command = ['/tools/node with spaces', '/bridge/dist/muse-server.mjs'];
const muse = '/tools/muse with spaces';
const input = (host, text, opencodeMajor = 1) => ({ host, text, command, muse, opencodeMajor });

test('Hermes preserves comments, unrelated MCP servers, and YAML 1.1 values', () => {
  const text = '# my configuration\nmodel:\n  provider: my-provider\nflag: yes\nmcp_servers:\n  docs:\n    command: docs-server # keep me\n';
  const next = transformConfig(input('hermes', text));
  assert.match(next, /# my configuration/);
  assert.match(next, /# keep me/);
  const data = yaml(next, { version: '1.1' });
  assert.equal(data.flag, true);
  assert.equal(data.model.provider, 'my-provider');
  assert.equal(data.mcp_servers.docs.command, 'docs-server');
  assert.deepEqual(data.mcp_servers[serverName].args, command.slice(1));
  assert.equal(data.mcp_servers[serverName].env.MUSE_BRIDGE_EXECUTABLE, muse);
  assert.equal(transformConfig(input('hermes', next)), next);
});

test('new Hermes configurations use ordinary YAML mappings', () => {
  for (const text of ['', '# empty file\n', 'model:\n  provider: example\n']) {
    const next = transformConfig(input('hermes', text));
    assert.doesNotMatch(next, /!!omap/);
    assert.equal(yaml(next).mcp_servers[serverName].command, command[0]);
    assert.equal(transformConfig(input('hermes', next)), next);
  }
});

for (const opencodeMajor of [1, 2]) test(`OpenCode ${opencodeMajor} preserves JSONC comments and picks the correct layout`, () => {
  const text = '{\n // keep this comment\n "provider": {"mine": {"options": {"apiKey": "test-only"}}},\n "permission": {"bash": "ask"},\n "mcp": '+(opencodeMajor === 1 ? '{"docs":{"type":"remote","url":"https://example.test"}}' : '{"servers":{"docs":{"type":"remote","url":"https://example.test"}}}')+',\n}\n';
  const next = transformConfig(input('opencode', text, opencodeMajor));
  assert.match(next, /\/\/ keep this comment/);
  const data = jsonc(next);
  assert.equal(data.provider.mine.options.apiKey, 'test-only');
  assert.deepEqual(data.permission, { bash: 'ask' });
  const entry = (opencodeMajor === 1 ? data.mcp : data.mcp.servers)[serverName];
  assert.deepEqual(entry.command, command);
  assert.equal(entry.environment.MUSE_BRIDGE_EXECUTABLE, muse);
  assert.equal(opencodeMajor === 1 ? entry.enabled : entry.disabled, opencodeMajor === 1);
  assert.equal(transformConfig(input('opencode', next, opencodeMajor)), next);
});

test('malformed, ambiguous, and incompatible host settings are rejected', () => {
  for (const text of ['mcp_servers: []', 'mcp_servers: {}\nmcp_servers: {}', 'mcp_servers: [', 'defaults: &x {}\nmcp_servers: *x', 'defaults: &x {mcp_servers: {docs: {command: docs}}}\n<<: *x']) {
    assert.throws(() => transformConfig(input('hermes', text)));
  }
  for (const text of ['{"mcp":', '{"mcp":{},"mcp":{}}', '{"mcp":null}', '[]']) {
    assert.throws(() => transformConfig(input('opencode', text)));
  }
  assert.throws(() => transformConfig(input('opencode', '{"mcp":{"servers":{}}}', 1)), /version 2/);
  assert.throws(() => transformConfig(input('opencode', '{"mcp":{"old":{"type":"local"}}}', 2)), /Migrate/);
  assert.throws(() => transformConfig(input('opencode', '{}', 3)), /Unsupported/);
});

test('a conflicting entry is never overwritten, including a user-disabled installation', () => {
  assert.throws(() => transformConfig(input('hermes', `mcp_servers:\n  ${serverName}:\n    command: something-else\n`)), /not overwritten/);
  const next = jsonc(transformConfig(input('opencode', '{}')));
  next.mcp[serverName].enabled = false;
  assert.throws(() => transformConfig(input('opencode', JSON.stringify(next))), /not overwritten/);
});

async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'muse host settings '));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'settings/config.jsonc');
  const env = { ...process.env, MUSE_BRIDGE_OPENCODE_CONFIG: file, MUSE_BRIDGE_HERMES_CONFIG: join(dir, 'hermes/config.yaml') };
  // The config helper checks executables exist; it does not execute Muse.
  const base = { host: 'opencode', repo, node: process.execPath, muse: process.execPath, env, opencodeVersion: '1' };
  return { dir, file, env, base };
}

test('preflight does not create config directories; writes have private backups and reruns are no-ops', async t => {
  const s = await setup(t);
  await configure({ ...s.base, check: true });
  assert.deepEqual(await readdir(s.dir), []);
  await mkdir(join(s.dir, 'settings'));
  const old = '{ // retain\n "model": "my-model"\n}\n';
  await writeFile(s.file, old);
  const result = await configure(s.base);
  assert.equal(await readFile(result.backup, 'utf8'), old);
  assert.equal((await stat(result.backup)).mode & 0o777, 0o600);
  assert.equal((await stat(s.file)).mode & 0o777, 0o600);
  const before = await readdir(join(s.dir, 'settings'));
  assert.equal((await configure(s.base)).changed, false);
  assert.deepEqual(await readdir(join(s.dir, 'settings')), before);
});

test('configuration file symlinks are kept; existing installer locks prevent changes', async t => {
  const s = await setup(t);
  await mkdir(join(s.dir, 'settings'));
  const target = join(s.dir, 'actual.jsonc');
  await writeFile(target, '{}\n');
  await symlink(target, s.file);
  await writeFile(target + '.muse-code-bridge.lock', '');
  await assert.rejects(configure(s.base), /EEXIST/);
  assert.equal(await readFile(target, 'utf8'), '{}\n');
  await rm(target + '.muse-code-bridge.lock');
  await configure(s.base);
  assert.equal(await readlink(s.file), target);
  assert.ok(jsonc(await readFile(target, 'utf8')).mcp[serverName]);
});

test('global JSONC selection respects config roots and refuses two ambiguous files', async t => {
  const s = await setup(t);
  const env = { XDG_CONFIG_HOME: s.dir };
  await mkdir(join(s.dir, 'opencode'));
  const jsoncFile = join(s.dir, 'opencode/opencode.jsonc');
  await writeFile(jsoncFile, '{}');
  assert.equal(await configPath('opencode', env), jsoncFile);
  await writeFile(join(s.dir, 'opencode/opencode.json'), '{}');
  await assert.rejects(configPath('opencode', env), /Both OpenCode/);
  assert.equal(await configPath('opencode', { ...env, OPENCODE_CONFIG: jsoncFile }), jsoncFile);
});

test('OpenCode auto detection uses the CLI, falls back to known config, and asks for a version if unknown', async t => {
  const s = await setup(t);
  s.env.MUSE_BRIDGE_OPENCODE_BIN = join(s.dir, 'opencode');
  const options = { ...s.base, opencodeVersion: 'auto', check: true };
  await assert.rejects(configure(options), /Could not detect/);
  await writeFile(s.env.MUSE_BRIDGE_OPENCODE_BIN, '#!/bin/sh\necho 2.0.0-beta.1\n', { mode: 0o755 });
  await configure({ ...options, check: false });
  assert.ok(jsonc(await readFile(s.file, 'utf8')).mcp.servers[serverName]);
  await rm(s.env.MUSE_BRIDGE_OPENCODE_BIN);
  await configure(options);
});
