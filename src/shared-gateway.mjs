import http from 'node:http';
import https from 'node:https';
import { randomBytes, createHash } from 'node:crypto';
import { gunzipSync, inflateSync } from 'node:zlib';
import { StringDecoder } from 'node:string_decoder';
import { Decompress } from 'fzstd';
import { WebSocket, WebSocketServer } from 'ws';
import { AdditiveCatalog, isMuseModel } from './additive-catalog.mjs';
import { makeCatalog } from './native-catalog.mjs';
import { NativeError, normalizeRequest, parseMuseOutput, responseObject, responseEvents } from './native-protocol.mjs';

const LIMIT = 32 * 1024 * 1024;
const hopHeaders = new Set(['host', 'connection', 'upgrade', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding']);
export function forwardHeaders(headers, websocket = false) {
  const blocked = new Set([...hopHeaders, ...(headers.connection || '').toLowerCase().split(',').map(v => v.trim())]);
  return Object.fromEntries(Object.entries(headers).filter(([key]) => !blocked.has(key.toLowerCase()) &&
    !(websocket && key.toLowerCase().startsWith('sec-websocket-'))));
}
export async function readBody(stream, limit = LIMIT) {
  const chunks = []; let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > limit) throw new NativeError('Request exceeds the gateway size limit.', 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export function decodeBody(raw, encoding) {
  if (!encoding || encoding === 'identity') return raw;
  if (encoding === 'gzip') return gunzipSync(raw, { maxOutputLength: LIMIT });
  if (encoding === 'deflate') return inflateSync(raw, { maxOutputLength: LIMIT });
  if (encoding === 'zstd') {
    const chunks = []; let size = 0;
    const decoder = new Decompress(chunk => {
      size += chunk.length;
      if (size > LIMIT) throw new NativeError('Decompressed request exceeds the gateway size limit.', 413);
      chunks.push(Buffer.from(chunk));
    });
    decoder.push(raw, true); return Buffer.concat(chunks);
  }
  throw new NativeError('Unsupported request content encoding.', 415);
}
const inputArray = input => typeof input === 'string' ? [{ role: 'user', content: input }] : input || [];

// Short-lived, memory-only history enables a provider switch on an incremental
// Responses connection. Partition by native account headers; never persist it.
export class ResponseHistory {
  constructor(limit = LIMIT) { this.entries = new Map(); this.size = 0; this.limit = limit; }
  expand(body, muse, scope) {
    if (!body.previous_response_id) return body;
    const previous = this.entries.get(scope + ':' + body.previous_response_id);
    if (!previous) {
      if (muse) throw new NativeError('Previous response is unavailable. Reopen this task to send its full history; no provider fallback was attempted.');
      // A Muse response identifier must never be sent to OpenAI after eviction.
      if (body.previous_response_id.startsWith('resp_muse_')) throw new NativeError('Previous Muse response expired. Reopen the task to send its full history.');
      return body;
    }
    if (!muse && !previous.muse) return body;
    const expanded = { ...body, input: [...previous.input, ...previous.output, ...inputArray(body.input)] };
    delete expanded.previous_response_id; return expanded;
  }
  remember(body, response, muse, scope) {
    if (!response?.id || !Array.isArray(response.output) || body.generate === false) return;
    let input = inputArray(body.input);
    if (body.previous_response_id) {
      const previous = this.entries.get(scope + ':' + body.previous_response_id);
      if (!previous) return;
      input = [...previous.input, ...previous.output, ...input];
    }
    const value = { input, output: response.output, muse };
    const size = Buffer.byteLength(JSON.stringify(value));
    if (size > this.limit) return;
    const key = scope + ':' + response.id;
    if (this.entries.has(key)) this.size -= this.entries.get(key).size;
    this.entries.delete(key); this.entries.set(key, { ...value, size }); this.size += size;
    while (this.size > this.limit || this.entries.size > 64) {
      const first = this.entries.keys().next().value;
      this.size -= this.entries.get(first).size; this.entries.delete(first);
    }
  }
}
const scopeOf = headers => createHash('sha256').update(headers.authorization || '').update('\0').update(headers['chatgpt-account-id'] || '').digest('hex');
const safeError = error => error instanceof NativeError ? error.message : 'The model gateway request failed. No provider fallback was attempted.';
const failure = error => ({ error: { type: 'gateway_error', code: 'gateway_error', message: safeError(error) } });
const wsError = error => ({ type: 'error', status: error.status || 502, ...failure(error) });
const send = (socket, value) => {
  if (socket.readyState !== WebSocket.OPEN) return;
  if (socket.bufferedAmount > LIMIT) { socket.close(1013, 'Client is too slow'); return; }
  socket.send(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value));
};

export function createSharedGateway({ upstream, discover, runner, connection, allowInsecureLocalhost = false, concurrency = 2 }) {
  const base = new URL(upstream.endsWith('/') ? upstream : upstream + '/');
  if (base.username || base.password || base.search || base.hash || (base.protocol !== 'https:' &&
    !(allowInsecureLocalhost && base.protocol === 'http:' && ['127.0.0.1', '[::1]'].includes(base.hostname)))) throw new Error('The upstream must be HTTPS (localhost HTTP is allowed only in tests).');
  const prefix = '/' + randomBytes(32).toString('hex') + '/v1';
  const catalog = new AdditiveCatalog({ discover });
  const history = new ResponseHistory();
  const sockets = new Set(), active = new Set(), upstreamRequests = new Set();
  const wsServer = new WebSocketServer({ noServer: true, maxPayload: LIMIT, perMessageDeflate: false });
  let busy = 0;
  const destination = path => new URL(base.href.replace(/\/$/, '') + path);
  const pathOf = req => {
    if (req.headers.origin || !req.url.startsWith(prefix + '/')) throw new NativeError('Forbidden.', 403);
    const host = req.headers.host || '';
    if (!/^127\.0\.0\.1:\d+$/.test(host)) throw new NativeError('Forbidden.', 403);
    const path = req.url.slice(prefix.length);
    // A fixed upstream, not a general HTTP proxy. Preserve its query string.
    if (!/^\/(models|responses(?:\/compact|\/lite)?)($|\?)/.test(path)) throw new NativeError('Unsupported gateway endpoint.', 404);
    return path;
  };
  async function isMuse(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new NativeError('Expected a Responses request object.');
    if (!isMuseModel(body?.model) || catalog.hostIds.has(body.model)) return false;
    try { await catalog.resolve(body.model); }
    catch { throw new NativeError('This Muse model is unavailable. Check Muse access or choose another model; no provider fallback was attempted.', 503); }
    return true;
  }
  async function museResponse(body, signal) {
    const id = 'resp_muse_' + randomBytes(16).toString('hex');
    // Codex warms a WebSocket using generate:false. Never bill a Muse request.
    if (body.generate === false) return { id, object: 'response', status: 'completed', model: body.model, output: [], usage: null };
    if (busy >= concurrency) throw new NativeError('Muse is busy. Wait for a running Muse request to finish.', 429);
    // Native attaches its optional provider-hosted search even when the model's
    // catalog declares no search support. Muse cannot execute that OpenAI tool;
    // omit it from Muse's choices. An explicitly required search still errors.
    if (body.tools != null && !Array.isArray(body.tools)) throw new NativeError('tools must be an array.');
    const tools = (body.tools || []).filter(tool => tool?.type !== 'web_search');
    const request = normalizeRequest({ ...body, tools, model: body.model.slice(5) }, catalog.ids());
    busy++;
    try {
      const answer = await runner(request, { signal, connection });
      return responseObject(body.model, parseMuseOutput(answer, request), id);
    } finally { busy--; }
  }
  const eventsOf = response => response.output.length ? responseEvents(response) : [
    { type: 'response.created', sequence_number: 0, response: { ...response, status: 'in_progress' } },
    { type: 'response.completed', sequence_number: 1, response },
  ];
  function requestUpstream(req, path, raw, onResponse, headers = forwardHeaders(req.headers)) {
    const target = destination(path);
    const pending = (target.protocol === 'https:' ? https : http).request(target, { method: req.method, headers }, onResponse);
    upstreamRequests.add(pending); pending.once('close', () => upstreamRequests.delete(pending));
    // No redirects; especially never replay native credentials to another host.
    pending.end(raw); return pending;
  }
  const server = http.createServer(async (req, res) => {
    const abort = new AbortController(); active.add(abort);
    res.once('close', () => { abort.abort(); active.delete(abort); });
    try {
      const path = pathOf(req);
      if (path.split('?')[0] === '/models' && req.method === 'GET') {
        const headers = forwardHeaders(req.headers);
        // Native ETags describe a combined catalog. Ask upstream for its complete
        // current catalog; do not reuse that ETag for a different representation.
        delete headers['if-none-match']; delete headers['if-modified-since']; headers['accept-encoding'] = 'identity';
        const pending = requestUpstream(req, path, undefined, upstreamResponse => {
          void (async () => {
            if (upstreamResponse.statusCode !== 200) {
              res.writeHead(upstreamResponse.statusCode, forwardHeaders(upstreamResponse.headers)); upstreamResponse.pipe(res); return;
            }
            const raw = await readBody(upstreamResponse);
            const native = JSON.parse(decodeBody(raw, upstreamResponse.headers['content-encoding']));
            if (!Array.isArray(native.models)) throw new NativeError('OpenAI returned an incompatible model catalog.', 502);
            await catalog.ensureFresh();
            catalog.hostIds = new Set(native.models.map(m => m.slug));
            const priority = Math.max(0, ...native.models.map(m => m.priority || 0)) + 1;
            const extras = catalog.models.filter(m => !catalog.hostIds.has('muse/' + m.modelId)).map((m, index) => ({
              ...makeCatalog(['muse/' + m.modelId]).models[0],
              display_name: `${m.displayLabel || m.displayName || m.modelId} (Muse bridge)`,
              priority: priority + index, visibility: m.hidden ? 'hide' : 'list',
            }));
            const body = JSON.stringify({ ...native, models: [...native.models, ...extras] });
            res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache', etag: '"' + createHash('sha256').update(body).digest('hex') + '"' });
            res.end(body);
          })().catch(error => { if (!res.headersSent) res.writeHead(error.status || 502); res.end(JSON.stringify(failure(error))); });
        }, headers);
        abort.signal.addEventListener('abort', () => pending.destroy(), { once: true });
        pending.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(JSON.stringify(failure(new Error()))); });
        return;
      }
      if (req.method !== 'POST') throw new NativeError('Method not allowed.', 405);
      const raw = await readBody(req);
      let body; try { body = JSON.parse(decodeBody(raw, req.headers['content-encoding'])); }
      catch (error) { throw error instanceof NativeError ? error : new NativeError('Invalid compressed JSON request.'); }
      const muse = await isMuse(body), scope = scopeOf(req.headers);
      const expanded = history.expand(body, muse, scope);
      if (!muse) {
        const headers = forwardHeaders(req.headers);
        let forwarded = raw;
        if (expanded !== body) { forwarded = Buffer.from(JSON.stringify(expanded)); delete headers['content-encoding']; headers['content-length'] = String(forwarded.length); }
        const pending = requestUpstream(req, path, forwarded, upstreamResponse => {
          res.writeHead(upstreamResponse.statusCode, forwardHeaders(upstreamResponse.headers));
          // Observe bounded completed responses without altering bytes or buffering
          // the outgoing stream. This supports SSE -> Muse provider switches.
          let observed = '', overflow = false; const decoder = new StringDecoder('utf8');
          upstreamResponse.on('data', chunk => {
            if (overflow) return;
            observed += decoder.write(chunk);
            if (observed.length > LIMIT) { observed = ''; overflow = true; }
          });
          upstreamResponse.on('end', () => {
            if (overflow) return;
            observed += decoder.end();
            try {
              if (upstreamResponse.headers['content-type']?.includes('text/event-stream')) {
                for (const line of observed.split('\n')) if (line.startsWith('data: ')) {
                  try { const event = JSON.parse(line.slice(6)); if (event.type === 'response.completed') history.remember(expanded, event.response, false, scope); } catch {}
                }
              } else history.remember(expanded, JSON.parse(observed), false, scope);
            } catch {}
          });
          upstreamResponse.pipe(res);
        }, headers);
        abort.signal.addEventListener('abort', () => pending.destroy(), { once: true });
        pending.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(JSON.stringify(failure(new Error()))); });
        return;
      }
      if (path.split('?')[0] !== '/responses') throw new NativeError('Muse does not support native compaction or Responses Lite. Start a fresh task when its context is full.');
      const stream = body.stream === true;
      let heartbeat;
      if (stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }); res.write(': Muse gateway\n\n');
        heartbeat = setInterval(() => res.write(': waiting\n\n'), 10000); heartbeat.unref();
      }
      try {
        const response = await museResponse(expanded, abort.signal);
        if (abort.signal.aborted) return;
        history.remember(expanded, response, true, scope);
        if (stream) { for (const event of eventsOf(response)) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`); res.end(); }
        else { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(response)); }
      } catch (error) {
        if (stream) {
          res.end(`event: response.failed\ndata: ${JSON.stringify({ type: 'response.failed', response: { id: 'resp_muse_failed', object: 'response', status: 'failed', output: [], ...failure(error) } })}\n\n`);
        } else throw error;
      } finally { clearInterval(heartbeat); }
    } catch (error) {
      if (!res.headersSent) res.writeHead(error.status || 502, { 'content-type': 'application/json' });
      res.end(JSON.stringify(failure(error)));
    }
  });
  server.on('upgrade', (req, socket, head) => {
    let path;
    try { path = pathOf(req); if (path.split('?')[0] !== '/responses') throw new NativeError('Unsupported WebSocket endpoint.', 404); }
    catch (error) { socket.end(`HTTP/1.1 ${error.status || 403} Forbidden\r\nConnection: close\r\n\r\n`); return; }
    const target = destination(path); target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:';
    const upstreamSocket = new WebSocket(target, { headers: forwardHeaders(req.headers, true), followRedirects: false, handshakeTimeout: 15000, maxPayload: LIMIT, perMessageDeflate: false });
    sockets.add(upstreamSocket); upstreamSocket.once('close', () => sockets.delete(upstreamSocket));
    // Authenticate upstream before accepting the native socket, preserving native
    // 401/refresh behavior. This sends no model prompt or generation request.
    let accepted = false;
    const abandon = () => { if (!accepted) upstreamSocket.terminate(); };
    socket.once('close', abandon);
    upstreamSocket.on('unexpected-response', (_request, response) => {
      const headers = forwardHeaders(response.headers);
      socket.write(`HTTP/1.1 ${response.statusCode} Upstream Response\r\nConnection: close\r\n${Object.entries(headers).map(([k, v]) => `${k}: ${v}\r\n`).join('')}\r\n`);
      response.pipe(socket); response.once('end', () => upstreamSocket.terminate());
    });
    upstreamSocket.on('error', () => { if (!accepted && !socket.destroyed && !socket.writableEnded) socket.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n'); });
    socket.on('error', abandon);
    upstreamSocket.once('open', () => {
      if (socket.destroyed) { upstreamSocket.terminate(); return; }
      wsServer.handleUpgrade(req, socket, head, client => {
        accepted = true; socket.removeListener('close', abandon); sockets.add(client);
        const scope = scopeOf(req.headers);
        let pending = null, controller = null, processing = false;
        client.once('close', () => { sockets.delete(client); controller?.abort(); upstreamSocket.close(); });
        upstreamSocket.once('close', () => { controller?.abort(); client.close(1011, 'Upstream connection closed; reconnect'); });
        upstreamSocket.on('message', (raw, binary) => {
          if (binary) { client.close(1003, 'Unexpected binary response'); return; }
          try {
            const event = JSON.parse(raw.toString());
            if (event.type === 'response.completed' && pending) history.remember(pending, event.response, false, scope);
            if (['response.completed', 'response.failed', 'response.incomplete', 'error'].includes(event.type)) pending = null;
          } catch {}
          send(client, raw.toString());
        });
        client.on('message', (raw, binary) => {
          void (async () => {
            if (binary) throw new NativeError('Binary Responses frames are unsupported.');
            let body; try { body = JSON.parse(raw.toString()); } catch { throw new NativeError('Invalid WebSocket JSON.'); }
            if (body.type === 'response.cancel') { if (controller) controller.abort(); else send(upstreamSocket, raw.toString()); return; }
            if (body.type !== 'response.create') { if (controller) throw new NativeError('Unsupported Muse WebSocket command.'); send(upstreamSocket, raw.toString()); return; }
            if (processing || pending || controller) throw new NativeError('A response is already running on this connection.', 409);
            processing = true;
            try {
              const muse = await isMuse(body), expanded = history.expand(body, muse, scope);
              if (!muse) { pending = expanded; send(upstreamSocket, expanded === body ? raw.toString() : JSON.stringify(expanded)); return; }
              controller = new AbortController(); active.add(controller);
              try {
                const response = await museResponse(expanded, controller.signal);
                if (controller.signal.aborted) throw new NativeError('Muse request cancelled.', 499);
                history.remember(expanded, response, true, scope);
                for (const event of eventsOf(response)) send(client, event);
              } finally { active.delete(controller); controller = null; }
            } finally { processing = false; }
          })().catch(error => send(client, wsError(error)));
        });
        client.on('error', () => { controller?.abort(); upstreamSocket.terminate(); });
      });
    });
  });
  return {
    server, catalog,
    async start() {
      await catalog.refresh(); catalog.start();
      await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
      return `http://127.0.0.1:${server.address().port}${prefix}`;
    },
    async close() {
      catalog.stop(); for (const controller of active) controller.abort();
      for (const pending of upstreamRequests) pending.destroy();
      for (const socket of sockets) socket.terminate();
      wsServer.close(); server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      history.entries.clear();
    },
  };
}
