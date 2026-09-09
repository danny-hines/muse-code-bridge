import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MuseBridge, projectItems } from '../src/bridge.mjs';
import { museEnvironment, uuid7 } from '../src/msp.mjs';

class FakeHost extends EventEmitter {
  constructor({ mode }, db) { super(); this.mode = mode; this.db = db; this.calls = []; this.info = { serverInfo: { version: '1.0.3' }, schema: { version: 1 } }; }
  async start() { return this.info; }
  async request(method, params) {
    this.calls.push({ method, params });
    if (method === 'model/list') return { models: [], source: 'fakeCatalog' };
    if (method === 'session/start') {
      const s = { sessionId: params.sessionId, modelId: 'fixture-model', activeTurnId: null, items: [], events: [], approvals: [], userInputs: [] };
      this.db.set(s.sessionId, s); return { session: s };
    }
    const s = this.db.get(params.sessionId);
    if (!s) throw new Error('sessionNotFound');
    if (method === 'session/resume') return { session: s };
    if (method === 'turn/start') {
      s.activeTurnId = params.commandId;
      this.emit('event', 'turn/started', { sessionId: s.sessionId, turnId: s.activeTurnId });
      return { turnId: params.commandId, disposition: 'started' };
    }
    if (method === 'session/read') return { session: s, history: { items: s.items } };
    if (method === 'view/page') return { events: s.events, nextCursor: null };
    if (method === 'approval/listPending') return { approvals: s.approvals, userInputs: s.userInputs };
    if (method === 'turn/interrupt') { this.finish(s.sessionId, 'cancelled'); return { status: 'accepted' }; }
    if (method === 'approval/decide') { s.approvals = []; return { status: 'accepted' }; }
    if (method === 'userInput/answer') { s.userInputs = []; return { status: 'accepted' }; }
    throw new Error('Unhandled fixture method: ' + method);
  }
  finish(id, terminal = 'completed') {
    const s = this.db.get(id);
    const params = { sessionId: id, turnId: s.activeTurnId, terminal };
    s.items.push({ itemId: uuid7(), turnId: s.activeTurnId, kind: 'agentMessage', text: 'answer', status: terminal });
    s.events.push({ method: 'turn/completed', params });
    s.activeTurnId = null;
    this.emit('event', 'turn/completed', params);
  }
  close() { this.closed = true; this.emit('disconnect', new Error('closed')); }
}

async function setup(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'muse-bridge-test-'));
  const db = new Map(); const hosts = [];
  const hostFactory = opts => { const host = new FakeHost(opts, db); hosts.push(host); return host; };
  const bridge = new MuseBridge({ dataDir: join(directory, 'state'), hostFactory, connection: { mode: 'account' }, ...options });
  t.after(async () => { bridge.close(); await rm(directory, { recursive: true, force: true }); });
  return { bridge, directory, db, hosts, hostFactory };
}

test('account environment removes an overriding API key without mutating parent environment', () => {
  const env = { META_API_KEY: 'test-key', PATH: '/bin', HOME: '/home/test' };
  assert.equal(museEnvironment(env).META_API_KEY, undefined);
  assert.equal(env.META_API_KEY, 'test-key');
  assert.equal(museEnvironment(env).HOME, env.HOME);
});

test('reviews and code sessions use separate hosts and onRequest approval policy', async t => {
  const { bridge, directory, hosts } = await setup(t);
  const review = await bridge.start({ prompt: 'review', workspace: directory, role: 'review' });
  const code = await bridge.start({ prompt: 'implement', workspace: directory, role: 'code' });
  assert.equal(review.mode, 'read-only'); assert.equal(code.mode, 'code');
  assert.deepEqual(hosts.map(h => h.mode), ['read-only', 'code']);
  for (const host of hosts) assert.equal(host.calls.find(c => c.method === 'session/start').params.approvalMode, 'onRequest');
});

test('a second submission is rejected while a turn runs; a finished session can continue', async t => {
  const { bridge, directory, hosts } = await setup(t);
  const run = await bridge.start({ prompt: 'review', workspace: directory });
  await assert.rejects(bridge.send({ session_id: run.session_id, message: 'again' }), /still running/);
  hosts[0].finish(run.session_id);
  const poll = await bridge.poll({ session_id: run.session_id });
  assert.equal(poll.status, 'completed'); assert.equal(poll.items[0].text, 'answer');
  const next = await bridge.send({ session_id: run.session_id, message: 'follow up' });
  assert.notEqual(run.turn_id, next.turn_id);
});

test('session mode and last completed turn survive a bridge restart', async t => {
  const { bridge, directory, hosts, hostFactory } = await setup(t);
  const run = await bridge.start({ prompt: 'review', workspace: directory });
  hosts[0].finish(run.session_id); bridge.close();
  const resumed = new MuseBridge({ dataDir: join(directory, 'state'), hostFactory, connection: { mode: 'account' } });
  t.after(() => resumed.close());
  const result = await resumed.poll({ session_id: run.session_id });
  assert.equal(result.status, 'completed'); assert.equal(result.turn_id, run.turn_id);
  assert.equal(result.mode, 'read-only'); assert.equal(hosts.at(-1).mode, 'read-only');
});

test('persisted and legacy sessions reject a different authentication mode before starting Muse', async t => {
  const { bridge, directory, hosts, hostFactory } = await setup(t);
  const run = await bridge.start({ prompt: 'review', workspace: directory });
  hosts[0].finish(run.session_id); bridge.close();
  const api = new MuseBridge({ dataDir: join(directory, 'state'), hostFactory, connection: { mode: 'api-key' } });
  t.after(() => api.close());
  await assert.rejects(api.send({ session_id: run.session_id, message: 'follow up' }), /different authentication mode/);
  assert.equal(hosts.length, 1);
  const path = join(directory, 'state', run.session_id + '.json');
  const record = JSON.parse(await readFile(path)); delete record.auth_mode;
  await writeFile(path, JSON.stringify(record));
  await assert.rejects(api.poll({ session_id: run.session_id }), /different authentication mode/);
  assert.equal(hosts.length, 1);
});

test('API status and session records identify the route without exposing a credential', async t => {
  const { bridge, directory } = await setup(t, { connection: { mode: 'api-key', apiKey: 'fixture-secret' } });
  const status = await bridge.status();
  const run = await bridge.start({ prompt: 'review', workspace: directory });
  assert.equal(status.auth_mode, 'api-key');
  assert.equal(run.auth_mode, 'api-key');
  assert.ok(!JSON.stringify([status, run, await bridge.list()]).includes('fixture-secret'));
});

test('stale approval stages and persistent approvals cannot execute', async t => {
  const { bridge, directory, db, hosts } = await setup(t);
  const run = await bridge.start({ prompt: 'implement', workspace: directory, role: 'code' });
  db.get(run.session_id).approvals = [{ approvalId: 'a1', currentRequirementId: { approvalId: 'a1', sourceIndex: 2 }, availableChoices: [{ choiceId: 'once', scope: 'once' }, { choiceId: 'always', scope: 'session' }] }];
  const args = { session_id: run.session_id, approval_id: 'a1', requirement_source_index: 1, choice_id: 'once' };
  await assert.rejects(bridge.decide(args), /requirement changed/);
  await assert.rejects(bridge.decide({ ...args, requirement_source_index: 2, choice_id: 'always' }), /one-time/);
  assert.equal(hosts[0].calls.filter(c => c.method === 'approval/decide').length, 0);
  await bridge.decide({ ...args, requirement_source_index: 2 });
  assert.equal(hosts[0].calls.filter(c => c.method === 'approval/decide').length, 1);
});

test('poll wakes on completion and cancel targets the current turn', async t => {
  const { bridge, directory, hosts } = await setup(t);
  const run = await bridge.start({ prompt: 'review', workspace: directory });
  const polling = bridge.poll({ session_id: run.session_id, wait_seconds: 20 });
  setTimeout(() => { void bridge.cancel({ session_id: run.session_id }); }, 15);
  assert.equal((await polling).status, 'cancelled');
  assert.equal(hosts[0].calls.find(c => c.method === 'turn/interrupt').params.turnId, run.turn_id);
});

test('a provisional history failure cannot finish a live turn before its completion notification', async t => {
  const { bridge, directory, hosts } = await setup(t);
  const run = await bridge.start({ prompt: 'review', workspace: directory });
  const host = hosts[0];
  const request = host.request.bind(host);
  host.request = async (method, params) => {
    const result = await request(method, params);
    // Muse 1.0.3 can expose both of these snapshots while inference is active.
    if (method === 'session/read') return { ...result, session: { ...result.session, activeTurnId: null } };
    if (method === 'view/page') return { events: [{ method: 'turn/completed', params: {
      sessionId: run.session_id, turnId: run.turn_id, terminal: 'failed', reason: 'incomplete',
    } }] };
    return result;
  };
  const inProgress = await bridge.poll({ session_id: run.session_id });
  assert.equal(inProgress.status, 'running');
  assert.equal(inProgress.completion, null);
  await assert.rejects(bridge.send({ session_id: run.session_id, message: 'duplicate' }), /still running/);
  host.finish(run.session_id);
  const finished = await bridge.poll({ session_id: run.session_id });
  assert.equal(finished.status, 'completed');
  assert.equal(finished.items[0].text, 'answer');
});

test('run deadline interrupts rather than silently extending usage', async t => {
  const { bridge, directory } = await setup(t, { maxTurnMs: 20 });
  const run = await bridge.start({ prompt: 'review', workspace: directory });
  const result = await bridge.poll({ session_id: run.session_id, wait_seconds: 1 });
  assert.equal(result.status, 'cancelled'); assert.equal(result.time_limit_reached, true);
});

test('unregistered sessions and relative workspaces are rejected', async t => {
  const { bridge } = await setup(t);
  await assert.rejects(bridge.start({ prompt: 'review', workspace: '.' }), /absolute/);
  await assert.rejects(bridge.poll({ session_id: '../../credential' }), /Invalid session ID/);
  await assert.rejects(bridge.poll({ session_id: uuid7() }), /not registered/);
});

test('transcript projection excludes reasoning and older-turn output', () => {
  const items = [
    { itemId: '1', kind: 'reasoning', text: 'private', turnId: 't2' },
    { itemId: '2', kind: 'agentMessage', text: 'old', turnId: 't1' },
    { itemId: '3', kind: 'agentMessage', text: 'answer', turnId: 't2' },
  ];
  assert.deepEqual(projectItems(items, 't2').map(i => i.text), ['answer']);
});
