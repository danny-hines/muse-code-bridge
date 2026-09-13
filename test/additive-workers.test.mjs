import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { AdditiveRouter } from '../src/additive-router.mjs';

const deferred = () => {
  let resolve;
  const promise = new Promise(r => { resolve = r; });
  return { promise, resolve };
};

// Deterministic lifecycle/race fixtures. Model generation and persisted history
// are covered separately against the real app-server in additive-live.test.mjs.
class Peer extends EventEmitter {
  constructor(id) {
    super(); this.id = id; this.closed = false; this.pending = new Map();
    this.loaded = [id]; this.status = { type: 'idle' }; this.terminals = [];
    this.calls = []; this.sent = [];
  }
  send(message) { this.sent.push(message); }
  async request(method, params) {
    assert.equal(this.closed, false, `request to closed worker: ${method}`);
    this.calls.push({ method, params });
    await this.beforeRequest?.(method);
    if (method === 'initialize') return {};
    if (method === 'thread/loaded/list') return { data: this.loaded };
    if (method === 'thread/backgroundTerminals/list') return { data: this.terminals, nextCursor: null };
    if (method === 'thread/unsubscribe') return { status: 'notLoaded' };
    if (method === 'thread/read' || method === 'thread/resume') return {
      thread: { id: params.threadId, modelProvider: 'openai', status: this.status, ephemeral: false },
      modelProvider: 'openai', model: params.model || 'host-model',
    };
    throw new Error(`Unexpected fixture RPC: ${method}`);
  }
  async stop() { await this.beforeStop?.(); this.closed = true; this.emit('closed'); }
}

function fixture(t, workerCacheSize = 1) {
  const coordinator = new Peer('coordinator'), responses = new Map(), routes = new Map(), created = [], events = [];
  const router = new AdditiveRouter({ coordinator, workerCacheSize,
    catalog: { resolve: async () => null, stop() {} },
    store: { get: id => routes.get(id), set: async (id, route) => { routes.set(id, route); }, writes: Promise.resolve() },
    preferences: { writes: Promise.resolve() },
    createWorker: async () => { const peer = new Peer(`new-${created.length}`); created.push(peer); return peer; },
    emit: message => { events.push(message); if (message.id !== undefined) responses.set(message.id, message); },
  });
  router.initialization = { clientInfo: { name: 'worker-fixture', version: '1' } };
  t.after(() => router.stop());
  let seq = 0;
  const request = async (method, params) => {
    const id = ++seq; await router.receive({ id, method, params });
    const response = responses.get(id); responses.delete(id);
    if (response.error) throw new Error(response.error.message);
    return response.result;
  };
  const add = (id, extra = {}) => {
    const peer = new Peer(id), route = { muse: false, model: 'host-model' };
    const state = { threadId: id, peer, route, active: false, ephemeral: false, persistedTurn: true, lastUsed: seq++, ...extra };
    routes.set(id, route); router.workers.set(id, state); router.allPeers.add(peer); router.attach(peer, state);
    return state;
  };
  return { router, coordinator, created, request, add, events };
}

test('idle cache cleanup preserves unsaved work, agents, requests, terminals, and runtime activity', async t => {
  const { router, add } = fixture(t);
  const protectedStates = [
    add('active', { active: true }), add('unsaved', { persistedTurn: false }), add('ephemeral', { ephemeral: true }),
    add('agents'), add('approval'), add('rpc'), add('terminal'), add('missed-status'),
  ];
  protectedStates[3].peer.loaded.push('child');
  protectedStates[4].peer.emit('message', { id: 1, method: 'item/commandExecution/requestApproval', params: { threadId: 'approval' } });
  protectedStates[5].peer.pending.set(1, {});
  protectedStates[6].peer.terminals.push({ processId: 'running-terminal' });
  protectedStates[7].peer.status = { type: 'active', activeFlags: [] };
  const idle = add('idle');
  await router.trimWorkers();
  assert.equal(idle.peer.closed, true);
  for (const state of protectedStates) assert.equal(state.peer.closed, false, state.threadId);
  assert.equal(router.workers.size, protectedStates.length);
  assert.equal(protectedStates[7].active, true);
});

test('child turn completion does not make a running parent eligible for eviction', async t => {
  const { router, add } = fixture(t, 0);
  const root = add('root', { active: true });
  root.peer.emit('message', { method: 'turn/completed', params: { threadId: 'child', turn: { id: 'child-turn' } } });
  root.peer.emit('message', { method: 'thread/status/changed', params: { threadId: 'child', status: { type: 'idle' } } });
  await router.trimWorkers();
  assert.equal(root.active, true); assert.equal(root.peer.closed, false);
  root.peer.emit('message', { method: 'turn/completed', params: { threadId: 'root', turn: { id: 'root-turn' } } });
  await router.trimWorkers();
  assert.equal(root.peer.closed, true);
});

test('a cancelled approval releases only its own worker and resolves the routed request ID', async t => {
  const { router, add, events } = fixture(t, 0);
  const first = add('first'), second = add('second');
  for (const state of [first, second]) state.peer.emit('message', {
    id: 1, method: 'item/commandExecution/requestApproval', params: { threadId: state.threadId },
  });
  const [firstId, secondId] = events.map(message => message.id);
  assert.notEqual(firstId, secondId);
  first.peer.emit('message', { method: 'serverRequest/resolved', params: { threadId: 'first', requestId: 1 } });
  assert.equal(events.at(-1).params.requestId, firstId);
  await router.trimWorkers();
  assert.equal(first.peer.closed, true); assert.equal(second.peer.closed, false);
  assert.equal(router.serverRequests.has(firstId), false); assert.equal(router.serverRequests.has(secondId), true);
  await router.receive({ id: firstId, result: { decision: 'decline' } });
  assert.equal(second.peer.sent.length, 0);
});

test('closing an unsaved ephemeral task frees its worker even below the cache target', async t => {
  const { router, add } = fixture(t, 4);
  const state = add('unused', { ephemeral: true, persistedTurn: false });
  state.peer.loaded = [];
  state.peer.emit('message', { method: 'thread/closed', params: { threadId: state.threadId } });
  await router.trimWorkers();
  assert.equal(state.peer.closed, true); assert.equal(router.workers.has(state.threadId), false);
  const exited = add('exited'); await exited.peer.stop();
  assert.equal(router.workers.has('exited'), false);
});

test('unsubscribing an unloaded task does not create an empty worker', async t => {
  const { request, created, coordinator } = fixture(t);
  assert.deepEqual(await request('thread/unsubscribe', { threadId: 'unloaded' }), { status: 'notLoaded' });
  assert.equal(created.length, 0); assert.equal(coordinator.calls[0].method, 'thread/unsubscribe');
});

test('queued and in-flight task requests keep their worker alive until they finish', async t => {
  const { router, add, request } = fixture(t, 0);
  const state = add('reading'), entered = deferred(), release = deferred();
  state.peer.beforeRequest = async method => { if (method === 'thread/read') { entered.resolve(); await release.promise; } };
  const first = request('thread/read', { threadId: state.threadId });
  const second = request('thread/read', { threadId: state.threadId });
  await entered.promise;
  await router.trimWorkers();
  assert.equal(state.peer.closed, false); assert.equal(router.inFlight.get(state.threadId), 2);
  release.resolve(); await Promise.all([first, second]);
  await router.trimWorkers();
  assert.equal(state.peer.closed, true); assert.equal(router.inFlight.has(state.threadId), false);
});

test('a resume arriving during eviction waits for process exit and reopens the saved task', async t => {
  const { router, add, request, created } = fixture(t);
  const old = add('old'), keep = add('keep', { active: true });
  const stopping = deferred(), stopped = deferred();
  old.peer.beforeStop = async () => { stopping.resolve(); await stopped.promise; };
  const trim = router.trimWorkers(); await stopping.promise;
  const resumed = request('thread/resume', { threadId: old.threadId });
  await new Promise(r => setImmediate(r));
  assert.equal(created.length, 0); assert.equal(old.peer.calls.some(c => c.method === 'thread/resume'), false);
  stopped.resolve(); await trim;
  assert.equal((await resumed).thread.id, old.threadId);
  assert.equal(router.workers.get(old.threadId).peer, created[0]);
  assert.equal(old.peer.closed, true); assert.equal(keep.peer.closed, false);
});

test('shutdown stops workers before waiting for outstanding cleanup RPCs', { timeout: 1000 }, async t => {
  const { router, add } = fixture(t, 0);
  const state = add('unresponsive'), entered = deferred(), release = deferred();
  state.peer.beforeRequest = async method => { if (method === 'thread/loaded/list') { entered.resolve(); await release.promise; } };
  state.peer.beforeStop = () => release.resolve();
  const trim = router.trimWorkers(); await entered.promise;
  await router.stop(); await trim;
  assert.equal(state.peer.closed, true);
});
