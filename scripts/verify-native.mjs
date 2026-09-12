// Explicit live acceptance test: uses the configured Muse account/API mode.
// Codex runs against an ephemeral local endpoint; no saved Codex settings change.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNativeServer } from '../src/native-server.mjs';
import { makeCatalog } from '../src/native-catalog.mjs';
import { readConnection } from '../src/auth.mjs';
import { MuseHost } from '../src/msp.mjs';

const dir = await mkdtemp(join(tmpdir(), 'codex-muse-acceptance-'));
const host = new MuseHost(); let models;
try { await host.start(); models = (await host.request('model/list', {})).models.map(x => x.modelId); } finally { host.close(); }
const model = process.env.MUSE_NATIVE_TEST_MODEL || models[0];
if (!models.includes(model)) throw new Error('Test model is not in Muse catalog.');
const token = randomBytes(32).toString('hex');
const server = createNativeServer({ token, models: [model], connection: readConnection() });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
const catalog = join(dir, 'models.json');
await writeFile(catalog, JSON.stringify(makeCatalog([model])));
const args = ['app-server', '-c', `model=${JSON.stringify(model)}`, '-c', 'model_provider="muse_acceptance"', '-c', `model_catalog_json=${JSON.stringify(catalog)}`, '-c', `model_providers.muse_acceptance={name="Muse acceptance",base_url="http://127.0.0.1:${port}/v1",experimental_bearer_token="${token}",wire_api="responses",request_max_retries=0,stream_max_retries=0}`, '-c', 'web_search="disabled"'];
const child = spawn(process.env.MUSE_NATIVE_CODEX_BIN || 'codex', args, { cwd: dir, stdio: ['pipe', 'pipe', 'pipe'] });
const pending = new Map(); let id = 0, buffer = '', diagnostics = '', toolCalls = 0, final = '', completed;
const marker = `CODEX_MUSE_${randomBytes(8).toString('hex')}`;
const done = new Promise((resolve, reject) => { completed = { resolve, reject }; });
done.catch(() => {});
const send = message => child.stdin.write(JSON.stringify(message) + '\n');
const request = (method, params) => new Promise((resolve, reject) => { const n = ++id; pending.set(n, { resolve, reject }); send({ id: n, method, params }); });
child.stderr.on('data', data => { if (diagnostics.length < 4000) diagnostics += data.toString().replaceAll(token, '[local token]'); });
child.stdout.setEncoding('utf8');
child.stdout.on('data', data => {
  buffer += data; let i;
  while ((i = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
    let event; try { event = JSON.parse(line); } catch { continue; }
    if (event.method && event.id !== undefined) {
      if (event.method === 'item/tool/call' && event.params.tool === 'codex_probe') {
        toolCalls++; send({ id: event.id, result: { contentItems: [{ type: 'inputText', text: marker }], success: true } });
      } else send({ id: event.id, error: { code: -32601, message: 'Unexpected test client request' } });
    } else if (pending.has(event.id)) {
      const p = pending.get(event.id); pending.delete(event.id);
      event.error ? p.reject(new Error(event.error.message)) : p.resolve(event.result);
    } else if (event.method === 'item/agentMessage/delta') final += event.params.delta;
    else if (event.method === 'turn/completed') completed.resolve(event.params.turn);
    else if (event.method === 'error') console.log('Codex error:', event.params.error?.message);
  }
});
child.on('exit', () => { const error = new Error('Codex process exited. ' + diagnostics); for (const p of pending.values()) p.reject(error); completed.reject(error); });
const timer = setTimeout(() => completed.reject(new Error('Acceptance test timed out.')), 240000);
try {
  await request('initialize', { clientInfo: { name: 'muse_native_acceptance', version: '0.1.0' }, capabilities: { experimentalApi: true } });
  send({ method: 'initialized', params: {} });
  const list = await request('model/list', { includeHidden: false });
  if (!list.data.some(x => x.model === model)) throw new Error('Custom model not discovered by Codex.');
  console.log('Codex model/list discovered:', model);
  const start = await request('thread/start', { model, modelProvider: 'muse_acceptance', cwd: dir, approvalPolicy: 'never', sandbox: 'workspace-write', ephemeral: true, dynamicTools: [{ name: 'codex_probe', description: 'Return the opaque marker used to verify this adapter. Call exactly once.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } }] });
  await request('turn/start', { threadId: start.thread.id, input: [{ type: 'text', text: 'Call codex_probe exactly once. Then reply with the exact marker it returned. Do not use other tools or invent the result.' }], effort: 'low' });
  const turn = await done;
  if (turn.status !== 'completed' || toolCalls !== 1 || !final.includes(marker)) throw new Error(`Tool round trip failed: status=${turn.status}, calls=${toolCalls}, answer=${final.slice(0,200)}`);
  console.log('PASS: live Muse → Codex dynamic tool → live Muse answer, with verified opaque marker.');
  const cancelled = new Promise((resolve, reject) => { completed = { resolve, reject }; });
  const second = await request('turn/start', { threadId: start.thread.id, input: [{ type: 'text', text: 'Explain in detail how you would test a text protocol adapter. Do not call tools.' }], effort: 'low' });
  let active = false;
  for (let i = 0; !active && i < 100; i++) {
    const health = await (await fetch(`http://127.0.0.1:${port}/health`, { headers: { Authorization: `Bearer ${token}` } })).json();
    active = health.active > 0;
    if (!active) await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (!active) throw new Error('No active model request observed for cancellation test.');
  await request('turn/interrupt', { threadId: start.thread.id, turnId: second.turn.id });
  const interrupted = await cancelled;
  if (interrupted.status !== 'interrupted') throw new Error('Codex did not report interruption.');
  for (let i = 0; active && i < 100; i++) {
    const health = await (await fetch(`http://127.0.0.1:${port}/health`, { headers: { Authorization: `Bearer ${token}` } })).json();
    active = health.active > 0;
    if (active) await new Promise(resolve => setTimeout(resolve, 50));
  }
  if (active) throw new Error('Muse provider retained cancelled work.');
  console.log('PASS: Codex interruption cancelled the active Muse provider request.');
} finally { clearTimeout(timer); child.kill('SIGTERM'); await server.stop(); await rm(dir, { recursive: true, force: true }); }
