import http from 'node:http';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { readConnection } from './auth.mjs';
import { NativeError, normalizeRequest, parseMuseOutput, responseObject, responseEvents } from './native-protocol.mjs';
import { runMuse } from './native-runner.mjs';
import { bridgeVersion, bridgeBuild } from './build-info.mjs';

export function createNativeServer({ token, models, getModels, connection, runner = runMuse, concurrency = 2 }) {
  if (typeof token !== 'string' || token.length < 32 || (typeof getModels !== 'function' && (!Array.isArray(models) || !models.length))) throw new Error('A private local token and explicit Muse model list are required.');
  const active = new Set();
  const server = http.createServer(async (req, res) => {
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    try {
      if (req.headers.origin) throw new NativeError('Browser origins are not accepted by this local model endpoint.', 403);
      const auth = Buffer.from(req.headers.authorization || '');
      const expected = Buffer.from(`Bearer ${token}`);
      if (auth.length !== expected.length || !timingSafeEqual(auth, expected)) throw new NativeError('Local provider authentication required.', 401);
      const availableModels = getModels ? await getModels() : models;
      if (req.method === 'GET' && req.url === '/health') { json(200, { ready: true, experimental: true, bridge_version: bridgeVersion, bridge_build: bridgeBuild, auth_mode: connection.mode, models: availableModels, active: active.size }); return; }
      if (req.method === 'GET' && req.url === '/v1/models') { json(200, { object: 'list', data: availableModels.map(id => ({ id, object: 'model', owned_by: 'meta' })) }); return; }
      if (req.method !== 'POST' || req.url !== '/v1/responses') throw new NativeError('Unsupported endpoint.', 404);
      if (!req.headers['content-type']?.startsWith('application/json')) throw new NativeError('Expected application/json.', 415);
      let text = '';
      req.setEncoding('utf8');
      for await (const chunk of req) {
        text += chunk;
        if (Buffer.byteLength(text) > 1_000_000) throw new NativeError('Request too large.', 413);
      }
      let body; try { body = JSON.parse(text); } catch { throw new NativeError('Invalid request JSON.'); }
      const request = normalizeRequest(body, availableModels);
      if (active.size >= concurrency) throw new NativeError('Muse provider is busy. Wait for the active request to finish.', 429);
      const controller = new AbortController();
      active.add(controller);
      res.on('close', () => { if (!res.writableEnded) controller.abort(); });
      let heartbeat;
      if (body.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write(': waiting for Muse\n\n');
        heartbeat = setInterval(() => res.write(': waiting for Muse\n\n'), 10_000);
      }
      try {
        const answer = await runner(request, { signal: controller.signal, connection });
        controller.signal.throwIfAborted();
        const response = responseObject(request.model, parseMuseOutput(answer, request));
        if (body.stream) {
          for (const event of responseEvents(response)) res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
          res.end();
        } else json(200, response);
      } finally { clearInterval(heartbeat); active.delete(controller); }
    } catch (error) {
      if (res.destroyed) return;
      const message = error instanceof NativeError ? error.message : 'Muse provider failed. No provider fallback was attempted.';
      if (res.headersSent) {
        // Codex needs a terminal Responses event. A generic SSE error alone was
        // reduced to "stream closed before response.completed", hiding the cause.
        const response = { id: `resp_${randomUUID()}`, object: 'response', created_at: Math.floor(Date.now() / 1000),
          status: 'failed', output: [], error: { code: 'muse_provider_error', message } };
        res.write(`event: response.failed\ndata: ${JSON.stringify({ type: 'response.failed', response, sequence_number: 0 })}\n\n`); res.end();
      } else json(error.status || 500, { error: { type: 'muse_provider_error', message } });
    }
  });
  server.stop = async () => { for (const controller of active) controller.abort(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); };
  return server;
}

export async function startNativeServer(argv = process.argv.slice(2)) {
  try {
    const { values } = parseArgs({ args: argv, options: { config: { type: 'string' } } });
    const info = await stat(values.config);
    if (!info.isFile() || info.size > 65536 || (info.mode & 0o077) || (process.getuid && info.uid !== process.getuid())) throw new Error('Invalid private config.');
    const config = JSON.parse(await readFile(values.config, 'utf8'));
    if (!Number.isInteger(config.port) || config.port < 1024 || config.port > 65535) throw new Error('Invalid port.');
    const server = createNativeServer({ ...config, connection: readConnection() });
    server.on('error', () => { console.error('Could not listen on the configured localhost port.'); process.exitCode = 1; });
    server.listen(config.port, '127.0.0.1', () => console.log(`Experimental Muse provider listening on 127.0.0.1:${config.port}`));
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.stop());
  } catch { console.error('Cannot start the native provider. Check its private configuration.'); process.exitCode = 1; }
}
