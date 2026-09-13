// Real Codex processes, local fixture model endpoints only. No account or API use.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNativeServer } from '../src/native-server.mjs';
import { createAdditiveRuntime } from '../src/additive-runtime.mjs';
import { makeCatalog } from '../src/native-catalog.mjs';
import { NativeError } from '../src/native-protocol.mjs';
import { museProvider } from '../src/additive-catalog.mjs';

const executable = process.env.MUSE_ADDITIVE_TEST_CODEX_BIN;
test('real app-server: additive discovery, isolated routes, switches, history, fork and restart', { skip: !executable, timeout: 90000 }, async t => {
  const dir = await mkdtemp(join(tmpdir(), 'muse-additive-acceptance-'));
  await mkdir(join(dir, 'home'));
  const seen = [], token = 'test-token-'.repeat(5);
  let museModels = [{ modelId: 'meta-fixture-1', displayName: 'Meta Fixture' }];
  let discoveryFails = false, cancelled = false;
  const runner = provider => async (request, { signal }) => {
    seen.push({ provider, model: request.model, history: JSON.stringify(request.input) });
    if (JSON.stringify(request.input.filter(x => x.role === 'user').at(-1)).includes('FAIL_PROVIDER_NOW')) throw new NativeError('Fixture model did not complete. No fallback.', 502);
    if (JSON.stringify(request.input.filter(x => x.role === 'user').at(-1)).includes('WAIT_FOR_INTERRUPT')) {
      return new Promise((resolve, reject) => signal.addEventListener('abort', () => { cancelled = true; reject(new Error('cancelled')); }, { once: true }));
    }
    const marker = `tool-evidence-${provider}`;
    if (!JSON.stringify(request.input).includes(marker)) return JSON.stringify({ kind: 'tool_call', name: 'codex_probe', arguments: { provider } });
    return JSON.stringify({ kind: 'message', text: marker });
  };
  const openai = createNativeServer({ token, models: ['openai-fixture-1', 'openai-fixture-2'], connection: { mode: 'account' }, runner: runner('openai') });
  await new Promise(r => openai.listen(0, '127.0.0.1', r));
  const catalogPath = join(dir, 'openai.json');
  await writeFile(catalogPath, JSON.stringify(makeCatalog(['openai-fixture-1'])));
  const config = `model = "openai-fixture-1"\nmodel_provider = "fixture_openai"\nmodel_catalog_json = ${JSON.stringify(catalogPath)}\nweb_search = "disabled"\n[model_providers.fixture_openai]\nname = "OpenAI fixture"\nbase_url = "http://127.0.0.1:${openai.address().port}/v1"\nexperimental_bearer_token = "${token}"\nrequires_openai_auth = false\nsupports_websockets = false\nwire_api = "responses"\nrequest_max_retries = 0\nstream_max_retries = 0\n`;
  const configPath = join(dir, 'home/config.toml'); await writeFile(configPath, config);
  // Pin fixtures at the command line as well: no user/global config discovery can
  // redirect an acceptance test to a paid endpoint.
  const args = ['app-server', '-c', 'model_provider="fixture_openai"', '-c', 'model="openai-fixture-1"',
    '-c', `model_catalog_json=${JSON.stringify(catalogPath)}`, '-c', 'web_search="disabled"',
    '-c', `model_providers.fixture_openai={name="Fixture",base_url="http://127.0.0.1:${openai.address().port}/v1",experimental_bearer_token="${token}",requires_openai_auth=false,supports_websockets=false,wire_api="responses",request_max_retries=0,stream_max_retries=0}`];
  const env = { ...process.env, CODEX_HOME: join(dir, 'home') }; delete env.OPENAI_API_KEY;
  let runtime, seq = 0;
  const pending = new Map(), turns = new Map(), waiting = new Map(), answers = new Map(), settings = new Map();
  const emit = m => {
    if (m.method && m.id !== undefined) {
      if (m.method === 'item/tool/call' && m.params.tool === 'codex_probe') {
        const provider = m.params.arguments.provider;
        runtime.router.receive({ id: m.id, result: { success: true, contentItems: [{ type: 'inputText', text: `tool-evidence-${provider}` }] } });
      } else runtime.router.receive({ id: m.id, error: { code: -32601, message: 'Unexpected fixture client request' } });
    } else if (m.id !== undefined && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id); clearTimeout(p.timer);
      m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
    } else if (m.method === 'turn/completed') {
      const key = m.params.turn.id; turns.set(key, m.params.turn); waiting.get(key)?.(m.params.turn);
    } else if (m.method === 'item/agentMessage/delta') answers.set(m.params.threadId, (answers.get(m.params.threadId) || '') + m.params.delta);
    else if (m.method === 'thread/settings/updated') settings.set(m.params.threadId, m.params.threadSettings);
  };
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq, timer = setTimeout(() => reject(new Error(`Timeout ${method}`)), 20000);
    pending.set(id, { resolve, reject, timer }); void runtime.router.receive({ id, method, params });
  });
  const boot = async () => {
    runtime = await createAdditiveRuntime({ executable, args, env, hostProvider: 'fixture_openai', cwd: dir, stateRoot: join(dir, 'state'), emit,
      connection: { mode: 'account' }, runner: runner('muse'), discover: async () => { if (discoveryFails) throw new Error('offline'); return museModels; },
    });
    await request('initialize', { clientInfo: { name: 'muse_additive_fixture', version: '0.1.0' }, capabilities: { experimentalApi: true } });
    await runtime.router.receive({ method: 'initialized', params: {} });
  };
  const turn = async (threadId, model, text = 'Run the probe tool and report its evidence.') => {
    const started = await request('turn/start', { threadId, model, input: [{ type: 'text', text }], effort: 'low' });
    const result = turns.get(started.turn.id) || await new Promise(resolve => waiting.set(started.turn.id, resolve));
    assert.equal(result.status, 'completed', JSON.stringify(result.error)); return result;
  };
  const create = model => request('thread/start', { model, cwd: dir, approvalPolicy: 'never', sandbox: 'read-only', dynamicTools: [{ name: 'codex_probe', description: 'Return provider-specific opaque evidence.', inputSchema: { type: 'object', properties: { provider: { type: 'string' } }, required: ['provider'], additionalProperties: false } }] });
  const waitForSettings = async (id, model) => {
    for (let i = 0; settings.get(id)?.model !== model && i < 200; i++) await new Promise(r => setTimeout(r, 10));
    assert.equal(settings.get(id)?.model, model);
  };
  t.after(async () => {
    for (const p of pending.values()) clearTimeout(p.timer);
    await runtime?.stop(); await openai.stop(); await rm(dir, { recursive: true, force: true });
  });
  await boot();
  const list = await request('model/list');
  assert.deepEqual(list.data.map(x => x.model), ['openai-fixture-1', 'muse/meta-fixture-1']);
  assert.equal(list.data[0].isDefault, true); assert.equal(list.data[1].isDefault, false);
  // Replay the exact desktop new-chat picker RPC (model + effort in one batch).
  const saveModel = (model, effort) => request('config/batchWrite', { edits: [
    { keyPath: 'model', value: model, mergeStrategy: 'upsert' },
    { keyPath: 'model_reasoning_effort', value: effort, mergeStrategy: 'upsert' },
  ], filePath: null, expectedVersion: null, reloadUserConfig: true });
  const saved = await saveModel('muse/meta-fixture-1', 'low');
  assert.equal(saved.status, 'ok'); assert.equal(saved.filePath, join(dir, 'state/preferences.json'));
  const selected = await request('config/read', { includeLayers: true, cwd: dir });
  assert.equal(selected.config.model, 'muse/meta-fixture-1'); assert.equal(selected.config.model_reasoning_effort, 'low');
  assert.equal(selected.config.model_provider, 'fixture_openai');
  assert.equal(selected.origins.model.version, saved.version);
  assert.equal(selected.layers.find(l => l.name.type === 'user').config.model, 'openai-fixture-1');
  assert.equal(await readFile(configPath, 'utf8'), config);
  const a = await create('openai-fixture-1'); const b = await create(null);
  assert.equal(a.modelProvider, 'fixture_openai'); assert.equal(b.modelProvider, museProvider);
  assert.equal(b.model, 'muse/meta-fixture-1');
  assert.equal(b.reasoningEffort, 'low');
  await Promise.all([turn(a.thread.id, 'openai-fixture-1'), turn(b.thread.id, 'muse/meta-fixture-1')]);
  assert.match(answers.get(a.thread.id), /tool-evidence-openai/); assert.match(answers.get(b.thread.id), /tool-evidence-muse/);
  assert.ok(seen.filter(x => x.provider === 'openai').every(x => x.model.startsWith('openai-')));
  assert.ok(seen.filter(x => x.provider === 'muse').every(x => x.model.startsWith('meta-')));
  // The same task, with the full earlier conversation, switches providers twice.
  // Existing-chat picker uses thread/settings/update, then can omit turn.model.
  await request('thread/settings/update', { threadId: a.thread.id, model: 'muse/meta-fixture-1', effort: 'low', multiAgentMode: 'explicitRequestOnly' });
  await waitForSettings(a.thread.id, 'muse/meta-fixture-1');
  assert.equal(settings.get(a.thread.id).model, 'muse/meta-fixture-1');
  assert.equal(settings.get(a.thread.id).collaborationMode.settings.model, 'muse/meta-fixture-1');
  assert.equal(settings.get(a.thread.id).modelProvider, museProvider);
  await turn(a.thread.id, undefined, 'Remember original-history-marker. Continue.');
  assert.equal(seen.at(-1).provider, 'muse'); assert.match(seen.at(-1).history, /tool-evidence-openai/);
  await request('thread/settings/update', { threadId: a.thread.id, model: 'openai-fixture-1', effort: 'low' });
  await waitForSettings(a.thread.id, 'openai-fixture-1');
  assert.equal(settings.get(a.thread.id).model, 'openai-fixture-1');
  assert.equal(settings.get(a.thread.id).modelProvider, 'fixture_openai');
  await turn(a.thread.id, undefined, 'Continue after provider switch.');
  assert.equal(seen.at(-1).provider, 'openai'); assert.match(seen.at(-1).history, /original-history-marker/);
  // A newly discovered Muse ID is accepted without editing installed settings.
  museModels = [...museModels, { modelId: 'future-arbitrary-model' }]; await runtime.catalog.refresh();
  assert.ok((await request('model/list')).data.some(x => x.model === 'muse/future-arbitrary-model'));
  await turn(b.thread.id, 'muse/future-arbitrary-model'); assert.equal(seen.at(-1).model, 'future-arbitrary-model');
  const fork = await request('thread/fork', { threadId: b.thread.id });
  assert.equal(fork.modelProvider, museProvider); await turn(fork.thread.id, undefined);
  assert.equal(seen.at(-1).provider, 'muse');
  await runtime.stop(); runtime = null; await boot();
  assert.equal((await request('config/read')).config.model, 'muse/meta-fixture-1');
  const afterRestart = await create(null); await turn(afterRestart.thread.id, undefined);
  assert.equal(seen.at(-1).provider, 'muse'); assert.equal(seen.at(-1).model, 'meta-fixture-1');
  // A Muse default does not change the provider of an existing OpenAI task.
  await turn(a.thread.id, undefined); assert.equal(seen.at(-1).provider, 'openai');
  await saveModel('openai-fixture-1', 'low');
  assert.equal((await request('config/read')).config.model, 'openai-fixture-1');
  const resumed = await request('thread/resume', { threadId: b.thread.id });
  assert.equal(resumed.modelProvider, museProvider); await turn(b.thread.id, undefined);
  assert.equal(seen.at(-1).model, 'future-arbitrary-model');
  const failed = await request('turn/start', { threadId: b.thread.id, model: 'muse/future-arbitrary-model', effort: 'low', input: [{ type: 'text', text: 'FAIL_PROVIDER_NOW' }] });
  const failure = turns.get(failed.turn.id) || await new Promise(resolve => waiting.set(failed.turn.id, resolve));
  assert.equal(failure.status, 'failed'); assert.match(failure.error.message, /Fixture model did not complete/);
  const waitingTurn = await request('turn/start', { threadId: b.thread.id, model: 'muse/future-arbitrary-model', effort: 'low', input: [{ type: 'text', text: 'WAIT_FOR_INTERRUPT' }] });
  for (let i = 0; !seen.at(-1).history.includes('WAIT_FOR_INTERRUPT') && i < 100; i++) await new Promise(r => setTimeout(r, 10));
  assert.match(seen.at(-1).history, /WAIT_FOR_INTERRUPT/);
  // Viewing/resuming an active task must not restart its worker.
  await request('thread/resume', { threadId: b.thread.id });
  await assert.rejects(request('turn/start', { threadId: b.thread.id, model: 'openai-fixture-1', input: [{ type: 'text', text: 'switch' }] }), /interrupt the current turn/);
  await request('turn/interrupt', { threadId: b.thread.id, turnId: waitingTurn.turn.id });
  for (let i = 0; (!cancelled || !turns.has(waitingTurn.turn.id)) && i < 100; i++) await new Promise(r => setTimeout(r, 10));
  assert.equal(cancelled, true); assert.equal(turns.get(waitingTurn.turn.id).status, 'interrupted');
  museModels = museModels.slice(0, 1); await runtime.catalog.refresh();
  const before = seen.length;
  await assert.rejects(turn(b.thread.id, 'muse/future-arbitrary-model'), /not in the current account catalog/);
  assert.equal(seen.length, before);
  await saveModel('muse/meta-fixture-1', 'low');
  discoveryFails = true; await runtime.catalog.refresh();
  await turn(a.thread.id, 'openai-fixture-1'); assert.equal(seen.at(-1).provider, 'openai');
  await assert.rejects(turn(b.thread.id, 'muse/meta-fixture-1'), /discovery failed/);
  const countBeforeUnavailableDefault = seen.length;
  await assert.rejects(create(null), /discovery failed/);
  assert.equal(seen.length, countBeforeUnavailableDefault);
  await assert.rejects(saveModel('muse/meta-fixture-1', 'low'), /discovery failed/);
  await assert.rejects(request('config/value/write', { keyPath: 'model_provider', value: museProvider, mergeStrategy: 'replace' }), /Global provider/);
  await saveModel('openai-fixture-1', 'low');
  assert.equal((await request('config/read')).config.model, 'openai-fixture-1');
  for (let i = 0; i < 5; i++) {
    const extra = await create(null); await turn(extra.thread.id, undefined);
    assert.ok([...runtime.router.workers.values()].filter(s => !s.peer.closed).length <= 4);
  }
  // An evicted saved task is resumed lazily, retaining its history and provider.
  await turn(a.thread.id, undefined); assert.equal(seen.at(-1).provider, 'openai');
  assert.match(seen.at(-1).history, /original-history-marker/);
  assert.equal(await readFile(configPath, 'utf8'), config);
});
