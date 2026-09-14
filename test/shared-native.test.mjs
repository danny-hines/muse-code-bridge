import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { createSharedRuntime } from '../src/shared-runtime.mjs';
import { CodexProcess } from '../src/codex-process.mjs';
import { makeCatalog } from '../src/native-catalog.mjs';
import { responseObject, responseEvents } from '../src/native-protocol.mjs';

const executable = process.env.MUSE_SHARED_TEST_CODEX || '/Applications/ChatGPT.app/Contents/Resources/codex';
let available = false; try { await access(executable); available = process.env.MUSE_SHARED_NATIVE_TEST === '1'; } catch {}
test('installed native server: one task server, live catalog, host tool roundtrip, provider switches and stock recovery', { skip: !available, timeout: 30000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'muse-shared-native-'));
  const calls = [], muse = [];
  const server = http.createServer((req, res) => {
    calls.push({ http: req.url });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(makeCatalog(['openai-fixture'])));
  });
  const wss = new WebSocketServer({ server, path: '/openai/responses' });
  wss.on('connection', socket => socket.on('message', raw => {
    const body = JSON.parse(raw.toString()); calls.push({ model: body.model });
    const response = responseObject(body.model, { id: 'msg_native_' + calls.length, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'OpenAI fixture reply', annotations: [] }] });
    for (const event of responseEvents(response)) socket.send(JSON.stringify(event));
  }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const enc = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = enc({ alg: 'RS256', typ: 'JWT' }) + '.' + enc({ sub: 'fixture-user', email: 'fixture@example.invalid', exp: Math.floor(Date.now() / 1000) + 86400,
    'https://api.openai.com/auth': { chatgpt_account_id: 'fixture-account', chatgpt_user_id: 'fixture-user', chatgpt_plan_type: 'plus' } }) + '.fixture-signature';
  await writeFile(join(root, 'auth.json'), JSON.stringify({ auth_mode: 'chatgpt', tokens: { id_token: token, access_token: token, refresh_token: 'fixture-refresh', account_id: 'fixture-account' }, last_refresh: new Date().toISOString() }), { mode: 0o600 });
  const config = 'model = "openai-fixture"\n'; await writeFile(join(root, 'config.toml'), config);
  const args = ['app-server', '-c', `openai_base_url=${JSON.stringify(base + '/openai')}`, '-c', `chatgpt_base_url=${JSON.stringify(base + '/chatgpt')}`,
    '-c', 'analytics.enabled=false', '-c', 'features.plugins=false', '-c', 'features.apps=false'];
  const env = { ...process.env, CODEX_HOME: root, CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED: '1' }; delete env.OPENAI_API_KEY; delete env.OPENAI_BASE_URL;
  const replies = new Map(); let seq = 0, completed, runtime, stock;
  t.after(async () => { await runtime?.stop(); await stock?.stop(); for (const c of wss.clients) c.terminate(); wss.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  let toolSent = false;
  runtime = await createSharedRuntime({ executable, args, stateRoot: join(root, 'bridge'), env, cwd: root, allowInsecureLocalhost: true,
    discover: async () => [{ modelId: 'fixture', displayLabel: 'Muse fixture' }], connection: { mode: 'account' },
    runner: async request => {
      muse.push(request);
      if (!toolSent) {
        const tool = request.tools.find(t => t.name === 'exec_command');
        assert.ok(tool, 'native shell tool is offered'); toolSent = true;
        return JSON.stringify({ kind: 'tool_call', name: tool.key, arguments: { cmd: 'printf gateway-tool-fixture', max_output_tokens: 100 } });
      }
      assert.ok(request.input.some(i => i.type === 'function_call_output' && i.output.includes('gateway-tool-fixture')), 'native tool result returned to Muse');
      return JSON.stringify({ kind: 'message', text: 'Muse fixture with verified native tool result' });
    },
    emit: message => {
      if (message.id !== undefined && !message.method) { replies.get(message.id)?.(message); replies.delete(message.id); }
      if (message.method === 'turn/completed') completed?.(message.params.turn);
    },
  });
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq; replies.set(id, message => message.error ? reject(new Error(message.error.message)) : resolve(message.result)); void runtime.receive({ id, method, params });
  });
  await request('initialize', { clientInfo: { name: 'shared_native_test', version: '1' }, capabilities: { experimentalApi: true } });
  await runtime.receive({ method: 'initialized', params: {} });
  assert.equal((await request('account/read')).account.type, 'chatgpt');
  // Native refresh is asynchronous when a standard catalog is already cached.
  let models;
  for (let i = 0; i < 40; i++) {
    models = (await request('model/list')).data.map(m => m.model);
    if (models.includes('muse/fixture')) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.deepEqual(models, ['openai-fixture', 'muse/fixture']);
  // A direct native call, like Remote, sees the same merged catalog.
  assert.deepEqual((await runtime.peer.request('model/list', {})).data.map(m => m.model), models);
  await request('config/batchWrite', { edits: [{ keyPath: 'model', value: 'muse/fixture', mergeStrategy: 'upsert' }], reloadUserConfig: true });
  assert.equal((await request('config/read', { includeLayers: true })).config.model, 'muse/fixture');
  assert.equal(await readFile(join(root, 'config.toml'), 'utf8'), config);
  const { thread } = await request('thread/start', { model: 'openai-fixture', cwd: root, ephemeral: true, approvalPolicy: 'never', sandbox: 'read-only' });
  const pid = runtime.peer.child.pid;
  for (const model of ['openai-fixture', 'muse/fixture', 'openai-fixture']) {
    const done = new Promise(resolve => { completed = resolve; });
    await request('turn/start', { threadId: thread.id, model, effort: 'low', input: [{ type: 'text', text: 'Use a fixture reply.' }] });
    const result = await done;
    assert.equal(result.status, 'completed', JSON.stringify(result.error));
    assert.equal(runtime.peer.child.pid, pid);
    // A second native client can inspect the same loaded task without a worker.
    assert.equal((await runtime.peer.request('thread/read', { threadId: thread.id, includeTurns: false })).thread.id, thread.id);
  }
  assert.equal(muse.length, 2); assert.equal(calls.filter(c => c.model?.startsWith('muse/')).length, 0);
  await runtime.stop(); runtime = null;
  stock = new CodexProcess(executable, args, { env, cwd: root, timeoutMs: 10000 });
  await stock.request('initialize', { clientInfo: { name: 'stock_recovery_test', version: '1' }, capabilities: { experimentalApi: true } }); stock.send({ method: 'initialized', params: {} });
  for (let i = 0; i < 40; i++) {
    models = (await stock.request('model/list', {})).data.map(m => m.model);
    if (!models.includes('muse/fixture')) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.deepEqual(models, ['openai-fixture']);
  assert.equal((await stock.request('config/read', {})).config.model, 'openai-fixture');
  assert.equal(await readFile(join(root, 'config.toml'), 'utf8'), config);
});
