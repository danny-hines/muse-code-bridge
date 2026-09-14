import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAdditiveRuntime } from '../src/additive-runtime.mjs';
import { assertStdio } from '../src/additive-cli.mjs';

test('Remote cannot bypass the router through the coordinator or either provider worker', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'muse-additive-remote-'));
  const executable = join(dir, 'codex-fixture'), calls = join(dir, 'calls.jsonl');
  // Real child processes emulate a native server with saved Remote enrollment.
  // Fail if any child can auto-connect, or if Remote setup reaches the server.
  await writeFile(executable, `#!${process.execPath}
const { createInterface } = require('node:readline');
const { appendFileSync } = require('node:fs');
createInterface({ input: process.stdin }).on('line', line => {
  const { id, method, params } = JSON.parse(line);
  if (id === undefined) return;
  appendFileSync(process.env.REMOTE_FIXTURE_CALLS, JSON.stringify({ pid: process.pid, method }) + '\\n');
  let result;
  if (method === 'initialize') result = { remoteDisabled: process.env.CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED };
  else if (method === 'remoteControl/status/read') result = { status: process.env.CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED === '1' ? 'disabled' : 'connected' };
  else if (method === 'thread/start') result = {
    modelProvider: params.modelProvider, model: params.model,
    thread: { id: 'fixture-' + process.pid, ephemeral: true, status: { type: 'idle' }, modelProvider: params.modelProvider },
  };
  else throw new Error('Unexpected fixture request: ' + method);
  process.stdout.write(JSON.stringify({ id, result }) + '\\n');
});
`, { mode: 0o700 });
  const env = { ...process.env, CODEX_HOME: join(dir, 'home'), REMOTE_FIXTURE_CALLS: calls,
    CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED: '0' };
  const replies = new Map(); let seq = 0, runtime;
  t.after(async () => { await runtime?.stop(); await rm(dir, { recursive: true, force: true }); });
  runtime = await createAdditiveRuntime({ executable, stateRoot: join(dir, 'state'), env, cwd: dir,
    connection: { mode: 'account' }, discover: async () => [{ modelId: 'fixture-muse' }],
    emit: message => { if (message.id !== undefined) replies.set(message.id, message); },
  });
  const request = async (method, params = {}) => {
    const id = ++seq; await runtime.router.receive({ id, method, params });
    const response = replies.get(id); replies.delete(id);
    if (response.error) throw new Error(response.error.message);
    return response.result;
  };
  assert.equal((await request('initialize', { clientInfo: { name: 'remote-fixture', version: '1' } })).remoteDisabled, '1');
  await runtime.router.receive({ method: 'initialized', params: {} });
  for (const model of ['host-model', 'muse/fixture-muse']) await request('thread/start', { model, ephemeral: true });
  assert.equal(runtime.router.allPeers.size, 3);
  for (const peer of runtime.router.allPeers) {
    assert.deepEqual(await peer.request('remoteControl/status/read', {}), { status: 'disabled' });
  }
  assert.equal(env.CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED, '0', 'parent environment must be unchanged');
  assert.deepEqual(await request('remoteControl/status/read'), { status: 'disabled' });
  for (const method of ['remoteControl/enable', 'remoteControl/pairing/start']) {
    await assert.rejects(request(method), /Fully quit.*reopen it normally.*Muse MCP/);
  }
  const forwarded = (await readFile(calls, 'utf8')).trim().split('\n').map(line => JSON.parse(line).method);
  assert.equal(forwarded.includes('remoteControl/enable'), false);
  assert.equal(forwarded.includes('remoteControl/pairing/start'), false);
});

test('an explicit Remote CLI launch is rejected before creating any server', () => {
  for (const flag of ['--remote-control', '--remote-control=true']) {
    assert.throws(() => assertStdio(['app-server', flag]), /local tasks only/);
  }
});
