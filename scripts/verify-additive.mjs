// Explicit live Muse smoke test. OpenAI discovery is read-only; no OpenAI generation.
// An ephemeral task and temporary routing state leave saved provider settings alone.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAdditiveRuntime } from '../src/additive-runtime.mjs';
import { museProvider } from '../src/additive-catalog.mjs';

const executable = process.env.MUSE_ADDITIVE_CODEX_BIN;
if (!executable?.startsWith('/')) throw new Error('Set MUSE_ADDITIVE_CODEX_BIN to the real Codex executable. This test spends a small amount of Muse usage.');
const root = await mkdtemp(join(tmpdir(), 'muse-additive-live-'));
const pending = new Map(); let runtime, seq = 0, calls = 0, answer = '', finish;
const marker = `ADDITIVE_${randomUUID()}`;
const done = new Promise((resolve, reject) => { finish = { resolve, reject }; }); done.catch(() => {});
const deadline = setTimeout(() => finish.reject(new Error('Live Muse smoke test timed out.')), 180000);
const emit = message => {
  if (message.method && message.id !== undefined) {
    if (message.method === 'item/tool/call' && message.params.tool === 'codex_probe') {
      calls++; void runtime.router.receive({ id: message.id, result: { contentItems: [{ type: 'inputText', text: marker }], success: true } });
    } else void runtime.router.receive({ id: message.id, error: { code: -32601, message: 'Unexpected smoke-test client request' } });
  } else if (pending.has(message.id)) {
    const p = pending.get(message.id); pending.delete(message.id);
    message.error ? p.reject(new Error(message.error.message)) : p.resolve(message.result);
  } else if (message.method === 'item/agentMessage/delta') answer += message.params.delta;
  else if (message.method === 'turn/completed') finish.resolve(message.params.turn);
};
const request = (method, params) => new Promise((resolve, reject) => {
  const id = ++seq; pending.set(id, { resolve, reject }); void runtime.router.receive({ id, method, params });
});
try {
  runtime = await createAdditiveRuntime({ executable, args: ['-c', 'features.code_mode_host=true', 'app-server'], stateRoot: root, cwd: root, emit });
  await request('initialize', { clientInfo: { name: 'muse_additive_live_test', version: '0.1.0' }, capabilities: { experimentalApi: true } });
  await runtime.router.receive({ method: 'initialized', params: {} });
  const host = await runtime.router.coordinator.request('model/list', { includeHidden: false, limit: 100 });
  const merged = await request('model/list', { includeHidden: false, limit: 100 });
  for (const model of host.data) assert.deepEqual(merged.data.find(m => m.model === model.model), model);
  assert.equal(merged.data.find(m => m.isDefault)?.model, host.data.find(m => m.isDefault)?.model);
  const preferred = runtime.catalog.models.find(m => m.isDefault)?.modelId;
  const model = process.env.MUSE_ADDITIVE_TEST_MODEL || (preferred ? `muse/${preferred}` : merged.data.find(m => m.model.startsWith('muse/'))?.model);
  assert.ok(merged.data.some(m => m.model === model), 'Select an available namespaced Muse model.');
  assert.ok(model.startsWith('muse/'), 'This test only spends Muse usage.');
  console.log(`Preserved ${host.data.length} OpenAI models and their default. Testing ${model}.`);
  const original = (await runtime.router.coordinator.request('config/read', {})).config;
  const saveModel = (model, effort) => request('config/batchWrite', { edits: [
    { keyPath: 'model', value: model, mergeStrategy: 'upsert' },
    { keyPath: 'model_reasoning_effort', value: effort, mergeStrategy: 'upsert' },
  ], filePath: null, expectedVersion: null, reloadUserConfig: true });
  assert.equal((await saveModel(model, 'low')).status, 'ok');
  assert.equal((await request('config/read', {})).config.model, model);
  const start = await request('thread/start', { cwd: root, ephemeral: true, approvalPolicy: 'never', sandbox: 'read-only', dynamicTools: [{ name: 'codex_probe', description: 'Return the opaque verification marker. Call exactly once.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }] });
  assert.equal(start.modelProvider, museProvider);
  assert.equal(start.model, model); assert.equal(start.reasoningEffort, 'low');
  await request('turn/start', { threadId: start.thread.id, effort: 'low', input: [{ type: 'text', text: 'Call codex_probe exactly once. Then reply with the exact marker it returned. Do not use other tools or invent the marker.' }] });
  const turn = await done;
  assert.equal(turn.status, 'completed', JSON.stringify(turn.error)); assert.equal(calls, 1); assert.ok(answer.includes(marker));
  await saveModel(host.data.find(m => m.isDefault).model, 'low');
  assert.equal((await request('config/read', {})).config.model, host.data.find(m => m.isDefault).model);
  const unchanged = (await runtime.router.coordinator.request('config/read', {})).config;
  for (const key of ['model', 'model_reasoning_effort', 'model_provider', 'model_catalog_json']) assert.equal(unchanged[key], original[key]);
  console.log('PASS: desktop preference save → new Muse task → real Codex host tool → live Muse answer → OpenAI preference restored. Original OpenAI catalog/default preserved.');
} finally { clearTimeout(deadline); await runtime?.stop(); await rm(root, { recursive: true, force: true }); }
