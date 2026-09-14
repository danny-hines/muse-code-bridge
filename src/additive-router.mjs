import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { museProvider, isMuseModel, museModelName } from './additive-catalog.mjs';
import { remoteUnsupported } from './additive-cli.mjs';

const lifecycle = new Set(['thread/start', 'thread/resume', 'thread/fork']);
const resumeKeys = ['approvalPolicy', 'approvalsReviewer', 'baseInstructions', 'config', 'cwd', 'developerInstructions', 'permissions', 'personality', 'runtimeWorkspaceRoots', 'sandbox', 'serviceTier'];
const pickResume = p => Object.fromEntries(resumeKeys.filter(k => p[k] !== undefined).map(k => [k, p[k]]));
const publicResult = (result, muse) => muse ? {
  ...result,
  ...(result?.model && !isMuseModel(result.model) ? { model: museModelName(result.model) } : {}),
  ...(result?.thread?.model && !isMuseModel(result.thread.model) ? { thread: { ...result.thread, model: museModelName(result.thread.model) } } : {}),
} : result;

export class RouteStore {
  constructor(path) { this.path = path; this.routes = {}; this.writes = Promise.resolve(); }
  async load() {
    try {
      const value = JSON.parse(await readFile(this.path, 'utf8'));
      if (value.version !== 1 || !value.routes || typeof value.routes !== 'object' || Array.isArray(value.routes)) throw new Error('invalid');
      for (const [id, route] of Object.entries(value.routes)) {
        if (!/^[\w-]+$/.test(id) || !route || typeof route.muse !== 'boolean' || typeof route.model !== 'string') throw new Error('invalid');
      }
      this.routes = value.routes;
    } catch (e) { if (e.code !== 'ENOENT') throw new Error('Cannot read additive routing state. No provider fallback was attempted.'); }
  }
  get(id) { return this.routes[id]; }
  async set(id, route) {
    this.routes[id] = { muse: route.muse, model: route.model };
    const snapshot = JSON.stringify({ version: 1, routes: this.routes });
    const write = async () => {
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      const temp = `${this.path}.${randomUUID()}.tmp`;
      try { await writeFile(temp, snapshot, { mode: 0o600, flag: 'wx' }); await rename(temp, this.path); }
      finally { await unlink(temp).catch(() => {}); }
    };
    this.writes = this.writes.then(write); await this.writes;
  }
}

// The coordinator handles account/catalog/global methods. Each loaded task has its
// own worker, so a provider switch can unload it without touching other tasks.
export class AdditiveRouter {
  constructor({ coordinator, createWorker, catalog, store, preferences, emit, hostProvider = 'openai', workerCacheSize = 4 }) {
    Object.assign(this, { coordinator, createWorker, catalog, store, preferences, emit, hostProvider });
    this.workers = new Map(); this.serverRequests = new Map(); this.queues = new Map(); this.allPeers = new Set([coordinator]);
    this.initialization = null; this.stopping = false;
    this.workerCacheSize = workerCacheSize; this.opening = 0;
    this.inFlight = new Map(); this.trimming = Promise.resolve(); this.trimScheduled = false;
    this.attach(coordinator);
  }
  attach(peer, state) {
    peer.on('message', message => {
      if (message.method && message.id !== undefined) {
        const id = `muse-bridge:${randomUUID()}`;
        this.serverRequests.set(id, { peer, id: message.id });
        this.emit({ ...message, id }); return;
      }
      if (message.method === 'serverRequest/resolved') {
        for (const [id, entry] of this.serverRequests) {
          if (entry.peer !== peer || entry.id !== message.params.requestId) continue;
          this.serverRequests.delete(id);
          this.emit({ ...message, params: { ...message.params, requestId: id } });
          this.scheduleTrim(); return;
        }
      }
      const rootEvent = state && message.params?.threadId != null && message.params.threadId === state.threadId;
      if (rootEvent && message.method === 'turn/started') state.active = true;
      if (rootEvent && message.method === 'turn/completed') { state.active = false; state.persistedTurn = true; this.scheduleTrim(); }
      if (rootEvent && message.method === 'thread/status/changed') {
        state.status = message.params.status; state.active = state.status.type === 'active';
      }
      if (state && ['thread/closed', 'thread/deleted'].includes(message.method)) {
        if (rootEvent) { state.discarded = true; state.active = false; state.status = { type: 'notLoaded' }; }
        this.scheduleTrim();
      }
      // Account-wide events come from the coordinator, not from every worker.
      if (state && /^(account\/|config\/)/.test(message.method || '')) return;
      if (state?.route.muse && message.method === 'thread/settings/updated') {
        const settings = message.params.threadSettings;
        this.emit({ ...message, params: { ...message.params, threadSettings: { ...settings,
          model: museModelName(settings.model),
          collaborationMode: { ...settings.collaborationMode, settings: { ...settings.collaborationMode.settings, model: museModelName(settings.collaborationMode.settings.model) } },
        } } }); return;
      }
      this.emit(message.params?.thread ? { ...message, params: { ...message.params, thread: this.presentThread(message.params.thread) } } : message);
    });
    peer.on('closed', () => {
      for (const [id, entry] of this.serverRequests) if (entry.peer === peer) this.serverRequests.delete(id);
      this.allPeers.delete(peer);
      if (state && this.workers.get(state.threadId) === state) this.workers.delete(state.threadId);
    });
  }
  presentThread(thread) {
    const state = this.workers.get(thread.id);
    const route = state?.route || this.store.get(thread.id);
    const muse = route?.muse ?? thread.modelProvider === museProvider;
    return { ...thread,
      ...(route ? { modelProvider: muse ? museProvider : this.hostProvider, model: muse ? museModelName(route.model) : route.model } : {}),
      ...(!route && muse && thread.model && !isMuseModel(thread.model) ? { model: museModelName(thread.model) } : {}),
      ...(state && !state.peer.closed ? { status: state.status || (state.active ? { type: 'active', activeFlags: [] } : { type: 'idle' }) } : {}),
    };
  }
  present(result) {
    if (result?.thread) return { ...result, thread: this.presentThread(result.thread) };
    if (Array.isArray(result?.data) && result.data.some(x => x?.modelProvider)) return { ...result, data: result.data.map(x => x?.modelProvider ? this.presentThread(x) : x) };
    return result;
  }
  async receive(message) {
    if (!message.method) {
      const entry = this.serverRequests.get(message.id);
      if (entry) { this.serverRequests.delete(message.id); entry.peer.send({ ...message, id: entry.id }); }
      return;
    }
    if (message.id === undefined) {
      if (message.method === 'initialized') this.coordinator.send(message);
      else this.coordinator.send(message);
      return;
    }
    const id = message.params?.threadId;
    if (id) this.inFlight.set(id, (this.inFlight.get(id) || 0) + 1);
    try {
      const execute = () => this.dispatch(message.method, message.params || {});
      // Serialize task changes, but let interruption and approval replies through.
      let result;
      if (id && message.method !== 'turn/interrupt') {
        const task = (this.queues.get(id) || Promise.resolve()).then(execute);
        const settled = task.catch(() => {}); this.queues.set(id, settled);
        try { result = await task; } finally { if (this.queues.get(id) === settled) this.queues.delete(id); }
      } else result = await execute();
      this.emit({ id: message.id, result: this.present(result) });
    } catch (error) {
      this.emit({ id: message.id, error: error.rpcError || { code: -32000, message: error.message || 'Additive routing failed. No fallback was attempted.' } });
    } finally {
      if (id) {
        const count = this.inFlight.get(id) - 1;
        if (count) this.inFlight.set(id, count); else this.inFlight.delete(id);
      }
      this.scheduleTrim();
    }
  }
  scheduleTrim() {
    if (this.stopping || this.trimScheduled) return;
    this.trimScheduled = true;
    setImmediate(() => { this.trimScheduled = false; void this.trimWorkers(); });
  }
  trimWorkers() {
    const trim = async () => {
      if (this.stopping) return;
      const count = () => this.opening + [...this.workers.values()].filter(s => !s.peer.closed).length;
      const candidates = [...this.workers].filter(([, s]) => !s.active && !s.peer.closed && (s.discarded || (!s.ephemeral && s.persistedTurn)))
        .sort((a, b) => Number(Boolean(b[1].discarded)) - Number(Boolean(a[1].discarded)) || a[1].lastUsed - b[1].lastUsed);
      for (const [id, state] of candidates) {
        if (this.stopping) return;
        if (!state.discarded && count() <= this.workerCacheSize) continue;
        if (this.inFlight.has(id) || this.workers.get(id) !== state) continue;
        try { await this.retire(id, state); } catch { /* Protected work stays alive, even above the cache target. */ }
      }
    };
    this.trimming = this.trimming.then(trim).catch(() => {});
    return this.trimming;
  }
  async route(model, previous) {
    if (model != null) {
      const raw = await this.catalog.resolve(model);
      if (raw === null && isMuseModel(model) && previous?.muse) throw new Error('This identifier now conflicts with a host model. Select another model explicitly; no provider switch was made.');
      return { muse: raw !== null, model: raw ?? model };
    }
    if (previous?.muse) await this.catalog.resolve(museModelName(previous.model));
    return previous || { muse: false, model: null };
  }
  async prior(id) {
    if (this.workers.has(id)) return this.workers.get(id).route;
    if (this.store.get(id)) return this.store.get(id);
    const read = await this.coordinator.request('thread/read', { threadId: id });
    if (read.thread.modelProvider === museProvider) {
      // A missing route record must never turn a Muse task into OpenAI usage.
      throw new Error('Muse task routing metadata is missing. Explicitly select a Muse model to resume it.');
    }
    if (read.thread.modelProvider && read.thread.modelProvider !== this.hostProvider) throw new Error('This prototype supports only OpenAI and Muse task providers.');
    return { muse: false, model: null };
  }
  async open(method, params, route) {
    if (!this.initialization) throw new Error('Initialize the adapter before opening a task.');
    // Four is a cache target, not a limit on navigation or concurrent work.
    // Reserve the opening worker before trimming so simultaneous opens cooperate.
    this.opening++;
    let peer;
    try {
      await this.trimWorkers();
      if (this.stopping) throw new Error('Adapter is stopping.');
      peer = await this.createWorker(route);
      if (this.stopping) { await peer.stop(); throw new Error('Adapter is stopping.'); }
    }
    catch (error) { this.opening--; throw error; }
    const state = { peer, route, active: false, ephemeral: Boolean(params.ephemeral), resume: pickResume(params), lastUsed: Date.now(), persistedTurn: method !== 'thread/start' };
    this.allPeers.add(peer); this.attach(peer, state);
    try {
      await peer.request('initialize', this.initialization); peer.send({ method: 'initialized', params: {} });
      const next = { ...params, ...(route.model ? { model: route.model } : {}), modelProvider: route.muse ? museProvider : this.hostProvider };
      if (route.muse) next.config = { ...(next.config || {}), web_search: 'disabled' };
      if (method === 'thread/start') next.allowProviderModelFallback = false;
      const result = await peer.request(method, next);
      if (result.modelProvider !== (route.muse ? museProvider : next.modelProvider)) throw new Error('Codex did not accept the selected provider. No turn was sent.');
      state.route = { muse: route.muse, model: result.model || route.model };
      state.ephemeral = Boolean(result.thread.ephemeral);
      state.threadId = result.thread.id; state.status = result.thread.status;
      state.active = state.status?.type === 'active';
      this.workers.set(result.thread.id, state);
      if (!state.ephemeral) await this.store.set(result.thread.id, state.route);
      return publicResult(result, route.muse);
    } catch (error) { await peer.stop(); throw error; }
    finally { this.opening--; }
  }
  async retire(id, state) {
    if (state.retiring) return state.retiring;
    const retire = async () => {
      const assertIdle = () => {
        if (state.active) throw new Error('Wait for or interrupt the current turn before switching providers.');
        if (state.peer.pending?.size || [...this.serverRequests.values()].some(r => r.peer === state.peer)) throw new Error('This task has pending requests. Wait for them before switching providers.');
      };
      assertIdle();
      if (state.ephemeral && !state.discarded) throw new Error('Cross-provider changes require a saved task in this prototype.');
      if (!state.peer.closed) {
        const loaded = await state.peer.request('thread/loaded/list', {});
        if (loaded.data.some(other => other !== id)) throw new Error('This task has other loaded tasks or agents in its worker. Finish that work before switching providers.');
        if (loaded.data.includes(id)) {
          // Notifications can lag, and unsubscribe suppresses turn events. Verify
          // runtime activity and background terminals before stopping the process.
          const read = await state.peer.request('thread/read', { threadId: id });
          state.status = read.thread.status; state.active = state.status?.type === 'active';
          assertIdle();
          const terminals = await state.peer.request('thread/backgroundTerminals/list', { threadId: id });
          if (terminals.data.length || terminals.nextCursor) throw new Error('This task has background terminals. Stop them before switching providers.');
        }
        assertIdle();
      }
      await state.peer.stop();
      if (this.workers.get(id) === state) this.workers.delete(id);
    };
    state.retiring = retire();
    try { return await state.retiring; } finally { state.retiring = null; }
  }
  async dispatch(method, params) {
    if (this.stopping) throw new Error('Adapter is stopping.');
    // Remote must never connect directly to one of our native child servers.
    // Reject before forwarding so an attempted setup cannot change enrollment.
    if (method === 'remoteControl/enable' || method === 'remoteControl/pairing/start') throw new Error(remoteUnsupported);
    // An eviction holds the worker until it has stopped. A concurrent resume or
    // turn then reopens the saved task instead of writing to a closing process.
    await this.workers.get(params.threadId)?.retiring?.catch(() => {});
    if (method === 'initialize') {
      if (this.initialization) throw new Error('Adapter is already initialized.');
      const result = await this.coordinator.request(method, params); this.initialization = params; return result;
    }
    if (method === 'model/list') return this.catalog.list(page => this.coordinator.request(method, page), params);
    if (method === 'thread/loaded/list') {
      const result = await this.coordinator.request(method, params);
      return { ...result, data: [...new Set([...result.data, ...[...this.workers].filter(([, state]) => !state.peer.closed).map(([id]) => id)])] };
    }
    if (method === 'config/read') {
      await this.preferences.writes;
      return this.preferences.project(await this.coordinator.request(method, params));
    }
    if (method === 'config/value/write' || method === 'config/batchWrite') return this.preferences.dispatch(method, params, {
      readConfig: params => this.coordinator.request('config/read', params),
      forward: (method, params) => this.coordinator.request(method, params),
      validateModel: model => this.route(model),
    });
    if (lifecycle.has(method)) {
      let defaultRoute;
      if (method === 'thread/start') await this.preferences.writes;
      if (method === 'thread/start' && this.preferences.hasValues && params.model == null) {
        const selected = this.preferences.selection(await this.coordinator.request('config/read', { cwd: params.cwd ?? null }));
        const defaults = selected.config; defaultRoute = selected.route;
        params = { ...params, model: defaults.model, config: {
          ...(defaults.model_reasoning_effort != null ? { model_reasoning_effort: defaults.model_reasoning_effort } : {}),
          ...params.config,
        } };
      }
      let prior;
      if (method !== 'thread/start') {
        prior = this.workers.get(params.threadId)?.route || this.store.get(params.threadId);
        if (!prior && params.model == null) prior = await this.prior(params.threadId);
      }
      const route = await this.route(params.model, prior || defaultRoute);
      const state = this.workers.get(params.threadId);
      if (state && method === 'thread/resume') {
        if (!state.peer.closed && state.route.muse === route.muse && state.route.model === route.model) {
          const result = await state.peer.request(method, { ...params, model: route.model, modelProvider: route.muse ? museProvider : this.hostProvider });
          state.status = result.thread.status; state.active = result.thread.status?.type === 'active'; state.discarded = false; state.lastUsed = Date.now();
          return publicResult(result, route.muse);
        }
        await this.retire(params.threadId, state);
        return this.open(method, { ...state.resume, ...params }, route);
      }
      if (state?.active && method === 'thread/fork') throw new Error('Wait for or interrupt the current turn before forking with this prototype.');
      if (state?.ephemeral && method === 'thread/fork') throw new Error('The prototype cannot fork an ephemeral task across workers.');
      return this.open(method, params, route);
    }
    const id = params.threadId;
    if (!id) return this.coordinator.request(method, params);
    let state = this.workers.get(id);
    if (state) state.lastUsed = Date.now();
    if (method === 'turn/start' || method === 'thread/settings/update') {
      const model = params.model ?? params.collaborationMode?.settings?.model;
      const route = await this.route(model, state?.route || this.store.get(id) || (model == null ? await this.prior(id) : undefined));
      const switchWorker = !state || state.peer.closed || state.route.muse !== route.muse || (route.muse && state.route.model !== route.model);
      if (switchWorker) {
        const resume = state?.resume || {};
        if (state) await this.retire(id, state);
        await this.open('thread/resume', { ...resume, threadId: id }, route); state = this.workers.get(id);
      }
      const next = { ...params, ...(route.model ? { model: route.model } : {}) };
      if (next.collaborationMode?.settings?.model) next.collaborationMode = { ...next.collaborationMode, settings: { ...next.collaborationMode.settings, model: route.model } };
      if (method === 'thread/settings/update') {
        const result = await state.peer.request(method, next);
        state.route = { ...route, model: route.model || state.route.model };
        if (!state.ephemeral) await this.store.set(id, state.route);
        return result;
      }
      state.route = { ...route, model: route.model || state.route.model };
      if (!state.ephemeral) await this.store.set(id, state.route);
      const previouslyActive = state.active;
      state.active = true;
      try {
        const result = await state.peer.request(method, next);
        return result;
      } catch (error) { state.active = state.status ? state.status.type === 'active' : previouslyActive; throw error; }
    }
    const metadataOnly = new Set(['thread/read', 'thread/turns/list', 'thread/items/list', 'thread/archive', 'thread/unarchive', 'thread/delete', 'thread/unsubscribe', 'thread/name/set', 'thread/metadata/update']);
    if ((!state || state.peer.closed) && !metadataOnly.has(method) && method !== 'turn/interrupt') {
      const route = await this.route(null, await this.prior(id));
      await this.open('thread/resume', { threadId: id }, route); state = this.workers.get(id);
    }
    const result = await (state && !state.peer.closed ? state.peer : this.coordinator).request(method, params);
    if (state && method === 'thread/delete') {
      state.discarded = true; state.active = false; state.status = { type: 'notLoaded' };
      try { await this.retire(id, state); } catch { /* Retry cleanup after owned descendants or pending requests settle. */ }
    }
    if (state && !state.peer.closed && result?.thread?.status) {
      state.status = result.thread.status; state.active = result.thread.status.type === 'active';
    }
    return result;
  }
  async stop() {
    this.stopping = true; this.catalog.stop();
    await Promise.allSettled([...this.allPeers].map(peer => peer.stop()));
    await this.trimming;
    await this.store.writes;
    await this.preferences.writes;
  }
}
