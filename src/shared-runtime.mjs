import { join } from 'node:path';
import { CodexProcess } from './codex-process.mjs';
import { AdditivePreferences } from './additive-preferences.mjs';
import { discoverMuse, isMuseModel } from './additive-catalog.mjs';
import { createSharedGateway } from './shared-gateway.mjs';
import { readConnection } from './auth.mjs';
import { runMuse } from './native-runner.mjs';

// Only this short-lived, task-free discovery process disables Remote. It exits
// before the single real task server starts. No account tokens are read here.
export async function inspectNative(executable, args, { env = process.env, cwd } = {}) {
  const peer = new CodexProcess(executable, args, { env: { ...env, CODEX_INTERNAL_APP_SERVER_REMOTE_CONTROL_DISABLED: '1' }, cwd, timeoutMs: 20000 });
  try {
    await peer.request('initialize', { clientInfo: { name: 'muse_gateway_discovery', version: '1' }, capabilities: { experimentalApi: true } });
    peer.send({ method: 'initialized', params: {} });
    const account = await peer.request('account/read', {});
    const { config } = await peer.request('config/read', { includeLayers: false });
    if (config.model_provider && config.model_provider !== 'openai') throw new Error('The shared launcher requires the built-in OpenAI provider. Restore the normal OpenAI provider before using this shortcut.');
    if (config.model_catalog_json) throw new Error('Remove the previous custom model_catalog_json override before using the shared launcher.');
    const upstream = config.openai_base_url || env.OPENAI_BASE_URL || (account.account?.type === 'chatgpt'
      ? (config.chatgpt_base_url || 'https://chatgpt.com/backend-api').replace(/\/$/, '') + '/codex'
      : 'https://api.openai.com/v1');
    return { upstream, model: config.model, accountType: account.account?.type };
  } finally { await peer.stop(); }
}

export async function createSharedRuntime({ executable, args = ['app-server'], stateRoot, emit,
  env = process.env, cwd, discover, connection, runner, nativeInfo, allowInsecureLocalhost = false }) {
  // Validate the transport without blocking the native server's own Remote flag.
  for (let i = 0; i < args.length; i++) {
    const value = args[i] === '--listen' ? args[++i] : args[i].startsWith('--listen=') ? args[i].slice(9) : null;
    if (value != null && value !== 'stdio://') throw new Error('The desktop shared launcher expects native stdio transport. Remote uses that server’s own connection.');
  }
  nativeInfo ||= await inspectNative(executable, args, { env, cwd });
  const preferences = new AdditivePreferences(join(stateRoot, 'model-preferences.json'));
  await preferences.load();
  let authError = false;
  try { connection ||= readConnection(env); } catch { authError = true; }
  const gateway = createSharedGateway({ upstream: nativeInfo.upstream, allowInsecureLocalhost,
    discover: discover || (async () => { if (authError) throw new Error('Muse authentication unavailable'); return discoverMuse(connection); }),
    connection, runner: runner || ((request, options) => runMuse(request, { ...options, decisionAtModelBoundary: true })),
  });
  let peer;
  try {
    const endpoint = await gateway.start();
    // These are process arguments, never config-file writes. Remote and desktop
    // both use this one native server and therefore the same endpoint/catalog.
    peer = new CodexProcess(executable, [...args, '-c', `openai_base_url=${JSON.stringify(endpoint)}`, '-c', 'model_provider="openai"'], { env: { ...env }, cwd });
    // CodexProcess remaps outgoing request IDs; native server requests also need
    // independent IDs so approvals cannot collide with a desktop request.
    const serverRequests = new Map(); let nextServerId = 0;
    peer.on('message', message => {
      if (message.method && message.id !== undefined) {
        const id = `muse-native:${++nextServerId}`; serverRequests.set(id, message.id); emit({ ...message, id });
      } else emit(message);
    });
    const receive = async message => {
      if (!message.method) {
        if (serverRequests.has(message.id)) { const id = serverRequests.get(message.id); serverRequests.delete(message.id); peer.send({ ...message, id }); }
        return;
      }
      if (message.id === undefined) { peer.send(message); return; }
      const method = message.method; let params = message.params || {};
      try {
        let result;
        if (['config/value/write', 'config/batchWrite'].includes(method)) {
          result = await preferences.dispatch(method, params, {
            readConfig: p => peer.request('config/read', p), forward: (m, p) => peer.request(m, p),
            validateModel: async model => {
              if (isMuseModel(model)) { await gateway.catalog.resolve(model); return { muse: true, model: model.slice(5) }; }
              // Native owns OpenAI catalog validation and future model IDs.
              return { muse: false, model };
            },
          });
        } else {
          if (method === 'thread/start' && params.model == null && preferences.hasValues) {
            const selected = preferences.selection(await peer.request('config/read', { includeLayers: true })).config;
            params = { ...params, ...(selected.model ? { model: selected.model } : {}),
              config: { ...params.config, ...(selected.model_reasoning_effort ? { model_reasoning_effort: selected.model_reasoning_effort } : {}) } };
          }
          result = await peer.request(method, params);
          if (method === 'config/read') result = preferences.project(result);
        }
        emit({ id: message.id, result });
      } catch (error) {
        // Preserve native protocol errors. Local adapter errors contain no tokens.
        emit({ id: message.id, error: error.rpcError || { code: -32602, message: error.message } });
      }
    };
    let stopped;
    const stop = () => stopped ||= (async () => { await peer.stop(); await gateway.close(); })();
    peer.once('closed', () => { void stop(); });
    return { peer, gateway, preferences, receive, stop };
  } catch (error) { await peer?.stop(); await gateway.close(); throw error; }
}
