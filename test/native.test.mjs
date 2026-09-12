import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRequest, parseMuseOutput, responseObject, responseEvents } from '../src/native-protocol.mjs';
import { createNativeServer } from '../src/native-server.mjs';
import { enableConfig, disableConfig } from '../src/native-config.mjs';

const model = 'muse-test';
const base = { model, input: 'Hello', tools: [{ type: 'function', name: 'probe', parameters: { type: 'object' } }] };
test('native provider preserves history, namespace calls and freeform input', () => {
  const r = normalizeRequest({ ...base, input: [{ role: 'user', content: [{ type: 'input_text', text: 'hello' }] }, { type: 'function_call_output', call_id: 'c', output: 'evidence' }], tools: [{ type: 'namespace', name: 'functions', tools: [{ type: 'custom', name: 'exec' }] }] }, [model]);
  assert.equal(r.input[1].output, 'evidence');
  const out = parseMuseOutput(JSON.stringify({ kind: 'tool_call', name: 'functions.exec', input: 'text(1)' }), r);
  assert.equal(out.namespace, 'functions'); assert.equal(out.name, 'exec'); assert.equal(out.input, 'text(1)');
  const events = responseEvents(responseObject(model, out));
  assert.equal(events.at(-1).type, 'response.completed');
  assert.equal(events.find(x => x.type === 'response.custom_tool_call_input.delta').delta, 'text(1)');
});

test('native provider rejects unsupported inputs and unoffered tool calls', () => {
  for (const override of [{ model: 'gpt-6-astra' }, { previous_response_id: 'x' }, { tools: [{ type: 'web_search' }] }, { input: [{ role: 'user', content: [{ type: 'input_image', image_url: 'data:...' }] }] }]) assert.throws(() => normalizeRequest({ ...base, ...override }, [model]));
  const r = normalizeRequest(base, [model]);
  assert.throws(() => normalizeRequest({ ...base, input: [{ type: 'function_call_output', call_id: 'x', output: [{ type: 'input_image', image_url: 'data:...' }] }] }, [model]), /cannot consume/);
  assert.throws(() => parseMuseOutput('{"kind":"tool_call","name":"unoffered","arguments":{}}', r));
  assert.throws(() => parseMuseOutput('partial prose', r));
  assert.throws(() => parseMuseOutput('{"kind":"message","text":"done"}', { ...r, toolChoice: 'required' }));
});

test('native config enable/disable preserves unrelated settings and refuses conflicts', () => {
  const original = '# My config\nmodel = "astra" # choice\nmodel_provider = "openai"\n\n[features]\nmulti_agent = true\n';
  const next = enableConfig(original, { model, catalogPath: '/tmp/catalog.json', port: 47831, token: 'x'.repeat(32) });
  assert.match(next.text, /model_provider = "muse_bridge"/);
  assert.equal(disableConfig(next.text, next.restore), original);
  const edited = next.text.replace('multi_agent = true', 'multi_agent = false');
  assert.match(disableConfig(edited, next.restore), /multi_agent = false/);
  assert.throws(() => enableConfig(next.text, {}));
  assert.throws(() => disableConfig(next.text.replace('port=foo', 'nope').replace('"muse_bridge"', '"other"'), next.restore));
});

test('HTTP native protocol performs a tool round trip, protects local endpoint and cancels work', async () => {
  const token = 'b'.repeat(64); let calls = 0, cancelled = false;
  const server = createNativeServer({ token, models: [model], connection: { mode: 'account' }, runner: async (request, { signal }) => {
    calls++;
    if (request.input[0].content === 'wait') return new Promise((resolve, reject) => signal.addEventListener('abort', () => { cancelled = true; reject(new Error('abort')); }));
    return request.input.some(x => x.type === 'function_call_output') ? '{"kind":"message","text":"verified evidence"}' : '{"kind":"tool_call","name":"probe","arguments":{}}';
  } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  try {
    assert.equal((await fetch(url + '/health')).status, 401);
    assert.equal((await fetch(url + '/health', { headers: { ...headers, Origin: 'https://example.com' } })).status, 403);
    const out = await (await fetch(url + '/v1/responses', { method: 'POST', headers, body: JSON.stringify(base) })).json();
    assert.equal(out.output[0].type, 'function_call');
    const next = { ...base, input: [{ role: 'user', content: 'hello' }, out.output[0], { type: 'function_call_output', call_id: out.output[0].call_id, output: 'evidence' }], stream: true };
    const stream = await (await fetch(url + '/v1/responses', { method: 'POST', headers, body: JSON.stringify(next) })).text();
    assert.match(stream, /response.completed/); assert.match(stream, /verified evidence/);
    const controller = new AbortController();
    const waiting = await fetch(url + '/v1/responses', { method: 'POST', headers, body: JSON.stringify({ ...base, input: 'wait', stream: true }), signal: controller.signal });
    controller.abort(); await waiting.text().catch(() => {});
    for (let i = 0; !cancelled && i < 30; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(cancelled, true); assert.equal(calls, 3);
  } finally { await server.stop(); }
});
