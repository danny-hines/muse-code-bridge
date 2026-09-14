import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { gzipSync } from 'node:zlib';
import { WebSocket, WebSocketServer } from 'ws';
import { createSharedGateway, decodeBody, ResponseHistory } from '../src/shared-gateway.mjs';
import { responseEvents, responseObject } from '../src/native-protocol.mjs';

const message = text => ({ id: 'msg_fixture', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] });
const request = (model, extra = {}) => ({ model, input: [{ role: 'user', content: 'Fixture prompt' }], ...extra });
async function fixture(t, options = {}) {
  const seen = [], muse = [];
  const nativeModel = { slug: 'openai-fixture', display_name: 'OpenAI fixture', priority: 0, base_instructions: 'preserve me', extra_future_field: { enabled: true } };
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks);
    seen.push({ method: req.method, url: req.url, headers: req.headers, raw });
    if (req.url.startsWith('/v1/models')) { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ models: [nativeModel], future_catalog: true })); }
    else {
      const body = JSON.parse(decodeBody(raw, req.headers['content-encoding']));
      const response = responseObject(body.model, message('OpenAI fixture'), 'resp_openai_http');
      res.writeHead(200, { 'content-type': 'text/event-stream', 'x-fixture': 'preserved' });
      for (const event of responseEvents(response)) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      res.end();
    }
  });
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    seen.push({ method: 'UPGRADE', url: req.url, headers: req.headers });
    if (req.headers.authorization === 'Bearer expired-fixture') {
      socket.end('HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Bearer realm="fixture"\r\nContent-Length: 0\r\n\r\n'); return;
    }
    wss.handleUpgrade(req, socket, head, client => {
      client.on('message', raw => {
        const body = JSON.parse(raw.toString()); seen.push({ body });
        const response = responseObject(body.model, message('OpenAI fixture'), 'resp_openai_' + seen.length);
        for (const event of responseEvents(response)) client.send(JSON.stringify(event));
      });
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const gateway = createSharedGateway({ upstream: `http://127.0.0.1:${server.address().port}/v1`, allowInsecureLocalhost: true,
    discover: async () => [{ modelId: 'fixture', displayLabel: 'Muse fixture' }], connection: { mode: 'account' },
    runner: async (body, opts) => { muse.push({ body, opts }); return JSON.stringify({ kind: 'message', text: 'Muse fixture' }); }, ...options,
  });
  const base = await gateway.start();
  t.after(async () => { await gateway.close(); for (const c of wss.clients) c.terminate(); wss.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { base, gateway, seen, muse, nativeModel };
}
const headers = { authorization: 'Bearer synthetic-openai-secret', 'chatgpt-account-id': 'fixture-account', 'content-type': 'application/json' };
async function openSocket(base, auth = headers.authorization) {
  const socket = new WebSocket(base.replace('http:', 'ws:') + '/responses', { headers: { ...headers, authorization: auth } });
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); }); return socket;
}
function turn(socket, body) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.off('message', read); reject(new Error('fixture response timeout')); }, 5000);
    function read(raw) {
      const event = JSON.parse(raw.toString());
      if (event.type === 'response.completed' || event.type === 'error') { clearTimeout(timer); socket.off('message', read); resolve(event); }
    }
    socket.on('message', read); socket.send(JSON.stringify({ type: 'response.create', ...body }));
  });
}

test('catalog preserves all native metadata, appends Muse, and never forwards combined ETags', async t => {
  const { base, nativeModel, seen } = await fixture(t);
  const response = await fetch(base + '/models?client_version=fixture', { headers: { ...headers, 'if-none-match': 'combined-old' } });
  const catalog = await response.json();
  assert.deepEqual(catalog.models[0], nativeModel); assert.equal(catalog.future_catalog, true);
  assert.equal(catalog.models[1].slug, 'muse/fixture'); assert.equal(catalog.models[1].supports_search_tool, false);
  assert.equal(seen[0].headers['if-none-match'], undefined);
  assert.equal(seen[0].headers.authorization, headers.authorization);
});

test('HTTP OpenAI compressed requests and SSE pass through; Muse never receives native credentials', async t => {
  const { base, seen, muse } = await fixture(t);
  const raw = gzipSync(JSON.stringify(request('openai-fixture', { stream: true, tools: [{ type: 'web_search' }] })));
  const response = await fetch(base + '/responses', { method: 'POST', headers: { ...headers, 'content-encoding': 'gzip' }, body: raw });
  assert.equal(response.headers.get('x-fixture'), 'preserved'); assert.match(await response.text(), /OpenAI fixture/);
  assert.deepEqual(seen.at(-1).raw, raw); assert.equal(seen.at(-1).headers.authorization, headers.authorization);
  const before = seen.length;
  const reply = await fetch(base + '/responses', { method: 'POST', headers, body: JSON.stringify(request('muse/fixture')) });
  assert.equal((await reply.json()).model, 'muse/fixture'); assert.equal(seen.length, before);
  assert.equal(muse[0].body.model, 'fixture'); assert.deepEqual(Object.keys(muse[0].opts).sort(), ['connection', 'signal']);
  assert.equal(JSON.stringify(muse).includes('synthetic-openai-secret'), false);
});

test('one WebSocket switches OpenAI -> Muse -> OpenAI with incremental history and free warmup', async t => {
  const { base, muse, seen } = await fixture(t); const socket = await openSocket(base);
  const first = await turn(socket, request('openai-fixture'));
  const warmup = await turn(socket, { model: 'muse/fixture', generate: false, input: [] });
  assert.deepEqual(warmup.response.output, []); assert.equal(muse.length, 0);
  const second = await turn(socket, request('muse/fixture', { previous_response_id: first.response.id }));
  assert.equal(second.response.model, 'muse/fixture'); assert.equal(muse[0].body.input.length, 3);
  const third = await turn(socket, request('openai-fixture', { previous_response_id: second.response.id }));
  assert.equal(third.response.model, 'openai-fixture');
  const outgoing = seen.filter(s => s.body).at(-1).body;
  assert.equal(outgoing.previous_response_id, undefined); assert.equal(outgoing.input.length, 5);
  assert.equal(seen.filter(s => s.body).length, 2);
  socket.close();
});

test('upstream WebSocket 401 reaches native before connection acceptance', async t => {
  const { base, muse } = await fixture(t);
  const socket = new WebSocket(base.replace('http:', 'ws:') + '/responses', { headers: { ...headers, authorization: 'Bearer expired-fixture' } });
  const status = await new Promise((resolve, reject) => {
    socket.once('open', () => reject(new Error('401 was hidden')));
    socket.once('unexpected-response', (_req, res) => { res.resume(); resolve({ code: res.statusCode, auth: res.headers['www-authenticate'] }); });
    socket.on('error', () => {});
  });
  assert.equal(status.code, 401); assert.equal(status.auth, 'Bearer realm="fixture"'); assert.equal(muse.length, 0); socket.terminate();
});

test('gateway rejects unauthorized access, unknown Muse, unsupported Muse tools and compaction without fallback', async t => {
  const { base, seen, muse } = await fixture(t);
  for (const [url, body, extraHeaders, status] of [
    [base.replace(/\/[a-f0-9]{64}\//, '/wrong/') + '/responses', request('muse/fixture'), {}, 403],
    [base + '/responses', request('muse/fixture'), { origin: 'https://evil.invalid' }, 403],
    [base + '/responses', request('muse/missing'), {}, 503],
    [base + '/responses', request('muse/fixture', { tools: [{ type: 'code_interpreter' }] }), {}, 400],
    [base + '/responses/compact', request('muse/fixture'), {}, 400],
  ]) {
    const reply = await fetch(url, { method: 'POST', headers: { ...headers, ...extraHeaders }, body: JSON.stringify(body) });
    assert.equal(reply.status, status, await reply.text());
  }
  assert.equal(seen.length, 0); assert.equal(muse.length, 0);
});

test('disconnect aborts Muse generation; failure does not run OpenAI', async t => {
  let started, cancelled;
  const ready = new Promise(resolve => { started = resolve; });
  const stopped = new Promise(resolve => { cancelled = resolve; });
  const { base, seen } = await fixture(t, { runner: (_body, { signal }) => new Promise((_resolve, reject) => {
    started(); signal.addEventListener('abort', () => { cancelled(); reject(new Error('cancelled')); }, { once: true });
  }) });
  const socket = await openSocket(base); socket.send(JSON.stringify({ type: 'response.create', ...request('muse/fixture') }));
  await ready; socket.close(); await stopped;
  assert.equal(seen.filter(s => s.body).length, 0);
});

test('history cannot mix accounts, silently lose Muse context, or exceed its bound', () => {
  const history = new ResponseHistory(1500);
  history.remember(request('muse/fixture'), responseObject('muse/fixture', message('private'), 'resp_muse_known'), true, 'account-a');
  assert.throws(() => history.expand(request('muse/fixture', { previous_response_id: 'resp_muse_known' }), true, 'account-b'), /unavailable/);
  for (let i = 0; i < 30; i++) history.remember(request('muse/fixture'), responseObject('muse/fixture', message('x'.repeat(100)), 'resp_muse_' + i), true, 'account-a');
  assert.ok(history.size <= 1500);
  assert.throws(() => history.expand(request('openai-fixture', { previous_response_id: 'resp_muse_known' }), false, 'account-a'), /expired/);
});
