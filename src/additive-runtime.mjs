import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm, mkdir, open, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { AdditiveRouter, RouteStore } from './additive-router.mjs';
import { AdditiveCatalog, discoverMuse, museProvider } from './additive-catalog.mjs';
import { CodexProcess } from './codex-process.mjs';
import { createNativeServer } from './native-server.mjs';
import { makeCatalog } from './native-catalog.mjs';
import { readConnection } from './auth.mjs';
import { runMuse } from './native-runner.mjs';
import { assertStdio } from './additive-cli.mjs';
import { AdditivePreferences } from './additive-preferences.mjs';

export async function createAdditiveRuntime({ executable, args = ['app-server'], env = process.env, stateRoot,
  emit, discover, connection, runner, hostProvider = 'openai', intervalMs = 300000, cwd } = {}) {
  if (!executable || !stateRoot || !emit) throw new Error('An explicit real Codex executable, state directory, and output handler are required.');
  // Only stdio is supported. A desktop daemon/WebSocket bypass needs separate work.
  assertStdio(args);
  // Every native child otherwise reuses the saved Remote enrollment and competes
  // for the same computer identity. Remote requests bypass this stdio router,
  // so even the coordinator must stay local. This does not edit the enrollment.
  env = { ...env, CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED: '1' };
  stateRoot = resolve(stateRoot); await mkdir(stateRoot, { recursive: true, mode: 0o700 });
  let lock;
  try { lock = await open(join(stateRoot, 'runtime.lock'), 'wx', 0o600); }
  catch { throw new Error('Another additive runtime may own this state directory. Do not run concurrent adapters against the same tasks.'); }
  const dir = await mkdtemp(join(tmpdir(), 'muse-additive-'));
  let router, server;
  try {
    // Read only the bridge's configured Muse authentication; Codex owns OpenAI auth.
    let connectionError;
    try { connection ||= readConnection(env); } catch { connectionError = true; }
    const catalog = new AdditiveCatalog({ intervalMs, discover: discover || (() => {
      if (connectionError) throw new Error('Muse authentication configuration unavailable');
      return discoverMuse(connection);
    }) });
    const token = randomBytes(32).toString('hex');
    server = createNativeServer({ token, connection: connection || { mode: 'unavailable' }, runner: runner || ((request, options) => runMuse(request, { ...options, decisionAtModelBoundary: true })),
      getModels: async () => { await catalog.ensureFresh(); if (catalog.error) throw new Error('Muse discovery unavailable'); return catalog.ids(); },
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const port = server.address().port;
    const store = new RouteStore(join(stateRoot, 'routes.json')); await store.load();
    const preferences = new AdditivePreferences(join(stateRoot, 'preferences.json')); await preferences.load();
    const coordinator = new CodexProcess(executable, args, { env, cwd });
    router = new AdditiveRouter({ coordinator, catalog, store, preferences, emit, hostProvider, createWorker: async route => {
      let extra = [];
      if (route.muse) {
        const catalogPath = join(dir, `${randomUUID()}.json`);
        await writeFile(catalogPath, JSON.stringify(makeCatalog(catalog.ids())), { mode: 0o600 });
        extra = ['-c', `model_provider=${JSON.stringify(museProvider)}`, '-c', `model=${JSON.stringify(route.model)}`,
          '-c', `model_catalog_json=${JSON.stringify(catalogPath)}`, '-c', 'web_search="disabled"',
          '-c', `model_providers.${museProvider}={name="Muse additive prototype",base_url="http://127.0.0.1:${port}/v1",experimental_bearer_token="${token}",wire_api="responses",requires_openai_auth=false,supports_websockets=false,request_max_retries=0,stream_max_retries=0,stream_idle_timeout_ms=180000}`];
      }
      return new CodexProcess(executable, [...args, ...extra], { env, cwd });
    } });
    catalog.start();
    // Background discovery does not delay initialization or OpenAI task requests.
    void catalog.refresh();
    return { router, catalog, async stop() {
      try { await router.stop(); await server.stop(); }
      finally { await rm(dir, { recursive: true, force: true }); await lock.close(); await unlink(join(stateRoot, 'runtime.lock')); }
    } };
  } catch (error) {
    await router?.stop(); if (server?.listening) await server.stop();
    await rm(dir, { recursive: true, force: true }); await lock.close(); await unlink(join(stateRoot, 'runtime.lock')); throw error;
  }
}
