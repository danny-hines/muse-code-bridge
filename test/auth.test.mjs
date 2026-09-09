import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, stat, chmod, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readConfig, readConnection, resolveConnection } from '../src/auth.mjs';
import { museEnvironment } from '../src/msp.mjs';

const exec = promisify(execFile);
async function setup(t) {
  const dir = await mkdtemp(join(tmpdir(), 'muse-auth-test-'));
  const file = join(dir, 'private/key');
  const key = join(dir, 'api-key');
  await writeFile(key, 'fixture-api-key\n', { mode: 0o600 });
  const env = { ...process.env, MUSE_BRIDGE_CONNECTION_FILE: file, META_API_KEY: 'ambient-key-must-not-win' };
  t.after(() => rm(dir, { recursive: true, force: true }));
  return { dir, file, key, env, run: (...args) => exec(process.execPath, [resolve('dist/configure-auth.mjs'), ...args], { env }) };
}

test('fresh account mode strips an ambient key and does not create settings', async t => {
  const s = await setup(t);
  assert.equal(readConnection(s.env).mode, 'account');
  assert.equal(museEnvironment(s.env, readConnection(s.env)).META_API_KEY, undefined);
  await s.run('--check');
  await assert.rejects(access(join(s.dir, 'private')));
});

test('API preflight is read-only; persisted choice works without a shell API key', async t => {
  const s = await setup(t);
  await s.run('--auth', 'api-key', '--api-key-file', s.key, '--check');
  await assert.rejects(access(s.file));
  await s.run('--auth', 'api-key', '--api-key-file', s.key);
  assert.equal((await stat(s.file)).mode & 0o777, 0o600);
  const contents = await readFile(s.file, 'utf8');
  assert.ok(!contents.includes('fixture-api-key'));
  const connection = readConnection(s.env);
  assert.equal(museEnvironment(s.env, connection).META_API_KEY, 'fixture-api-key');
  assert.equal(museEnvironment({}, connection).META_API_KEY, 'fixture-api-key');
  assert.equal(JSON.stringify(connection), '{"mode":"api-key"}');
  assert.equal(s.env.META_API_KEY, 'ambient-key-must-not-win');
  const before = (await stat(s.file)).mtimeMs;
  const result = await s.run();
  assert.match(result.stdout, /pay-as-you-go/);
  assert.equal((await stat(s.file)).mtimeMs, before);
});

test('missing, empty, and world-readable API keys fail without an account fallback', async t => {
  const s = await setup(t);
  const config = { version: 1, mode: 'api-key', api_key_file: s.key };
  await chmod(s.key, 0o644);
  assert.throws(() => resolveConnection(config), /No account fallback/);
  await chmod(s.key, 0o600);
  await writeFile(s.key, '');
  assert.throws(() => resolveConnection(config), /No account fallback/);
  await rm(s.key);
  assert.throws(() => resolveConnection(config), /No account fallback/);
  await assert.rejects(s.run('--auth', 'api-key', '--api-key-file', s.key));
  await assert.rejects(access(s.file));
});

test('API mode requires a file even when META_API_KEY is present; conflicting login fails', async t => {
  const s = await setup(t);
  await assert.rejects(s.run('--auth', 'api-key'), /requires --api-key-file/);
  await assert.rejects(s.run('--api-key-file', s.key), /requires --auth/);
  await assert.rejects(s.run('--auth', 'api-key', '--api-key-file', s.key, '--login'), /cannot be used/);
  await assert.rejects(access(s.file));
});

test('switching back to account preserves the key file and clears the saved key reference', async t => {
  const s = await setup(t);
  await s.run('--auth', 'api-key', '--api-key-file', s.key);
  await s.run('--auth', 'account');
  assert.deepEqual(readConfig(s.env), { version: 1, mode: 'account' });
  assert.equal(await readFile(s.key, 'utf8'), 'fixture-api-key\n');
  assert.equal(museEnvironment(s.env, readConnection(s.env)).META_API_KEY, undefined);
});

test('malformed and unknown settings are never overwritten or reported verbatim', async t => {
  const s = await setup(t);
  await s.run('--auth', 'api-key', '--api-key-file', s.key);
  await writeFile(s.file, '{secret-should-not-be-reported');
  await assert.rejects(s.run('--auth', 'account'), error => /Invalid JSON/.test(error.stderr) && !error.stderr.includes('secret-should-not-be-reported'));
  assert.equal(await readFile(s.file, 'utf8'), '{secret-should-not-be-reported');
  await writeFile(s.file, JSON.stringify({ version: 1, mode: 'account', api_key: 'secret' }));
  assert.throws(() => readConnection(s.env), /Invalid bridge connection/);
});
